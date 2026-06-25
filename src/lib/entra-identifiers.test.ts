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
