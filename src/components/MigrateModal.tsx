"use client";

import { useState, useEffect } from "react";
import { OktaApp, OktaAppDetail } from "@/types/okta";
import {
  MigrateConfirmPayload,
  PreflightResult,
  ResolvedAssignment,
  ConfirmedPrincipal,
} from "@/types/entra";
import { getRedirectUris, getSamlSettings } from "@/lib/okta-utils";

function principalKey(r: ResolvedAssignment): string {
  return `${r.principalType}:${r.sourceName}`;
}

interface Props {
  app: OktaApp;
  detail: OktaAppDetail;
  onConfirm: (payload: MigrateConfirmPayload) => void;
  onCancel: () => void;
}

export default function MigrateModal({ app, detail, onConfirm, onCancel }: Props) {
  const isSaml = app.signOnMode === "SAML_2_0";
  const samlSettings = getSamlSettings(app);

  const [displayName, setDisplayName] = useState(app.label);
  const [replyUrlsText, setReplyUrlsText] = useState(
    getRedirectUris(detail.app).join("\n")
  );
  const [samlAcsUrl, setSamlAcsUrl] = useState(samlSettings?.acsUrl ?? "");
  const [samlEntityId, setSamlEntityId] = useState(samlSettings?.entityId ?? "");

  const [entraApps, setEntraApps] = useState<{ appId: string; displayName: string }[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(true);

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [preflightFailed, setPreflightFailed] = useState(false);
  // Chosen Entra ID per ambiguous assignment (keyed by type:sourceName). "" = skip.
  const [ambiguousChoices, setAmbiguousChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/entra/apps")
      .then((r) => r.json())
      .then((data) => setEntraApps(data.apps ?? []))
      .catch(() => {})
      .finally(() => setCheckingDuplicate(false));
  }, []);

  useEffect(() => {
    fetch("/api/entra/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groups: detail.groups.map((g) => ({ name: g.profile?.name })),
        users: detail.users.map((u) => ({ userName: u.credentials?.userName })),
        entityId: isSaml ? (samlSettings?.entityId ?? undefined) : undefined,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("preflight failed");
        return r.json();
      })
      .then((data: PreflightResult) => setPreflight(data))
      .catch(() => {
        setPreflight(null);
        setPreflightFailed(true);
      })
      .finally(() => setPreflightLoading(false));
    // Run once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const duplicate = !checkingDuplicate
    ? entraApps.find((a) => a.displayName.toLowerCase() === displayName.trim().toLowerCase())
    : undefined;

  function buildConfirmedPrincipals(): ConfirmedPrincipal[] {
    const all = [...(preflight?.groups ?? []), ...(preflight?.users ?? [])];
    const confirmed: ConfirmedPrincipal[] = [];
    for (const r of all) {
      if (r.status === "matched" && r.entraId) {
        confirmed.push({
          entraId: r.entraId,
          principalType: r.principalType,
          label: r.sourceName,
        });
      } else if (r.status === "ambiguous") {
        const chosen = ambiguousChoices[principalKey(r)];
        if (chosen) {
          confirmed.push({
            entraId: chosen,
            principalType: r.principalType,
            label: r.sourceName,
          });
        }
      }
      // not_found and unselected ambiguous are skipped.
    }
    return confirmed;
  }

  function handleConfirm() {
    const replyUrls = replyUrlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    onConfirm({
      displayName,
      replyUrls,
      confirmedPrincipals: buildConfirmedPrincipals(),
      ...(isSaml && { samlAcsUrl, samlEntityId }),
    });
  }

  const mappableCount = samlSettings?.attributeStatements.filter((s) => s.values?.[0]).length ?? 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-panel border border-line rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Migrate to Entra ID
        </h2>
        <p className="text-sm text-muted mb-5">
          Review and confirm the details before creating the app registration.
        </p>

        <div className="space-y-4">
          {/* Display name */}
          <div>
            <label className="block text-sm font-medium text-muted mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {checkingDuplicate && (
              <p className="mt-1 text-xs text-faint">Checking Entra ID for duplicates…</p>
            )}
            {!checkingDuplicate && duplicate && (
              <p className="mt-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
                <strong>Possible duplicate:</strong> An app named &ldquo;{duplicate.displayName}&rdquo; already
                exists in Entra ID (App ID: <span className="font-mono">{duplicate.appId}</span>).
                You can still proceed, but check that you&apos;re not duplicating a prior migration.
              </p>
            )}
          </div>

          {/* OIDC redirect URIs — only shown for non-SAML apps */}
          {!isSaml && (
            <div>
              <label htmlFor="redirect-uris" className="block text-sm font-medium text-muted mb-1">
                Redirect URIs{" "}
                <span className="font-normal text-faint">(one per line)</span>
              </label>
              <textarea
                id="redirect-uris"
                rows={4}
                value={replyUrlsText}
                onChange={(e) => setReplyUrlsText(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="https://..."
              />
            </div>
          )}

          {/* SAML-specific fields */}
          {isSaml && (
            <>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  ACS URL
                </label>
                <input
                  type="text"
                  value={samlAcsUrl}
                  onChange={(e) => setSamlAcsUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="https://app.example.com/saml/acs"
                />
                <p className="mt-1 text-xs text-faint">
                  Assertion Consumer Service URL — pre-filled from Okta
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Entity ID
                </label>
                <input
                  type="text"
                  value={samlEntityId}
                  onChange={(e) => setSamlEntityId(e.target.value)}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="https://app.example.com"
                />
                <p className="mt-1 text-xs text-faint">
                  SP Entity ID / Audience — pre-filled from Okta
                </p>
                {preflight?.entityIdValidation &&
                  !preflight.entityIdValidation.accepted && (
                    <p className="mt-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
                      <strong>Entity ID may be rejected by Entra:</strong>{" "}
                      {preflight.entityIdValidation.reason ??
                        "the identifier did not pass validation."}
                    </p>
                  )}
              </div>

              {/* Attribute statements info */}
              {(samlSettings?.attributeStatements.length ?? 0) > 0 && (
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-xs text-muted">
                  <strong className="text-foreground">Attribute statements:</strong>{" "}
                  {samlSettings!.attributeStatements.length} found in Okta.{" "}
                  {mappableCount > 0
                    ? `${mappableCount} will be mapped automatically to an Entra claims policy.`
                    : "None could be mapped automatically — configure claims manually."}
                </div>
              )}

              <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-xs text-muted">
                <strong className="text-foreground">SAML auto-configuration:</strong> The ACS URL, Entity ID, and sign-on mode
                will be set automatically. A signing certificate will be generated — its value will
                be shown in the result so you can configure it in your service provider.
              </div>
            </>
          )}

          {!isSaml && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200">
              <strong>Note:</strong> This will create a new App Registration in your Entra ID tenant.
              SSO configuration, SAML certificates, and claim mappings must be completed manually
              after migration.
            </div>
          )}

          {/* Assignments preview */}
          <div>
            <label className="block text-sm font-medium text-muted mb-1">
              Assignments preview
            </label>
            {preflightLoading && (
              <p className="text-xs text-faint">
                Resolving assignments in Entra…
              </p>
            )}
            {!preflightLoading && preflightFailed && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
                Couldn&apos;t run the pre-flight resolution. You can still migrate, but
                no group/user assignments will be created.
              </p>
            )}
            {!preflightLoading && !preflightFailed && preflight && (
              <div className="space-y-3">
                {([
                  { title: "Groups", items: preflight.groups },
                  { title: "Users", items: preflight.users },
                ] as const).map(({ title, items }) => {
                  if (items.length === 0) return null;
                  const matched = items.filter((r) => r.status === "matched");
                  const ambiguous = items.filter((r) => r.status === "ambiguous");
                  const notFound = items.filter((r) => r.status === "not_found");
                  return (
                    <div
                      key={title}
                      className="border border-line rounded-lg p-3 space-y-2"
                    >
                      <p className="text-xs font-semibold text-muted">{title}</p>

                      {matched.length > 0 && (
                        <div className="text-xs text-green-300 bg-green-500/10 border border-green-500/30 rounded-md px-3 py-2">
                          <span className="font-medium">
                            ✅ {matched.length} matched
                          </span>{" "}
                          — {matched.map((r) => r.sourceName).join(", ")}
                        </div>
                      )}

                      {ambiguous.map((r) => {
                        const key = principalKey(r);
                        return (
                          <div
                            key={key}
                            className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 space-y-1"
                          >
                            <p>
                              <span className="font-medium">⚠️ Ambiguous:</span>{" "}
                              {r.sourceName}
                            </p>
                            <select
                              value={ambiguousChoices[key] ?? ""}
                              onChange={(e) =>
                                setAmbiguousChoices((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              className="w-full px-2 py-1 border border-line rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">Skip</option>
                              {(r.candidates ?? []).map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}

                      {notFound.length > 0 && (
                        <div className="text-xs text-muted bg-white/5 border border-line rounded-md px-3 py-2">
                          <span className="font-medium text-muted">
                            ❌ {notFound.length} not found
                          </span>{" "}
                          — {notFound.map((r) => r.sourceName).join(", ")}
                          <p className="text-faint mt-0.5">
                            not in Entra (sync gap) — will be skipped
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {preflight.groups.length === 0 && preflight.users.length === 0 && (
                  <p className="text-xs text-faint">
                    No groups or users assigned in Okta.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-line text-foreground rounded-lg hover:bg-panel-hover transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!displayName.trim()}
            className="px-4 py-2 text-sm bg-primary text-primary-fg rounded-lg hover:bg-primary-hover disabled:opacity-50 transition"
          >
            Create in Entra ID
          </button>
        </div>
      </div>
    </div>
  );
}
