"use client";

import { useSyncExternalStore } from "react";

/**
 * A value kept in this browser's localStorage, readable from React via
 * useSyncExternalStore. Invalid or missing data reads as `fallback`.
 */
export function createLocalStore<T>(key: string, isValid: (v: unknown) => v is T, fallback: T) {
  const listeners = new Set<() => void>();
  // Cache the parsed value by its raw string so snapshots stay referentially
  // stable between reads (useSyncExternalStore requires this).
  let cachedRaw: string | null = null;
  let cachedValue: T = fallback;

  function get(): T {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return fallback; // storage blocked (e.g. some private modes)
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        const parsed = raw ? JSON.parse(raw) : fallback;
        cachedValue = isValid(parsed) ? parsed : fallback;
      } catch {
        cachedValue = fallback;
      }
    }
    return cachedValue;
  }

  function set(value: T) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Nothing more we can do; the value just won't persist.
    }
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    // Keep other tabs in sync.
    const onStorage = (e: StorageEvent) => e.key === key && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  function useValue(): T {
    return useSyncExternalStore(subscribe, get, () => fallback);
  }

  return { get, set, useValue };
}
