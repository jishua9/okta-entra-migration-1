# Entra Migration Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Okta→Entra write path onto Microsoft's documented `applicationTemplates/instantiate` flow, with a pre-flight match preview, real SAML signing-cert generation, tiered best-effort rollback, throttle-safe assignment, and a server-side audit trail.

**Architecture:** Pure, framework-free helper modules in `src/lib/` hold all the logic worth testing (identifier validation, claims building, cert/PEM handling, retry/backoff, match classification, audit persistence). A thin orchestration layer in `src/lib/entra.ts` sequences Microsoft Graph calls using those helpers. API route handlers stay thin: auth-guard → call lib → record audit → respond. The React UI gains a pre-flight preview step before any tenant writes.

**Tech stack:** Next.js 16 (App Router, Node runtime, `proxy.ts` convention), React 19, TypeScript, better-sqlite3, `@microsoft/microsoft-graph-client`, `@azure/identity`. Tests: **Vitest** (unit tests over the pure helpers; the Graph-calling orchestration is verified by a manual integration checklist against a test tenant).

**Design reference:** `docs/plans/2026-06-25-entra-migration-redesign-design.md`. Defect list: `memory/original-tool-known-bugs.md`.

**Conventions for the executor:**
- This is a **customised Next.js 16**. Before editing any Next-specific file, read the relevant guide under `node_modules/next/dist/docs/`. Confirmed facts: middleware is named `proxy.ts` with a named `proxy` export (Node runtime, not edge); route-handler `params` is a `Promise`; `next lint` is removed (use `eslint` directly via `npm run lint`).
- Commit after every task. Run `npx tsc --noEmit` before each commit; it must pass.
- DRY / YAGNI / TDD. Each step is one small action.

---

## Task 1: Add the Vitest test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/smoke.test.ts`

**Step 1: Install Vitest**

Run: `npm install -D vitest`
Expected: `vitest` added to `devDependencies`.

**Step 2: Add the test script**

In `package.json` `scripts`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

**Step 4: Write a smoke test**

`src/lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 5: Run it**

Run: `npm test`
Expected: 1 passing test.

**Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/__tests__/smoke.test.ts
git commit -m "test: add Vitest harness"
```

---

## Task 2: Identifier-URI (SAML Entity ID) validation

Pre-validates whether Entra will accept a SAML Entity ID as an `identifierUri`, per the documented rules (must be `api://…`, the app/tenant ID, or on a verified domain). Used by the pre-flight preview and to produce actionable warnings.

**Files:**
- Create: `src/lib/entra-identifiers.ts`
- Test: `src/lib/entra-identifiers.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { validateIdentifierUri } from "./entra-identifiers";

const domains = ["contoso.com", "contoso.onmicrosoft.com"];

describe("validateIdentifierUri", () => {
  it("accepts api:// scheme", () => {
    expect(validateIdentifierUri("api://myapp", domains).accepted).toBe(true);
  });
  it("accepts a verified custom domain host", () => {
    expect(validateIdentifierUri("https://app.contoso.com", domains).accepted).toBe(true);
  });
  it("accepts the onmicrosoft.com initial domain", () => {
    expect(validateIdentifierUri("https://contoso.onmicrosoft.com/app", domains).accepted).toBe(true);
  });
  it("rejects an unverified domain with a reason", () => {
    const r = validateIdentifierUri("https://app.vendor.com", domains);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/verified domain/i);
  });
  it("rejects a trailing slash", () => {
    expect(validateIdentifierUri("https://contoso.com/", domains).accepted).toBe(false);
  });
  it("rejects empty input", () => {
    expect(validateIdentifierUri("", domains).accepted).toBe(false);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/entra-identifiers.test.ts`
Expected: FAIL (module not found).

**Step 3: Implement**

```ts
export interface IdentifierValidation {
  accepted: boolean;
  reason?: string;
}

// Mirrors Microsoft's identifier-URI restrictions for AzureADMyOrg apps.
// https://learn.microsoft.com/entra/identity-platform/identifier-uri-restrictions
export function validateIdentifierUri(
  uri: string,
  verifiedDomains: string[],
): IdentifierValidation {
  if (!uri) return { accepted: false, reason: "Entity ID is empty." };
  if (uri.endsWith("/")) return { accepted: false, reason: "Identifier must not end with '/'." };

  if (uri.startsWith("api://")) return { accepted: true };

  let host: string;
  try {
    host = new URL(uri).host.toLowerCase();
  } catch {
    return { accepted: false, reason: `"${uri}" is not a valid absolute URI.` };
  }
  if (!host) return { accepted: false, reason: `"${uri}" has no host.` };

  const domains = verifiedDomains.map((d) => d.toLowerCase());
  const onVerified = domains.some((d) => host === d || host.endsWith(`.${d}`));
  if (onVerified) return { accepted: true };

  return {
    accepted: false,
    reason:
      `"${host}" is not a verified domain in this tenant. Entra requires the Entity ID to be ` +
      `api://…, the app/tenant ID, or on a verified domain. Set it manually after migration ` +
      `or add the domain to the tenant.`,
  };
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/lib/entra-identifiers.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/entra-identifiers.ts src/lib/entra-identifiers.test.ts
git commit -m "feat: add SAML Entity ID identifier-URI validation"
```

---

## Task 3: Extract and harden the SAML claims-schema builder

Moves the `OKTA_EXPR_TO_ENTRA` map and claims-building logic out of `entra.ts` into a pure, tested module.

**Files:**
- Create: `src/lib/saml-claims.ts`
- Test: `src/lib/saml-claims.test.ts`
- Modify (later, Task 10): `src/lib/entra.ts` to import from here.

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { buildClaimsSchema } from "./saml-claims";

describe("buildClaimsSchema", () => {
  it("maps known user.* expressions", () => {
    const r = buildClaimsSchema([
      { name: "email", namespace: "", values: ["user.email"] },
    ]);
    expect(r.schema).toEqual([{ Source: "user", ID: "mail", SamlClaimType: "email" }]);
    expect(r.warnings).toHaveLength(0);
  });
  it("warns on unmapped expressions and skips them", () => {
    const r = buildClaimsSchema([
      { name: "weird", namespace: "", values: ["appuser.custom"] },
    ]);
    expect(r.schema).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/weird/);
  });
  it("ignores statements with no value", () => {
    const r = buildClaimsSchema([{ name: "x", namespace: "", values: [] }]);
    expect(r.schema).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/saml-claims.test.ts`
Expected: FAIL.

**Step 3: Implement** (move the map verbatim from `entra.ts:29-44`)

```ts
import { SamlAttributeStatement } from "@/types/entra";

const OKTA_EXPR_TO_ENTRA: Record<string, { Source: string; ID: string }> = {
  "user.email": { Source: "user", ID: "mail" },
  "user.login": { Source: "user", ID: "userprincipalname" },
  "user.firstName": { Source: "user", ID: "givenname" },
  "user.lastName": { Source: "user", ID: "surname" },
  "user.displayName": { Source: "user", ID: "displayname" },
  "user.department": { Source: "user", ID: "department" },
  "user.employeeNumber": { Source: "user", ID: "employeeid" },
  "user.mobilePhone": { Source: "user", ID: "telephonenumber" },
  "user.title": { Source: "user", ID: "jobtitle" },
  "user.streetAddress": { Source: "user", ID: "streetaddress" },
  "user.city": { Source: "user", ID: "city" },
  "user.state": { Source: "user", ID: "state" },
  "user.countryCode": { Source: "user", ID: "country" },
  "user.postalCode": { Source: "user", ID: "postalcode" },
};

export interface ClaimEntry { Source: string; ID: string; SamlClaimType: string }
export interface ClaimsBuildResult { schema: ClaimEntry[]; warnings: string[] }

export function buildClaimsSchema(
  statements: SamlAttributeStatement[],
): ClaimsBuildResult {
  const warnings: string[] = [];
  const schema = statements.flatMap((stmt): ClaimEntry[] => {
    const value = stmt.values?.[0];
    if (!value) return [];
    const entra = OKTA_EXPR_TO_ENTRA[value];
    if (!entra) {
      warnings.push(`Could not map attribute "${stmt.name}" (expression: ${value}) — configure manually`);
      return [];
    }
    return [{ ...entra, SamlClaimType: stmt.name }];
  });
  return { schema, warnings };
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/lib/saml-claims.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/saml-claims.ts src/lib/saml-claims.test.ts
git commit -m "feat: extract tested SAML claims-schema builder"
```

---

## Task 4: SAML signing-certificate helpers

The public-cert selection filter and PEM formatting. Fixes the original wrong filter (`usage:"Sign"` → must be `usage:"Verify"` + `type:"AsymmetricX509Cert"`).

**Files:**
- Create: `src/lib/saml-cert.ts`
- Test: `src/lib/saml-cert.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { selectSigningCert, keyToPem } from "./saml-cert";

describe("keyToPem", () => {
  it("wraps base64 in PEM markers", () => {
    const pem = keyToPem("QUJD");
    expect(pem).toContain("-----BEGIN CERTIFICATE-----");
    expect(pem).toContain("QUJD");
    expect(pem).toContain("-----END CERTIFICATE-----");
  });
});

describe("selectSigningCert", () => {
  it("selects the Verify/AsymmetricX509Cert public cert", () => {
    const creds = [
      { usage: "Sign", type: "X509CertAndPassword", key: "PRIVATE", endDateTime: "2030-01-01T00:00:00Z" },
      { usage: "Verify", type: "AsymmetricX509Cert", key: "PUBLIC", endDateTime: "2030-01-01T00:00:00Z" },
    ];
    const r = selectSigningCert(creds);
    expect(r?.key).toBe("PUBLIC");
  });
  it("returns null when none match", () => {
    expect(selectSigningCert([])).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/saml-cert.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
export interface KeyCredential {
  usage?: string;
  type?: string;
  key?: string;
  endDateTime?: string;
}

export function keyToPem(base64Key: string): string {
  const lines = base64Key.match(/.{1,64}/g)?.join("\n") ?? base64Key;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

// The public SAML signing cert is the Verify / AsymmetricX509Cert entry.
// (The original code wrongly looked for usage "Sign".)
export function selectSigningCert(creds: KeyCredential[]): KeyCredential | null {
  return (
    creds.find((k) => k.usage === "Verify" && k.type === "AsymmetricX509Cert") ?? null
  );
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/lib/saml-cert.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/saml-cert.ts src/lib/saml-cert.test.ts
git commit -m "feat: add SAML signing-cert selection + PEM helpers"
```

---

## Task 5: Graph retry/backoff utility

Retries a Graph call on `429`/`503`, honouring `Retry-After`, with bounded attempts. Used for replication-lag and throttling.

**Files:**
- Create: `src/lib/graph-retry.ts`
- Test: `src/lib/graph-retry.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./graph-retry";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseMs: 0 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries on a 429 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseMs: 0 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("rethrows a non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 400 });
    await expect(withRetry(fn, { retries: 3, baseMs: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("gives up after the retry budget", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 429 });
    await expect(withRetry(fn, { retries: 2, baseMs: 0 })).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/graph-retry.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
const RETRYABLE = new Set([429, 503, 504]);

function statusOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null) {
    const o = e as { statusCode?: number; status?: number };
    return o.statusCode ?? o.status;
  }
  return undefined;
}

export interface RetryOpts { retries?: number; baseMs?: number }

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const status = statusOf(e);
      if (status === undefined || !RETRYABLE.has(status) || attempt >= retries) throw e;
      const delay = baseMs * Math.pow(2, attempt);
      attempt++;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/lib/graph-retry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/graph-retry.ts src/lib/graph-retry.test.ts
git commit -m "feat: add Graph retry/backoff utility"
```

---

## Task 6: Bounded-concurrency map helper

Runs an async mapper over items at most N at a time (replaces `Promise.all` over all members).

**Files:**
- Create: `src/lib/concurrency.ts`
- Test: `src/lib/concurrency.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves order and maps all items", async () => {
    const r = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(r).toEqual([10, 20, 30, 40]);
  });
  it("never exceeds the concurrency limit", async () => {
    let active = 0, peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return n;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/concurrency.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/lib/concurrency.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/concurrency.ts src/lib/concurrency.test.ts
git commit -m "feat: add bounded-concurrency map helper"
```

---

## Task 7: Assignment match classification

Pure logic that turns a Graph lookup result (array of candidates) into `matched` / `ambiguous` / `not_found`, killing the blind `value[0]` guess.

**Files:**
- Create: `src/lib/assignment-match.ts`
- Test: `src/lib/assignment-match.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { classifyMatch } from "./assignment-match";

describe("classifyMatch", () => {
  it("matched on exactly one candidate", () => {
    const r = classifyMatch("Sales", [{ id: "1", displayName: "Sales" }]);
    expect(r.status).toBe("matched");
    expect(r.entraId).toBe("1");
  });
  it("ambiguous on multiple", () => {
    const r = classifyMatch("Sales", [
      { id: "1", displayName: "Sales" },
      { id: "2", displayName: "Sales" },
    ]);
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });
  it("not_found on none", () => {
    expect(classifyMatch("Sales", []).status).toBe("not_found");
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/assignment-match.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
export interface Candidate { id: string; displayName?: string; userPrincipalName?: string }
export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface MatchResult {
  sourceName: string;
  status: MatchStatus;
  entraId?: string;
  candidates?: Candidate[];
}

export function classifyMatch(sourceName: string, candidates: Candidate[]): MatchResult {
  if (candidates.length === 1) return { sourceName, status: "matched", entraId: candidates[0].id };
  if (candidates.length > 1) return { sourceName, status: "ambiguous", candidates };
  return { sourceName, status: "not_found" };
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/lib/assignment-match.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/assignment-match.ts src/lib/assignment-match.test.ts
git commit -m "feat: add assignment match classification"
```

---

## Task 8: Audit table + migrations persistence

**Files:**
- Modify: `src/lib/db.ts` (add `migrations` table)
- Create: `src/lib/migrations.ts` (record/list helpers)
- Test: `src/lib/migrations.test.ts`

**Step 1: Add the table to `db.ts`**

Append to the `db.exec(\`…\`)` block:
```sql
CREATE TABLE IF NOT EXISTS migrations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  okta_app_id     TEXT NOT NULL,
  okta_label      TEXT NOT NULL,
  sign_on_mode    TEXT,
  status          TEXT NOT NULL,
  entra_app_id    TEXT,
  entra_object_id TEXT,
  entra_sp_id     TEXT,
  assigned_groups INTEGER NOT NULL DEFAULT 0,
  assigned_users  INTEGER NOT NULL DEFAULT 0,
  warnings        TEXT,
  errors          TEXT,
  created_at      TEXT NOT NULL
);
```

**Step 2: Write the failing tests** (`src/lib/migrations.test.ts`)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import db from "@/lib/db";
import { recordMigration, listMigrations } from "./migrations";

describe("migrations audit", () => {
  beforeEach(() => db.prepare("DELETE FROM migrations").run());

  it("records and lists an attempt for a user", () => {
    recordMigration({
      userId: "u1", oktaAppId: "a1", oktaLabel: "App One", signOnMode: "SAML_2_0",
      status: "success", entraAppId: "e1", entraObjectId: "o1", entraSpId: "sp1",
      assignedGroups: 2, assignedUsers: 5, warnings: ["w"], errors: [],
    });
    const rows = listMigrations("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("success");
    expect(rows[0].warnings).toEqual(["w"]);
  });

  it("scopes listing to the user", () => {
    recordMigration({ userId: "u2", oktaAppId: "a", oktaLabel: "x", status: "failed", assignedGroups: 0, assignedUsers: 0, warnings: [], errors: ["boom"] });
    expect(listMigrations("u1")).toHaveLength(0);
    expect(listMigrations("u2")[0].errors).toEqual(["boom"]);
  });
});
```

**Step 3: Run to verify failure**

Run: `npx vitest run src/lib/migrations.test.ts`
Expected: FAIL.

**Step 4: Implement `src/lib/migrations.ts`**

```ts
import crypto from "crypto";
import db from "@/lib/db";

export interface MigrationRecordInput {
  userId: string;
  oktaAppId: string;
  oktaLabel: string;
  signOnMode?: string;
  status: "success" | "failed" | "partial";
  entraAppId?: string;
  entraObjectId?: string;
  entraSpId?: string;
  assignedGroups: number;
  assignedUsers: number;
  warnings: string[];
  errors: string[];
}

export interface MigrationRow extends Omit<MigrationRecordInput, "userId"> {
  id: string;
  migratedAt: string;
}

export function recordMigration(input: MigrationRecordInput): string {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO migrations
      (id, user_id, okta_app_id, okta_label, sign_on_mode, status,
       entra_app_id, entra_object_id, entra_sp_id, assigned_groups, assigned_users,
       warnings, errors, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.userId, input.oktaAppId, input.oktaLabel, input.signOnMode ?? null,
    input.status, input.entraAppId ?? null, input.entraObjectId ?? null,
    input.entraSpId ?? null, input.assignedGroups, input.assignedUsers,
    JSON.stringify(input.warnings), JSON.stringify(input.errors),
    new Date().toISOString(),
  );
  return id;
}

type DbRow = {
  id: string; okta_app_id: string; okta_label: string; sign_on_mode: string | null;
  status: MigrationRow["status"]; entra_app_id: string | null; entra_object_id: string | null;
  entra_sp_id: string | null; assigned_groups: number; assigned_users: number;
  warnings: string | null; errors: string | null; created_at: string;
};

export function listMigrations(userId: string): MigrationRow[] {
  const rows = db.prepare(
    "SELECT * FROM migrations WHERE user_id = ? ORDER BY created_at DESC",
  ).all(userId) as DbRow[];
  return rows.map((r) => ({
    id: r.id, oktaAppId: r.okta_app_id, oktaLabel: r.okta_label,
    signOnMode: r.sign_on_mode ?? undefined, status: r.status,
    entraAppId: r.entra_app_id ?? undefined, entraObjectId: r.entra_object_id ?? undefined,
    entraSpId: r.entra_sp_id ?? undefined, assignedGroups: r.assigned_groups,
    assignedUsers: r.assigned_users, warnings: JSON.parse(r.warnings ?? "[]"),
    errors: JSON.parse(r.errors ?? "[]"), migratedAt: r.created_at,
  }));
}
```

**Step 5: Run to verify pass**

Run: `npx vitest run src/lib/migrations.test.ts`
Expected: PASS.

**Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/db.ts src/lib/migrations.ts src/lib/migrations.test.ts
git commit -m "feat: add migrations audit table and persistence"
```

---

## Task 9: Structured logger

**Files:**
- Create: `src/lib/log.ts`
- Test: `src/lib/log.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { logEvent } from "./log";

describe("logEvent", () => {
  it("writes a JSON line with event and context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("migrate.start", { userId: "u1", oktaAppId: "a1" });
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.event).toBe("migrate.start");
    expect(parsed.userId).toBe("u1");
    expect(typeof parsed.ts).toBe("string");
    spy.mockRestore();
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/log.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
type Ctx = Record<string, unknown>;

export function logEvent(event: string, ctx: Ctx = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...ctx }));
}
```

**Step 4: Run to verify pass + commit**

Run: `npx vitest run src/lib/log.test.ts`
```bash
git add src/lib/log.ts src/lib/log.test.ts
git commit -m "feat: add structured logEvent helper"
```

---

## Task 10: Extend types for preflight, resolved assignments, and richer results

**Files:**
- Modify: `src/types/entra.ts`

**Step 1: Add types**

```ts
// Pre-flight resolution
export interface ResolvedAssignment {
  sourceName: string;
  status: "matched" | "ambiguous" | "not_found";
  entraId?: string;
  principalType: "group" | "user";
  candidates?: { id: string; label: string }[];
}

export interface PreflightResult {
  groups: ResolvedAssignment[];
  users: ResolvedAssignment[];
  entityIdValidation?: { accepted: boolean; reason?: string };
}

// What the migrate endpoint now receives: confirmed Entra principal IDs
export interface ConfirmedPrincipal { entraId: string; principalType: "group" | "user"; label: string }
```

Add to `EntraAppPayload`: `confirmedPrincipals?: ConfirmedPrincipal[];` (replaces name-based `groups`/`users` for the new flow; keep old fields until Task 13 removes their use).

Add to `MigrationResult`: `status?: "success" | "failed" | "partial"; rollbackPerformed?: boolean; rollbackErrors?: string[];`

**Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/types/entra.ts
git commit -m "feat: add preflight/resolved-assignment/result types"
```

---

## Task 11: Rewrite `entra.ts` — instantiate flow, cert generation, tiered rollback

This is the core orchestration. It uses every helper from Tasks 2–7. Keep it thin: branch logic lives in helpers; this sequences Graph calls.

**Files:**
- Modify: `src/lib/entra.ts`

**Reference before editing:** Microsoft "Configure SAML SSO via Graph" (steps 2,3,5,6) and `applicationTemplate: instantiate` — see design doc §4/§6.

**Step 1: Add the generic template constant + instantiate helper**

```ts
const GENERIC_TEMPLATE_ID = "8adf8e6e-67b2-4cf2-a259-e3dc5476c621"; // global-service "Custom" non-gallery template

async function instantiateApp(client: Client, displayName: string) {
  // Returns { application, servicePrincipal }
  return withRetry(() =>
    client.api(`/applicationTemplates/${GENERIC_TEMPLATE_ID}/instantiate`).post({ displayName }),
  );
}
```

**Step 2: Add verified-domains lookup**

```ts
export async function getVerifiedDomains(config: EntraConfig): Promise<string[]> {
  const client = makeGraphClient(config);
  const res = await client.api("/domains").select("id,isVerified").get();
  return (res.value as { id: string; isVerified: boolean }[])
    .filter((d) => d.isVerified)
    .map((d) => d.id);
}
```

**Step 3: Add the signing-cert step** (uses `saml-cert.ts`)

```ts
async function addSigningCertificate(client: Client, spId: string, displayName: string) {
  const endDateTime = new Date();
  endDateTime.setFullYear(endDateTime.getFullYear() + 3); // 3-year default (design §11)
  const cert = await withRetry(() =>
    client.api(`/servicePrincipals/${spId}/addTokenSigningCertificate`).post({
      displayName: `CN=${displayName}`,
      endDateTime: endDateTime.toISOString(),
    }),
  );
  // Activate it
  if (cert.thumbprint) {
    await withRetry(() =>
      client.api(`/servicePrincipals/${spId}`).patch({
        preferredTokenSigningKeyThumbprint: cert.thumbprint,
      }),
    );
  }
  return cert; // contains .key (public cert base64) and .thumbprint
}
```

**Step 4: Rewrite `createEntraApplication`** with the tier split + rollback. Track created IDs; on a **core**-step failure, delete claims policy → SP → application (best-effort, collecting rollback errors). Configuration-step failures push to `warnings` and continue. Sketch:

```ts
export async function createEntraApplication(payload, config) {
  const client = makeGraphClient(config);
  const created: { appObjectId?: string; spId?: string; claimsPolicyId?: string } = {};
  const warnings: string[] = [];

  try {
    // --- CORE ---
    const inst = await instantiateApp(client, payload.displayName);
    created.appObjectId = inst.application.id;
    created.spId = inst.servicePrincipal.id;
    const appId = inst.application.appId;

    if (payload.signOnMode === "SAML_2_0") {
      await withRetry(() => client.api(`/servicePrincipals/${created.spId}`).patch({
        preferredSingleSignOnMode: "saml",
      }));
    } else if (payload.replyUrls?.length) {
      await withRetry(() => client.api(`/applications/${created.appObjectId}`).patch({
        web: { redirectUris: payload.replyUrls, implicitGrantSettings: { enableIdTokenIssuance: false } },
      }));
    }

    // --- CONFIGURATION (failures => warnings, no rollback) ---
    let samlResult;
    if (payload.signOnMode === "SAML_2_0") {
      samlResult = await configureSaml(client, created, payload, warnings);
    }

    return { entraAppId: appId, entraObjectId: created.appObjectId, entraSPId: created.spId,
             displayName: payload.displayName, warnings, ...samlResult };
  } catch (coreErr) {
    const rollback = await rollback(client, created);
    throw new MigrationCoreError(coreErr, rollback);
  }
}
```

`configureSaml` here is rewritten to: set reply URL (config), set identifier URI guarded by `validateIdentifierUri` + try/warn (config), build claims via `buildClaimsSchema` + create/assign policy (config; record `created.claimsPolicyId`), add+activate signing cert via `addSigningCertificate` then `keyToPem(cert.key)` (config). Each wrapped so a failure becomes a warning.

`rollback(client, created)` deletes, best-effort with `withRetry`, in order: claims policy, SP, application; returns `{ performed: boolean; errors: string[] }`.

Define `class MigrationCoreError extends Error { constructor(cause, rollbackInfo){…} }` carrying the rollback info so the route can report it.

**Step 5: Rewrite `assignAppMembers`** to take **confirmed principal IDs** (not names), use `mapWithConcurrency(confirmed, 5, …)` + `withRetry` per assignment, and return counts + per-item warnings. No name lookups remain here (lookups happen in preflight).

**Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (fix type mismatches against Task 10 types).

**Step 7: Commit**

```bash
git add src/lib/entra.ts
git commit -m "feat: re-platform Entra creation onto instantiate flow with cert + rollback"
```

> **Note:** `createEntraApplication`/`configureSaml` are integration-verified (Task 18), since they are thin wrappers over Graph. All branching logic they call is already unit-tested in Tasks 2–7.

---

## Task 12: Preflight resolution in `entra.ts`

**Files:**
- Modify: `src/lib/entra.ts`
- (logic already tested via `assignment-match` + `entra-identifiers`)

**Step 1: Implement `resolveAssignments`**

```ts
export async function resolveAssignments(
  groups: { name?: string }[],
  users: { userName?: string }[],
  entityId: string | undefined,
  config: EntraConfig,
): Promise<PreflightResult> {
  const client = makeGraphClient(config);

  const resolveOne = async (name: string, kind: "group" | "user"): Promise<ResolvedAssignment> => {
    const path = kind === "group" ? "/groups" : "/users";
    const field = kind === "group" ? "displayName" : "userPrincipalName";
    const res = await withRetry(() =>
      client.api(path).filter(`${field} eq '${oDataEscape(name)}'`).select(`id,${field}`).get());
    const m = classifyMatch(name, res.value ?? []);
    return {
      sourceName: name, status: m.status, entraId: m.entraId, principalType: kind,
      candidates: m.candidates?.map((c) => ({ id: c.id, label: c.displayName ?? c.userPrincipalName ?? c.id })),
    };
  };

  const groupResults = await mapWithConcurrency(
    groups.filter((g) => g.name), 5, (g) => resolveOne(g.name!, "group"));
  const userResults = await mapWithConcurrency(
    users.filter((u) => u.userName), 5, (u) => resolveOne(u.userName!, "user"));

  let entityIdValidation;
  if (entityId) {
    const domains = await getVerifiedDomains(config);
    entityIdValidation = validateIdentifierUri(entityId, domains);
  }
  return { groups: groupResults, users: userResults, entityIdValidation };
}
```

**Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/entra.ts
git commit -m "feat: add preflight assignment + entity-id resolution"
```

---

## Task 13: `POST /api/entra/preflight` route

**Files:**
- Create: `src/app/api/entra/preflight/route.ts`

**Step 1: Implement** (mirror existing route auth pattern)

```ts
import { NextResponse } from "next/server";
import { resolveAssignments } from "@/lib/entra";
import { requireUserConfig } from "@/lib/api-helpers";
import { logEvent } from "@/lib/log";

export async function POST(req: Request) {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config, userId } = result;
  try {
    const body = await req.json();
    const out = await resolveAssignments(
      body.groups ?? [], body.users ?? [], body.entityId,
      { tenantId: config.azureTenantId, clientId: config.azureClientId, clientSecret: config.azureClientSecret },
    );
    return NextResponse.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logEvent("preflight.error", { userId, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/entra/preflight/route.ts
git commit -m "feat: add preflight resolve API route"
```

---

## Task 14: Rewrite `POST /api/entra/migrate` — resolved IDs, audit, logging, rollback reporting

**Files:**
- Modify: `src/app/api/entra/migrate/route.ts`

**Step 1: Implement**

- Read `confirmedPrincipals` from body; split into the IDs passed to `assignAppMembers`.
- `logEvent("migrate.start", { userId, oktaAppId })`.
- Call `createEntraApplication`; on `MigrationCoreError`, record a `failed` audit row (with rollback info in errors) and return `{ success:false, status:"failed", rollbackPerformed, rollbackErrors, error }`.
- On success, run `assignAppMembers`; compute `status` = `partial` if any warnings/assignment errors else `success`.
- `recordMigration({...})` for **every** outcome.
- `logEvent("migrate.done", { userId, oktaAppId, status })`.
- Return the richer `MigrationResult`.

**Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/entra/migrate/route.ts
git commit -m "feat: migrate route uses resolved IDs, writes audit, reports rollback"
```

---

## Task 15: `GET /api/migrations` route

**Files:**
- Create: `src/app/api/migrations/route.ts`

**Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { listMigrations } from "@/lib/migrations";

export async function GET() {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;
  return NextResponse.json({ migrations: listMigrations(result.userId) });
}
```

**Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/migrations/route.ts
git commit -m "feat: add server-side migration history route"
```

---

## Task 16: Move migration history from localStorage to the server

**Files:**
- Modify: `src/hooks/useMigrationHistory.ts` (fetch from `/api/migrations`; keep `addEntry` as a refetch trigger; drop localStorage writes)
- Modify: `src/components/MigrationHistoryPanel.tsx` (consume server shape; remove/disable "clear" or wire to a future delete — for v1, hide the clear button)
- Modify: `src/app/page.tsx` (after a successful migrate, call the hook's refresh instead of building a localStorage entry; `migratedIds` derives from server history)

**Step 1: Implement the hook against the API**, preserving the existing return shape (`history`, `refresh`, `migratedIds` source) so `page.tsx` changes stay minimal.

**Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/hooks/useMigrationHistory.ts src/components/MigrationHistoryPanel.tsx src/app/page.tsx
git commit -m "feat: back migration history with the server audit table"
```

---

## Task 17: Pre-flight preview + override in `MigrateModal`

**Files:**
- Modify: `src/components/MigrateModal.tsx`
- Modify: `src/app/page.tsx` (`handleMigrate` sends `confirmedPrincipals`)

**Step 1: Add a preview stage.** When the modal opens, after the existing duplicate check, `POST /api/entra/preflight` with the app's group names, user UPNs, and (SAML) Entity ID. Render three groupings:
- ✅ matched (count) — included by default
- ⚠️ ambiguous — render candidate radio/select; the consultant picks one or skips
- ❌ not found — listed, excluded by default, with a "directory sync gap" note

Show the `entityIdValidation` warning inline near the Entity ID field when `accepted === false`.

**Step 2: On confirm**, build `confirmedPrincipals` from matched + resolved-ambiguous selections (skip not-found and skipped), and pass them up through `onConfirm`. `page.tsx handleMigrate` puts them in the POST body instead of `groups`/`users` names.

**Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit` then `npm run dev`, open a SAML app, confirm the preview renders matched/ambiguous/not-found and an unverified Entity ID shows the warning.

**Step 4: Commit**

```bash
git add src/components/MigrateModal.tsx src/app/page.tsx
git commit -m "feat: pre-flight match preview with override in migrate modal"
```

---

## Task 18: Full verification + manual integration checklist

**Files:** none (verification only)

**Step 1: Static checks**

```bash
npm test            # all unit tests pass
npx tsc --noEmit    # types clean
npm run lint        # eslint clean (next lint is removed; this runs eslint directly)
npm run build       # production build succeeds (Turbopack)
```

**Step 2: Manual integration (test tenant + test Okta org)** — see `superpowers:verification-before-completion`. Verify each:
- [ ] Migrate an OIDC app → app registration created with redirect URIs; SP exists.
- [ ] Migrate a SAML app → SP has `preferredSingleSignOnMode = saml`, an **active signing certificate** (thumbprint set), claims policy attached, reply URL + Entity ID set; the returned PEM is non-empty.
- [ ] SAML app with an **unverified-domain Entity ID** → migration succeeds, Entity ID surfaced as a warning (no 500, no rollback).
- [ ] App with an **ambiguous group name** → preview shows the choice; chosen group is the one assigned.
- [ ] App with a **not-found user** → excluded; reported, app still created.
- [ ] **Force a core-step failure** (e.g. temporarily break the instantiate call) → no orphaned app/SP/claims policy remain; result reports `rollbackPerformed`.
- [ ] Every attempt (success and failure) appears in `GET /api/migrations` and the history panel; ✓ markers survive a browser change.
- [ ] Server logs show `migrate.start` / `migrate.done` JSON lines.

**Step 3: Final commit (if any verification fixes were needed)**

```bash
git add -A && git commit -m "fix: address verification findings"
```

---

## Execution notes

- Tasks 1–9 are pure/TDD and have no external dependencies — safe to do in one sitting.
- Tasks 11–12 (the Graph orchestration) cannot be meaningfully unit-tested without heavy SDK mocking; their *logic* is already covered by Tasks 2–7, and they are validated by Task 18's integration checklist. Keep them thin.
- The old name-based `groups`/`users` fields and the localStorage history are removed only once the new paths work (Tasks 14, 16) to keep each commit runnable.
