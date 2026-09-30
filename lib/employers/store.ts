"use client";

import { useSyncExternalStore } from "react";
import { isEmployerList, type Employer } from "@/lib/employers/types";

// The employer list lives in this browser's localStorage.
const STORAGE_KEY = "job-scout:employers";
const EMPTY: Employer[] = [];
const listeners = new Set<() => void>();

// Cache the parsed list by its raw string so snapshots stay referentially
// stable between reads (useSyncExternalStore requires this).
let cachedRaw: string | null = null;
let cachedList: Employer[] = EMPTY;

function read(): Employer[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY; // storage blocked (e.g. some private modes)
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      cachedList = isEmployerList(parsed) ? parsed : EMPTY;
    } catch {
      cachedList = EMPTY;
    }
  }
  return cachedList;
}

export function saveEmployers(employers: Employer[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(employers));
  } catch {
    // Nothing more we can do; the list just won't persist.
  }
  listeners.forEach((l) => l());
}

export function getEmployers(): Employer[] {
  return read();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep other tabs in sync.
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useEmployers(): Employer[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
