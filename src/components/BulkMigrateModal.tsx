"use client";

import { useEffect, useState } from "react";
import { OktaApp, OktaAppDetail } from "@/types/okta";
import {
  ConfirmedPrincipal,
  MigrationResult,
  MigrationStep,
  PreflightResult,
} from "@/types/entra";
import { getRedirectUris, getSamlSettings } from "@/lib/okta-utils";

const STEP_META: Record<MigrationStep["status"], { icon: string; cls: string }> = {
  done: { icon: "✓", cls: "text-green-300" },
  warning: { icon: "⚠", cls: "text-amber-300" },
  failed: { icon: "✗", cls: "text-red-300" },
  skipped: { icon: "–", cls: "text-faint" },
};

type Phase = "review" | "running" | "done";
type PlanStatus =
  | "planning"
  | "ready"
  | "planError"
  | "pending"
  | "migrating"
  | "complete";

interface Plan {
  app: OktaApp;
  include: boolean;
  status: PlanStatus;
  detail?: OktaAppDetail;
  replyUrls: string[];
  saml: ReturnType<typeof getSamlSettings>;
  confirmed: ConfirmedPrincipal[];
  matched: number;
  skipped: number; // ambiguous + not_found (not auto-assigned in bulk)
  planError?: string;
  result?: MigrationResult;
}

// Run `fn` over items with at most `limit` in flight at once.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++;
      await fn(items[cur]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

function summarisePreflight(pf: PreflightResult) {
  const all = [...pf.groups, ...pf.users];
  const confirmed: ConfirmedPrincipal[] = all
    .filter((r) => r.status === "matched" && r.entraId)
    .map((r) => ({
      entraId: r.entraId as string,
      principalType: r.principalType,
      label: r.sourceName,
    }));
  return {
    confirmed,
    matched: confirmed.length,
    skipped: all.filter((r) => r.status !== "matched").length,
  };
}

function resultTone(r: MigrationResult): { label: string; icon: string; cls: string } {
  const st = r.success ? r.status ?? "success" : "failed";
  if (st === "success") return { label: "success", icon: "✓", cls: "text-green-300" };
  if (st === "partial") return { label: "partial", icon: "⚠", cls: "text-amber-300" };
  return { label: "failed", icon: "✗", cls: "text-red-300" };
}

export default function BulkMigrateModal({
  apps,
  onClose,
  onFinished,
}: {
  apps: OktaApp[];
  onClose: () => void;
  onFinished: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("review");
  const [plans, setPlans] = useState<Plan[]>(() =>
    apps.map((app) => ({
      app,
      include: true,
      status: "planning" as PlanStatus,
      replyUrls: [],
      saml: null,
      confirmed: [],
      matched: 0,
      skipped: 0,
    })),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const patch = (id: string, next: Partial<Plan>) =>
    setPlans((prev) => prev.map((p) => (p.app.id === id ? { ...p, ...next } : p)));

  // Plan phase: load detail + pre-flight for each app (max 3 concurrent).
  useEffect(() => {
    let cancelled = false;
    const planOne = async (app: OktaApp) => {
      try {
        const dRes = await fetch(`/api/okta/apps/${app.id}`);
        if (!dRes.ok) throw new Error("couldn't load app detail");
        const detail: OktaAppDetail = await dRes.json();
        const saml = getSamlSettings(detail.app);
        const replyUrls = getRedirectUris(detail.app);
        let confirmed: ConfirmedPrincipal[] = [];
        let matched = 0;
        let skipped = 0;
        try {
          const pfRes = await fetch("/api/entra/preflight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groups: detail.groups.map((g) => ({ name: g.profile?.name })),
              users: detail.users.map((u) => ({ userName: u.credentials?.userName })),
              entityId: saml?.entityId ?? undefined,
            }),
          });
          if (pfRes.ok) {
            const s = summarisePreflight((await pfRes.json()) as PreflightResult);
            confirmed = s.confirmed;
            matched = s.matched;
            skipped = s.skipped;
          }
        } catch {
          /* preflight is best-effort; migrate with no assignments */
        }
        if (cancelled) return;
        patch(app.id, { status: "ready", detail, saml, replyUrls, confirmed, matched, skipped });
      } catch (e) {
        if (cancelled) return;
        patch(app.id, {
          status: "planError",
          planError: e instanceof Error ? e.message : "planning failed",
        });
      }
    };
    runWithConcurrency(apps, 3, planOne);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planning = plans.some((p) => p.status === "planning");
  const selectable = plans.filter((p) => p.status === "ready");
  const toRun = plans.filter((p) => p.include && p.status === "ready");

  function buildPayload(plan: Plan) {
    const { app, saml, replyUrls, confirmed } = plan;
    return {
      displayName: app.label,
      replyUrls,
      signOnMode: app.signOnMode,
      oktaAppId: app.id,
      notes: `Migrated from Okta app: ${app.label} (${app.id})`,
      confirmedPrincipals: confirmed,
      ...(saml && {
        samlAcsUrl: saml.acsUrl,
        samlEntityId: saml.entityId,
        samlRelayState: saml.relayState,
        samlAttributeStatements: saml.attributeStatements,
      }),
    };
  }

  async function start() {
    const batch = plans.filter((p) => p.include && p.status === "ready");
    if (batch.length === 0) return;
    setPhase("running");
    setPlans((prev) =>
      prev.map((p) =>
        batch.some((b) => b.app.id === p.app.id) ? { ...p, status: "pending" } : p,
      ),
    );
    await runWithConcurrency(batch, 3, async (plan) => {
      patch(plan.app.id, { status: "migrating" });
      try {
        const res = await fetch("/api/entra/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(plan)),
        });
        const result: MigrationResult = await res.json();
        patch(plan.app.id, { status: "complete", result });
      } catch (e) {
        patch(plan.app.id, {
          status: "complete",
          result: { success: false, error: e instanceof Error ? e.message : "request failed" },
        });
      }
    });
    setPhase("done");
    onFinished();
  }

  const done = plans.filter((p) => p.status === "complete" && p.result);
  const counts = {
    success: done.filter((p) => p.result!.success && (p.result!.status ?? "success") === "success").length,
    partial: done.filter((p) => p.result!.success && p.result!.status === "partial").length,
    failed: done.filter((p) => !p.result!.success).length,
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={phase === "running" ? undefined : onClose}
    >
      <div
        className="bg-panel border border-line rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {phase === "review"
            ? `Migrate ${apps.length} app${apps.length !== 1 ? "s" : ""} to Entra ID`
            : phase === "running"
              ? "Migrating…"
              : "Migration complete"}
        </h2>
        <p className="text-sm text-muted mb-5">
          {phase === "review"
            ? "Review what each app will do, then start. Values are auto-derived from Okta; unmatched groups/users are skipped."
            : phase === "running"
              ? "Up to 3 apps migrate at once. Please don’t close this window."
              : `${counts.success} succeeded · ${counts.partial} with warnings · ${counts.failed} failed`}
        </p>

        <div className="space-y-2">
          {plans.map((p) => {
            const isOpen = !!expanded[p.app.id];
            return (
              <div key={p.app.id} className="border border-line rounded-lg">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {phase === "review" && (
                    <input
                      type="checkbox"
                      checked={p.include}
                      disabled={p.status !== "ready"}
                      onChange={(e) => patch(p.app.id, { include: e.target.checked })}
                      className="accent-[var(--primary)] disabled:opacity-40"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground truncate">{p.app.label}</span>
                      <span className="text-[11px] font-mono text-faint shrink-0">{p.app.signOnMode}</span>
                    </div>
                    {/* Sub-line: planning / plan summary / run status */}
                    {p.status === "planning" && (
                      <p className="text-xs text-faint mt-0.5">Analysing…</p>
                    )}
                    {p.status === "planError" && (
                      <p className="text-xs text-red-300 mt-0.5">Skipped — {p.planError}</p>
                    )}
                    {p.status === "ready" && (
                      <p className="text-xs text-muted mt-0.5">
                        {p.matched} assignment{p.matched !== 1 ? "s" : ""} matched
                        {p.skipped > 0 ? ` · ${p.skipped} skipped (unmatched)` : ""}
                        {p.replyUrls.length > 0 ? ` · ${p.replyUrls.length} redirect URI(s)` : ""}
                      </p>
                    )}
                    {(p.status === "pending" || p.status === "migrating") && (
                      <p className="text-xs text-faint mt-0.5">
                        {p.status === "pending" ? "Queued…" : "Migrating…"}
                      </p>
                    )}
                    {p.status === "complete" && p.result && (
                      <p className="text-xs mt-0.5">
                        <span className={resultTone(p.result).cls}>
                          {resultTone(p.result).icon} {resultTone(p.result).label}
                        </span>
                        {p.result.success ? (
                          <button
                            type="button"
                            onClick={() => setExpanded((e) => ({ ...e, [p.app.id]: !isOpen }))}
                            className="ml-2 text-faint underline hover:no-underline"
                          >
                            {isOpen ? "hide" : "details"}
                          </button>
                        ) : (
                          <span className="text-red-300 ml-2">{p.result.error}</span>
                        )}
                      </p>
                    )}
                  </div>
                  {/* Right-side status icon during run */}
                  {p.status === "migrating" && (
                    <span className="inline-block w-4 h-4 border-2 border-muted/30 border-t-primary rounded-full animate-spin shrink-0" />
                  )}
                </div>

                {/* Expanded per-app step summary */}
                {isOpen && p.result?.steps && (
                  <ul className="px-3 pb-3 pt-1 space-y-1 border-t border-line">
                    {p.result.steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className={`font-semibold ${STEP_META[s.status].cls}`}>
                          {STEP_META[s.status].icon}
                        </span>
                        <span className="text-foreground">{s.label}</span>
                        {s.detail && <span className="text-faint break-all">— {s.detail}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          {phase !== "running" && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-line text-foreground rounded-lg hover:bg-panel-hover transition"
            >
              {phase === "done" ? "Close" : "Cancel"}
            </button>
          )}
          {phase === "review" && (
            <button
              type="button"
              onClick={start}
              disabled={planning || toRun.length === 0}
              className="px-4 py-2 text-sm bg-primary text-primary-fg rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {planning
                ? "Analysing…"
                : `Start migration${toRun.length ? ` (${toRun.length})` : ""}`}
            </button>
          )}
        </div>

        {phase === "review" && !planning && selectable.length === 0 && (
          <p className="text-xs text-amber-300 mt-3">
            None of the selected apps could be analysed — nothing to migrate.
          </p>
        )}
      </div>
    </div>
  );
}
