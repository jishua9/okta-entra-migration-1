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
