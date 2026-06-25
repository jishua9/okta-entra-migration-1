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
