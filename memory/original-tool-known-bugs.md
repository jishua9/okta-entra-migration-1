---
name: original-tool-known-bugs
description: Defects found in the original off-the-shelf GitHub Okta→Entra tool before the redesign
metadata:
  type: project
---

The tool was downloaded from GitHub (single "First commit"). Deep review found these defects in the Entra write path (`src/lib/entra.ts`, `src/app/api/entra/migrate/route.ts`):

1. **SAML signing certificate never generated.** Code only *reads back* `keyCredentials`; never calls `POST /servicePrincipals/{id}/addTokenSigningCertificate` + activate via `preferredTokenSigningKeyThumbprint`. README falsely claims auto-generation.
2. **Cert read-back filter is wrong** even if a cert existed: it looks for `usage:"Sign"+type:"AsymmetricX509Cert"`; the public cert is `usage:"Verify"+type:"AsymmetricX509Cert"`.
3. **identifierUris (SAML Entity ID) PATCH unguarded.** Entra rejects URIs not on a verified domain ("All newly added URIs must contain a tenant verified domain, tenant ID, or app ID") → whole migration 500s, leaving orphaned app+SP.
4. **No rollback / no idempotency.** Partial failure orphans objects; retry creates duplicates (duplicate detection is client-side, name-based, advisory only).
5. **Blind identity matching.** Groups matched on `displayName`, users on UPN, takes `value[0]` (can assign wrong group), silently drops not-found.
6. **No throttling/backoff** on bulk `appRoleAssignedTo` (Promise.all over all members → 429s).
7. **No logging anywhere** (grep for console/logger = 0). Migration history lives only in browser localStorage.

Root cause for SAML issues: tool hand-rolls `POST /applications` + `POST /servicePrincipals` instead of Microsoft's `applicationTemplates/{id}/instantiate` flow. See [[migration-redesign-decisions]].
