"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { OktaApp, OktaAppDetail } from "@/types/okta";
import { MigrationResult, MigrationHistoryEntry, MigrateConfirmPayload } from "@/types/entra";
import { getSamlSettings } from "@/lib/okta-utils";
import AppDetailPanel from "@/components/AppDetailPanel";
import MigrateModal from "@/components/MigrateModal";
import MigrationHistoryPanel from "@/components/MigrationHistoryPanel";
import { useMigrationHistory } from "@/hooks/useMigrationHistory";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

async function fetchAppsData(signal?: AbortSignal): Promise<OktaApp[]> {
  const res = await fetch("/api/okta/apps", { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load apps: ${res.statusText}`);
  }
  const data = await res.json();
  return data.apps;
}

export default function HomePage() {
  const [apps, setApps] = useState<OktaApp[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedApp, setSelectedApp] = useState<OktaApp | null>(null);
  const [detail, setDetail] = useState<OktaAppDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailAbortRef = useRef<AbortController | null>(null);

  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  const { history, addEntry, clearHistory } = useMigrationHistory();
  const migratedIds = useMemo(() => new Set(history.map((e) => e.oktaAppId)), [history]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return apps.filter((a) => {
      const matchesSearch =
        a.label.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.signOnMode.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "ALL" || a.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [apps, search, statusFilter]);

  // Initial load — all setState deferred after fetch resolves (no sync setState in effect)
  useEffect(() => {
    const controller = new AbortController();
    fetchAppsData(controller.signal)
      .then((data) => {
        setApps(data);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Refresh button
  const refreshApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApps(await fetchAppsData());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  async function selectApp(app: OktaApp) {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setSelectedApp(app);
    setDetail(null);
    setMigrationResult(null);
    setError(null);
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/okta/apps/${app.id}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Failed to load app detail`);
      setDetail(await res.json());
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }

  function handleExport() {
    if (!selectedApp) return;
    window.open(`/api/okta/apps/${selectedApp.id}/export`, "_blank");
  }

  async function handleMigrate({ displayName, replyUrls, samlAcsUrl, samlEntityId }: MigrateConfirmPayload) {
    if (!selectedApp || !detail) return;
    setShowMigrateModal(false);
    setMigrationResult(null);
    const saml = getSamlSettings(detail.app);
    try {
      const res = await fetch("/api/entra/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          replyUrls,
          signOnMode: selectedApp.signOnMode,
          oktaAppId: selectedApp.id,
          notes: `Migrated from Okta app: ${selectedApp.label} (${selectedApp.id})`,
          groups: detail.groups.map((g) => ({ id: g.id, name: g.profile?.name })),
          users: detail.users.map((u) => ({ id: u.id, userName: u.credentials?.userName })),
          ...(saml && {
            samlAcsUrl: samlAcsUrl ?? saml.acsUrl,
            samlEntityId: samlEntityId ?? saml.entityId,
            samlRelayState: saml.relayState,
            samlAttributeStatements: saml.attributeStatements,
          }),
        }),
      });
      const result: MigrationResult = await res.json();
      setMigrationResult(result);

      if (result.success && result.entraAppId && result.entraObjectId) {
        const entry: MigrationHistoryEntry = {
          id: crypto.randomUUID(),
          oktaAppId: selectedApp.id,
          oktaLabel: selectedApp.label,
          entraAppId: result.entraAppId,
          entraObjectId: result.entraObjectId,
          displayName: result.displayName ?? displayName,
          migratedAt: new Date().toISOString(),
          assignedGroups: result.assignedGroups ?? 0,
          assignedUsers: result.assignedUsers ?? 0,
          assignmentErrors: result.assignmentErrors ?? [],
        };
        addEntry(entry);
      }
    } catch (e) {
      setMigrationResult({
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  const statusColor: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    INACTIVE: "bg-gray-100 text-gray-600",
    DELETED: "bg-red-100 text-red-800",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b shadow-sm px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Okta → Entra ID Migration Tool
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Browse Okta applications and migrate them to Microsoft Entra ID
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refreshApps}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition"
          >
            ↺ Refresh
          </button>
          <Link
            href="/settings"
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition"
          >
            ⚙ Settings
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition text-gray-600"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* App List Panel */}
        <aside className="w-96 bg-white border-r flex flex-col">
          <div className="p-4 border-b space-y-2">
            <input
              type="search"
              placeholder="Search applications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {(["ALL", "ACTIVE", "INACTIVE"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`text-xs px-2 py-1 rounded-md font-medium transition ${
                      statusFilter === s
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {filtered.length} of {apps.length}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                Loading applications…
              </div>
            )}
            {error && (
              <div className="m-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm space-y-2">
                <p>{error}</p>
                {error.toLowerCase().includes("not configured") && (
                  <Link
                    href="/settings"
                    className="inline-block text-xs font-medium px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Go to Settings →
                  </Link>
                )}
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                No applications found
              </div>
            )}
            {filtered.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => selectApp(app)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-blue-50 transition ${
                  selectedApp?.id === app.id
                    ? "bg-blue-50 border-l-4 border-l-blue-600"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-gray-900 truncate">
                    {app.label}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {migratedIds.has(app.id) && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        ✓
                      </span>
                    )}
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        statusColor[app.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {app.status}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {app.signOnMode}
                </p>
              </button>
            ))}
          </div>
        </aside>

        {/* Detail / History Panel */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selectedApp && (
            <MigrationHistoryPanel history={history} onClear={clearHistory} />
          )}

          {selectedApp && (
            <div>
              {/* Action Bar */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  {selectedApp.label}
                </h2>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition"
                  >
                    ↓ Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMigrateModal(true)}
                    disabled={!detail}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    → Migrate to Entra ID
                  </button>
                </div>
              </div>

              {/* Migration Result Banner */}
              {migrationResult && (
                <div
                  className={`mb-4 p-4 rounded-lg text-sm ${
                    migrationResult.success
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
                  {migrationResult.success ? (
                    <div className="space-y-2">
                      <p><strong>Migration successful!</strong> App created in Entra ID.</p>
                      <p>
                        Application (client) ID:{" "}
                        <code className="font-mono">{migrationResult.entraAppId}</code>
                      </p>
                      <p>
                        Object ID:{" "}
                        <code className="font-mono">{migrationResult.entraObjectId}</code>
                      </p>
                      <p>
                        Assigned: {migrationResult.assignedGroups ?? 0} group(s),{" "}
                        {migrationResult.assignedUsers ?? 0} user(s)
                      </p>
                      {(migrationResult.assignmentErrors?.length ?? 0) > 0 && (
                        <p className="text-amber-700">
                          {migrationResult.assignmentErrors!.length} assignment error(s):{" "}
                          {migrationResult.assignmentErrors!.join("; ")}
                        </p>
                      )}
                      {migrationResult.samlConfigured && (
                        <div className="mt-3 pt-3 border-t border-green-200 space-y-1">
                          <p className="font-medium">SAML configured automatically:</p>
                          {(migrationResult.samlClaimsMapped ?? 0) > 0 && (
                            <p>{migrationResult.samlClaimsMapped} attribute statement(s) mapped to claims policy</p>
                          )}
                          {migrationResult.samlCertExpiry && (
                            <p>Signing certificate expires: {new Date(migrationResult.samlCertExpiry).toLocaleDateString()}</p>
                          )}
                          {migrationResult.samlSigningCertificate && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium">Show signing certificate (paste into your service provider)</summary>
                              <pre className="mt-2 text-xs font-mono bg-green-100 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap break-all">
                                {migrationResult.samlSigningCertificate}
                              </pre>
                            </details>
                          )}
                          {(migrationResult.samlWarnings?.length ?? 0) > 0 && (
                            <div className="text-amber-700 mt-1">
                              {migrationResult.samlWarnings!.map((w, i) => (
                                <p key={i}>{w}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <strong>Migration failed:</strong> {migrationResult.error}
                    </>
                  )}
                </div>
              )}

              {/* Detail Content */}
              {detailLoading && (
                <div className="text-gray-500 text-sm">Loading detail…</div>
              )}
              {detail && <AppDetailPanel detail={detail} />}
            </div>
          )}
        </main>
      </div>

      {/* Migrate Modal */}
      {showMigrateModal && selectedApp && detail && (
        <MigrateModal
          app={selectedApp}
          detail={detail}
          onConfirm={handleMigrate}
          onCancel={() => setShowMigrateModal(false)}
        />
      )}
    </div>
  );
}
