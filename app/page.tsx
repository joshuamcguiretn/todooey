"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Priority = 1 | 2;
type Recurrence = "none" | "daily" | "weekly" | "monthly";

type Task = {
  id: string;
  title: string;
  dueDate: string;
  priority: Priority;
  recurrence: Recurrence;
  done: boolean;
  createdAt: string;
};

const STORAGE_KEY = "todoey-v1";

function formatDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isDueTodayOrOlder(dueDate: string) {
  const today = formatDateInput();
  return dueDate <= today;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dueText(dueDate: string) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const due = startOfDay(new Date(year, month - 1, day));
  const today = startOfDay(new Date());
  const diffMs = today.getTime() - due.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1) return `${diffDays} days ago`;
  if (diffDays === -1) return "Tomorrow";
  return `In ${Math.abs(diffDays)} days`;
}

function advanceRecurringDate(dueDate: string, recurrence: Recurrence) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const next = new Date(year, month - 1, day);

  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (recurrence === "monthly") {
    next.setMonth(next.getMonth() + 1);
  }

  return formatDateInput(next);
}

export default function TodoeyPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(formatDateInput());
  const [priority, setPriority] = useState<Priority>(2);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [showCompleted, setShowCompleted] = useState(false);
  const [lastCompletedTaskId, setLastCompletedTaskId] = useState<string | null>(null);
  const taskInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<Task>[];

        const normalized: Task[] = parsed.map((task) => ({
          id: task.id ?? generateId(),
          title: task.title ?? "",
          dueDate: task.dueDate ?? formatDateInput(),
          priority: task.priority === 1 ? 1 : 2,
          recurrence:
            task.recurrence === "daily" ||
            task.recurrence === "weekly" ||
            task.recurrence === "monthly"
              ? task.recurrence
              : "none",
          done: Boolean(task.done),
          createdAt: task.createdAt ?? new Date().toISOString(),
        }));

        setTasks(normalized);
      } catch {
        setTasks([]);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    }
  }, [tasks]);

  useEffect(() => {
    taskInputRef.current?.focus();
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks
      .filter((task) => (showCompleted ? task.done : !task.done))
      .filter((task) => (showCompleted ? true : isDueTodayOrOlder(task.dueDate)))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [tasks, showCompleted]);

  const activeDueCount = useMemo(() => {
    return tasks.filter((task) => !task.done && isDueTodayOrOlder(task.dueDate)).length;
  }, [tasks]);

  function addTask() {
    const cleaned = title.trim();
    if (!cleaned) return;

    const newTask: Task = {
      id: generateId(),
      title: cleaned,
      dueDate,
      priority,
      recurrence,
      done: false,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [...prev, newTask]);
    setTitle("");
    setDueDate(formatDateInput());
    setPriority(2);
    setRecurrence("none");

    window.setTimeout(() => {
      taskInputRef.current?.focus();
    }, 0);
  }

  function toggleDone(id: string) {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;

        const isRecurring =
          task.recurrence === "daily" ||
          task.recurrence === "weekly" ||
          task.recurrence === "monthly";

        if (!task.done && isRecurring) {
          return {
            ...task,
            dueDate: advanceRecurringDate(task.dueDate, task.recurrence),
            done: false,
          };
        }

        const nextDone = !task.done;

        if (nextDone) {
          setLastCompletedTaskId(id);
          setShowCompleted(false);
        } else if (lastCompletedTaskId === id) {
          setLastCompletedTaskId(null);
        }

        return { ...task, done: nextDone };
      })
    );
  }

  function undoLastComplete() {
    if (!lastCompletedTaskId) return;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === lastCompletedTaskId ? { ...task, done: false } : task
      )
    );
    setLastCompletedTaskId(null);

    window.setTimeout(() => {
      taskInputRef.current?.focus();
    }, 0);
  }

  const styles = {
    page: {
      minHeight: "100vh",
      background: "#0b0b0d",
      color: "#ffffff",
      padding: "12px",
      fontFamily: "Arial, sans-serif",
    } as React.CSSProperties,
    wrap: {
      maxWidth: "1080px",
      margin: "0 auto",
    } as React.CSSProperties,
    shell: {
      background: "#17171a",
      border: "1px solid #2e2e33",
      borderRadius: "22px",
      overflow: "hidden",
      boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
    } as React.CSSProperties,
    header: {
      background: "#3a3a3f",
      padding: "16px 20px",
      textAlign: "center",
      fontSize: "52px",
      fontWeight: 800,
      letterSpacing: "-2px",
      lineHeight: 1,
    } as React.CSSProperties,
    banner: {
      background: "#c39af1",
      color: "#101012",
      textAlign: "center",
      padding: "8px 14px",
      fontSize: "22px",
      fontWeight: 800,
      lineHeight: 1.1,
    } as React.CSSProperties,
    section: {
      padding: "18px",
    } as React.CSSProperties,
    controlsRow: {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      alignItems: "center",
      marginBottom: "12px",
      flexWrap: "wrap",
    } as React.CSSProperties,
    toggleButton: {
      padding: "10px 12px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#ffffff",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "14px",
    } as React.CSSProperties,
    undoButton: {
      padding: "10px 12px",
      borderRadius: "10px",
      border: "none",
      background: "#8b5cf6",
      color: "#ffffff",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "14px",
    } as React.CSSProperties,
    mobileControls: {
      display: "grid",
      gridTemplateColumns: "1fr 56px",
      gap: "10px",
      alignItems: "center",
      marginBottom: "10px",
    } as React.CSSProperties,
    mobileMetaRow: {
      display: "grid",
      gridTemplateColumns: "1fr 48px 48px",
      gap: "10px",
      alignItems: "center",
      padding: "10px 12px",
      borderRadius: "14px",
      border: "1px solid #2f2f35",
      background: "#111114",
      marginBottom: "12px",
    } as React.CSSProperties,
    recurrenceRow: {
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
      marginBottom: "16px",
    } as React.CSSProperties,
    recurrenceChip: {
      padding: "9px 12px",
      borderRadius: "999px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#cfcfd6",
      fontSize: "14px",
      fontWeight: 700,
      cursor: "pointer",
    } as React.CSSProperties,
    recurrenceChipActive: {
      padding: "9px 12px",
      borderRadius: "999px",
      border: "1px solid #6d28d9",
      background: "#1b1525",
      color: "#ffffff",
      fontSize: "14px",
      fontWeight: 700,
      cursor: "pointer",
    } as React.CSSProperties,
    toggleIconButton: {
      width: "48px",
      height: "48px",
      borderRadius: "12px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#8b8b92",
      fontSize: "22px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 0.15s ease",
    } as React.CSSProperties,
    activeToggleIconButton: {
      width: "48px",
      height: "48px",
      borderRadius: "12px",
      border: "1px solid #6d28d9",
      background: "#15111d",
      color: "#ffffff",
      fontSize: "22px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 0.15s ease",
    } as React.CSSProperties,
    addButton: {
      width: "56px",
      height: "50px",
      borderRadius: "12px",
      border: "none",
      background: "#8b5cf6",
      color: "#ffffff",
      fontSize: "30px",
      fontWeight: 700,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    } as React.CSSProperties,
    input: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#ffffff",
      fontSize: "16px",
      boxSizing: "border-box",
      outline: "none",
    } as React.CSSProperties,
    listWrap: {
      borderRadius: "16px",
      overflow: "hidden",
      border: "1px solid #2f2f35",
      background: "#111114",
    } as React.CSSProperties,
    itemRow: {
      display: "grid",
      gridTemplateColumns: "28px 1fr 24px",
      gap: "8px",
      alignItems: "start",
      padding: "12px 8px",
      borderBottom: "1px solid #24242a",
      background: "#111114",
    } as React.CSSProperties,
    checkboxCell: {
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      paddingTop: "4px",
    } as React.CSSProperties,
    checkbox: {
      width: "18px",
      height: "18px",
      cursor: "pointer",
      margin: 0,
    } as React.CSSProperties,
    taskBlock: {
      minWidth: 0,
    } as React.CSSProperties,
    taskText: {
      fontSize: "19px",
      fontWeight: 600,
      color: "#ffffff",
      lineHeight: 1.2,
      wordBreak: "break-word",
    } as React.CSSProperties,
    dueCell: {
      fontSize: "13px",
      color: "#aeb0b8",
      marginTop: "4px",
      paddingLeft: "10px",
    } as React.CSSProperties,
    fireCell: {
      fontSize: "18px",
      lineHeight: 1,
      paddingTop: "2px",
      textAlign: "right",
    } as React.CSSProperties,
    empty: {
      background: "#111114",
      border: "1px solid #2f2f35",
      borderRadius: "16px",
      padding: "28px",
      textAlign: "center",
      color: "#9d9da5",
      fontSize: "18px",
    } as React.CSSProperties,
  };

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.shell}>
          <div style={styles.header}>ToDooey</div>

          <div style={styles.banner}>
            {showCompleted
              ? `${visibleTasks.length} completed`
              : activeDueCount === 0
              ? "And We’re Done!"
              : `${activeDueCount} task${activeDueCount === 1 ? "" : "s"} left`}
          </div>

          <div style={styles.section}>
            <div style={styles.controlsRow}>
              <button
                style={styles.toggleButton}
                onClick={() => setShowCompleted((prev) => !prev)}
              >
                {showCompleted ? "Show active" : "Show completed"}
              </button>

              {lastCompletedTaskId && !showCompleted ? (
                <button style={styles.undoButton} onClick={undoLastComplete}>
                  Undo last complete
                </button>
              ) : null}
            </div>

            <div style={styles.mobileControls}>
              <input
                ref={taskInputRef}
                style={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTask();
                }}
                placeholder="What needs to get done?"
              />
              <button
                style={styles.addButton}
                onClick={addTask}
                aria-label="Add task"
                title="Add task"
              >
                +
              </button>
            </div>

            <div style={styles.mobileMetaRow}>
              <input
                style={styles.input}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <button
                style={priority === 1 ? styles.activeToggleIconButton : styles.toggleIconButton}
                onClick={() => setPriority((prev) => (prev === 1 ? 2 : 1))}
                aria-label="Toggle priority"
                title="Toggle priority"
              >
                🔥
              </button>
              <button
                style={recurrence !== "none" ? styles.activeToggleIconButton : styles.toggleIconButton}
                onClick={() => setRecurrence((prev) => (prev === "none" ? "daily" : "none"))}
                aria-label="Toggle recurrence"
                title="Toggle recurrence"
              >
                🔄
              </button>
            </div>

            {recurrence !== "none" ? (
              <div style={styles.recurrenceRow}>
                <button
                  style={recurrence === "daily" ? styles.recurrenceChipActive : styles.recurrenceChip}
                  onClick={() => setRecurrence("daily")}
                >
                  Daily
                </button>
                <button
                  style={recurrence === "weekly" ? styles.recurrenceChipActive : styles.recurrenceChip}
                  onClick={() => setRecurrence("weekly")}
                >
                  Weekly
                </button>
                <button
                  style={recurrence === "monthly" ? styles.recurrenceChipActive : styles.recurrenceChip}
                  onClick={() => setRecurrence("monthly")}
                >
                  Monthly
                </button>
              </div>
            ) : null}

            {visibleTasks.length === 0 ? (
              <div style={styles.empty}>
                {showCompleted ? "No completed tasks." : "Nothing showing right now."}
              </div>
            ) : (
              <div style={styles.listWrap}>
                {visibleTasks.map((task, index) => (
                  <div
                    key={task.id}
                    style={{
                      ...styles.itemRow,
                      borderBottom:
                        index === visibleTasks.length - 1 ? "none" : styles.itemRow.borderBottom,
                    }}
                  >
                    <div style={styles.checkboxCell}>
                      <input
                        style={styles.checkbox}
                        type="checkbox"
                        checked={task.done}
                        onChange={() => toggleDone(task.id)}
                        aria-label={`Mark ${task.title} done`}
                      />
                    </div>

                    <div style={styles.taskBlock}>
                      <div style={styles.taskText}>{task.title}</div>
                      <div style={styles.dueCell}>{dueText(task.dueDate)}</div>
                    </div>

                    <div style={styles.fireCell}>{task.priority === 1 ? "🔥" : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}