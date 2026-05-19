# Okta → Entra ID Migration Tool

A self-hosted web application for browsing Okta application registrations and migrating them to Microsoft Entra ID (formerly Azure Active Directory). Each user registers their own account and connects their own Okta and Entra ID credentials — no shared environment variables or configuration files required.

---

## Features

- **Browse Okta apps** — paginated list with search and status filtering (All / Active / Inactive)
- **Migration readiness checklist** — per-app analysis of sign-on mode, redirect URIs, SCIM provisioning, custom claims, and assigned groups/users
- **One-click migration** — creates an Entra ID App Registration and Service Principal, copies redirect URIs, and assigns matched groups and users
- **Full SAML 2.0 automation** — ACS URL, Entity ID, sign-on mode, signing certificate, and attribute statement → claims policy mapping all configured automatically
- **Duplicate detection** — warns before migrating if an app with the same display name already exists in Entra ID
- **JSON export** — download the full Okta app payload for offline reference
- **Migration history** — local record of every completed migration with IDs and assignment counts
- **Per-user credentials** — each account stores its own Okta and Azure secrets, encrypted at rest with AES-256-GCM
- **Connection testing** — verify Okta and Entra ID credentials before saving

---

## Prerequisites

### Okta

You need an Okta API token with read access to applications, groups, and users.

1. Sign in to the **Okta Admin Console**
2. Go to **Security → API → Tokens**
3. Click **Create Token** and copy the value — it is only shown once

The token needs the following permissions (granted automatically to org admins, or via a custom admin role):
- `okta.apps.read`
- `okta.groups.read`
- `okta.users.read`

### Microsoft Entra ID

You need an App Registration in your Entra ID tenant with a client secret and the following **application** (not delegated) Microsoft Graph API permissions:

| Permission | Purpose |
|---|---|
| `Application.ReadWrite.All` | Create app registrations and service principals |
| `Group.Read.All` | Look up groups by display name for assignment |
| `User.Read.All` | Look up users by UPN for assignment |
| `Policy.ReadWrite.ApplicationConfiguration` | Create claims mapping policies for SAML attribute statements (SAML apps only) |

**Creating the App Registration:**

1. Open the **Azure Portal** → **Microsoft Entra ID** → **App registrations**
2. Click **New registration** — name it something like `Okta Migration Tool`
3. Leave redirect URI blank; click **Register**
4. Note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page
5. Go to **Certificates & secrets** → **New client secret** — copy the value immediately
6. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
7. Add the four permissions listed above, then click **Grant admin consent**

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm run dev        # development (hot reload)
npm run build && npm start   # production
```

The app listens on **http://localhost:3000** by default.

No `.env` file is needed. A random secret is generated automatically on first start and stored in `data/secret.key`. If you want to supply your own secret (e.g. for production), set the `NEXTAUTH_SECRET` environment variable.

### 3. Register an account

Open http://localhost:3000 — you will be redirected to `/register`. Create an account with your email and a password of at least 8 characters.

### 4. Connect your integrations

After logging in you will see a **"Go to Settings →"** prompt. Enter your:

- **Okta Org URL** — e.g. `https://acme.okta.com`
- **Okta API Token**
- **Azure Tenant ID**
- **Azure Client ID**
- **Azure Client Secret**

Use the **Test connection** button in each section to verify the credentials before saving.

---

## Usage

### Browsing apps

The left panel lists all applications from your Okta org. Use the search box to filter by name or sign-on mode, and the **ALL / ACTIVE / INACTIVE** buttons to filter by status. Apps that have already been migrated are marked with a **✓** badge.

### Reviewing an app

Click any app to load its detail view on the right. The **Migration Readiness** checklist at the top summarises:

| Item | What it means |
|---|---|
| **Sign-on mode** | OIDC and SAML 2.0 apps migrate automatically. SWA and Bookmark apps require manual follow-up in Entra ID. |
| **Redirect URIs** | OAuth/OIDC redirect URIs are copied to the new app registration. For SAML apps, the ACS URL is set on the service principal instead. |
| **Provisioning (SCIM)** | If SCIM is enabled in Okta it must be re-configured in Entra ID manually. |
| **Custom claims** | Known `user.*` attribute statements are mapped to an Entra claims policy automatically. Complex expressions are flagged for manual setup. |
| **Groups / Users** | All assigned groups and users will be looked up by name/UPN in Entra ID and assigned automatically. |

### Migrating an app

1. Click **→ Migrate to Entra ID** (enabled once the app detail has loaded)
2. Review or edit the display name and redirect URIs in the confirmation modal
3. Click **Create in Entra ID**

The tool will:
- Create an App Registration with the given display name and redirect URIs
- Create a linked Service Principal (tagged `okta-migrated`)
- Look up each assigned group and user in Entra ID by display name / UPN and assign them to the service principal
- **For SAML 2.0 apps additionally:** set SAML sign-on mode, copy the ACS URL and Entity ID, create a claims mapping policy for supported attribute statements, and return the auto-generated signing certificate

A result banner shows the new Application (client) ID, Object ID, assignment counts, and — for SAML apps — the signing certificate to paste into your service provider.

### What is migrated automatically for SAML 2.0 apps

When migrating a SAML 2.0 app, the tool automatically:

- Sets `preferredSingleSignOnMode` to `saml` on the service principal
- Copies the Okta **ACS URL** (`ssoAcsUrl`) to the service principal's reply URLs
- Copies the **Entity ID** (`audience`) to the app registration's identifier URIs
- Retrieves the auto-generated **signing certificate** and displays it in the result — paste it into your service provider to complete trust
- Maps **attribute statements** that use known `user.*` Okta expressions to an Entra ID claims mapping policy (requires `Policy.ReadWrite.ApplicationConfiguration`)

Supported automatic attribute mappings: `user.email`, `user.login`, `user.firstName`, `user.lastName`, `user.displayName`, `user.department`, `user.employeeNumber`, `user.mobilePhone`, `user.title`, `user.streetAddress`, `user.city`, `user.state`, `user.countryCode`, `user.postalCode`. Attribute statements using complex expressions or `appuser.*` attributes are flagged in the result for manual setup.

### What still requires manual steps

- **SWA / form-fill apps** — no direct Entra equivalent; consider a linked app or Entra's My Apps
- **SCIM provisioning** — must be reconfigured under the Enterprise Application in Entra ID
- **Conditional Access policies** — Okta sign-on policies are not part of the app object and must be recreated in Entra ID
- **SAML attribute statements using complex expressions** — any expressions not in the supported list above

### Exporting an app

Click **↓ Export JSON** to download the full Okta app payload (including settings, credentials schema, groups, and users) as a JSON file. This is useful as a reference when completing manual steps in Entra ID.

---

## Data & Security

| Item | Details |
|---|---|
| **User accounts** | Stored in `data/app.db` (SQLite). Passwords are hashed with bcrypt (cost factor 12). |
| **API credentials** | Okta API tokens and Azure client secrets are encrypted with AES-256-GCM before being written to the database. The encryption key is derived from the app secret. |
| **App secret** | Auto-generated on first run and stored in `data/secret.key` (mode `0600`). Override with the `NEXTAUTH_SECRET` environment variable. |
| **Migration history** | Stored in the browser's `localStorage` — not sent to the server. |
| **Secrets in transit** | The Settings page sends credentials to the server over the same connection as the rest of the app. Use HTTPS in production. |

The `data/` directory should not be committed to source control or made publicly accessible. Add it to `.gitignore` if it is not already excluded.

---

## Architecture

```
src/
├── app/
│   ├── page.tsx                  # Main migration UI
│   ├── login/page.tsx            # Login form
│   ├── register/page.tsx         # Registration form
│   ├── settings/page.tsx         # Per-user credential configuration
│   └── api/
│       ├── auth/
│       │   ├── [...nextauth]/    # NextAuth session endpoints
│       │   └── register/         # POST — create new account
│       ├── okta/apps/            # GET apps list, GET app detail, GET export
│       ├── entra/
│       │   ├── apps/             # GET Entra app list (duplicate check)
│       │   └── migrate/          # POST — create app registration
│       └── user/config/          # GET/PUT saved credentials, POST test-okta, POST test-entra
├── components/
│   ├── AppDetailPanel.tsx        # App info, redirect URIs, groups, users
│   ├── ReadinessChecklist.tsx    # Migration readiness analysis
│   ├── MigrateModal.tsx          # Confirmation modal with duplicate check
│   └── MigrationHistoryPanel.tsx # Local migration history
├── lib/
│   ├── db.ts                     # SQLite connection and schema
│   ├── secret.ts                 # App secret management
│   ├── crypto.ts                 # AES-256-GCM encrypt/decrypt
│   ├── auth.ts                   # NextAuth credentials provider
│   ├── user-config.ts            # Per-user config read/write
│   ├── okta.ts                   # Okta REST API client
│   ├── entra.ts                  # Microsoft Graph API client
│   └── api-helpers.ts            # requireUserConfig() shared guard
├── hooks/
│   └── useMigrationHistory.ts    # localStorage-backed history hook
├── proxy.ts                      # Auth guard (Next.js 16 proxy convention)
└── types/
    ├── okta.ts
    ├── entra.ts
    └── next-auth.d.ts
```

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · NextAuth v4 · better-sqlite3 · Microsoft Graph SDK · @azure/identity

---

## API Reference

All endpoints except `/api/auth/*` require a valid session cookie. All endpoints except `/api/auth/register` additionally require that the user has saved their integration credentials in Settings.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create a new user account |
| `GET` | `/api/user/config` | Get saved config (secrets not returned) |
| `PUT` | `/api/user/config` | Save Okta and Entra ID credentials |
| `POST` | `/api/user/config/test-okta` | Test Okta credentials without saving |
| `POST` | `/api/user/config/test-entra` | Test Entra ID credentials without saving |
| `GET` | `/api/okta/apps` | List all Okta applications (paginated internally) |
| `GET` | `/api/okta/apps/:appId` | Get app detail including groups and users |
| `GET` | `/api/okta/apps/:appId/export` | Download app detail as JSON attachment |
| `GET` | `/api/entra/apps` | List Entra ID app registrations (for duplicate check) |
| `POST` | `/api/entra/migrate` | Create app registration and assign members |

---

## Production Deployment

1. **Build:** `npm run build`
2. **Start:** `npm start`
3. **HTTPS:** Put the app behind a reverse proxy (nginx, Caddy, etc.) with a valid TLS certificate. Credentials are transmitted to the server on every Settings save and test.
4. **Persistent data:** Mount or back up the `data/` directory. It contains the SQLite database and the app secret. Losing `data/secret.key` means all stored credentials become unreadable.
5. **Secret management:** Set `NEXTAUTH_SECRET` as an environment variable in your process manager or container rather than relying on the auto-generated `data/secret.key`.

```bash
NEXTAUTH_SECRET=<your-secret> NEXTAUTH_URL=https://your-domain.com npm start
```
