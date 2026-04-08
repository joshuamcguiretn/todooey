"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Priority = 1 | 2 | 3;

type Task = {
  id: string;
  title: string;
  dueDate: string;
  priority: Priority;
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

export default function TodoeyPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(formatDateInput());
  const [priority, setPriority] = useState<Priority>(1);
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
        setTasks(JSON.parse(saved));
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
      done: false,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [...prev, newTask]);
    setTitle("");
    setDueDate(formatDateInput());
    setPriority(1);

    window.setTimeout(() => {
      taskInputRef.current?.focus();
    }, 0);
  }

  function toggleDone(id: string) {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;
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

  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((task) => task.id !== id));
    if (lastCompletedTaskId === id) setLastCompletedTaskId(null);
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
      gridTemplateColumns: "1fr 120px",
      gap: "10px",
      alignItems: "center",
      padding: "10px 12px",
      borderRadius: "14px",
      border: "1px solid #2f2f35",
      background: "#111114",
      marginBottom: "16px",
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
    select: {
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
      gridTemplateColumns: "34px 1fr auto 90px",
      gap: "8px",
      alignItems: "start",
      padding: "12px 10px",
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
    } as React.CSSProperties,
    actionCell: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      alignItems: "center",
    } as React.CSSProperties,
    smallButton: {
      padding: "9px 10px",
      borderRadius: "10px",
      border: "none",
      background: "#44444b",
      color: "white",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "13px",
      whiteSpace: "nowrap",
    } as React.CSSProperties,
    dangerButton: {
      padding: "9px 10px",
      borderRadius: "10px",
      border: "none",
      background: "#dc2626",
      color: "white",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "13px",
      whiteSpace: "nowrap",
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
              <select
                style={styles.select}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) as Priority)}
              >
                <option value={1}>1 - High</option>
                <option value={2}>2 - Medium</option>
                <option value={3}>3 - Low</option>
              </select>
            </div>

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

                    <div style={styles.actionCell}>
                      <button
                        style={styles.smallButton}
                        onClick={() => toggleDone(task.id)}
                      >
                        {task.done ? "Mark Active" : "Done"}
                      </button>
                      <button
                        style={styles.dangerButton}
                        onClick={() => deleteTask(task.id)}
                      >
                        Delete
                      </button>
                    </div>
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
