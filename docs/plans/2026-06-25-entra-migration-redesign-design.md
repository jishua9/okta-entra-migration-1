# Entra Migration Redesign — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming complete, ready for implementation planning)
**Scope:** The Entra ID *write path* of the Okta→Entra migration tool. The Okta
read/inventory side and the readiness checklist are unchanged.

---

## 1. Summary (plain English)

The tool migrates Okta applications into Microsoft Entra ID. The existing write
path hand-builds the Entra objects in a way that produces half-configured SAML
apps, can fail destructively, and silently mis-assigns users and groups. This
redesign rebuilds the write path "the Microsoft-supported way" so that a migrated
app actually works and a failed migration cleans up after itself.

After the redesign, a migration runs in four stages:

1. **Pick app + readiness check** — unchanged.
2. **Pre-flight preview** — before *anything* is written to the customer tenant,
   the tool resolves every assigned group/user against Entra and shows the
   consultant a table (matched / ambiguous / not-found). For SAML apps it also
   pre-checks whether the Entity ID will be accepted. The consultant confirms,
   corrects, or skips items.
3. **Create the app the supported way** — instantiate from Microsoft's official
   application template, configure SSO, **properly generate the signing
   certificate**, map claims, and assign only the confirmed members.
4. **Result + durable audit record** — every attempt (success *or* failure) is
   written to a server-side audit table. Core-step failures roll back cleanly.

---

## 2. Goals / non-goals

**Goals**
- Produce a working SAML enterprise app, including a real signing certificate.
- Never silently mis-assign or silently drop a group/user.
- Never leave orphaned half-built objects in the customer tenant.
- Keep a durable, server-side record of what was migrated (and what failed).
- Ground every Graph interaction in documented Microsoft behaviour.

**Non-goals (YAGNI for v1)**
- Automated gallery-app matching (we *hint*, we don't auto-select — Microsoft
  only does gallery selection human-in-the-loop).
- Resumable / idempotent re-runs (best-effort rollback instead; resumability is
  a later enhancement).
- SCIM provisioning, Conditional Access, multi-ACS SAML — remain manual, as the
  readiness checklist already states.

---

## 3. Root cause being fixed

The original code calls `POST /applications` then `POST /servicePrincipals`
directly. That path does **not** wire up SSO the way Entra expects, which is why
the signing certificate, claims, and identifier handling are all broken. See
`memory/original-tool-known-bugs.md` for the full defect list.

Microsoft's documented programmatic path for arbitrary apps is
`POST /applicationTemplates/{id}/instantiate`, which creates a correctly-wired
application **and** service principal in one call.

---

## 4. The new creation flow (technical)

Implemented in `src/lib/entra.ts`. Ordered steps, following Microsoft's
"Configure SAML SSO via Graph" tutorial.

### Step tiers (governs rollback)

- **Core steps** — failure ⇒ roll back everything created so far:
  1. `POST /applicationTemplates/8adf8e6e-67b2-4cf2-a259-e3dc5476c621/instantiate`
     with `{ displayName }` → returns `{ application, servicePrincipal }`.
     *(Template ID = the global-service generic "Custom" non-gallery template.)*
  2. Handle Graph **replication lag**: the new app/SP may not be immediately
     queryable. Poll/retry (bounded) before configuring.
  3. `PATCH /servicePrincipals/{spId}` → `{ preferredSingleSignOnMode: "saml" }`
     (SAML apps) — establishes the app as usable.

- **Configuration steps** — failure ⇒ warning only, app survives, no rollback:
  4. **Reply / sign-on URLs.** SAML: set the SP `loginUrl`/reply URL from the
     Okta ACS URL. OIDC: set `application.web.redirectUris`.
  5. **Entity ID / identifier URI.** SAML only:
     `PATCH /applications/{appId}` → `{ identifierUris: [entityId] }`.
     Pre-validated in the preview (see §5); a write-time rejection becomes a
     warning with remediation text.
  6. **Claims-mapping policy.** Build from supported Okta `user.*` expressions
     (existing `OKTA_EXPR_TO_ENTRA` map), `POST /policies/claimsMappingPolicies`,
     then assign by `$ref` to the SP. Unmapped expressions → warnings.
  7. **Signing certificate** (the key fix). See §6.

- **Assignment** — failure ⇒ per-item warning, never rollback. See §7.

### Rollback (best-effort)

Track `{ applicationObjectId, servicePrincipalId, claimsMappingPolicyId }` as
they are created. On a **core**-step failure, delete in reverse order:
claims policy → service principal → application. Rollback is best-effort; if a
delete itself fails (e.g. throttling), report it in the result rather than
claiming a clean tenant.

---

## 5. Pre-flight preview & identity matching

New behaviour, surfaced in `MigrateModal` before the confirm action.

**Resolve endpoint** (new): `POST /api/entra/preflight`
- Input: the Okta app's groups (names) + users (UPNs) + (SAML) the Entity ID.
- For each group: `GET /groups?$filter=displayName eq '...'` →
  - exactly one → **matched** (store Entra object ID)
  - more than one → **ambiguous** (return candidates for the consultant to pick)
  - none → **not found**
- For each user: same against `/users` on `userPrincipalName`.
- Entity ID: fetch tenant verified domains (`GET /domains` /
  `organization.verifiedDomains`) and check the Entity ID against the allowed
  identifier-URI patterns (`api://…`, verified domain, tenant ID, app ID).
  Return a likely-accept / likely-reject verdict.

**Override:** the modal lets the consultant resolve ambiguities, skip not-found
items, and proceed knowing the Entity-ID risk. The migrate call then receives
**resolved Entra object IDs**, not names — eliminating the blind `value[0]` guess.

> Assumption (consistent with Microsoft guidance): users/groups are already
> synced into Entra before app migration. Not-found items mean a sync gap, made
> visible here rather than failing silently at assignment time.

---

## 6. Signing certificate (prescribed by docs)

Replaces the read-only logic that never generated a cert and used the wrong
filter.

1. `POST /servicePrincipals/{spId}/addTokenSigningCertificate` with
   `{ displayName: "CN=<app>", endDateTime: <now + 3 years> }`.
   - **Default validity: 3 years** (Graph max; reduces re-roll frequency for the
     customer). Flagged as a chosen default, not a Microsoft mandate.
   - The response contains the public certificate (`key`, base64) and the
     thumbprint.
2. **Activate** it: `PATCH /servicePrincipals/{spId}` →
   `{ preferredTokenSigningKeyThumbprint: <thumbprint> }`.
3. Return the public cert as PEM for the consultant to paste into the service
   provider. If reading from `keyCredentials` instead of the add response, select
   `usage === "Verify" && type === "AsymmetricX509Cert"` (the original code
   wrongly looked for `usage === "Sign"`).

---

## 7. Member assignment (robustness)

`POST /servicePrincipals/{spId}/appRoleAssignedTo` with the confirmed principal
IDs and `appRoleId` = default-access (`00000000-…`) when the app defines no roles.

- **Bounded concurrency** (e.g. ~5 at a time) instead of `Promise.all` over the
  full set — avoids Graph 429 throttling on large apps.
- **Retry with backoff** honouring `Retry-After` on 429, and a bounded retry for
  the post-create replication lag.
- Each failure is a per-item warning in the result; assignment never triggers
  rollback.

---

## 8. Logging & audit

**Structured stdout logging** in the API routes and the entra/okta clients:
context = user, Okta app ID, step, outcome, error. Consumed via the process
manager / container logs.

**Audit table** (new) in the existing SQLite DB (`src/lib/db.ts`):

```sql
CREATE TABLE IF NOT EXISTS migrations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  okta_app_id     TEXT NOT NULL,
  okta_label      TEXT NOT NULL,
  sign_on_mode    TEXT,
  status          TEXT NOT NULL,         -- success | failed | partial
  entra_app_id    TEXT,
  entra_object_id TEXT,
  entra_sp_id     TEXT,
  assigned_groups INTEGER NOT NULL DEFAULT 0,
  assigned_users  INTEGER NOT NULL DEFAULT 0,
  warnings        TEXT,                  -- JSON array
  errors          TEXT,                  -- JSON array
  created_at      TEXT NOT NULL
);
```

- **Every attempt is recorded, including failures.**
- New `GET /api/migrations` returns the current user's history; the history panel
  and the "already migrated ✓" markers read from this instead of `localStorage`,
  retiring the browser-only fragility.

---

## 9. Affected files

- `src/lib/entra.ts` — rewrite `createEntraApplication` onto the instantiate
  flow; add cert generation, rollback tracking, bounded-concurrency assignment,
  preflight resolution helpers, verified-domain lookup.
- `src/app/api/entra/preflight/route.ts` — **new** resolve endpoint.
- `src/app/api/entra/migrate/route.ts` — accept resolved IDs; write audit row;
  structured logging.
- `src/app/api/migrations/route.ts` — **new** history endpoint.
- `src/lib/db.ts` — add `migrations` table.
- `src/lib/migrations.ts` — **new** audit read/write helpers.
- `src/components/MigrateModal.tsx` — add the preview/override step.
- `src/components/MigrationHistoryPanel.tsx` + `src/hooks/useMigrationHistory.ts`
  — back history with the server instead of localStorage.
- `src/app/page.tsx` — pass resolved assignments through `handleMigrate`.
- `src/types/entra.ts` — types for preflight results, resolved assignments,
  richer migration result, audit rows.

---

## 10. Testing

- **Unit (mocked Graph):** group/user match classification (matched / ambiguous /
  not-found), Entity-ID pattern validation, claims-schema build from Okta
  expressions, cert add→activate→PEM handling, rollback ordering, retry/backoff.
- **Integration (manual, test tenant):** migrate a known SAML app end-to-end;
  verify the SP has an active signing cert, claims policy attached, members
  assigned; verify a deliberately-bad Entity ID degrades to a warning (not a
  failure); verify a forced core-step failure rolls back with no leftovers.

---

## 11. Open defaults chosen on the user's behalf

- Signing certificate validity: **3 years**.
- Assignment concurrency: **~5 concurrent**, backoff on 429.
- Generic template: **global-service** ID (swap to US-gov / 21Vianet only if a
  customer tenant is in those clouds — note for future engagements).
