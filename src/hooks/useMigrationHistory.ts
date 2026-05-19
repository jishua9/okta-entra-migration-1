"use client";

import { useState, useEffect } from "react";
import { MigrationHistoryEntry } from "@/types/entra";

const STORAGE_KEY = "okta-entra-migration-history";

export function useMigrationHistory() {
  const [history, setHistory] = useState<MigrationHistoryEntry[]>([]);

  useEffect(() => {
    Promise.resolve()
      .then(() => localStorage.getItem(STORAGE_KEY))
      .then((raw) => {
        if (raw) setHistory(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  function addEntry(entry: MigrationHistoryEntry) {
    setHistory((prev) => {
      const next = [entry, ...prev];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return { history, addEntry, clearHistory };
}
