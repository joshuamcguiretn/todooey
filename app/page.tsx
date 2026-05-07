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
  recurrenceInterval: number;
  description: string;
  done: boolean;
  createdAt: string;
};

const STORAGE_KEY = "todoey-v1";
const DAILY_PROGRESS_KEY = "todoey-daily-progress";

type DailyProgress = {
  date: string;
  completedTodayCount: number;
};

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

function normalizeInterval(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 1;
  return Math.max(1, Math.floor(numberValue));
}

function recurrenceUnit(recurrence: Recurrence, intervalInput: unknown) {
  const interval = normalizeInterval(intervalInput);
  if (recurrence === "daily") return interval === 1 ? "day" : "days";
  if (recurrence === "weekly") return interval === 1 ? "week" : "weeks";
  if (recurrence === "monthly") return interval === 1 ? "month" : "months";
  return "";
}

function recurrenceSummary(recurrence: Recurrence, intervalInput: unknown) {
  if (recurrence === "none") return "One-time task";

  const interval = normalizeInterval(intervalInput);
  const unit = recurrenceUnit(recurrence, interval);

  return `Every ${interval} ${unit}`;
}

function advanceRecurringDate(recurrence: Recurrence, intervalInput: unknown) {
  const interval = normalizeInterval(intervalInput);
  const next = startOfDay(new Date());

  if (recurrence === "daily") {
    next.setDate(next.getDate() + interval);
  } else if (recurrence === "weekly") {
    next.setDate(next.getDate() + interval * 7);
  } else if (recurrence === "monthly") {
    next.setMonth(next.getMonth() + interval);
  }

  return formatDateInput(next);
}

export default function TodoeyPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(formatDateInput());
  const [priority, setPriority] = useState<Priority>(2);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState<number | "">(1);
  const [newDescription, setNewDescription] = useState("");
  const [showNewDescription, setShowNewDescription] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [viewMode, setViewMode] = useState<"current" | "future" | "recurring">("current");
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>({
    date: formatDateInput(),
    completedTodayCount: 0,
  });
  const [dailyProgressLoaded, setDailyProgressLoaded] = useState(false);
  const [lastCompletedTaskId, setLastCompletedTaskId] = useState<string | null>(null);
  const [completingTaskIds, setCompletingTaskIds] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState(formatDateInput());
  const [editPriority, setEditPriority] = useState<Priority>(2);
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("none");
  const [editRecurrenceInterval, setEditRecurrenceInterval] = useState<number | "">(1);
  const [editDescription, setEditDescription] = useState("");
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
          recurrenceInterval: normalizeInterval(task.recurrenceInterval ?? 1),
          description: task.description ?? "",
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
    if (!dailyProgressLoaded) return;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify(dailyProgress));
    }
  }, [dailyProgress, dailyProgressLoaded]);

  useEffect(() => {
    const savedProgress =
      typeof window !== "undefined"
        ? window.localStorage.getItem(DAILY_PROGRESS_KEY)
        : null;

    if (savedProgress) {
      try {
        const parsedProgress = JSON.parse(savedProgress) as Partial<DailyProgress>;
        const today = formatDateInput();

        if (parsedProgress.date === today) {
          setDailyProgress({
            date: today,
            completedTodayCount: Math.max(0, Number(parsedProgress.completedTodayCount ?? 0)),
          });
        } else {
          setDailyProgress({ date: today, completedTodayCount: 0 });
        }
      } catch {
        setDailyProgress({ date: formatDateInput(), completedTodayCount: 0 });
      }
    }

    setDailyProgressLoaded(true);
  }, []);

  useEffect(() => {
    taskInputRef.current?.focus();
  }, []);

  const visibleTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    if (viewMode === "future") {
      return sorted.filter(
        (task) => !task.done && !isDueTodayOrOlder(task.dueDate)
      );
    }

    if (viewMode === "recurring") {
      return sorted.filter(
        (task) => !task.done && task.recurrence !== "none"
      );
    }

    if (showCompleted) {
      return sorted.filter((task) => task.done);
    }

    return sorted.filter(
      (task) => !task.done && isDueTodayOrOlder(task.dueDate)
    );
  }, [tasks, showCompleted, viewMode]);

  const activeDueCount = useMemo(() => {
    return tasks.filter((task) => !task.done && isDueTodayOrOlder(task.dueDate)).length;
  }, [tasks]);

  const progressStats = useMemo(() => {
    const today = formatDateInput();
    const completedTodayCount = dailyProgress.date === today ? dailyProgress.completedTodayCount : 0;
    const totalTodayCount = activeDueCount + completedTodayCount;
    const percent =
      totalTodayCount === 0
        ? 100
        : Math.round((completedTodayCount / totalTodayCount) * 100);

    return {
      completedTodayCount,
      totalTodayCount,
      percent,
    };
  }, [activeDueCount, dailyProgress]);

  const editingTask = useMemo(() => {
    return tasks.find((task) => task.id === editingTaskId) ?? null;
  }, [tasks, editingTaskId]);

  function resetNewTaskInputs() {
    setTitle("");
    setDueDate(formatDateInput());
    setPriority(2);
    setRecurrence("none");
    setRecurrenceInterval(1);
    setNewDescription("");
    setShowNewDescription(false);
  }

  function addTask() {
    const cleaned = title.trim();
    if (!cleaned) return;

    const newTask: Task = {
      id: generateId(),
      title: cleaned,
      dueDate,
      priority,
      recurrence,
      recurrenceInterval: normalizeInterval(recurrenceInterval),
      description: newDescription.trim(),
      done: false,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [...prev, newTask]);
    resetNewTaskInputs();

    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 0);
  }

  function openEditor(task: Task) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDueDate(formatDateInput());
    setEditPriority(task.priority);
    setEditRecurrence(task.recurrence);
    setEditRecurrenceInterval(normalizeInterval(task.recurrenceInterval));
    setEditDescription(task.description ?? "");
  }

  function clearEditState() {
    setEditingTaskId(null);
    setEditTitle("");
    setEditDueDate(task.dueDate);
    setEditPriority(2);
    setEditRecurrence("none");
    setEditRecurrenceInterval(1);
    setEditDescription("");
  }

  function closeEditor() {
    clearEditState();
    window.setTimeout(() => {
      taskInputRef.current?.focus();
    }, 0);
  }

  function saveEdit() {
    const cleaned = editTitle.trim();
    const taskIdToSave = editingTaskId;
    if (!taskIdToSave || !cleaned) return;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskIdToSave
          ? {
              ...task,
              title: cleaned,
              dueDate: editDueDate,
              priority: editPriority,
              recurrence: editRecurrence,
              recurrenceInterval: normalizeInterval(editRecurrenceInterval),
              description: editDescription.trim(),
            }
          : task
      )
    );
    closeEditor();
  }

  function toggleDone(id: string) {
    if (completingTaskIds.includes(id)) return;

    if (editingTaskId === id) {
      clearEditState();
    }

    const taskToComplete = tasks.find((task) => task.id === id);
    if (!taskToComplete) return;

    const isRecurring =
      taskToComplete.recurrence === "daily" ||
      taskToComplete.recurrence === "weekly" ||
      taskToComplete.recurrence === "monthly";

    if (!taskToComplete.done) {
      setCompletingTaskIds((prev) => [...prev, id]);

      window.setTimeout(() => {
        setTasks((prev) =>
          prev.map((task) => {
            if (task.id !== id) return task;

            if (isRecurring) {
              return {
                ...task,
                dueDate: advanceRecurringDate(task.recurrence, task.recurrenceInterval),
                done: false,
              };
            }

            return { ...task, done: true };
          })
        );

        setCompletingTaskIds((prev) => prev.filter((taskId) => taskId !== id));

        setDailyProgress((prev) => {
          const today = formatDateInput();
          const currentCount = prev.date === today ? prev.completedTodayCount : 0;
          return {
            date: today,
            completedTodayCount: currentCount + 1,
          };
        });

        if (!isRecurring) {
          setLastCompletedTaskId(id);
          setShowCompleted(false);
        }
      }, 420);

      return;
    }

    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, done: false } : task))
    );

    if (lastCompletedTaskId === id) {
      setLastCompletedTaskId(null);
    }
  }

  function undoLastComplete() {
    if (!lastCompletedTaskId) return;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === lastCompletedTaskId ? { ...task, done: false } : task
      )
    );
    setDailyProgress((prev) => ({
      date: formatDateInput(),
      completedTodayCount: Math.max(0, prev.completedTodayCount - 1),
    }));
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
      padding: 0,
      fontFamily: "Arial, sans-serif",
    } as React.CSSProperties,
    wrap: {
      width: "100%",
      margin: 0,
    } as React.CSSProperties,
    shell: {
      minHeight: "100vh",
      background: "#17171a",
      border: "none",
      borderRadius: 0,
      overflow: "hidden",
      boxShadow: "none",
    } as React.CSSProperties,
    header: {
      background: "#3a3a3f",
      padding: "14px 18px",
      textAlign: "center",
      fontSize: "48px",
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
    progressArea: {
      background: "#c39af1",
      color: "#101012",
      padding: "0 14px 10px",
    } as React.CSSProperties,
    progressText: {
      textAlign: "center",
      fontSize: "13px",
      fontWeight: 700,
      opacity: 0.86,
      marginBottom: "6px",
    } as React.CSSProperties,
    progressTrack: {
      width: "100%",
      height: "12px",
      borderRadius: "999px",
      background: "rgba(16, 16, 18, 0.22)",
      overflow: "hidden",
    } as React.CSSProperties,
    progressFill: {
      height: "100%",
      borderRadius: "999px",
      background: "#101012",
      transition: "width 0.5s ease",
    } as React.CSSProperties,
    section: {
      padding: "14px 12px 22px",
    } as React.CSSProperties,
    viewToggleRow: {
      display: "flex",
      gap: "8px",
      marginBottom: "12px",
    } as React.CSSProperties,
    viewToggleButton: {
      flex: 1,
      padding: "10px 12px",
      borderRadius: "12px",
      border: "1px solid #3a3a40",
      background: "#151519",
      color: "#d7d7dc",
      fontWeight: 700,
      cursor: "pointer",
    } as React.CSSProperties,
    activeViewToggleButton: {
      background: "#8b5cf6",
      color: "#ffffff",
      border: "1px solid #8b5cf6",
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
    taskInputWrap: {
      position: "relative",
      width: "100%",
    } as React.CSSProperties,
    taskInputWithButton: {
      width: "100%",
      padding: "12px 44px 12px 14px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#ffffff",
      fontSize: "16px",
      boxSizing: "border-box",
      outline: "none",
    } as React.CSSProperties,
    detailsArrowButton: {
      position: "absolute",
      right: "6px",
      top: "50%",
      transform: "translateY(-50%)",
      width: "34px",
      height: "34px",
      borderRadius: "8px",
      border: "none",
      background: "transparent",
      color: "#cfcfd6",
      fontSize: "18px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
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
      alignItems: "center",
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
    intervalControl: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 10px",
      borderRadius: "999px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#cfcfd6",
      fontSize: "14px",
      fontWeight: 700,
    } as React.CSSProperties,
    intervalInput: {
      width: "58px",
      padding: "7px 8px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#ffffff",
      fontSize: "15px",
      boxSizing: "border-box",
      outline: "none",
      textAlign: "center",
    } as React.CSSProperties,
    addDetailsButton: {
      padding: "10px 12px",
      borderRadius: "12px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#cfcfd6",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "14px",
      marginBottom: "10px",
    } as React.CSSProperties,
    newDescriptionBox: {
      marginBottom: "16px",
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
    textArea: {
      width: "100%",
      minHeight: "92px",
      padding: "12px 14px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#ffffff",
      fontSize: "16px",
      boxSizing: "border-box",
      outline: "none",
      resize: "vertical",
      fontFamily: "Arial, sans-serif",
    } as React.CSSProperties,
    listWrap: {
      borderRadius: "14px",
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
      transition: "opacity 0.28s ease, transform 0.28s ease, box-shadow 0.28s ease, background 0.28s ease",
    } as React.CSSProperties,
    completingItemRow: {
      opacity: 0,
      transform: "scale(1.02)",
      background: "#1d1828",
      boxShadow: "inset 0 0 0 1px #8b5cf6, 0 0 22px rgba(139, 92, 246, 0.45)",
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
      cursor: "pointer",
      padding: "2px 0",
    } as React.CSSProperties,
    taskText: {
      display: "block",
      width: "100%",
      padding: 0,
      border: "none",
      background: "transparent",
      color: "#ffffff",
      textAlign: "left",
      fontSize: "19px",
      fontWeight: 600,
      lineHeight: 1.2,
      wordBreak: "break-word",
      cursor: "pointer",
      fontFamily: "Arial, sans-serif",
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
    modalOverlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.72)",
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "12px",
    } as React.CSSProperties,
    modal: {
      width: "100%",
      maxWidth: "560px",
      maxHeight: "92vh",
      overflowY: "auto",
      background: "#17171a",
      border: "1px solid #3f3f48",
      borderRadius: "22px",
      boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
      padding: "18px",
    } as React.CSSProperties,
    modalTitle: {
      fontSize: "24px",
      fontWeight: 800,
      marginBottom: "14px",
    } as React.CSSProperties,
    fieldGroup: {
      marginBottom: "12px",
    } as React.CSSProperties,
    fieldLabel: {
      display: "block",
      marginBottom: "6px",
      fontSize: "13px",
      color: "#aeb0b8",
      fontWeight: 700,
    } as React.CSSProperties,
    modalMetaRow: {
      display: "grid",
      gridTemplateColumns: "1fr 48px 48px",
      gap: "10px",
      alignItems: "center",
      marginBottom: "12px",
    } as React.CSSProperties,
    modalActions: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "10px",
      marginTop: "16px",
    } as React.CSSProperties,
    saveButton: {
      padding: "12px 14px",
      borderRadius: "12px",
      border: "none",
      background: "#8b5cf6",
      color: "#ffffff",
      fontWeight: 800,
      fontSize: "16px",
      cursor: "pointer",
    } as React.CSSProperties,
    cancelButton: {
      padding: "12px 14px",
      borderRadius: "12px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#ffffff",
      fontWeight: 800,
      fontSize: "16px",
      cursor: "pointer",
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

          <div style={styles.progressArea}>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${progressStats.percent}%`,
                }}
              />
            </div>
            <div style={styles.progressText}>
              {progressStats.totalTodayCount === 0
                ? "Nothing due right now"
                : `${progressStats.completedTodayCount} of ${progressStats.totalTodayCount} done`}
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.viewToggleRow}>
              <button
                style={{
                  ...styles.viewToggleButton,
                  ...(viewMode === "current" ? styles.activeViewToggleButton : {}),
                }}
                onClick={() => {
                  setViewMode("current");
                  setShowCompleted(false);
                }}
              >
                Current
              </button>

              <button
                style={{
                  ...styles.viewToggleButton,
                  ...(viewMode === "future" ? styles.activeViewToggleButton : {}),
                }}
                onClick={() => {
                  setViewMode("future");
                  setShowCompleted(false);
                }}
              >
                Future
              </button>

              <button
                style={{
                  ...styles.viewToggleButton,
                  ...(viewMode === "recurring" ? styles.activeViewToggleButton : {}),
                }}
                onClick={() => {
                  setViewMode("recurring");
                  setShowCompleted(false);
                }}
              >
                Recurring
              </button>
            </div>

            <div style={styles.mobileControls}>
              <div style={styles.taskInputWrap}>
                <input
                  ref={taskInputRef}
                  style={styles.taskInputWithButton}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTask();
                  }}
                  placeholder="What needs to get done?"
                />
                <button
                  style={styles.detailsArrowButton}
                  onClick={() => setShowNewDescription((prev) => !prev)}
                  aria-label="Toggle details"
                  title="Toggle details"
                >
                  {showNewDescription ? "▲" : "▼"}
                </button>
              </div>
              <button
                style={styles.addButton}
                onClick={addTask}
                aria-label="Add task"
                title="Add task"
              >
                +
              </button>
            </div>

            {showNewDescription ? (
              <div style={styles.newDescriptionBox}>
                <textarea
                  style={styles.textArea}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Add extra details if needed"
                />
              </div>
            ) : null}

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
                <div style={styles.intervalControl}>
                  Every
                  <input
                    style={styles.intervalInput}
                    type="number"
                    min={1}
                    value={recurrenceInterval}
                    onChange={(e) => {
  const val = e.target.value;
  if (val === "") {
    setRecurrenceInterval("");
  } else {
    setRecurrenceInterval(Number(val));
  }
}}
                  />
                  {recurrenceUnit(recurrence, recurrenceInterval)}
                </div>
              </div>
            ) : null}

            {visibleTasks.length === 0 ? (
              <div style={styles.empty}>
                {showCompleted
                  ? "No completed tasks."
                  : viewMode === "future"
                  ? "No future tasks."
                  : viewMode === "recurring"
                  ? "No recurring tasks."
                  : "Nothing showing right now."}
              </div>
            ) : (
              <div style={styles.listWrap}>
                {visibleTasks.map((task, index) => {
                  const isCompleting = completingTaskIds.includes(task.id);

                  return (
                  <div
                    key={task.id}
                    style={{
                      ...styles.itemRow,
                      ...(isCompleting ? styles.completingItemRow : {}),
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

                    <div style={styles.taskBlock} onClick={() => openEditor(task)}>
                      <div style={styles.taskText}>{task.title}</div>
                      <div style={styles.dueCell}>
                        {viewMode === "recurring"
                          ? `${recurrenceSummary(task.recurrence, task.recurrenceInterval)} · Next: ${dueText(task.dueDate)}`
                          : dueText(task.dueDate)}
                      </div>
                    </div>

                    <div style={styles.fireCell}>
  <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
    {task.priority === 1 ? <span>🔥</span> : null}
    {task.description ? <span>📝</span> : null}
  </span>
</div>
                  </div>
                  );
                })}
              </div>
            )}

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
          </div>
        </div>
      </div>

      {editingTask ? (
        <div style={styles.modalOverlay} onClick={closeEditor}>
          <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalTitle}>Edit Task</div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Task name</label>
              <input
                style={styles.input}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Date / Priority / Recurring</label>
              <div style={styles.modalMetaRow}>
                <input
                  style={styles.input}
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                />
                <button
                  style={editPriority === 1 ? styles.activeToggleIconButton : styles.toggleIconButton}
                  onClick={() => setEditPriority((prev) => (prev === 1 ? 2 : 1))}
                  aria-label="Toggle priority"
                  title="Toggle priority"
                >
                  🔥
                </button>
                <button
                  style={editRecurrence !== "none" ? styles.activeToggleIconButton : styles.toggleIconButton}
                  onClick={() => setEditRecurrence((prev) => (prev === "none" ? "daily" : "none"))}
                  aria-label="Toggle recurrence"
                  title="Toggle recurrence"
                >
                  🔄
                </button>
              </div>
            </div>

            {editRecurrence !== "none" ? (
              <div style={styles.recurrenceRow}>
                <button
                  style={editRecurrence === "daily" ? styles.recurrenceChipActive : styles.recurrenceChip}
                  onClick={() => setEditRecurrence("daily")}
                >
                  Daily
                </button>
                <button
                  style={editRecurrence === "weekly" ? styles.recurrenceChipActive : styles.recurrenceChip}
                  onClick={() => setEditRecurrence("weekly")}
                >
                  Weekly
                </button>
                <button
                  style={editRecurrence === "monthly" ? styles.recurrenceChipActive : styles.recurrenceChip}
                  onClick={() => setEditRecurrence("monthly")}
                >
                  Monthly
                </button>
                <div style={styles.intervalControl}>
                  Every
                  <input
                    style={styles.intervalInput}
                    type="number"
                    min={1}
                    value={editRecurrenceInterval}
                    onChange={(e) => setEditRecurrenceInterval(normalizeInterval(e.target.value))}
                  />
                  {recurrenceUnit(editRecurrence, editRecurrenceInterval)}
                </div>
              </div>
            ) : null}

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Description</label>
              <textarea
                style={styles.textArea}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Add extra details if needed"
              />
            </div>

            <div style={styles.modalActions}>
              <button style={styles.cancelButton} onClick={closeEditor}>
                Cancel
              </button>
              <button style={styles.saveButton} onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
