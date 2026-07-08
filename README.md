# Okta → Entra ID Migration Tool

A self-hosted web app that browses an Okta org's applications and migrates them to Microsoft Entra ID — creating the app registration and enterprise app, configuring SSO, and assigning groups/users. Each migration is verified by reading the result back from Microsoft Graph.

## What it migrates

| Okta sign-on mode | Result in Entra |
|---|---|
| **SAML 2.0** | App registration + enterprise app, SAML sign-on mode, ACS URL, Entity ID, auto-generated signing certificate, and known `user.*` attribute statements mapped to a claims policy |
| **OpenID Connect** | App registration + enterprise app with the redirect URIs copied across |
| **SWA / Browser Plugin** | Placeholder app registration + enterprise app (password-based SSO must be finished manually — no SSO protocol to migrate) |

Groups and users are matched in Entra by display name / UPN and assigned automatically. Migrate one app at a time, or select many and run them in bulk (3 concurrent). Every attempt is recorded in the in-app history.

**Not migrated (manual follow-up):** SCIM provisioning, Conditional Access / sign-on policies, SAML attribute statements using complex or `appuser.*` expressions. A per-app **readiness checklist** flags these before you migrate.

## Requirements

- **Node.js 20+**
- Per Okta org / Entra tenant you migrate: an **Okta API token** and an **Entra app registration** (below)

## Setup

### 1. Entra ID app registration (in the customer tenant)

1. **Entra admin center → App registrations → New registration** (name it e.g. `Okta Migration Tool`, leave redirect URI blank).
2. From **Overview**, note the **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret** — copy the **value** immediately.
4. **API permissions → Add a permission → Microsoft Graph → Application permissions** — add the four below, then click **Grant admin consent** (required — without consent every call fails with *Insufficient privileges*).

   | Permission | Purpose |
   |---|---|
   | `Application.ReadWrite.All` | Create app registrations and enterprise apps |
   | `Group.Read.All` | Match groups by display name |
   | `User.Read.All` | Match users by UPN |
   | `Policy.ReadWrite.ApplicationConfiguration` | SAML claims mapping policies |

> The admin consenting must be a Global Administrator (or Privileged Role / Cloud Application Administrator).

### 2. Okta API token (in the customer org)

**Okta Admin Console → Security → API → Tokens → Create Token.** Copy the value (shown once). The creating admin needs read access to apps, groups, and users (`okta.apps.read`, `okta.groups.read`, `okta.users.read`).

### 3. Deploy the app

```bash
git clone <repo> && cd okta-entra-migration-1
npm install
npm run build
npm start          # serves on http://localhost:3000
```

For anything beyond localhost, set these before `npm start`:

```bash
NEXTAUTH_URL=https://migrate.example.com   # the URL users hit
NEXTAUTH_SECRET=<a long random string>     # else one is generated into data/secret.key
```

Production notes:
- Put it behind a **reverse proxy with TLS** (nginx/Caddy) — credentials are sent to the server on every save and test.
- Run under a process manager (`systemd`, `pm2`, container) so it survives restarts.
- Back up the **`data/`** directory (SQLite DB + encryption key). Losing `data/secret.key` makes stored credentials unreadable.

### 4. Connect and migrate

1. Open the app and **register an account** (email + password, min 8 chars).
2. **Settings** → enter the Okta Org URL + API token and the Entra Tenant ID / Client ID / Client Secret. Use **Test connection** on each side to confirm before saving.
3. Browse apps, open one to see its readiness checklist, and **Migrate** — or use **Select for bulk migrate** to do several at once. Each result shows a per-step summary (created objects, SSO config, signing cert, assignments, and the verification read-back).

## Data & security

- **Store:** `data/app.db` (SQLite) — accounts, encrypted credentials, and migration history.
- **Credentials at rest:** Okta tokens and Azure secrets are encrypted with **AES-256-GCM**; the key is derived from the app secret (`data/secret.key`, mode `0600`, or `NEXTAUTH_SECRET`).
- **Passwords:** bcrypt (cost 12). **Okta is never written to** — the tool only reads from it.

## Notes

- The Entra **Entity ID** must use a domain **verified in the target tenant**, or Entra rejects it (surfaced as a warning; the rest of the migration still completes).
- **Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · NextAuth v4 · better-sqlite3 · Microsoft Graph SDK.
