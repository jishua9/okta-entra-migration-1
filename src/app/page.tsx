"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { OktaApp, OktaAppDetail } from "@/types/okta";
import { MigrationResult, MigrateConfirmPayload } from "@/types/entra";
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
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  const { history, refresh } = useMigrationHistory();
  const migratedIds = useMemo(
    () => new Set(history.filter((e) => e.status !== "failed").map((e) => e.oktaAppId)),
    [history],
  );

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

  async function handleMigrate({ displayName, replyUrls, samlAcsUrl, samlEntityId, confirmedPrincipals }: MigrateConfirmPayload) {
    if (!selectedApp || !detail) return;
    setMigrationResult(null);
    setMigrating(true);
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
          confirmedPrincipals,
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

      // The server already recorded this attempt (success, partial, or failed)
      // via recordMigration in the migrate route — just refetch the audit table.
      await refresh();
    } catch (e) {
      setMigrationResult({
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      // Keep the modal open so it flips to the result summary; the user closes
      // it with "Done". A fresh migration clears the result at the top of this fn.
      setMigrating(false);
    }
  }

  const statusColor: Record<string, string> = {
    ACTIVE: "bg-green-500/15 text-green-300",
    INACTIVE: "bg-white/10 text-muted",
    DELETED: "bg-red-500/15 text-red-300",
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="bg-panel border-b border-line shadow-sm px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Okta → Entra ID Migration Tool
          </h1>
          <p className="text-sm text-muted mt-0.5">
            Browse Okta applications and migrate them to Microsoft Entra ID
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              detailAbortRef.current?.abort();
              setSelectedApp(null);
              setDetail(null);
              setMigrationResult(null);
            }}
            disabled={!selectedApp}
            className="text-sm px-4 py-2 rounded-lg border border-line text-foreground hover:bg-panel-hover disabled:opacity-40 disabled:cursor-default transition"
            title="Back to migration history"
          >
            ⌂ Home
          </button>
          <button
            type="button"
            onClick={refreshApps}
            className="text-sm px-4 py-2 rounded-lg border border-line text-foreground hover:bg-panel-hover transition"
          >
            ↺ Refresh
          </button>
          <Link
            href="/settings"
            className="text-sm px-4 py-2 rounded-lg border border-line text-foreground hover:bg-panel-hover transition"
          >
            ⚙ Settings
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm px-4 py-2 rounded-lg border border-line hover:bg-panel-hover transition text-muted"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* App List Panel */}
        <aside className="w-96 bg-panel border-r border-line flex flex-col">
          <div className="p-4 border-b border-line space-y-2">
            <input
              type="search"
              placeholder="Search applications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                        ? "bg-primary text-primary-fg"
                        : "bg-white/5 text-muted hover:bg-panel-hover"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-faint">
                {filtered.length} of {apps.length}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center h-32 text-muted text-sm">
                Loading applications…
              </div>
            )}
            {error && (
              <div className="m-4 p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg text-sm space-y-2">
                <p>{error}</p>
                {error.toLowerCase().includes("not configured") && (
                  <Link
                    href="/settings"
                    className="inline-block text-xs font-medium px-3 py-1.5 bg-primary text-primary-fg rounded-lg hover:bg-primary-hover transition"
                  >
                    Go to Settings →
                  </Link>
                )}
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="flex items-center justify-center h-32 text-faint text-sm">
                No applications found
              </div>
            )}
            {filtered.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => selectApp(app)}
                className={`w-full text-left px-4 py-3 border-b border-line hover:bg-panel-hover transition ${
                  selectedApp?.id === app.id
                    ? "bg-primary/10 border-l-4 border-l-primary"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-foreground truncate">
                    {app.label}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {migratedIds.has(app.id) && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
                        ✓
                      </span>
                    )}
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        statusColor[app.status] ?? "bg-white/10 text-muted"
                      }`}
                    >
                      {app.status}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-faint mt-0.5 truncate">
                  {app.signOnMode}
                </p>
              </button>
            ))}
          </div>
        </aside>

        {/* Detail / History Panel */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selectedApp && (
            <MigrationHistoryPanel history={history} />
          )}

          {selectedApp && (
            <div>
              {/* Action Bar */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  {selectedApp.label}
                </h2>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="px-4 py-2 text-sm border border-line text-foreground rounded-lg hover:bg-panel-hover transition"
                  >
                    ↓ Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMigrationResult(null); setShowMigrateModal(true); }}
                    disabled={!detail}
                    className="px-4 py-2 text-sm bg-primary text-primary-fg rounded-lg hover:bg-primary-hover disabled:opacity-50 transition"
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
                      ? "bg-green-500/10 text-green-200 border border-green-500/30"
                      : "bg-red-500/10 text-red-200 border border-red-500/30"
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
                        <p className="text-amber-300">
                          {migrationResult.assignmentErrors!.length} assignment error(s):{" "}
                          {migrationResult.assignmentErrors!.join("; ")}
                        </p>
                      )}
                      {migrationResult.samlConfigured && (
                        <div className="mt-3 pt-3 border-t border-green-500/30 space-y-1">
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
                              <pre className="mt-2 text-xs font-mono bg-black/30 border border-green-500/20 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap break-all">
                                {migrationResult.samlSigningCertificate}
                              </pre>
                            </details>
                          )}
                          {(migrationResult.samlWarnings?.length ?? 0) > 0 && (
                            <div className="text-amber-300 mt-1">
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
                <div className="text-muted text-sm">Loading detail…</div>
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
          migrating={migrating}
          result={migrationResult}
          onConfirm={handleMigrate}
          onCancel={() => setShowMigrateModal(false)}
        />
      )}
    </div>
  );
}
