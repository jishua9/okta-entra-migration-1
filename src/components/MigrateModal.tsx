"use client";

import { useState, useEffect } from "react";
import { OktaApp, OktaAppDetail } from "@/types/okta";
import { MigrateConfirmPayload } from "@/types/entra";
import { getRedirectUris, getSamlSettings } from "@/lib/okta-utils";

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

  useEffect(() => {
    fetch("/api/entra/apps")
      .then((r) => r.json())
      .then((data) => setEntraApps(data.apps ?? []))
      .catch(() => {})
      .finally(() => setCheckingDuplicate(false));
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

  function handleConfirm() {
    const replyUrls = replyUrlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    onConfirm({
      displayName,
      replyUrls,
      ...(isSaml && { samlAcsUrl, samlEntityId }),
    });
  }

  const mappableCount = samlSettings?.attributeStatements.filter((s) => s.values?.[0]).length ?? 0;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Migrate to Entra ID
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          Review and confirm the details before creating the app registration.
        </p>

        <div className="space-y-4">
          {/* Display name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {checkingDuplicate && (
              <p className="mt-1 text-xs text-gray-400">Checking Entra ID for duplicates…</p>
            )}
            {!checkingDuplicate && duplicate && (
              <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <strong>Possible duplicate:</strong> An app named &ldquo;{duplicate.displayName}&rdquo; already
                exists in Entra ID (App ID: <span className="font-mono">{duplicate.appId}</span>).
                You can still proceed, but check that you&apos;re not duplicating a prior migration.
              </p>
            )}
          </div>

          {/* OIDC redirect URIs — only shown for non-SAML apps */}
          {!isSaml && (
            <div>
              <label htmlFor="redirect-uris" className="block text-sm font-medium text-gray-700 mb-1">
                Redirect URIs{" "}
                <span className="font-normal text-gray-400">(one per line)</span>
              </label>
              <textarea
                id="redirect-uris"
                rows={4}
                value={replyUrlsText}
                onChange={(e) => setReplyUrlsText(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://..."
              />
            </div>
          )}

          {/* SAML-specific fields */}
          {isSaml && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ACS URL
                </label>
                <input
                  type="text"
                  value={samlAcsUrl}
                  onChange={(e) => setSamlAcsUrl(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://app.example.com/saml/acs"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Assertion Consumer Service URL — pre-filled from Okta
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Entity ID
                </label>
                <input
                  type="text"
                  value={samlEntityId}
                  onChange={(e) => setSamlEntityId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://app.example.com"
                />
                <p className="mt-1 text-xs text-gray-400">
                  SP Entity ID / Audience — pre-filled from Okta
                </p>
              </div>

              {/* Attribute statements info */}
              {(samlSettings?.attributeStatements.length ?? 0) > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                  <strong>Attribute statements:</strong>{" "}
                  {samlSettings!.attributeStatements.length} found in Okta.{" "}
                  {mappableCount > 0
                    ? `${mappableCount} will be mapped automatically to an Entra claims policy.`
                    : "None could be mapped automatically — configure claims manually."}
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                <strong>SAML auto-configuration:</strong> The ACS URL, Entity ID, and sign-on mode
                will be set automatically. A signing certificate will be generated — its value will
                be shown in the result so you can configure it in your service provider.
              </div>
            </>
          )}

          {!isSaml && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <strong>Note:</strong> This will create a new App Registration in your Entra ID tenant.
              SSO configuration, SAML certificates, and claim mappings must be completed manually
              after migration.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!displayName.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            Create in Entra ID
          </button>
        </div>
      </div>
    </div>
  );
}
