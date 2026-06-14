"use client";

import type { User } from "@supabase/supabase-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Priority = 1 | 2;
type Recurrence = "none" | "daily" | "weekly" | "monthly" | "fibonacci";
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Task = {
  id: string;
  listId: string;
  title: string;
  dueDate: string;
  priority: Priority;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceAnchored: boolean;
  recurrenceWeekdays: number[];
  rotationTitles: string[];
  rotationTitleIndex: number;
  description: string;
  imageDataUrl: string;
  done: boolean;
  createdAt: string;
};

type TaskList = {
  id: string;
  name: string;
  createdAt: string;
};

const STORAGE_KEY = "todoey-v1";
const DAILY_PROGRESS_KEY = "todoey-daily-progress";
const CLOUD_MIGRATION_KEY = "todoey-cloud-migrated";
const PENDING_SYNC_KEY = "todoey-pending-sync-v1";
const SYNC_BASE_KEY = "todoey-sync-base-v1";
const TASK_LISTS_KEY = "todoey-task-lists-v1";
const ACTIVE_LIST_KEY = "todoey-active-list-v1";
const DELETED_TASK_LISTS_KEY = "todoey-deleted-task-lists-v1";
const DELETE_LIST_CONFIRMATION = "delete";
const DEFAULT_LIST_ID = "home";
const LIST_LONG_PRESS_MS = 520;
const WEEKLY_INTERVAL_ENCODING_BASE = 1000;
const IMAGE_TARGET_BYTES = 550 * 1024;
const IMAGE_MAX_EDGE_STEPS = [1600, 1400, 1200, 1000, 850];
const IMAGE_QUALITY_STEPS = [0.86, 0.8, 0.74, 0.68, 0.62];
const EMAIL_REFERENCE_LETTER_COUNT = 3;
const EMAIL_REFERENCE_DIGIT_COUNT = 3;
const EMAIL_REFERENCE_DUE_DAYS = 3;
const EMAIL_REFERENCE_PATTERN = /\bRef:\s*[A-Z]{3}\d{3}\b/i;
const DEFAULT_TASK_LISTS: TaskList[] = [
  { id: DEFAULT_LIST_ID, name: "Home", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "work", name: "Work", createdAt: "2026-01-01T00:00:01.000Z" },
];

type DailyProgress = {
  date: string;
  listId: string;
  completedTodayCount: number;
};

type PendingSync = {
  taskIds: string[];
  deletedTaskIds: string[];
  progressDates: string[];
  taskUpdatedAt: string;
  progressUpdatedAt: string;
};

type TaskConflict = {
  id: string;
  base: Task | null;
  local: Task | null;
  cloud: Task | null;
};

type TaskMergeResult = {
  tasks: Task[];
  conflicts: TaskConflict[];
};

type TaskSyncResult = {
  error: string;
  savedTaskIds: string[];
  savedDeletedTaskIds: string[];
};

type DbTask = {
  id: string;
  list_id: string | null;
  title: string;
  due_date: string;
  priority: Priority;
  recurrence: Recurrence;
  recurrence_interval: number;
  recurrence_anchored: boolean | null;
  recurrence_weekdays?: number[] | null;
  rotation_titles: string[] | null;
  rotation_title_index: number | null;
  description: string | null;
  image_data_url: string | null;
  done: boolean;
  created_at: string;
};

type DbTaskList = {
  id: string;
  name: string | null;
  created_at: string | null;
};

function formatDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAtEarliestToday(date: string) {
  const today = formatDateInput();
  if (!date) return today;
  return date < today ? today : date;
}

function dateDaysFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateEmailReferenceCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const valueCount = EMAIL_REFERENCE_LETTER_COUNT + EMAIL_REFERENCE_DIGIT_COUNT;
  const values = new Uint8Array(valueCount);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    values.forEach((_, index) => {
      values[index] = Math.floor(Math.random() * 256);
    });
  }

  const letterPart = Array.from(
    values.slice(0, EMAIL_REFERENCE_LETTER_COUNT),
    (value) => letters[value % letters.length]
  ).join("");
  const digitPart = Array.from(
    values.slice(EMAIL_REFERENCE_LETTER_COUNT),
    (value) => digits[value % digits.length]
  ).join("");

  return `${letterPart}${digitPart}`;
}

function withEmailReferenceCode(title: string, code: string) {
  const reference = `Ref: ${code}`;
  const cleaned = title.trim();

  if (!cleaned) return reference;

  if (EMAIL_REFERENCE_PATTERN.test(cleaned)) {
    return cleaned.replace(EMAIL_REFERENCE_PATTERN, reference).replace(/\s{2,}/g, " ").trim();
  }

  return `${cleaned} ${reference}`;
}

function hasTextSelectionInside(element: HTMLElement) {
  if (typeof window === "undefined") return false;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return false;
  }

  const anchorInside = Boolean(selection.anchorNode && element.contains(selection.anchorNode));
  const focusInside = Boolean(selection.focusNode && element.contains(selection.focusNode));
  return anchorInside || focusInside;
}

function normalizeListId(value: unknown) {
  const listId = String(value ?? "").trim();
  return listId || DEFAULT_LIST_ID;
}

function normalizeTaskList(list: Partial<TaskList>): TaskList {
  const name = String(list.name ?? "").trim();

  return {
    id: normalizeListId(list.id),
    name: name || "Untitled",
    createdAt: list.createdAt ?? new Date().toISOString(),
  };
}

function normalizeDeletedTaskListIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeListId(item))));
}

function mergeTaskListsWithDeleted(deletedListIds: string[], ...listGroups: TaskList[][]) {
  const merged = new Map<string, TaskList>();
  const deleted = new Set(deletedListIds.map(normalizeListId));

  DEFAULT_TASK_LISTS.forEach((list) => {
    if (!deleted.has(list.id)) {
      merged.set(list.id, list);
    }
  });

  listGroups.flat().forEach((list) => {
    const normalized = normalizeTaskList(list);
    if (deleted.has(normalized.id)) return;

    const existing = merged.get(normalized.id);

    merged.set(normalized.id, {
      ...normalized,
      createdAt: existing?.createdAt ?? normalized.createdAt,
    });
  });

  const sorted = Array.from(merged.values()).sort((a, b) => {
    const defaultA = DEFAULT_TASK_LISTS.findIndex((list) => list.id === a.id);
    const defaultB = DEFAULT_TASK_LISTS.findIndex((list) => list.id === b.id);

    if (defaultA !== -1 || defaultB !== -1) {
      if (defaultA === -1) return 1;
      if (defaultB === -1) return -1;
      return defaultA - defaultB;
    }

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return sorted.length > 0 ? sorted : [DEFAULT_TASK_LISTS[0]];
}

function mergeTaskLists(...listGroups: TaskList[][]) {
  return mergeTaskListsWithDeleted([], ...listGroups);
}

function loadDeletedTaskListIds() {
  if (typeof window === "undefined") return [];

  const saved = window.localStorage.getItem(DELETED_TASK_LISTS_KEY);
  if (!saved) return [];

  try {
    return normalizeDeletedTaskListIds(JSON.parse(saved));
  } catch {
    return [];
  }
}

function saveDeletedTaskListIds(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DELETED_TASK_LISTS_KEY,
    JSON.stringify(normalizeDeletedTaskListIds(ids))
  );
}

function loadLocalTaskLists(deletedListIds = loadDeletedTaskListIds()) {
  if (typeof window === "undefined") return DEFAULT_TASK_LISTS;

  const saved = window.localStorage.getItem(TASK_LISTS_KEY);
  if (!saved) return mergeTaskListsWithDeleted(deletedListIds);

  try {
    const parsed = JSON.parse(saved) as Partial<TaskList>[];
    return mergeTaskListsWithDeleted(deletedListIds, parsed.map(normalizeTaskList));
  } catch {
    return mergeTaskListsWithDeleted(deletedListIds);
  }
}

function saveLocalTaskLists(lists: TaskList[], deletedListIds: string[] = []) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    TASK_LISTS_KEY,
    JSON.stringify(mergeTaskListsWithDeleted(deletedListIds, lists))
  );
}

function loadActiveListId(lists: TaskList[]) {
  if (typeof window === "undefined") return DEFAULT_LIST_ID;

  const saved = normalizeListId(window.localStorage.getItem(ACTIVE_LIST_KEY));
  return lists.some((list) => list.id === saved)
    ? saved
    : lists[0]?.id ?? DEFAULT_LIST_ID;
}

function saveActiveListId(listId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_LIST_KEY, normalizeListId(listId));
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

function displayDate(dueDate: string) {
  const [year, month, day] = dueDate.split("-").map(Number);
  if (!year || !month || !day) return dueDate;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function taskConflictTitle(task: Task | null) {
  return task?.title || "Deleted task";
}

function taskConflictDetails(task: Task | null) {
  if (!task) return "Deleted on this side";

  const pieces = [dueText(task.dueDate)];
  if (task.done) pieces.push("Done");
  if (task.priority === 1) pieces.push("Priority");
  if (task.recurrence !== "none") {
    pieces.push(
      recurrenceSummary(
        task.recurrence,
        task.recurrenceInterval,
        task.recurrenceWeekdays
      )
    );
  }

  return pieces.join(" - ");
}

function upcomingWorkload(tasks: Task[]) {
  const today = startOfDay(new Date());
  const counts: { label: string; count: number }[] = [];

  for (let i = 1; i <= 5; i++) {
    const future = new Date(today);
    future.setDate(future.getDate() + i);

    const key = formatDateInput(future);

    counts.push({
      label: i === 1 ? "Tomorrow" : `${i}d`,
      count: tasks.filter(
        (task) => !task.done && task.dueDate === key
      ).length,
    });
  }

  return counts;
}

function normalizeInterval(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 1;
  return Math.max(1, Math.floor(numberValue));
}

function normalizeWeekdays(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      items
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    )
  ).sort((a, b) => a - b);
}

function weekdaySummary(weekdays: number[]) {
  return normalizeWeekdays(weekdays)
    .map((dayIndex) => WEEKDAY_SHORT_NAMES[dayIndex])
    .join(", ");
}

function weekdayMask(weekdays: number[]) {
  return normalizeWeekdays(weekdays).reduce((mask, weekday) => mask | (1 << weekday), 0);
}

function weekdaysFromMask(mask: number) {
  return WEEKDAY_LABELS.map((_, index) => index).filter(
    (weekday) => (mask & (1 << weekday)) !== 0
  );
}

function encodeWeeklyInterval(
  recurrence: Recurrence,
  intervalInput: unknown,
  recurrenceWeekdays: number[]
) {
  const interval = normalizeInterval(intervalInput);
  const mask = weekdayMask(recurrenceWeekdays);

  if (recurrence !== "weekly" || mask === 0) return interval;
  return interval * WEEKLY_INTERVAL_ENCODING_BASE + mask;
}

function decodeWeeklyInterval(
  recurrence: Recurrence,
  intervalInput: unknown,
  recurrenceWeekdaysInput: unknown
) {
  const interval = normalizeInterval(intervalInput);
  const recurrenceWeekdays = normalizeWeekdays(recurrenceWeekdaysInput);

  if (recurrence !== "weekly") {
    return { interval, recurrenceWeekdays: [] };
  }

  if (recurrenceWeekdays.length > 0) {
    return { interval, recurrenceWeekdays };
  }

  if (interval < WEEKLY_INTERVAL_ENCODING_BASE) {
    return { interval, recurrenceWeekdays: [] };
  }

  const decodedInterval = Math.floor(interval / WEEKLY_INTERVAL_ENCODING_BASE);
  const mask = interval % WEEKLY_INTERVAL_ENCODING_BASE;

  if (mask <= 0 || mask > 127) {
    return { interval, recurrenceWeekdays: [] };
  }

  return {
    interval: normalizeInterval(decodedInterval),
    recurrenceWeekdays: weekdaysFromMask(mask),
  };
}

function normalizeRotationTitles(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRotationIndex(value: unknown, titles: string[], currentTitle: string) {
  if (titles.length === 0) return 0;

  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue >= 0) {
    return Math.floor(numberValue) % titles.length;
  }

  const currentIndex = titles.findIndex((title) => title === currentTitle);
  return currentIndex >= 0 ? currentIndex : 0;
}

function normalizeRecurrence(value: unknown): Recurrence {
  if (
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "fibonacci"
  ) {
    return value;
  }

  return "none";
}

function normalizeTask(task: Partial<Task>): Task {
  const title = task.title ?? "";
  const rotationTitles = normalizeRotationTitles(task.rotationTitles);
  const recurrence = normalizeRecurrence(task.recurrence);
  const dueDate = task.dueDate ?? formatDateInput();
  const recurrenceAnchored =
    typeof task.recurrenceAnchored === "boolean"
      ? task.recurrenceAnchored
      : recurrence !== "none";
  const recurrenceWeekdays = normalizeWeekdays(task.recurrenceWeekdays);

  return {
    id: task.id ?? generateId(),
    listId: normalizeListId(task.listId),
    title,
    dueDate,
    priority: task.priority === 1 ? 1 : 2,
    recurrence,
    recurrenceInterval: normalizeInterval(task.recurrenceInterval ?? 1),
    recurrenceAnchored,
    recurrenceWeekdays:
      recurrence === "weekly" && recurrenceAnchored && recurrenceWeekdays.length === 0
        ? [weekdayFromDateInput(dueDate)]
        : recurrence === "weekly"
          ? recurrenceWeekdays
          : [],
    rotationTitles,
    rotationTitleIndex: normalizeRotationIndex(
      task.rotationTitleIndex,
      rotationTitles,
      title
    ),
    description: task.description ?? "",
    imageDataUrl: task.imageDataUrl ?? "",
    done: Boolean(task.done),
    createdAt: task.createdAt ?? new Date().toISOString(),
  };
}

function loadLocalTasks() {
  if (typeof window === "undefined") return [];

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as Partial<Task>[];
    return parsed.map(normalizeTask);
  } catch {
    return [];
  }
}

function syncBaseKey(userId: string) {
  return `${SYNC_BASE_KEY}-${userId}`;
}

function loadSyncBaseTasks(userId: string) {
  if (typeof window === "undefined") return [];

  const saved = window.localStorage.getItem(syncBaseKey(userId));
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as Partial<Task>[];
    return parsed.map(normalizeTask);
  } catch {
    return [];
  }
}

function saveSyncBaseTasks(userId: string, tasks: Task[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(syncBaseKey(userId), JSON.stringify(sortTasksByDate(tasks)));
}

function saveSyncBaseTask(userId: string, taskId: string, task: Task | null) {
  const nextTasks = loadSyncBaseTasks(userId).filter((item) => item.id !== taskId);
  if (task) {
    nextTasks.push(task);
  }

  saveSyncBaseTasks(userId, nextTasks);
}

function progressSyncKey(date: string, listId: string) {
  return `${normalizeListId(listId)}::${date}`;
}

function parseProgressSyncKey(key: string) {
  const [listId, date] = key.includes("::")
    ? key.split("::")
    : [DEFAULT_LIST_ID, key];

  return {
    listId: normalizeListId(listId),
    date: date || formatDateInput(),
  };
}

function normalizeDailyProgress(progress: Partial<DailyProgress> | null): DailyProgress | null {
  if (!progress?.date) return null;

  return {
    date: String(progress.date),
    listId: normalizeListId(progress.listId),
    completedTodayCount: Math.max(0, Number(progress.completedTodayCount ?? 0)),
  };
}

function loadLocalDailyProgress() {
  if (typeof window === "undefined") return [] as DailyProgress[];

  const saved = window.localStorage.getItem(DAILY_PROGRESS_KEY);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as Partial<DailyProgress>[] | Partial<DailyProgress>;
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .map((item) => normalizeDailyProgress(item))
      .filter((item): item is DailyProgress => Boolean(item));
  } catch {
    return [];
  }
}

function mergeDailyProgressItems(
  cloudItems: DailyProgress[],
  localItems: DailyProgress[],
  pending: PendingSync
) {
  const merged = new Map(
    cloudItems.map((item) => [progressSyncKey(item.date, item.listId), item])
  );
  const localByKey = new Map(
    localItems.map((item) => [progressSyncKey(item.date, item.listId), item])
  );

  pending.progressDates.forEach((key) => {
    const { date, listId } = parseProgressSyncKey(key);
    const localItem = localByKey.get(progressSyncKey(date, listId));
    if (localItem) {
      merged.set(progressSyncKey(date, listId), localItem);
    }
  });

  return Array.from(merged.values());
}

function progressForList(progressItems: DailyProgress[], listId: string) {
  const today = formatDateInput();
  return (
    progressItems.find(
      (item) => item.date === today && normalizeListId(item.listId) === normalizeListId(listId)
    ) ?? {
      date: today,
      listId: normalizeListId(listId),
      completedTodayCount: 0,
    }
  );
}

function updateProgressCount(
  progressItems: DailyProgress[],
  listId: string,
  updater: (count: number) => number
) {
  const today = formatDateInput();
  const normalizedListId = normalizeListId(listId);
  const existing = progressForList(progressItems, normalizedListId);
  const nextProgress = {
    date: today,
    listId: normalizedListId,
    completedTodayCount: Math.max(0, updater(existing.completedTodayCount)),
  };
  const withoutExisting = progressItems.filter(
    (item) =>
      item.date !== today || normalizeListId(item.listId) !== normalizedListId
  );

  return [...withoutExisting, nextProgress];
}

function pendingSyncKey(userId: string) {
  return `${PENDING_SYNC_KEY}-${userId}`;
}

function emptyPendingSync(): PendingSync {
  return {
    taskIds: [],
    deletedTaskIds: [],
    progressDates: [],
    taskUpdatedAt: "",
    progressUpdatedAt: "",
  };
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item)).filter(Boolean)));
}

function loadPendingSync(userId: string): PendingSync {
  if (typeof window === "undefined") return emptyPendingSync();

  const saved = window.localStorage.getItem(pendingSyncKey(userId));
  if (!saved) return emptyPendingSync();

  try {
    const parsed = JSON.parse(saved) as Partial<PendingSync>;

    return {
      taskIds: uniqueStrings(parsed.taskIds),
      deletedTaskIds: uniqueStrings(parsed.deletedTaskIds),
      progressDates: uniqueStrings(parsed.progressDates),
      taskUpdatedAt: String(parsed.taskUpdatedAt ?? ""),
      progressUpdatedAt: String(parsed.progressUpdatedAt ?? ""),
    };
  } catch {
    return emptyPendingSync();
  }
}

function savePendingSync(userId: string, pending: PendingSync) {
  if (typeof window === "undefined") return;

  const hasPending =
    pending.taskIds.length > 0 ||
    pending.deletedTaskIds.length > 0 ||
    pending.progressDates.length > 0;

  if (!hasPending) {
    window.localStorage.removeItem(pendingSyncKey(userId));
    return;
  }

  window.localStorage.setItem(pendingSyncKey(userId), JSON.stringify(pending));
}

function markPendingTaskChange(userId: string, taskId: string) {
  const pending = loadPendingSync(userId);
  const now = new Date().toISOString();

  savePendingSync(userId, {
    ...pending,
    taskIds: Array.from(new Set([...pending.taskIds, taskId])),
    deletedTaskIds: pending.deletedTaskIds.filter((id) => id !== taskId),
    taskUpdatedAt: now,
  });
}

function markPendingTaskDelete(userId: string, taskId: string) {
  const pending = loadPendingSync(userId);
  const now = new Date().toISOString();

  savePendingSync(userId, {
    ...pending,
    taskIds: pending.taskIds.filter((id) => id !== taskId),
    deletedTaskIds: Array.from(new Set([...pending.deletedTaskIds, taskId])),
    taskUpdatedAt: now,
  });
}

function markPendingProgressChange(userId: string, date: string, listId: string) {
  const pending = loadPendingSync(userId);
  const now = new Date().toISOString();
  const key = progressSyncKey(date, listId);

  savePendingSync(userId, {
    ...pending,
    progressDates: Array.from(new Set([...pending.progressDates, key])),
    progressUpdatedAt: now,
  });
}

function clearPendingTaskSync(
  userId: string,
  savedTaskUpdatedAt: string,
  savedTaskIds: string[],
  savedDeletedTaskIds: string[]
) {
  if (!savedTaskUpdatedAt) return;

  const pending = loadPendingSync(userId);
  if (pending.taskUpdatedAt && pending.taskUpdatedAt !== savedTaskUpdatedAt) return;

  const nextTaskIds = pending.taskIds.filter((id) => !savedTaskIds.includes(id));
  const nextDeletedTaskIds = pending.deletedTaskIds.filter(
    (id) => !savedDeletedTaskIds.includes(id)
  );

  savePendingSync(userId, {
    ...pending,
    taskIds: nextTaskIds,
    deletedTaskIds: nextDeletedTaskIds,
    taskUpdatedAt:
      nextTaskIds.length === 0 && nextDeletedTaskIds.length === 0
        ? ""
        : pending.taskUpdatedAt,
  });
}

function clearPendingTaskDecision(userId: string, taskId: string) {
  const pending = loadPendingSync(userId);
  const nextTaskIds = pending.taskIds.filter((id) => id !== taskId);
  const nextDeletedTaskIds = pending.deletedTaskIds.filter((id) => id !== taskId);

  savePendingSync(userId, {
    ...pending,
    taskIds: nextTaskIds,
    deletedTaskIds: nextDeletedTaskIds,
    taskUpdatedAt:
      nextTaskIds.length === 0 && nextDeletedTaskIds.length === 0
        ? ""
        : pending.taskUpdatedAt,
  });
}

function clearPendingProgressSync(userId: string, savedProgressUpdatedAt: string) {
  if (!savedProgressUpdatedAt) return;

  const pending = loadPendingSync(userId);
  if (
    pending.progressUpdatedAt &&
    pending.progressUpdatedAt !== savedProgressUpdatedAt
  ) {
    return;
  }

  savePendingSync(userId, {
    ...pending,
    progressDates: [],
    progressUpdatedAt: "",
  });
}

function hasPendingTasks(pending: PendingSync) {
  return pending.taskIds.length > 0 || pending.deletedTaskIds.length > 0;
}

function hasPendingProgress(pending: PendingSync) {
  return pending.progressDates.length > 0;
}

function sortTasksByDate(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const dueDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (dueDiff !== 0) return dueDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function taskSignature(task: Task | null) {
  if (!task) return "__missing__";

  return JSON.stringify({
    listId: normalizeListId(task.listId),
    title: task.title,
    dueDate: task.dueDate,
    priority: task.priority,
    recurrence: task.recurrence,
    recurrenceInterval: normalizeInterval(task.recurrenceInterval),
    recurrenceAnchored: task.recurrenceAnchored,
    recurrenceWeekdays: normalizeWeekdays(task.recurrenceWeekdays),
    rotationTitles: task.rotationTitles,
    rotationTitleIndex: task.rotationTitleIndex,
    description: task.description,
    imageDataUrl: task.imageDataUrl,
    done: task.done,
    createdAt: task.createdAt,
  });
}

function tasksMatch(first: Task | null, second: Task | null) {
  return taskSignature(first) === taskSignature(second);
}

function taskChangedSinceBase(task: Task | null, base: Task | null) {
  return !tasksMatch(task, base);
}

function mergePendingTasks(
  cloudTasks: Task[],
  localTasks: Task[],
  baseTasks: Task[],
  pending: PendingSync
): TaskMergeResult {
  const merged = new Map(cloudTasks.map((task) => [task.id, task]));
  const localById = new Map(localTasks.map((task) => [task.id, task]));
  const cloudById = new Map(cloudTasks.map((task) => [task.id, task]));
  const baseById = new Map(baseTasks.map((task) => [task.id, task]));
  const conflicts: TaskConflict[] = [];

  pending.deletedTaskIds.forEach((id) => {
    const baseTask = baseById.get(id) ?? null;
    const cloudTask = cloudById.get(id) ?? null;

    if (baseTask && cloudTask && taskChangedSinceBase(cloudTask, baseTask)) {
      conflicts.push({
        id,
        base: baseTask,
        local: null,
        cloud: cloudTask,
      });
      return;
    }

    merged.delete(id);
  });

  pending.taskIds.forEach((id) => {
    const baseTask = baseById.get(id) ?? null;
    const localTask = localById.get(id);
    const cloudTask = cloudById.get(id) ?? null;

    if (!localTask) {
      return;
    }

    const cloudChanged = baseTask
      ? taskChangedSinceBase(cloudTask, baseTask)
      : false;

    if (cloudChanged && !tasksMatch(localTask, cloudTask)) {
      conflicts.push({
        id,
        base: baseTask,
        local: localTask,
        cloud: cloudTask,
      });
      return;
    }

    merged.set(id, localTask);
  });

  return {
    tasks: sortTasksByDate(Array.from(merged.values())),
    conflicts,
  };
}

function preserveLocalTaskListIds(cloudTasks: Task[], localTasks: Task[]) {
  const localById = new Map(localTasks.map((task) => [task.id, task]));
  const preservedTaskIds: string[] = [];

  const tasks = cloudTasks.map((task) => {
    const localTask = localById.get(task.id);
    if (!localTask || task.listId !== DEFAULT_LIST_ID || localTask.listId === DEFAULT_LIST_ID) {
      return task;
    }

    preservedTaskIds.push(task.id);
    return { ...task, listId: localTask.listId };
  });

  return { tasks, preservedTaskIds };
}

function dbTaskToTask(task: DbTask): Task {
  const recurrence = normalizeRecurrence(task.recurrence);
  const decodedWeekly = decodeWeeklyInterval(
    recurrence,
    task.recurrence_interval,
    task.recurrence_weekdays
  );

  return normalizeTask({
    id: task.id,
    listId: task.list_id ?? DEFAULT_LIST_ID,
    title: task.title,
    dueDate: task.due_date,
    priority: task.priority === 1 ? 1 : 2,
    recurrence,
    recurrenceInterval: decodedWeekly.interval,
    recurrenceAnchored: task.recurrence_anchored ?? true,
    recurrenceWeekdays: decodedWeekly.recurrenceWeekdays,
    rotationTitles: task.rotation_titles ?? [],
    rotationTitleIndex: task.rotation_title_index ?? 0,
    description: task.description ?? "",
    imageDataUrl: task.image_data_url ?? "",
    done: task.done,
    createdAt: task.created_at,
  });
}

function taskToDbTask(
  task: Task,
  userId: string,
  options = {
    includeRecurrenceAnchor: true,
    includeListId: true,
    includeRecurrenceWeekdays: true,
  }
) {
  const record = {
    id: task.id,
    user_id: userId,
    title: task.title,
    due_date: task.dueDate,
    priority: task.priority,
    recurrence: task.recurrence,
    recurrence_interval: options.includeRecurrenceWeekdays
      ? normalizeInterval(task.recurrenceInterval)
      : encodeWeeklyInterval(
          task.recurrence,
          task.recurrenceInterval,
          task.recurrenceWeekdays
        ),
    rotation_titles: task.rotationTitles,
    rotation_title_index: task.rotationTitleIndex,
    description: task.description,
    image_data_url: task.imageDataUrl,
    done: task.done,
    created_at: task.createdAt,
  };

  return {
    ...record,
    ...(options.includeListId ? { list_id: normalizeListId(task.listId) } : {}),
    ...(options.includeRecurrenceAnchor
      ? { recurrence_anchored: task.recurrenceAnchored }
      : {}),
    ...(options.includeRecurrenceWeekdays
      ? { recurrence_weekdays: normalizeWeekdays(task.recurrenceWeekdays) }
      : {}),
  };
}

function isMissingRecurrenceAnchorError(message: string) {
  return message.includes("recurrence_anchored");
}

function isMissingListColumnError(message: string) {
  return message.includes("list_id") || message.includes("task_lists");
}

function isMissingRecurrenceWeekdaysError(message: string) {
  return message.includes("recurrence_weekdays");
}

async function upsertTaskRecords(userId: string, tasks: Task[]) {
  if (!supabase || tasks.length === 0) return "";

  let includeRecurrenceAnchor = true;
  let includeListId = true;
  let includeRecurrenceWeekdays = true;

  for (let attempt = 0; attempt < 4; attempt++) {
    const records = tasks.map((task) =>
      taskToDbTask(task, userId, {
        includeRecurrenceAnchor,
        includeListId,
        includeRecurrenceWeekdays,
      })
    );
    const { error } = await supabase.from("tasks").upsert(records);

    if (!error) return "";

    if (includeRecurrenceAnchor && isMissingRecurrenceAnchorError(error.message)) {
      includeRecurrenceAnchor = false;
      continue;
    }

    if (includeListId && isMissingListColumnError(error.message)) {
      includeListId = false;
      continue;
    }

    if (includeRecurrenceWeekdays && isMissingRecurrenceWeekdaysError(error.message)) {
      includeRecurrenceWeekdays = false;
      continue;
    }

    return error.message;
  }

  return "";
}

function dateFromInput(dateInput: string) {
  const [year, month, day] = dateInput.split("-").map(Number);
  if (!year || !month || !day) return startOfDay(new Date());
  return startOfDay(new Date(year, month - 1, day));
}

function weekdayFromDateInput(dateInput: string) {
  return dateFromInput(dateInput).getDay();
}

function dateForNextWeekday(dayIndex: number) {
  const next = startOfDay(new Date());
  const daysUntil = (dayIndex - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + daysUntil);
  return formatDateInput(next);
}

function dateForSelectedWeekdays(weekdays: number[], currentDueDate: string) {
  const selected = normalizeWeekdays(weekdays);
  if (selected.length === 0) return currentDueDate;

  const candidates = selected.map((dayIndex) => dateFromInput(dateForNextWeekday(dayIndex)));
  const next = candidates.sort((a, b) => a.getTime() - b.getTime())[0];
  return formatDateInput(next);
}

function advanceWeeklyRecurringDate(
  dueDate: string,
  intervalInput: unknown,
  recurrenceWeekdays: number[]
) {
  const selected = normalizeWeekdays(recurrenceWeekdays);
  const interval = normalizeInterval(intervalInput);

  if (selected.length === 0) {
    const next = dateFromInput(dueDate);
    const today = startOfDay(new Date());

    do {
      next.setDate(next.getDate() + interval * 7);
    } while (next <= today);

    return formatDateInput(next);
  }

  const today = startOfDay(new Date());
  const due = dateFromInput(dueDate);
  const dueWeekday = due.getDay();
  const sameWeekCandidates = selected
    .filter((dayIndex) => dayIndex > dueWeekday)
    .map((dayIndex) => {
      const candidate = new Date(due);
      candidate.setDate(due.getDate() + (dayIndex - dueWeekday));
      return candidate;
    })
    .filter((candidate) => candidate > due && candidate > today)
    .sort((a, b) => a.getTime() - b.getTime());

  if (sameWeekCandidates[0]) {
    return formatDateInput(sameWeekCandidates[0]);
  }

  const dueWeekStart = new Date(due);
  dueWeekStart.setDate(due.getDate() - dueWeekday);

  const nextWeekStart = new Date(dueWeekStart);
  nextWeekStart.setDate(dueWeekStart.getDate() + interval * 7);

  let next = new Date(nextWeekStart);
  next.setDate(nextWeekStart.getDate() + selected[0]);

  while (next <= today) {
    nextWeekStart.setDate(nextWeekStart.getDate() + interval * 7);
    next = new Date(nextWeekStart);
    next.setDate(nextWeekStart.getDate() + selected[0]);
  }

  return formatDateInput(next);
}

function fibonacciDays(stepInput: unknown) {
  const step = normalizeInterval(stepInput);
  let previous = 1;
  let current = 1;

  if (step <= 2) return 1;

  for (let index = 3; index <= step; index++) {
    const next = previous + current;
    previous = current;
    current = next;
  }

  return current;
}

function recurrenceUnit(recurrence: Recurrence, intervalInput: unknown) {
  const interval = normalizeInterval(intervalInput);
  if (recurrence === "daily") return interval === 1 ? "day" : "days";
  if (recurrence === "weekly") return interval === 1 ? "week" : "weeks";
  if (recurrence === "monthly") return interval === 1 ? "month" : "months";
  return "";
}

function recurrenceSummary(
  recurrence: Recurrence,
  intervalInput: unknown,
  recurrenceWeekdays: number[] = []
) {
  if (recurrence === "none") return "One-time task";
  if (recurrence === "fibonacci") {
    const days = fibonacciDays(intervalInput);
    return `Fibonacci: next in ${days} ${days === 1 ? "day" : "days"}`;
  }

  const interval = normalizeInterval(intervalInput);
  const unit = recurrenceUnit(recurrence, interval);
  const cadence = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}`;

  if (recurrence === "weekly" && normalizeWeekdays(recurrenceWeekdays).length > 0) {
    return `${cadence} on ${weekdaySummary(recurrenceWeekdays)}`;
  }

  return cadence;
}

function advanceRecurringDate(
  dueDate: string,
  recurrence: Recurrence,
  intervalInput: unknown,
  recurrenceAnchored: boolean,
  recurrenceWeekdays: number[] = []
) {
  const interval = normalizeInterval(intervalInput);
  const today = startOfDay(new Date());
  const next =
    recurrence === "fibonacci" || !recurrenceAnchored
      ? new Date(today)
      : dateFromInput(dueDate);

  if (recurrence === "daily") {
    if (recurrenceAnchored) {
      do {
        next.setDate(next.getDate() + interval);
      } while (next <= today);
    } else {
      next.setDate(next.getDate() + interval);
    }
  } else if (recurrence === "weekly") {
    if (recurrenceAnchored && normalizeWeekdays(recurrenceWeekdays).length > 0) {
      return advanceWeeklyRecurringDate(dueDate, interval, recurrenceWeekdays);
    }

    if (recurrenceAnchored) {
      do {
        next.setDate(next.getDate() + interval * 7);
      } while (next <= today);
    } else {
      next.setDate(next.getDate() + interval * 7);
    }
  } else if (recurrence === "monthly") {
    if (recurrenceAnchored) {
      do {
        next.setMonth(next.getMonth() + interval);
      } while (next <= today);
    } else {
      next.setMonth(next.getMonth() + interval);
    }
  } else if (recurrence === "fibonacci") {
    next.setDate(next.getDate() + fibonacciDays(interval));
  }

  return formatDateInput(next);
}

function nextRecurrenceInterval(recurrence: Recurrence, intervalInput: unknown) {
  const interval = normalizeInterval(intervalInput);
  return recurrence === "fibonacci" ? interval + 1 : interval;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = dataUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not finish image compression."));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(sourceDataUrl);
  const sourceMaxEdge = Math.max(img.width, img.height);
  const candidateTypes = ["image/webp", "image/jpeg"];
  let smallestBlob: Blob | null = null;

  for (const maxEdge of IMAGE_MAX_EDGE_STEPS) {
    const scale = Math.min(1, maxEdge / sourceMaxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not compress image.");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const mimeType of candidateTypes) {
      for (const quality of IMAGE_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, mimeType, quality);
        if (!blob || blob.size === 0 || blob.type !== mimeType) continue;

        if (!smallestBlob || blob.size < smallestBlob.size) {
          smallestBlob = blob;
        }

        if (blob.size <= IMAGE_TARGET_BYTES) {
          return blobToDataUrl(blob);
        }
      }
    }
  }

  if (!smallestBlob) {
    throw new Error("Could not compress image.");
  }

  return blobToDataUrl(smallestBlob);
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 760px)");
    const updateIsDesktop = () => setIsDesktop(mediaQuery.matches);

    updateIsDesktop();
    mediaQuery.addEventListener("change", updateIsDesktop);

    return () => {
      mediaQuery.removeEventListener("change", updateIsDesktop);
    };
  }, []);

  return isDesktop;
}

function dbTaskListToTaskList(list: DbTaskList): TaskList {
  return normalizeTaskList({
    id: list.id,
    name: list.name ?? "",
    createdAt: list.created_at ?? undefined,
  });
}

function isMissingTaskListsTableError(message: string) {
  return message.includes("task_lists") || message.includes("schema cache");
}

async function fetchCloudTaskLists(userId: string) {
  if (!supabase) {
    return {
      lists: DEFAULT_TASK_LISTS,
      error: "Supabase is not configured.",
      isMissingTable: false,
    };
  }

  try {
    const { data, error } = await supabase
      .from("task_lists")
      .select("id, name, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingTaskListsTableError(error.message)) {
        return { lists: DEFAULT_TASK_LISTS, error: "", isMissingTable: true };
      }

      return { lists: DEFAULT_TASK_LISTS, error: error.message, isMissingTable: false };
    }

    return {
      lists: mergeTaskLists(((data ?? []) as DbTaskList[]).map(dbTaskListToTaskList)),
      error: "",
      isMissingTable: false,
    };
  } catch (error) {
    return {
      lists: DEFAULT_TASK_LISTS,
      error: error instanceof Error ? error.message : "Could not load task lists.",
      isMissingTable: false,
    };
  }
}

async function saveCloudTaskLists(
  userId: string,
  lists: TaskList[],
  deletedListIds: string[] = []
) {
  if (!supabase) return "Supabase is not configured.";

  try {
    const normalizedDeletedListIds = normalizeDeletedTaskListIds(deletedListIds);
    const records = mergeTaskListsWithDeleted(
      normalizedDeletedListIds,
      lists
    ).map((list) => ({
      id: list.id,
      user_id: userId,
      name: list.name,
      created_at: list.createdAt,
    }));

    if (records.length > 0) {
      const { error } = await supabase
        .from("task_lists")
        .upsert(records, { onConflict: "user_id,id" });

      if (error && isMissingTaskListsTableError(error.message)) return "";
      if (error) return error.message;
    }

    if (normalizedDeletedListIds.length > 0) {
      const { error } = await supabase
        .from("task_lists")
        .delete()
        .eq("user_id", userId)
        .in("id", normalizedDeletedListIds);

      if (error && isMissingTaskListsTableError(error.message)) return "";
      if (error) return error.message;
    }

    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Could not sync task lists.";
  }
}

async function fetchCloudTasks(userId: string) {
  if (!supabase) {
    return {
      tasks: [] as Task[],
      error: "Supabase is not configured.",
      isMissingListColumn: false,
    };
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return { tasks: [] as Task[], error: error.message, isMissingListColumn: false };
    }

    const rows = (data ?? []) as Record<string, unknown>[];

    return {
      tasks: (rows as DbTask[]).map(dbTaskToTask),
      error: "",
      isMissingListColumn: rows.length > 0 && !("list_id" in rows[0]),
    };
  } catch (error) {
    return {
      tasks: [] as Task[],
      error: error instanceof Error ? error.message : "Could not load tasks.",
      isMissingListColumn: false,
    };
  }
}

async function saveCloudTasks(userId: string, tasks: Task[]) {
  if (!supabase) return "Supabase is not configured.";

  try {
    const upsertError = await upsertTaskRecords(userId, tasks);
    if (upsertError) return upsertError;

    const { data: existingTasks, error: existingError } = await supabase
      .from("tasks")
      .select("id")
      .eq("user_id", userId);

    if (existingError) return existingError.message;

    const nextIds = new Set(tasks.map((task) => task.id));
    const idsToDelete = ((existingTasks ?? []) as { id: string }[])
      .map((task) => task.id)
      .filter((id) => !nextIds.has(id));

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("user_id", userId)
        .in("id", idsToDelete);

      if (error) return error.message;
    }

    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Could not sync tasks.";
  }
}

async function saveCloudTaskChanges(
  userId: string,
  tasks: Task[],
  pending: PendingSync,
  blockedTaskIds: Set<string>
): Promise<TaskSyncResult> {
  if (!supabase) {
    return {
      error: "Supabase is not configured.",
      savedTaskIds: [],
      savedDeletedTaskIds: [],
    };
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const taskIdsToSave = pending.taskIds.filter(
    (id) => !blockedTaskIds.has(id) && tasksById.has(id)
  );
  const deletedTaskIdsToSave = pending.deletedTaskIds.filter(
    (id) => !blockedTaskIds.has(id)
  );

  if (taskIdsToSave.length === 0 && deletedTaskIdsToSave.length === 0) {
    return { error: "", savedTaskIds: [], savedDeletedTaskIds: [] };
  }

  try {
    const records = taskIdsToSave
      .map((id) => tasksById.get(id))
      .filter((task): task is Task => Boolean(task));

    if (records.length > 0) {
      const upsertError = await upsertTaskRecords(userId, records);
      if (upsertError) {
        return { error: upsertError, savedTaskIds: [], savedDeletedTaskIds: [] };
      }
    }

    if (deletedTaskIdsToSave.length > 0) {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("user_id", userId)
        .in("id", deletedTaskIdsToSave);

      if (error) {
        return { error: error.message, savedTaskIds: [], savedDeletedTaskIds: [] };
      }
    }

    return {
      error: "",
      savedTaskIds: taskIdsToSave,
      savedDeletedTaskIds: deletedTaskIdsToSave,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not sync task changes.",
      savedTaskIds: [],
      savedDeletedTaskIds: [],
    };
  }
}

async function fetchCloudDailyProgress(userId: string) {
  if (!supabase) {
    return { progress: [] as DailyProgress[], error: "Supabase is not configured." };
  }

  try {
    const today = formatDateInput();
    const { data, error } = await supabase
      .from("daily_progress")
      .select("date, list_id, completed_today_count")
      .eq("user_id", userId)
      .eq("date", today);

    if (error) {
      if (!isMissingListColumnError(error.message)) {
        return { progress: [] as DailyProgress[], error: error.message };
      }

      const fallbackResult = await supabase
        .from("daily_progress")
        .select("date, completed_today_count")
        .eq("user_id", userId)
        .eq("date", today)
        .maybeSingle();

      if (fallbackResult.error) {
        return { progress: [] as DailyProgress[], error: fallbackResult.error.message };
      }

      return {
        progress: fallbackResult.data
          ? [
              {
                date: String(fallbackResult.data.date),
                listId: DEFAULT_LIST_ID,
                completedTodayCount: Math.max(
                  0,
                  Number(fallbackResult.data.completed_today_count ?? 0)
                ),
              },
            ]
          : [],
        error: "",
      };
    }

    return {
      progress: ((data ?? []) as (Partial<DailyProgress> & {
        list_id?: string | null;
        completed_today_count?: number | null;
      })[])
        .map((item) =>
          normalizeDailyProgress({
            date: item.date,
            listId: item.list_id ?? DEFAULT_LIST_ID,
            completedTodayCount: item.completed_today_count ?? 0,
          })
        )
        .filter((item): item is DailyProgress => Boolean(item)),
      error: "",
    };
  } catch (error) {
    return {
      progress: [] as DailyProgress[],
      error: error instanceof Error ? error.message : "Could not load progress.",
    };
  }
}

async function saveCloudDailyProgress(userId: string, progressItems: DailyProgress[]) {
  if (!supabase) return "Supabase is not configured.";

  try {
    const today = formatDateInput();
    const todaysProgress = progressItems.filter((item) => item.date === today);

    if (todaysProgress.length === 0) return "";

    const records = todaysProgress.map((progress) => ({
      user_id: userId,
      date: progress.date,
      list_id: normalizeListId(progress.listId),
      completed_today_count: Math.max(0, progress.completedTodayCount),
    }));

    const { error } = await supabase
      .from("daily_progress")
      .upsert(records, { onConflict: "user_id,list_id,date" });

    if (error && isMissingListColumnError(error.message)) {
      const fallbackCount = todaysProgress.reduce(
        (sum, progress) => sum + Math.max(0, progress.completedTodayCount),
        0
      );
      const fallbackResult = await supabase.from("daily_progress").upsert({
        user_id: userId,
        date: today,
        completed_today_count: fallbackCount,
      });

      return fallbackResult.error?.message ?? "";
    }

    return error?.message ?? "";
  } catch (error) {
    return error instanceof Error ? error.message : "Could not sync progress.";
  }
}

export default function TodoeyPage() {
  const isDesktop = useIsDesktop();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskLists, setTaskLists] = useState<TaskList[]>(DEFAULT_TASK_LISTS);
  const [deletedTaskListIds, setDeletedTaskListIds] = useState<string[]>([]);
  const [activeListId, setActiveListId] = useState(DEFAULT_LIST_ID);
  const [listSwitcherOpen, setListSwitcherOpen] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editListName, setEditListName] = useState("");
  const [deleteListConfirmName, setDeleteListConfirmName] = useState("");
  const [newListName, setNewListName] = useState("");
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(!isSupabaseConfigured);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [cloudLoaded, setCloudLoaded] = useState(!isSupabaseConfigured);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(formatDateInput());
  const [priority, setPriority] = useState<Priority>(2);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState<number | "">(1);
  const [recurrenceAnchored, setRecurrenceAnchored] = useState(false);
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([]);
  const [showRotationNames, setShowRotationNames] = useState(false);
  const [rotationText, setRotationText] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newImageDataUrl, setNewImageDataUrl] = useState("");
  const [showNewDescription, setShowNewDescription] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [viewMode, setViewMode] = useState<"current" | "future" | "recurring">("current");
  const [dailyProgress, setDailyProgress] = useState<DailyProgress[]>([]);
  const [dailyProgressLoaded, setDailyProgressLoaded] = useState(false);
  const [lastCompletedTaskId, setLastCompletedTaskId] = useState<string | null>(null);
  const [completingTaskIds, setCompletingTaskIds] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState(formatDateInput());
  const [editPriority, setEditPriority] = useState<Priority>(2);
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("none");
  const [editRecurrenceInterval, setEditRecurrenceInterval] = useState<number | "">(1);
  const [editRecurrenceAnchored, setEditRecurrenceAnchored] = useState(false);
  const [editRecurrenceWeekdays, setEditRecurrenceWeekdays] = useState<number[]>([]);
  const [showEditRotationNames, setShowEditRotationNames] = useState(false);
  const [editRotationText, setEditRotationText] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editImageDataUrl, setEditImageDataUrl] = useState("");
  const [fullScreenImage, setFullScreenImage] = useState("");
  const [taskConflicts, setTaskConflicts] = useState<TaskConflict[]>([]);
  const [syncRetryNonce, setSyncRetryNonce] = useState(0);
  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const listLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listLongPressTriggeredRef = useRef(false);
  const cloudTaskSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudProgressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editDateInputRef = useRef<HTMLInputElement | null>(null);
  const taskSelectionWasActiveOnPointerDownRef = useRef(false);

  function rememberTaskChange(taskId: string) {
    if (!user) return;
    markPendingTaskChange(user.id, taskId);
  }

  function rememberTaskDelete(taskId: string) {
    if (!user) return;
    markPendingTaskDelete(user.id, taskId);
  }

  function rememberProgressChange(date = formatDateInput(), listId = activeListId) {
    if (!user) return;
    markPendingProgressChange(user.id, date, listId);
  }

  const clearEditState = React.useCallback(() => {
    setEditingTaskId(null);
    setEditTitle("");
    setEditDueDate(formatDateInput());
    setEditPriority(2);
    setEditRecurrence("none");
    setEditRecurrenceInterval(1);
    setEditRecurrenceAnchored(false);
    setEditRecurrenceWeekdays([]);
    setShowEditRotationNames(false);
    setEditRotationText("");
    setEditDescription("");
    setEditImageDataUrl("");
  }, []);

  useEffect(() => {
    const localTasks = loadLocalTasks();
    const localDeletedTaskListIds = loadDeletedTaskListIds();
    const localTaskLists = loadLocalTaskLists(localDeletedTaskListIds);
    let isCancelled = false;

    window.queueMicrotask(() => {
      if (isCancelled) return;
      setDeletedTaskListIds(localDeletedTaskListIds);
      setTaskLists(localTaskLists);
      setActiveListId(loadActiveListId(localTaskLists));
      setTasks(localTasks);
      setTasksLoaded(true);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tasksLoaded) return;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    }
  }, [tasks, tasksLoaded]);

  useEffect(() => {
    if (!tasksLoaded) return;
    saveDeletedTaskListIds(deletedTaskListIds);
    saveLocalTaskLists(taskLists, deletedTaskListIds);
  }, [deletedTaskListIds, taskLists, tasksLoaded]);

  useEffect(() => {
    if (!tasksLoaded) return;
    saveActiveListId(activeListId);
  }, [activeListId, tasksLoaded]);

  useEffect(() => {
    if (!dailyProgressLoaded) return;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify(dailyProgress));
    }
  }, [dailyProgress, dailyProgressLoaded]);

  useEffect(() => {
    const savedProgress = loadLocalDailyProgress();
    let isCancelled = false;

    window.queueMicrotask(() => {
      if (isCancelled) return;
      setDailyProgress(savedProgress.filter((progress) => progress.date === formatDateInput()));
      setDailyProgressLoaded(true);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setUser(data.session?.user ?? null);
      setAuthLoaded(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoaded(true);
      setAuthMessage("");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;

    if (!user) {
      window.setTimeout(() => {
        setCloudLoaded(false);
      }, 0);
      return;
    }

    let isCancelled = false;

    async function loadCloudData() {
      setCloudLoaded(false);

      const [taskResult, progressResult, listResult] =
        await Promise.all([
          fetchCloudTasks(user!.id),
          fetchCloudDailyProgress(user!.id),
          fetchCloudTaskLists(user!.id),
        ]);

      if (isCancelled) return;

      if (taskResult.error) {
        setAuthMessage(taskResult.error);
        setCloudLoaded(true);
        return;
      }

      const pendingSync = loadPendingSync(user!.id);
      const localTasks = loadLocalTasks();
      const localProgress = loadLocalDailyProgress();
      const localDeletedTaskListIds = loadDeletedTaskListIds();
      const localTaskLists = loadLocalTaskLists(localDeletedTaskListIds);
      const baseTasks = loadSyncBaseTasks(user!.id);
      const cloudTaskLists = listResult.lists.filter(
        (list) => !localDeletedTaskListIds.includes(list.id)
      );
      const nextTaskLists = mergeTaskListsWithDeleted(
        localDeletedTaskListIds,
        localTaskLists,
        cloudTaskLists
      );
      const listPreservation = preserveLocalTaskListIds(taskResult.tasks, localTasks);
      const cloudTasks = listPreservation.tasks;
      const hasPendingTaskChanges = hasPendingTasks(pendingSync);
      const mergeResult = hasPendingTaskChanges
        ? mergePendingTasks(cloudTasks, localTasks, baseTasks, pendingSync)
        : ({ tasks: cloudTasks, conflicts: [] } satisfies TaskMergeResult);
      let nextTasks = mergeResult.tasks;
      const migrationKey = `${CLOUD_MIGRATION_KEY}-${user!.id}`;
      const shouldMigrateLocalTasks =
        !hasPendingTaskChanges &&
        cloudTasks.length === 0 &&
        localTasks.length > 0 &&
        typeof window !== "undefined" &&
        !window.localStorage.getItem(migrationKey);

      if (shouldMigrateLocalTasks) {
        const migrationError = await saveCloudTasks(user!.id, localTasks);

        if (isCancelled) return;

        if (migrationError) {
          setAuthMessage(migrationError);
        } else {
          nextTasks = localTasks;
          saveSyncBaseTasks(user!.id, localTasks);
          window.localStorage.setItem(migrationKey, "1");
          setAuthMessage("Moved this device's tasks into your account.");
        }
      } else if (!hasPendingTaskChanges) {
        saveSyncBaseTasks(user!.id, cloudTasks);
      }

      setTaskLists(nextTaskLists);
      setDeletedTaskListIds(localDeletedTaskListIds);
      setTasks(nextTasks);
      setTaskConflicts(mergeResult.conflicts);

      listPreservation.preservedTaskIds
        .filter((id) =>
          nextTasks.some(
            (task) => task.id === id && normalizeListId(task.listId) !== DEFAULT_LIST_ID
          )
        )
        .forEach((id) => markPendingTaskChange(user!.id, id));

      setActiveListId((current) =>
        nextTaskLists.some((list) => list.id === current) ? current : DEFAULT_LIST_ID
      );

      if (mergeResult.conflicts.length > 0) {
        setAuthMessage(
          `Sync needs a choice for ${mergeResult.conflicts.length} task${
            mergeResult.conflicts.length === 1 ? "" : "s"
          }.`
        );
      }

      if (listResult.error) {
        setAuthMessage(listResult.error);
      } else if (!listResult.isMissingTable) {
        const listSyncError = await saveCloudTaskLists(
          user!.id,
          nextTaskLists,
          localDeletedTaskListIds
        );
        if (!isCancelled && listSyncError) {
          setAuthMessage(listSyncError);
        }
      }

      if (progressResult.error) {
        setAuthMessage(progressResult.error);
      } else {
        setDailyProgress(
          hasPendingProgress(pendingSync)
            ? mergeDailyProgressItems(progressResult.progress, localProgress, pendingSync)
            : progressResult.progress
        );
      }

      setCloudLoaded(true);
    }

    loadCloudData();

    return () => {
      isCancelled = true;
    };
  }, [syncRetryNonce, user]);

  useEffect(() => {
    const requestRetry = () => {
      setSyncRetryNonce((current) => current + 1);
    };

    const requestVisibleRetry = () => {
      if (document.visibilityState === "visible") {
        requestRetry();
      }
    };

    window.addEventListener("online", requestRetry);
    window.addEventListener("focus", requestRetry);
    document.addEventListener("visibilitychange", requestVisibleRetry);

    return () => {
      window.removeEventListener("online", requestRetry);
      window.removeEventListener("focus", requestRetry);
      document.removeEventListener("visibilitychange", requestVisibleRetry);
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user || !cloudLoaded || !tasksLoaded) return;

    saveCloudTaskLists(user.id, taskLists, deletedTaskListIds).then((error) => {
      if (error) {
        setAuthMessage(error);
      }
    });
  }, [cloudLoaded, deletedTaskListIds, taskLists, tasksLoaded, user]);

  useEffect(() => {
    if (!supabase || !user || !cloudLoaded || !tasksLoaded) return;

    if (cloudTaskSaveTimerRef.current) {
      clearTimeout(cloudTaskSaveTimerRef.current);
    }

    cloudTaskSaveTimerRef.current = setTimeout(() => {
      const pendingSync = loadPendingSync(user.id);
      const blockedTaskIds = new Set(taskConflicts.map((conflict) => conflict.id));

      if (!hasPendingTasks(pendingSync)) {
        saveSyncBaseTasks(user.id, tasks);
        return;
      }

      const taskUpdatedAt = pendingSync.taskUpdatedAt;

      saveCloudTaskChanges(user.id, tasks, pendingSync, blockedTaskIds).then((result) => {
        if (result.error) {
          setAuthMessage(result.error);
          return;
        }

        if (
          result.savedTaskIds.length === 0 &&
          result.savedDeletedTaskIds.length === 0
        ) {
          return;
        }

        clearPendingTaskSync(
          user.id,
          taskUpdatedAt,
          result.savedTaskIds,
          result.savedDeletedTaskIds
        );

        const nextPendingSync = loadPendingSync(user.id);
        if (!hasPendingTasks(nextPendingSync) && taskConflicts.length === 0) {
          saveSyncBaseTasks(user.id, tasks);
        }
      });
    }, 500);

    return () => {
      if (cloudTaskSaveTimerRef.current) {
        clearTimeout(cloudTaskSaveTimerRef.current);
      }
    };
  }, [cloudLoaded, syncRetryNonce, taskConflicts, tasks, tasksLoaded, user]);

  useEffect(() => {
    if (!supabase || !user || !cloudLoaded || !dailyProgressLoaded) return;

    if (cloudProgressSaveTimerRef.current) {
      clearTimeout(cloudProgressSaveTimerRef.current);
    }

    cloudProgressSaveTimerRef.current = setTimeout(() => {
      const progressUpdatedAt = loadPendingSync(user.id).progressUpdatedAt;

      saveCloudDailyProgress(user.id, dailyProgress).then((error) => {
        if (error) {
          setAuthMessage(error);
          return;
        }

        clearPendingProgressSync(user.id, progressUpdatedAt);
      });
    }, 500);

    return () => {
      if (cloudProgressSaveTimerRef.current) {
        clearTimeout(cloudProgressSaveTimerRef.current);
      }
    };
  }, [cloudLoaded, dailyProgress, dailyProgressLoaded, syncRetryNonce, user]);

  useEffect(() => {
    taskInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!editingTaskId && !fullScreenImage) return;

    const handleBackButton = () => {
      if (fullScreenImage) {
        setFullScreenImage("");
        return;
      }

      if (editingTaskId) {
        clearEditState();
      }
    };

    window.addEventListener("popstate", handleBackButton);

    return () => {
      window.removeEventListener("popstate", handleBackButton);
    };
  }, [clearEditState, editingTaskId, fullScreenImage]);

  const activeTaskList = useMemo(() => {
    return taskLists.find((list) => list.id === activeListId) ?? taskLists[0] ?? DEFAULT_TASK_LISTS[0];
  }, [activeListId, taskLists]);

  const activeListTasks = useMemo(() => {
    return tasks.filter((task) => normalizeListId(task.listId) === activeTaskList.id);
  }, [activeTaskList.id, tasks]);

  const visibleTasks = useMemo(() => {
    const sorted = [...activeListTasks].sort((a, b) => {
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
  }, [activeListTasks, showCompleted, viewMode]);

  const activeDueCount = useMemo(() => {
    return activeListTasks.filter((task) => !task.done && isDueTodayOrOlder(task.dueDate)).length;
  }, [activeListTasks]);

  const progressStats = useMemo(() => {
    const completedTodayCount = progressForList(
      dailyProgress,
      activeTaskList.id
    ).completedTodayCount;
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
  }, [activeDueCount, activeTaskList.id, dailyProgress]);

  const workloadForecast = useMemo(() => {
    return upcomingWorkload(activeListTasks);
  }, [activeListTasks]);

  const editingTaskList = useMemo(() => {
    return taskLists.find((list) => list.id === editingListId) ?? null;
  }, [editingListId, taskLists]);

  const editingTask = useMemo(() => {
    return tasks.find((task) => task.id === editingTaskId) ?? null;
  }, [tasks, editingTaskId]);

  const activeTaskConflict = taskConflicts[0] ?? null;

  function toggleWeeklyAnchor(dayIndex: number) {
    const currentWeekdays = recurrence === "weekly" ? recurrenceWeekdays : [];
    const nextWeekdays = currentWeekdays.includes(dayIndex)
      ? currentWeekdays.filter((weekday) => weekday !== dayIndex)
      : normalizeWeekdays([...currentWeekdays, dayIndex]);

    setRecurrence("weekly");
    setRecurrenceWeekdays(nextWeekdays);
    setRecurrenceAnchored(nextWeekdays.length > 0);

    if (nextWeekdays.length > 0) {
      setDueDate(dateForSelectedWeekdays(nextWeekdays, dueDate));
    }
  }

  function toggleEditWeeklyAnchor(dayIndex: number) {
    const currentWeekdays = editRecurrence === "weekly" ? editRecurrenceWeekdays : [];
    const nextWeekdays = currentWeekdays.includes(dayIndex)
      ? currentWeekdays.filter((weekday) => weekday !== dayIndex)
      : normalizeWeekdays([...currentWeekdays, dayIndex]);

    setEditRecurrence("weekly");
    setEditRecurrenceWeekdays(nextWeekdays);
    setEditRecurrenceAnchored(nextWeekdays.length > 0);

    if (nextWeekdays.length > 0) {
      setEditDueDate(dateForSelectedWeekdays(nextWeekdays, editDueDate));
    }
  }

  function openEditDatePicker() {
    if (!editDateInputRef.current) return;

    const today = formatDateInput();
    editDateInputRef.current.min = today;
    editDateInputRef.current.value = editDueDate >= today ? editDueDate : "";

    try {
      editDateInputRef.current.showPicker();
    } catch {
      editDateInputRef.current.focus();
      editDateInputRef.current.click();
    }
  }

  function resolveTaskConflict(conflictId: string, choice: "local" | "cloud") {
    const conflict = taskConflicts.find((item) => item.id === conflictId);
    if (!conflict || !user) return;

    const chosenTask = choice === "local" ? conflict.local : conflict.cloud;

    if (choice === "local") {
      saveSyncBaseTask(user.id, conflictId, conflict.cloud);

      if (chosenTask) {
        rememberTaskChange(conflictId);
      } else {
        rememberTaskDelete(conflictId);
      }
    } else {
      clearPendingTaskDecision(user.id, conflictId);
    }

    setTasks((prev) => {
      const withoutConflict = prev.filter((task) => task.id !== conflictId);
      return chosenTask
        ? sortTasksByDate([...withoutConflict, chosenTask])
        : withoutConflict;
    });

    const remainingConflicts = taskConflicts.filter((item) => item.id !== conflictId);
    setTaskConflicts(remainingConflicts);
    setAuthMessage(
      remainingConflicts.length > 0
        ? `Sync needs a choice for ${remainingConflicts.length} task${
            remainingConflicts.length === 1 ? "" : "s"
          }.`
        : ""
    );
    setSyncRetryNonce((current) => current + 1);
  }

  async function submitAuth(mode: "sign-in" | "sign-up") {
    if (!supabase || authBusy) return;

    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthMessage("Enter an email and password.");
      return;
    }

    setAuthBusy(true);
    setAuthMessage(mode === "sign-in" ? "Signing in..." : "Creating account...");

    const { data, error } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({
            email,
            password: authPassword,
          })
        : await supabase.auth.signUp({
            email,
            password: authPassword,
            options: {
              emailRedirectTo: window.location.origin,
            },
          });

    setAuthBusy(false);

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    if (mode === "sign-up" && !data.session) {
      setAuthMessage("Check your email to finish creating the account.");
      return;
    }

    setAuthPassword("");
    setAuthMessage("Signed in. Sync is starting.");
  }

  async function signOut() {
    if (!supabase || authBusy) return;

    setAuthBusy(true);
    const { error } = await supabase.auth.signOut();
    setAuthBusy(false);

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    setUser(null);
    setCloudLoaded(false);
    setAuthPassword("");
    setAuthMessage("Signed out.");
  }

  function resetNewTaskInputs() {
    setTitle("");
    setDueDate(formatDateInput());
    setPriority(2);
    setRecurrence("none");
    setRecurrenceInterval(1);
    setRecurrenceAnchored(false);
    setRecurrenceWeekdays([]);
    setShowRotationNames(false);
    setRotationText("");
    setNewDescription("");
    setNewImageDataUrl("");
    setShowNewDescription(false);
  }

  function addTask() {
    const rotationTitles = recurrence === "none" ? [] : normalizeRotationTitles(rotationText);
    const cleaned = rotationTitles[0] ?? title.trim();
    if (!cleaned) return;
    const selectedWeekdays =
      recurrence === "weekly" && recurrenceAnchored
        ? normalizeWeekdays(recurrenceWeekdays)
        : [];

    const newTask: Task = {
      id: generateId(),
      listId: normalizeListId(activeListId),
      title: cleaned,
      dueDate,
      priority,
      recurrence,
      recurrenceInterval: normalizeInterval(recurrenceInterval),
      recurrenceAnchored:
        recurrence === "weekly"
          ? selectedWeekdays.length > 0
          : recurrence !== "fibonacci" && recurrenceAnchored,
      recurrenceWeekdays: selectedWeekdays,
      rotationTitles,
      rotationTitleIndex: 0,
      description: newDescription.trim(),
      imageDataUrl: newImageDataUrl,
      done: false,
      createdAt: new Date().toISOString(),
    };

    rememberTaskChange(newTask.id);
    setTasks((prev) => [...prev, newTask]);
    resetNewTaskInputs();

    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 0);
  }

  function createEmailReferenceTask() {
    const code = generateEmailReferenceCode();
    setTitle((currentTitle) => withEmailReferenceCode(currentTitle, code));
    setDueDate(dateDaysFromToday(EMAIL_REFERENCE_DUE_DAYS));
  }

  function openEditor(task: Task) {
    if (!editingTaskId && typeof window !== "undefined") {
      window.history.pushState({ todoeyOverlay: "edit" }, "", window.location.href);
    }

    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDueDate(task.dueDate);
    setEditPriority(task.priority);
    setEditRecurrence(task.recurrence);
    setEditRecurrenceInterval(normalizeInterval(task.recurrenceInterval));
    setEditRecurrenceAnchored(task.recurrence !== "fibonacci" && task.recurrenceAnchored);
    setEditRecurrenceWeekdays(task.recurrence === "weekly" ? task.recurrenceWeekdays : []);
    setShowEditRotationNames((task.rotationTitles ?? []).length > 0);
    setEditRotationText((task.rotationTitles ?? []).join("\n"));
    setEditDescription(task.description ?? "");
    setEditImageDataUrl(task.imageDataUrl ?? "");
  }

  function closeEditor() {
    if (editingTaskId && typeof window !== "undefined") {
      window.history.back();
    } else {
      clearEditState();
    }

    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 0);
  }

  function openFullScreenImage(imageDataUrl: string) {
    if (!imageDataUrl) return;

    if (!fullScreenImage && typeof window !== "undefined") {
      window.history.pushState({ todoeyOverlay: "image" }, "", window.location.href);
    }

    setFullScreenImage(imageDataUrl);
  }

  function closeFullScreenImage() {
    if (fullScreenImage && typeof window !== "undefined") {
      window.history.back();
    } else {
      setFullScreenImage("");
    }
  }

  function saveEdit() {
    const cleaned = editTitle.trim();
    const taskIdToSave = editingTaskId;
    if (!taskIdToSave || !cleaned) return;

    const rotationTitles =
      editRecurrence === "none" ? [] : normalizeRotationTitles(editRotationText);
    const selectedWeekdays =
      editRecurrence === "weekly" && editRecurrenceAnchored
        ? normalizeWeekdays(editRecurrenceWeekdays)
        : [];

    rememberTaskChange(taskIdToSave);
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskIdToSave
          ? (() => {
              const rotationTitleIndex = normalizeRotationIndex(
                task.rotationTitleIndex,
                rotationTitles,
                cleaned
              );

              return {
                ...task,
                title: rotationTitles[rotationTitleIndex] ?? cleaned,
                dueDate: editDueDate,
                priority: editPriority,
                recurrence: editRecurrence,
                recurrenceInterval: normalizeInterval(editRecurrenceInterval),
                recurrenceAnchored:
                  editRecurrence === "weekly"
                    ? selectedWeekdays.length > 0
                    : editRecurrence !== "fibonacci" && editRecurrenceAnchored,
                recurrenceWeekdays: selectedWeekdays,
                rotationTitles,
                rotationTitleIndex,
                description: editDescription.trim(),
                imageDataUrl: editImageDataUrl,
              };
            })()
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
      taskToComplete.recurrence === "monthly" ||
      taskToComplete.recurrence === "fibonacci";

    if (!taskToComplete.done) {
      setCompletingTaskIds((prev) => [...prev, id]);

      window.setTimeout(() => {
        rememberTaskChange(id);
        rememberProgressChange(formatDateInput(), taskToComplete.listId);

        setTasks((prev) =>
          prev.map((task) => {
            if (task.id !== id) return task;

            if (isRecurring) {
              const rotationTitles = normalizeRotationTitles(task.rotationTitles);
              const nextRotationTitleIndex =
                rotationTitles.length > 0
                  ? (normalizeRotationIndex(
                      task.rotationTitleIndex,
                      rotationTitles,
                      task.title
                    ) +
                      1) %
                    rotationTitles.length
                  : 0;

              return {
                ...task,
                title: rotationTitles[nextRotationTitleIndex] ?? task.title,
                dueDate: advanceRecurringDate(
                  task.dueDate,
                  task.recurrence,
                  task.recurrenceInterval,
                  task.recurrenceAnchored,
                  task.recurrenceWeekdays
                ),
                recurrenceInterval: nextRecurrenceInterval(
                  task.recurrence,
                  task.recurrenceInterval
                ),
                rotationTitles,
                rotationTitleIndex: nextRotationTitleIndex,
                done: false,
              };
            }

            return { ...task, done: true };
          })
        );

        setCompletingTaskIds((prev) => prev.filter((taskId) => taskId !== id));

        setDailyProgress((prev) =>
          updateProgressCount(prev, taskToComplete.listId, (count) => count + 1)
        );

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
    rememberTaskChange(id);

    if (lastCompletedTaskId === id) {
      setLastCompletedTaskId(null);
    }
  }

  function deleteRecurringTask(task: Task) {
    const shouldDelete = window.confirm(
      `Delete this recurring task?\n\n${task.title}`
    );

    if (!shouldDelete) return;

    if (editingTaskId === task.id) {
      clearEditState();
    }

    rememberTaskDelete(task.id);
    setTasks((prev) => prev.filter((item) => item.id !== task.id));
  }

  function selectTaskList(listId: string) {
    const nextListId = normalizeListId(listId);

    if (nextListId !== activeListId) {
      resetNewTaskInputs();
    }

    setActiveListId(nextListId);
    setListSwitcherOpen(false);
    setShowCompleted(false);
    setNewListName("");

    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 0);
  }

  function openListSwitcher() {
    setNewListName("");
    setEditingListId(null);
    setEditListName("");
    setDeleteListConfirmName("");
    setListSwitcherOpen(true);
  }

  function openListEditor(list: TaskList) {
    setEditingListId(list.id);
    setEditListName(list.name);
    setDeleteListConfirmName("");
  }

  function closeListEditor() {
    setEditingListId(null);
    setEditListName("");
    setDeleteListConfirmName("");
  }

  function saveListName() {
    if (!editingTaskList) return;

    const cleaned = editListName.trim();
    if (!cleaned) return;

    const duplicate = taskLists.some(
      (list) =>
        list.id !== editingTaskList.id &&
        list.name.toLowerCase() === cleaned.toLowerCase()
    );

    if (duplicate) {
      setAuthMessage("A list with that name already exists.");
      return;
    }

    setTaskLists((prev) =>
      prev.map((list) =>
        list.id === editingTaskList.id ? { ...list, name: cleaned } : list
      )
    );
    setEditListName(cleaned);
    setAuthMessage("");
  }

  function deleteTaskList() {
    if (!editingTaskList) return;
    if (taskLists.length <= 1) return;
    if (deleteListConfirmName.trim().toLowerCase() !== DELETE_LIST_CONFIRMATION) return;

    const destinationList = taskLists.find((list) => list.id !== editingTaskList.id);
    if (!destinationList) return;

    const movedTaskIds = tasks
      .filter((task) => normalizeListId(task.listId) === editingTaskList.id)
      .map((task) => task.id);

    movedTaskIds.forEach(rememberTaskChange);

    setTasks((prev) =>
      prev.map((task) =>
        normalizeListId(task.listId) === editingTaskList.id
          ? { ...task, listId: destinationList.id }
          : task
      )
    );
    setTaskLists((prev) => prev.filter((list) => list.id !== editingTaskList.id));
    setDeletedTaskListIds((prev) =>
      Array.from(new Set([...prev, editingTaskList.id]))
    );
    setDailyProgress((prev) =>
      prev.filter((progress) => normalizeListId(progress.listId) !== editingTaskList.id)
    );

    if (activeTaskList.id === editingTaskList.id) {
      setActiveListId(destinationList.id);
    }

    closeListEditor();
    setNewListName("");
    setAuthMessage(
      movedTaskIds.length > 0
        ? `Deleted list. Moved ${movedTaskIds.length} task${
            movedTaskIds.length === 1 ? "" : "s"
          } to ${destinationList.name}.`
        : "Deleted list."
    );
  }

  function cycleTaskList() {
    const lists = taskLists.length > 0 ? taskLists : DEFAULT_TASK_LISTS;
    const currentIndex = lists.findIndex((list) => list.id === activeTaskList.id);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % lists.length : 0;
    const nextList = lists[nextIndex];

    if (nextList) {
      selectTaskList(nextList.id);
    }
  }

  function clearListLongPressTimer() {
    if (listLongPressTimerRef.current) {
      clearTimeout(listLongPressTimerRef.current);
      listLongPressTimerRef.current = null;
    }
  }

  function startListLongPress(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    clearListLongPressTimer();
    listLongPressTriggeredRef.current = false;

    listLongPressTimerRef.current = setTimeout(() => {
      listLongPressTriggeredRef.current = true;
      listLongPressTimerRef.current = null;
      openListSwitcher();
    }, LIST_LONG_PRESS_MS);
  }

  function finishListPress() {
    const wasLongPress = listLongPressTriggeredRef.current;
    clearListLongPressTimer();
    listLongPressTriggeredRef.current = false;

    if (!wasLongPress) {
      cycleTaskList();
    }
  }

  function cancelListPress() {
    clearListLongPressTimer();
  }

  function addTaskList() {
    const cleaned = newListName.trim();
    if (!cleaned) return;

    const existing = taskLists.find(
      (list) => list.name.toLowerCase() === cleaned.toLowerCase()
    );

    if (existing) {
      selectTaskList(existing.id);
      return;
    }

    const newList: TaskList = {
      id: `list-${generateId()}`,
      name: cleaned,
      createdAt: new Date().toISOString(),
    };

    setTaskLists((prev) => mergeTaskLists(prev, [newList]));
    selectTaskList(newList.id);
  }

  function undoLastComplete() {
    if (!lastCompletedTaskId) return;

    const taskToUndo = tasks.find((task) => task.id === lastCompletedTaskId);
    const progressListId = taskToUndo?.listId ?? activeTaskList.id;

    rememberTaskChange(lastCompletedTaskId);
    rememberProgressChange(formatDateInput(), progressListId);
    setTasks((prev) =>
      prev.map((task) =>
        task.id === lastCompletedTaskId ? { ...task, done: false } : task
      )
    );
    setDailyProgress((prev) =>
      updateProgressCount(prev, progressListId, (count) => count - 1)
    );
    setLastCompletedTaskId(null);

    window.setTimeout(() => {
      taskInputRef.current?.focus();
    }, 0);
  }

  const styles = {
    launchSplash: {
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#fbf8f0",
      color: "#171717",
    } as React.CSSProperties,
    launchSplashArt: {
      width: "min(84vw, 380px)",
      height: "min(84vh, 820px)",
      backgroundImage: 'url("/splash/todooey-splash-1170x2532.jpg")',
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      backgroundSize: "contain",
    } as React.CSSProperties,
    page: {
      minHeight: "100vh",
      background: "#0b0b0d",
      color: "#ffffff",
      padding: isDesktop ? "28px 18px" : 0,
      fontFamily: "Arial, sans-serif",
    } as React.CSSProperties,
    wrap: {
      width: "100%",
      maxWidth: isDesktop ? "520px" : "none",
      margin: isDesktop ? "0 auto" : 0,
    } as React.CSSProperties,
    shell: {
      position: "relative",
      minHeight: isDesktop ? "calc(100vh - 56px)" : "100vh",
      background: "#17171a",
      border: isDesktop ? "1px solid #2f2f35" : "none",
      borderRadius: isDesktop ? "24px" : 0,
      overflow: "hidden",
      boxShadow: isDesktop ? "0 24px 80px rgba(0,0,0,0.42)" : "none",
    } as React.CSSProperties,
    header: {
      background: "#3a3a3f",
      padding: "10px 18px 12px",
      textAlign: "center",
      userSelect: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
    syncPill: {
      position: "absolute",
      top: "10px",
      right: "10px",
      zIndex: 45,
      padding: "5px 8px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(17, 17, 20, 0.76)",
      color: "#efe7ff",
      fontSize: "11px",
      fontWeight: 800,
      lineHeight: 1,
      letterSpacing: 0,
      pointerEvents: "none",
      boxShadow: "0 8px 22px rgba(0,0,0,0.26)",
      backdropFilter: "blur(8px)",
    } as React.CSSProperties,
    headerButton: {
      position: "relative",
      display: "inline-block",
      border: "none",
      background: "transparent",
      color: "#ffffff",
      padding: "4px 44px 10px",
      cursor: "pointer",
      fontFamily: "Arial, sans-serif",
      touchAction: "manipulation",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
      WebkitTouchCallout: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
    headerWord: {
      fontSize: "48px",
      fontWeight: 800,
      letterSpacing: 0,
      lineHeight: 1,
      userSelect: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
    listSplash: {
      position: "absolute",
      right: "18px",
      bottom: "0",
      transform: "rotate(-12deg)",
      color: "#facc15",
      fontSize: "14px",
      fontWeight: 900,
      letterSpacing: 0,
      lineHeight: 1,
      textShadow: "0 2px 0 rgba(0,0,0,0.45)",
      maxWidth: "110px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      userSelect: "none",
      WebkitUserSelect: "none",
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
    workloadForecast: {
      display: "flex",
      gap: "8px",
      overflowX: "auto",
      padding: "2px 0",
      marginBottom: "12px",
    } as React.CSSProperties,
    workloadDay: {
      minWidth: "58px",
      borderRadius: "12px",
      padding: "8px 6px",
      background: "#111114",
      border: "1px solid #2f2f35",
      color: "#ffffff",
      textAlign: "center",
    } as React.CSSProperties,
    workloadLabel: {
      fontSize: "11px",
      fontWeight: 700,
      opacity: 0.72,
      marginBottom: "4px",
    } as React.CSSProperties,
    workloadCount: {
      fontSize: "18px",
      fontWeight: 800,
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
      padding: "14px 12px 96px",
    } as React.CSSProperties,
    viewToggleRow: {
      display: "flex",
      gap: "8px",
      marginBottom: "12px",
    } as React.CSSProperties,
    bottomNav: {
      position: "fixed",
      left: isDesktop ? "50%" : "10px",
      right: isDesktop ? "auto" : "10px",
      bottom: isDesktop ? "28px" : "10px",
      width: isDesktop ? "calc(520px - 36px)" : "auto",
      transform: isDesktop ? "translateX(-50%)" : "none",
      zIndex: 40,
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: "8px",
      padding: "8px",
      borderRadius: "18px",
      border: "1px solid #2f2f35",
      background: "rgba(17, 17, 20, 0.96)",
      boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
      backdropFilter: "blur(10px)",
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
    authWrap: {
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "18px",
    } as React.CSSProperties,
    authCard: {
      width: "100%",
      maxWidth: "420px",
      border: "1px solid #2f2f35",
      background: "#17171a",
      borderRadius: "22px",
      boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
      padding: "18px",
    } as React.CSSProperties,
    authBrand: {
      fontSize: "38px",
      fontWeight: 800,
      lineHeight: 1,
      marginBottom: "14px",
    } as React.CSSProperties,
    accountTitle: {
      color: "#ffffff",
      fontSize: "14px",
      fontWeight: 800,
    } as React.CSSProperties,
    accountSubtext: {
      color: "#aeb0b8",
      fontSize: "12px",
      fontWeight: 700,
      marginTop: "3px",
    } as React.CSSProperties,
    accountForm: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "8px",
      marginTop: "10px",
    } as React.CSSProperties,
    accountButtonRow: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px",
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
    signOutArea: {
      display: "flex",
      justifyContent: "center",
      marginTop: "18px",
      paddingTop: "14px",
      borderTop: "1px solid #24242a",
    } as React.CSSProperties,
    signOutButton: {
      padding: "10px 14px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "transparent",
      color: "#aeb0b8",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "13px",
    } as React.CSSProperties,
    mobileControls: {
      display: "grid",
      gridTemplateColumns: "1fr 48px 56px",
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
    emailReferenceButton: {
      width: "48px",
      height: "50px",
      borderRadius: "12px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#ffffff",
      fontSize: "22px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
      userSelect: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
    mobileMetaRow: {
      display: "grid",
      gridTemplateColumns: "1fr 48px 48px 48px",
      gap: "10px",
      alignItems: "center",
      padding: "10px 12px",
      borderRadius: "14px",
      border: "1px solid #2f2f35",
      background: "#111114",
      marginBottom: "12px",
    } as React.CSSProperties,
    activeCameraIconButton: {
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
    cameraIcon: {
      display: "block",
      lineHeight: 1,
      transform: "translateY(-1px)",
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
    weekdayPicker: {
      width: "100%",
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: "6px",
    } as React.CSSProperties,
    weekdayButton: {
      height: "38px",
      borderRadius: "999px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#cfcfd6",
      fontSize: "14px",
      fontWeight: 800,
      cursor: "pointer",
    } as React.CSSProperties,
    weekdayButtonActive: {
      height: "38px",
      borderRadius: "999px",
      border: "1px solid #6d28d9",
      background: "#1b1525",
      color: "#ffffff",
      fontSize: "14px",
      fontWeight: 800,
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
    imagePreview: {
      width: "100%",
      maxHeight: "220px",
      objectFit: "cover",
      borderRadius: "14px",
      border: "1px solid #3f3f48",
      marginTop: "10px",
    } as React.CSSProperties,
    imageButtonRow: {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
      marginTop: "10px",
    } as React.CSSProperties,
    imageActionButton: {
      padding: "10px 12px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#111114",
      color: "#ffffff",
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "14px",
    } as React.CSSProperties,
    hiddenFileInput: {
      display: "none",
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
    dateButtonWrap: {
      position: "relative",
      width: "100%",
    } as React.CSSProperties,
    dateButton: {
      width: "100%",
      height: "48px",
      padding: "0 14px",
      borderRadius: "10px",
      border: "1px solid #3f3f48",
      background: "#09090b",
      color: "#ffffff",
      fontSize: "16px",
      fontWeight: 700,
      boxSizing: "border-box",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      userSelect: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
    hiddenDateInput: {
      position: "absolute",
      left: 0,
      bottom: 0,
      width: "1px",
      height: "1px",
      opacity: 0,
      pointerEvents: "none",
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
      gridTemplateColumns: "28px 1fr 56px",
      gap: "8px",
      alignItems: "start",
      padding: "12px 8px",
      borderBottom: "1px solid #24242a",
      background: "#111114",
      transition: "opacity 0.28s ease, transform 0.28s ease, box-shadow 0.28s ease, background 0.28s ease",
    } as React.CSSProperties,
    recurringItemRow: {
      gridTemplateColumns: "1fr 56px",
      alignItems: "center",
      padding: "10px 8px 10px 12px",
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
    deleteRecurringButton: {
      width: "48px",
      height: "48px",
      borderRadius: "12px",
      border: "1px solid rgba(239, 68, 68, 0.55)",
      background: "rgba(127, 29, 29, 0.35)",
      color: "#fca5a5",
      cursor: "pointer",
      fontSize: "34px",
      fontWeight: 800,
      lineHeight: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
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
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "flex-start",
      gap: "4px",
      whiteSpace: "nowrap",
      overflow: "visible",
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
    fullScreenImageOverlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.92)",
      zIndex: 80,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "14px",
    } as React.CSSProperties,
    fullScreenImage: {
      maxWidth: "100%",
      maxHeight: "100%",
      objectFit: "contain",
      borderRadius: "12px",
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
    conflictText: {
      color: "#d7d7dc",
      fontSize: "14px",
      lineHeight: 1.45,
      marginBottom: "14px",
    } as React.CSSProperties,
    conflictChoices: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "10px",
      marginTop: "12px",
    } as React.CSSProperties,
    conflictChoice: {
      border: "1px solid #3f3f48",
      background: "#111114",
      borderRadius: "14px",
      padding: "12px",
      color: "#ffffff",
      textAlign: "left",
      cursor: "pointer",
    } as React.CSSProperties,
    conflictChoiceTitle: {
      fontSize: "14px",
      fontWeight: 800,
      marginBottom: "8px",
    } as React.CSSProperties,
    conflictTaskTitle: {
      fontSize: "16px",
      fontWeight: 800,
      overflowWrap: "anywhere",
      marginBottom: "6px",
    } as React.CSSProperties,
    conflictTaskMeta: {
      color: "#aeb0b8",
      fontSize: "12px",
      fontWeight: 700,
      lineHeight: 1.35,
    } as React.CSSProperties,
    listPickerGrid: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "8px",
      marginBottom: "14px",
    } as React.CSSProperties,
    listOption: {
      width: "100%",
      border: "1px solid #3f3f48",
      background: "#111114",
      borderRadius: "14px",
      padding: "13px 14px",
      color: "#ffffff",
      textAlign: "left",
      cursor: "pointer",
      fontWeight: 800,
      fontSize: "17px",
    } as React.CSSProperties,
    listOptionActive: {
      border: "1px solid #8b5cf6",
      background: "#1b1525",
      boxShadow: "inset 0 0 0 1px rgba(139, 92, 246, 0.45)",
    } as React.CSSProperties,
    listOptionMeta: {
      color: "#aeb0b8",
      fontSize: "12px",
      fontWeight: 700,
      marginTop: "5px",
    } as React.CSSProperties,
    listCreateRow: {
      display: "grid",
      gridTemplateColumns: "1fr 92px",
      gap: "8px",
      alignItems: "center",
    } as React.CSSProperties,
    listManageHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
      marginBottom: "12px",
    } as React.CSSProperties,
    listMetaText: {
      color: "#aeb0b8",
      fontSize: "13px",
      fontWeight: 700,
      lineHeight: 1.35,
      marginBottom: "12px",
    } as React.CSSProperties,
    dangerPanel: {
      borderTop: "1px solid #2f2f35",
      paddingTop: "14px",
      marginTop: "14px",
    } as React.CSSProperties,
    dangerLabel: {
      color: "#fca5a5",
      fontSize: "13px",
      fontWeight: 800,
      marginBottom: "8px",
    } as React.CSSProperties,
    dangerButton: {
      padding: "12px 14px",
      borderRadius: "12px",
      border: "1px solid rgba(239, 68, 68, 0.62)",
      background: "rgba(127, 29, 29, 0.45)",
      color: "#fecaca",
      fontWeight: 800,
      fontSize: "16px",
      cursor: "pointer",
    } as React.CSSProperties,
    disabledDangerButton: {
      opacity: 0.42,
      cursor: "not-allowed",
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

  const launchSplashReady = tasksLoaded && dailyProgressLoaded;
  const syncIndicatorText =
    isSupabaseConfigured && (!authLoaded || (Boolean(user) && !cloudLoaded))
      ? "Updating..."
      : "";

  if (!launchSplashReady) {
    return (
      <div
        style={styles.launchSplash}
        aria-label="Opening ToDooey"
        role="status"
      >
        <div style={styles.launchSplashArt} />
      </div>
    );
  }

  if (isSupabaseConfigured && authLoaded && !user) {
    return (
      <div style={styles.page}>
        <div style={styles.authWrap}>
          <div style={styles.authCard}>
            <div style={styles.authBrand}>ToDooey</div>

            <>
              <div style={styles.accountTitle}>Sign in</div>
              <div style={styles.accountSubtext}>Tasks, everywhere.</div>

              <div style={styles.accountForm}>
                <input
                  style={styles.input}
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                />
                <input
                  style={styles.input}
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitAuth("sign-in");
                  }}
                  placeholder="Password"
                  autoComplete="current-password"
                />
                <div style={styles.accountButtonRow}>
                  <button
                    style={styles.saveButton}
                    onClick={() => submitAuth("sign-in")}
                    disabled={authBusy}
                  >
                    Sign in
                  </button>
                  <button
                    style={styles.cancelButton}
                    onClick={() => submitAuth("sign-up")}
                    disabled={authBusy}
                  >
                    Create account
                  </button>
                </div>
              </div>

              {authMessage ? (
                <div style={styles.accountSubtext}>{authMessage}</div>
              ) : null}
            </>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.shell}>
          {syncIndicatorText ? <div style={styles.syncPill}>{syncIndicatorText}</div> : null}
          <div style={styles.header}>
            <button
              style={styles.headerButton}
              onPointerDown={startListLongPress}
              onPointerUp={finishListPress}
              onPointerLeave={cancelListPress}
              onPointerCancel={cancelListPress}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  cycleTaskList();
                }
              }}
              aria-label="Cycle task list. Long press for all lists."
              title="Tap to switch list. Long press for all lists."
            >
              <span style={styles.headerWord}>ToDooey</span>
              <span style={styles.listSplash}>{activeTaskList.name}</span>
            </button>
          </div>

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

          </div>

          <div style={styles.section}>
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
                style={styles.emailReferenceButton}
                onClick={createEmailReferenceTask}
                aria-label="Create email reference code"
                title="Create email reference code"
              >
                ✉
              </button>
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

                {newImageDataUrl ? (
                  <div style={styles.imageButtonRow}>
                    <button
                      style={styles.imageActionButton}
                      onClick={() => setNewImageDataUrl("")}
                    >
                      Remove image
                    </button>
                  </div>
                ) : null}

                {newImageDataUrl ? (
                  <button
                    style={{ padding: 0, border: "none", background: "transparent", width: "100%" }}
                    onClick={() => openFullScreenImage(newImageDataUrl)}
                  >
                    <img
                      style={styles.imagePreview}
                      src={newImageDataUrl}
                      alt="Task attachment preview"
                    />
                  </button>
                ) : null}
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
                style={recurrence !== "none" ? styles.activeToggleIconButton : styles.toggleIconButton}
                onClick={() => {
                  if (recurrence === "none") {
                    setRecurrence("daily");
                  } else {
                    setRecurrence("none");
                    setRecurrenceAnchored(false);
                    setRecurrenceWeekdays([]);
                    setShowRotationNames(false);
                  }
                }}
                aria-label="Toggle recurrence"
                title="Toggle recurrence"
              >
                🔄
              </button>
              <button
                style={priority === 1 ? styles.activeToggleIconButton : styles.toggleIconButton}
                onClick={() => setPriority((prev) => (prev === 1 ? 2 : 1))}
                aria-label="Toggle priority"
                title="Toggle priority"
              >
                🔥
              </button>
              <label
                style={newImageDataUrl ? styles.activeCameraIconButton : styles.toggleIconButton}
                aria-label={newImageDataUrl ? "Change image" : "Add image"}
                title={newImageDataUrl ? "Change image" : "Add image"}
              >
                <span style={styles.cameraIcon}>📷</span>
                <input
                  style={styles.hiddenFileInput}
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const compressed = await compressImage(file);
                    setNewImageDataUrl(compressed);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {recurrence !== "none" ? (
              <>
                <div style={styles.recurrenceRow}>
                  <button
                    style={recurrence === "daily" ? styles.recurrenceChipActive : styles.recurrenceChip}
                    onClick={() => {
                      setRecurrence("daily");
                      setRecurrenceAnchored(false);
                      setRecurrenceWeekdays([]);
                    }}
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
                    onClick={() => {
                      setRecurrence("monthly");
                      setRecurrenceAnchored(false);
                      setRecurrenceWeekdays([]);
                    }}
                  >
                    Monthly
                  </button>
                  <button
                    style={recurrence === "fibonacci" ? styles.recurrenceChipActive : styles.recurrenceChip}
                    onClick={() => {
                      setRecurrence("fibonacci");
                      setRecurrenceInterval(1);
                      setRecurrenceAnchored(false);
                      setRecurrenceWeekdays([]);
                    }}
                  >
                    Fibonacci
                  </button>
                  <button
                    style={
                      showRotationNames || rotationText
                        ? styles.recurrenceChipActive
                        : styles.recurrenceChip
                    }
                    onClick={() => setShowRotationNames((prev) => !prev)}
                    aria-label="Toggle rotating task names"
                    title="Rotating task names"
                  >
                    🔀
                  </button>
                  {recurrence !== "fibonacci" ? (
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
                  ) : (
                    <div style={styles.intervalControl}>
                      Next: {fibonacciDays(recurrenceInterval)}{" "}
                      {fibonacciDays(recurrenceInterval) === 1 ? "day" : "days"}
                    </div>
                  )}
                  {recurrence === "weekly" ? (
                    <div style={styles.weekdayPicker}>
                      {WEEKDAY_LABELS.map((label, index) => {
                        const isSelected = recurrenceWeekdays.includes(index);

                        return (
                          <button
                            key={`${label}-${index}`}
                            style={
                              isSelected
                                ? styles.weekdayButtonActive
                                : styles.weekdayButton
                            }
                            onClick={() => toggleWeeklyAnchor(index)}
                            aria-label={WEEKDAY_NAMES[index]}
                            title={WEEKDAY_NAMES[index]}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {showRotationNames ? (
                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Rotating task names</label>
                  <textarea
                    style={styles.textArea}
                    value={rotationText}
                    onChange={(e) => setRotationText(e.target.value)}
                    placeholder={"Clean bathroom\nClean kitchen"}
                  />
                </div>
                ) : null}
              </>
            ) : null}

            {viewMode === "future" ? (
              <div style={styles.workloadForecast}>
                {workloadForecast.map((day) => (
                  <div key={day.label} style={styles.workloadDay}>
                    <div style={styles.workloadLabel}>{day.label}</div>
                    <div style={styles.workloadCount}>{day.count}</div>
                  </div>
                ))}
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
                      ...(viewMode === "recurring" ? styles.recurringItemRow : {}),
                      ...(isCompleting ? styles.completingItemRow : {}),
                      borderBottom:
                        index === visibleTasks.length - 1 ? "none" : styles.itemRow.borderBottom,
                    }}
                  >
                    {viewMode !== "recurring" ? (
                      <div style={styles.checkboxCell}>
                        <input
                          style={styles.checkbox}
                          type="checkbox"
                          checked={task.done}
                          onChange={() => toggleDone(task.id)}
                          aria-label={`Mark ${task.title} done`}
                        />
                      </div>
                    ) : null}

                    <div
                      style={styles.taskBlock}
                      onPointerDown={(event) => {
                        taskSelectionWasActiveOnPointerDownRef.current =
                          hasTextSelectionInside(event.currentTarget);
                      }}
                      onClick={(event) => {
                        const selectionInsideTask = hasTextSelectionInside(event.currentTarget);
                        if (
                          selectionInsideTask &&
                          !taskSelectionWasActiveOnPointerDownRef.current
                        ) {
                          return;
                        }

                        if (selectionInsideTask) {
                          window.getSelection()?.removeAllRanges();
                        }

                        openEditor(task);
                      }}
                    >
                      <div style={styles.taskText}>{task.title}</div>
                      <div style={styles.dueCell}>
                        {viewMode === "recurring"
                          ? `${recurrenceSummary(
                              task.recurrence,
                              task.recurrenceInterval,
                              task.recurrenceWeekdays
                            )} · Next: ${dueText(task.dueDate)}`
                          : dueText(task.dueDate)}
                      </div>
                    </div>

                    {viewMode === "recurring" ? (
                      <div style={styles.fireCell}>
                        <button
                          style={styles.deleteRecurringButton}
                          onClick={() => deleteRecurringTask(task)}
                          aria-label={`Delete recurring task ${task.title}`}
                          title="Delete recurring task"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div style={styles.fireCell}>
                        {task.priority === 1 ? <span>🔥</span> : null}
                        {task.description ? <span>📝</span> : null}
                        {task.imageDataUrl ? <span>📷</span> : null}
                      </div>
                    )}
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

            {isSupabaseConfigured && user ? (
              <div style={styles.signOutArea}>
                <button
                  style={styles.signOutButton}
                  onClick={signOut}
                  disabled={authBusy}
                >
                  {authBusy ? "Signing out..." : "Sign out"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div style={styles.bottomNav}>
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

      {listSwitcherOpen ? (
        <div style={styles.modalOverlay} onClick={() => setListSwitcherOpen(false)}>
          <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
            {editingTaskList ? (
              <>
                <div style={styles.listManageHeader}>
                  <div style={{ ...styles.modalTitle, marginBottom: 0 }}>Edit list</div>
                  <button style={styles.cancelButton} onClick={closeListEditor}>
                    Back
                  </button>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>List name</label>
                  <input
                    style={styles.input}
                    value={editListName}
                    onChange={(event) => setEditListName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveListName();
                    }}
                  />
                </div>

                <div style={styles.listMetaText}>
                  {tasks.filter((task) => normalizeListId(task.listId) === editingTaskList.id).length}{" "}
                  task
                  {tasks.filter((task) => normalizeListId(task.listId) === editingTaskList.id).length === 1
                    ? ""
                    : "s"}{" "}
                  in this list.
                </div>

                <div style={styles.modalActions}>
                  <button
                    style={styles.cancelButton}
                    onClick={() => selectTaskList(editingTaskList.id)}
                  >
                    Open
                  </button>
                  <button style={styles.saveButton} onClick={saveListName}>
                    Save
                  </button>
                </div>

                <div style={styles.dangerPanel}>
                  <div style={styles.dangerLabel}>Delete list</div>
                  <div style={styles.listMetaText}>
                    Tasks will be moved to{" "}
                    {taskLists.find((list) => list.id !== editingTaskList.id)?.name ?? "another list"}.
                    Type delete to confirm.
                  </div>
                  <div style={styles.fieldGroup}>
                    <input
                      style={styles.input}
                      value={deleteListConfirmName}
                      onChange={(event) => setDeleteListConfirmName(event.target.value)}
                      placeholder={DELETE_LIST_CONFIRMATION}
                    />
                  </div>
                  <button
                    style={{
                      ...styles.dangerButton,
                      ...((deleteListConfirmName.trim().toLowerCase() !== DELETE_LIST_CONFIRMATION ||
                        taskLists.length <= 1)
                        ? styles.disabledDangerButton
                        : {}),
                    }}
                    onClick={deleteTaskList}
                    disabled={
                      deleteListConfirmName.trim().toLowerCase() !== DELETE_LIST_CONFIRMATION ||
                      taskLists.length <= 1
                    }
                  >
                    Delete list
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={styles.modalTitle}>Lists</div>

                <div style={styles.listPickerGrid}>
                  {taskLists.map((list) => {
                    const listTaskCount = tasks.filter(
                      (task) => normalizeListId(task.listId) === list.id
                    ).length;

                    return (
                      <button
                        key={list.id}
                        style={{
                          ...styles.listOption,
                          ...(list.id === activeTaskList.id ? styles.listOptionActive : {}),
                        }}
                        onClick={() => openListEditor(list)}
                      >
                        <div>{list.name}</div>
                        <div style={styles.listOptionMeta}>
                          {list.id === activeTaskList.id ? "Current - " : ""}
                          {listTaskCount} task{listTaskCount === 1 ? "" : "s"}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>New list</label>
                  <div style={styles.listCreateRow}>
                    <input
                      style={styles.input}
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addTaskList();
                      }}
                      placeholder="List name"
                    />
                    <button style={styles.saveButton} onClick={addTaskList}>
                      Add
                    </button>
                  </div>
                </div>
              </>
            )}
              </div>
        </div>
      ) : null}

      {fullScreenImage ? (
        <div style={styles.fullScreenImageOverlay} onClick={closeFullScreenImage}>
          <img
            style={styles.fullScreenImage}
            src={fullScreenImage}
            alt="Full size task attachment"
          />
        </div>
      ) : null}

      {activeTaskConflict ? (
        <div style={{ ...styles.modalOverlay, zIndex: 70 }}>
          <div style={styles.modal}>
            <div style={styles.modalTitle}>Sync conflict</div>
            <div style={styles.conflictText}>
              This task changed in two places before sync finished. Choose which version to keep.
            </div>

            <div style={styles.conflictChoices}>
              <button
                style={styles.conflictChoice}
                onClick={() => resolveTaskConflict(activeTaskConflict.id, "local")}
              >
                <div style={styles.conflictChoiceTitle}>This device</div>
                <div style={styles.conflictTaskTitle}>
                  {taskConflictTitle(activeTaskConflict.local)}
                </div>
                <div style={styles.conflictTaskMeta}>
                  {taskConflictDetails(activeTaskConflict.local)}
                </div>
              </button>

              <button
                style={styles.conflictChoice}
                onClick={() => resolveTaskConflict(activeTaskConflict.id, "cloud")}
              >
                <div style={styles.conflictChoiceTitle}>Cloud version</div>
                <div style={styles.conflictTaskTitle}>
                  {taskConflictTitle(activeTaskConflict.cloud)}
                </div>
                <div style={styles.conflictTaskMeta}>
                  {taskConflictDetails(activeTaskConflict.cloud)}
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingTask ? (
        <div style={styles.modalOverlay} onClick={closeEditor}>
          <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Task</label>
              <input
                style={styles.input}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Date / Recurring / Priority</label>
              <div style={styles.modalMetaRow}>
                <div style={styles.dateButtonWrap}>
                  <button
                    type="button"
                    style={styles.dateButton}
                    onClick={openEditDatePicker}
                    aria-label={`Change due date. Current date is ${editDueDate}.`}
                    title="Change due date"
                  >
                    {displayDate(editDueDate)}
                  </button>
                  <input
                    ref={editDateInputRef}
                    style={styles.hiddenDateInput}
                    type="date"
                    tabIndex={-1}
                    min={formatDateInput()}
                    onChange={(e) => {
                      if (e.target.value) setEditDueDate(dateAtEarliestToday(e.target.value));
                    }}
                  />
                </div>
                <button
                  style={editRecurrence !== "none" ? styles.activeToggleIconButton : styles.toggleIconButton}
                  onClick={() => {
                    if (editRecurrence === "none") {
                      setEditRecurrence("daily");
                    } else {
                      setEditRecurrence("none");
                      setEditRecurrenceAnchored(false);
                      setEditRecurrenceWeekdays([]);
                      setShowEditRotationNames(false);
                    }
                  }}
                  aria-label="Toggle recurrence"
                  title="Toggle recurrence"
                >
                  🔄
                </button>
                <button
                  style={editPriority === 1 ? styles.activeToggleIconButton : styles.toggleIconButton}
                  onClick={() => setEditPriority((prev) => (prev === 1 ? 2 : 1))}
                  aria-label="Toggle priority"
                  title="Toggle priority"
                >
                  🔥
                </button>
              </div>
            </div>

            {editRecurrence !== "none" ? (
              <>
                <div style={styles.recurrenceRow}>
                  <button
                    style={editRecurrence === "daily" ? styles.recurrenceChipActive : styles.recurrenceChip}
                    onClick={() => {
                      setEditRecurrence("daily");
                      setEditRecurrenceAnchored(false);
                      setEditRecurrenceWeekdays([]);
                    }}
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
                    onClick={() => {
                      setEditRecurrence("monthly");
                      setEditRecurrenceAnchored(false);
                      setEditRecurrenceWeekdays([]);
                    }}
                  >
                    Monthly
                  </button>
                  <button
                    style={editRecurrence === "fibonacci" ? styles.recurrenceChipActive : styles.recurrenceChip}
                    onClick={() => {
                      setEditRecurrence("fibonacci");
                      setEditRecurrenceInterval(1);
                      setEditRecurrenceAnchored(false);
                      setEditRecurrenceWeekdays([]);
                    }}
                  >
                    Fibonacci
                  </button>
                  <button
                    style={
                      showEditRotationNames || editRotationText
                        ? styles.recurrenceChipActive
                        : styles.recurrenceChip
                    }
                    onClick={() => setShowEditRotationNames((prev) => !prev)}
                    aria-label="Toggle rotating task names"
                    title="Rotating task names"
                  >
                    🔀
                  </button>
                  {editRecurrence !== "fibonacci" ? (
                    <div style={styles.intervalControl}>
                      Every
                      <input
                        style={styles.intervalInput}
                        type="number"
                        min={1}
                        value={editRecurrenceInterval}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "") {
                            setEditRecurrenceInterval("");
                          } else {
                            setEditRecurrenceInterval(Number(val));
                          }
                        }}
                      />
                      {recurrenceUnit(editRecurrence, editRecurrenceInterval)}
                    </div>
                  ) : (
                    <div style={styles.intervalControl}>
                      Next: {fibonacciDays(editRecurrenceInterval)}{" "}
                      {fibonacciDays(editRecurrenceInterval) === 1 ? "day" : "days"}
                    </div>
                  )}
                  {editRecurrence === "weekly" ? (
                    <div style={styles.weekdayPicker}>
                      {WEEKDAY_LABELS.map((label, index) => {
                        const isSelected = editRecurrenceWeekdays.includes(index);

                        return (
                          <button
                            key={`${label}-${index}`}
                            style={
                              isSelected
                                ? styles.weekdayButtonActive
                                : styles.weekdayButton
                            }
                            onClick={() => toggleEditWeeklyAnchor(index)}
                            aria-label={WEEKDAY_NAMES[index]}
                            title={WEEKDAY_NAMES[index]}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {showEditRotationNames ? (
                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Rotating task names</label>
                  <textarea
                    style={styles.textArea}
                    value={editRotationText}
                    onChange={(e) => setEditRotationText(e.target.value)}
                    placeholder={"Clean bathroom\nClean kitchen"}
                  />
                </div>
                ) : null}
              </>
            ) : null}

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Description</label>
              <textarea
                style={styles.textArea}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Add extra details if needed"
              />

              <div style={styles.imageButtonRow}>
                <label style={styles.imageActionButton}>
                  {editImageDataUrl ? "Change image" : "Add image"}
                  <input
                    style={styles.hiddenFileInput}
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const compressed = await compressImage(file);
                      setEditImageDataUrl(compressed);
                    }}
                  />
                </label>

                {editImageDataUrl ? (
                  <button
                    style={styles.imageActionButton}
                    onClick={() => setEditImageDataUrl("")}
                  >
                    Remove image
                  </button>
                ) : null}
              </div>

              {editImageDataUrl ? (
                <button
                  style={{ padding: 0, border: "none", background: "transparent", width: "100%" }}
                  onClick={() => openFullScreenImage(editImageDataUrl)}
                >
                  <img
                    style={styles.imagePreview}
                    src={editImageDataUrl}
                    alt="Task attachment preview"
                  />
                </button>
              ) : null}
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
