---
name: migration-redesign-decisions
description: Agreed design decisions for re-platforming the Entra app creation path onto the Microsoft Graph instantiate flow
metadata:
  type: project
---

Brainstormed 2026-06-25. Goal: make the Okta→Entra migration write-path correct and reliable, "the Microsoft-blessed way." Decisions:

1. **Re-platform onto Graph `applicationTemplates/{id}/instantiate`** instead of hand-rolled `POST /applications` + `POST /servicePrincipals`.
2. **Template strategy: generic non-gallery template** `8adf8e6e-67b2-4cf2-a259-e3dc5476c621` as the engine, **plus a gallery suggestion hint** surfaced for the consultant (MS only does gallery selection human-in-the-loop; never automate fuzzy matching).
3. **Identity matching: pre-flight match preview with manual override.** Resolve every group/user before any writes; show matched / ambiguous / not-found; let consultant correct or skip; migrate only confirmed matches. Assumes users/groups already synced into Entra.
4. **Best-effort rollback on failure**, with a tier split:
   - *Core steps* (rollback if they fail): instantiate → app+SP exist → set SSO mode.
   - *Configuration steps* (failure = warning, no rollback): Entity ID/identifier URI, reply URLs, claims-mapping policy, signing certificate.
   - Rollback also deletes any tenant-level claims-mapping policy created. Member-assignment failures stay as warnings, never trigger rollback.
5. **Entity ID handling: pre-validate in the preview** (check against verified domains / allowed patterns) **AND treat write-time rejection as a non-fatal warning.**
6. **Logging + audit table (capture ALL attempts incl. failures).** Structured stdout logs for diagnostics + a `migrations` table in SQLite as durable record; make the table the source of truth for history (retires fragile localStorage).
7. **Signing cert (prescribed by docs):** `addTokenSigningCertificate` → activate via `preferredTokenSigningKeyThumbprint` → read back the `Verify`/`AsymmetricX509Cert` public key as PEM.

Validated design doc to be written to `docs/plans/2026-06-25-entra-migration-redesign-design.md`. Fixes the defects in [[original-tool-known-bugs]].

## Implementation status (as of 2026-06-25)

Built on branch `entra-migration-redesign` via subagent-driven execution of `docs/plans/2026-06-25-entra-migration-redesign.md` (18 tasks). **Static verification all green: 27 unit tests, tsc clean, eslint clean, `next build` succeeds.** Final code review passed after fixes (relay-state propagation restored, audit row on all failure paths, cert read-back fallback wired, dead name-based payload fields removed, test DB isolated to in-memory via `SQLITE_DB_PATH`).

Also fixed a **pre-existing** prod-build failure: `/login` used `useSearchParams()` without a `<Suspense>` boundary (broke `next build` on the original tool).

**Outstanding before merge/use:**
- Manual integration verification on a live Entra tenant + Okta org (no test env available at build time) — the real "does SSO work" gate.
- Deferred minor items: client-side re-validation of an edited Entity ID; remove redundant `samlWarnings` alias.

Branch not yet merged to `master`.
