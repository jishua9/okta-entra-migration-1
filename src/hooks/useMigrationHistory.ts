"use client";

import { useState, useEffect, useCallback } from "react";
import { MigrationRow } from "@/types/entra";

export function useMigrationHistory() {
  const [history, setHistory] = useState<MigrationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/migrations");
      if (!res.ok) throw new Error(`Failed to load migrations: ${res.statusText}`);
      const data: { migrations: MigrationRow[] } = await res.json();
      setHistory(data.migrations ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { history, refresh, loading };
}
