"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import Link from "next/link";

interface FieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}

function Field({ label, id, value, onChange, type = "text", placeholder, hint }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-2 border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

type TestState = { status: "idle" } | { status: "testing" } | { status: "ok"; message: string } | { status: "error"; message: string };

function TestResult({ state }: { state: TestState }) {
  if (state.status === "idle") return null;
  if (state.status === "testing") {
    return <p className="text-xs text-muted mt-2">Testing connection…</p>;
  }
  if (state.status === "ok") {
    return (
      <p className="text-xs text-green-300 bg-green-500/10 border border-green-500/30 rounded-md px-3 py-2 mt-2">
        ✓ {state.message}
      </p>
    );
  }
  return (
    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 mt-2">
      ✗ {state.message}
    </p>
  );
}

export default function SettingsPage() {
  const router = useRouter();

  const [oktaOrgUrl, setOktaOrgUrl] = useState("");
  const [oktaApiToken, setOktaApiToken] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [azureClientId, setAzureClientId] = useState("");
  const [azureClientSecret, setAzureClientSecret] = useState("");

  const [oktaTest, setOktaTest] = useState<TestState>({ status: "idle" });
  const [entraTest, setEntraTest] = useState<TestState>({ status: "idle" });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    fetch("/api/user/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.configured) {
          setOktaOrgUrl(data.oktaOrgUrl ?? "");
          setAzureTenantId(data.azureTenantId ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, []);

  async function testOkta() {
    setOktaTest({ status: "testing" });
    const res = await fetch("/api/user/config/test-okta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgUrl: oktaOrgUrl.trim().replace(/\/$/, ""), apiToken: oktaApiToken.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setOktaTest({ status: "ok", message: `Connected to "${data.orgName}"` });
    } else {
      setOktaTest({ status: "error", message: data.error ?? "Connection failed" });
    }
  }

  async function testEntra() {
    setEntraTest({ status: "testing" });
    const res = await fetch("/api/user/config/test-entra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: azureTenantId.trim(),
        clientId: azureClientId.trim(),
        clientSecret: azureClientSecret.trim(),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setEntraTest({ status: "ok", message: `Connected to "${data.tenantName}"` });
    } else {
      setEntraTest({ status: "error", message: data.error ?? "Connection failed" });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    const res = await fetch("/api/user/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oktaOrgUrl: oktaOrgUrl.trim().replace(/\/$/, ""),
        oktaApiToken: oktaApiToken.trim(),
        azureTenantId: azureTenantId.trim(),
        azureClientId: azureClientId.trim(),
        azureClientSecret: azureClientSecret.trim(),
      }),
    });

    setSaving(false);

    if (res.ok) {
      setSaved(true);
      setTimeout(() => router.push("/"), 1000);
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to save settings.");
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-panel border-b border-line shadow-sm px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted mt-0.5">Connect your Okta and Entra ID accounts</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/"
            className="text-sm px-4 py-2 rounded-lg border border-line text-foreground hover:bg-panel-hover transition"
          >
            ← Back
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

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {loadingConfig ? (
          <div className="text-sm text-muted mt-8">Loading…</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* Okta */}
            <section className="bg-panel rounded-xl border border-line p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Okta</h2>
                <button
                  type="button"
                  disabled={!oktaOrgUrl || !oktaApiToken || oktaTest.status === "testing"}
                  onClick={testOkta}
                  className="text-xs px-3 py-1.5 rounded-lg border border-line text-foreground hover:bg-panel-hover disabled:opacity-40 transition"
                >
                  {oktaTest.status === "testing" ? "Testing…" : "Test connection"}
                </button>
              </div>
              <Field
                label="Org URL"
                id="okta-org-url"
                value={oktaOrgUrl}
                onChange={(v) => { setOktaOrgUrl(v); setOktaTest({ status: "idle" }); }}
                placeholder="https://your-org.okta.com"
                hint="Your Okta organisation base URL (no trailing slash)"
              />
              <Field
                label="API Token"
                id="okta-api-token"
                value={oktaApiToken}
                onChange={(v) => { setOktaApiToken(v); setOktaTest({ status: "idle" }); }}
                type="password"
                placeholder="00A…"
                hint="Okta Admin Console → Security → API → Tokens → Create Token"
              />
              <TestResult state={oktaTest} />
            </section>

            {/* Entra ID */}
            <section className="bg-panel rounded-xl border border-line p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Microsoft Entra ID</h2>
                <button
                  type="button"
                  disabled={!azureTenantId || !azureClientId || !azureClientSecret || entraTest.status === "testing"}
                  onClick={testEntra}
                  className="text-xs px-3 py-1.5 rounded-lg border border-line text-foreground hover:bg-panel-hover disabled:opacity-40 transition"
                >
                  {entraTest.status === "testing" ? "Testing…" : "Test connection"}
                </button>
              </div>
              <div className="text-xs text-muted bg-primary/10 border border-primary/30 rounded-lg px-3 py-3 space-y-1.5">
                <p className="font-medium text-foreground">
                  Your app registration needs these Microsoft Graph <span className="font-semibold">application</span> permissions:
                </p>
                <ul className="space-y-0.5">
                  <li>
                    <code className="font-mono text-[11px] bg-black/30 border border-line rounded px-1 py-0.5 text-foreground">Application.ReadWrite.All</code>
                    <span> — create app registrations &amp; service principals</span>
                  </li>
                  <li>
                    <code className="font-mono text-[11px] bg-black/30 border border-line rounded px-1 py-0.5 text-foreground">Group.Read.All</code>
                    <span> — look up groups by name for assignment</span>
                  </li>
                  <li>
                    <code className="font-mono text-[11px] bg-black/30 border border-line rounded px-1 py-0.5 text-foreground">User.Read.All</code>
                    <span> — look up users by UPN for assignment</span>
                  </li>
                  <li>
                    <code className="font-mono text-[11px] bg-black/30 border border-line rounded px-1 py-0.5 text-foreground">Policy.ReadWrite.ApplicationConfiguration</code>
                    <span> — claims mapping policies (SAML apps)</span>
                  </li>
                </ul>
                <p className="pt-0.5">
                  Add them under <span className="text-foreground">API permissions → Add a permission → Microsoft Graph → Application permissions</span>, then click{" "}
                  <span className="font-medium text-foreground">Grant admin consent</span> — without consent every call fails with &ldquo;Insufficient privileges&rdquo;.
                </p>
              </div>
              <Field
                label="Tenant ID"
                id="azure-tenant-id"
                value={azureTenantId}
                onChange={(v) => { setAzureTenantId(v); setEntraTest({ status: "idle" }); }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                hint="Azure Portal → Entra ID → Overview → Tenant ID"
              />
              <Field
                label="Application (client) ID"
                id="azure-client-id"
                value={azureClientId}
                onChange={(v) => { setAzureClientId(v); setEntraTest({ status: "idle" }); }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                hint="App Registrations → your app → Application (client) ID"
              />
              <Field
                label="Client Secret"
                id="azure-client-secret"
                value={azureClientSecret}
                onChange={(v) => { setAzureClientSecret(v); setEntraTest({ status: "idle" }); }}
                type="password"
                placeholder="your-client-secret"
                hint="App Registrations → your app → Certificates & secrets → New client secret"
              />
              <TestResult state={entraTest} />
            </section>

            {error && (
              <p className="text-sm text-red-300 bg-red-500/10 px-4 py-3 rounded-lg border border-red-500/30">
                {error}
              </p>
            )}
            {saved && (
              <p className="text-sm text-green-300 bg-green-500/10 px-4 py-3 rounded-lg border border-green-500/30">
                Settings saved — redirecting…
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-primary text-primary-fg text-sm font-medium rounded-lg hover:bg-primary-hover disabled:opacity-50 transition"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
