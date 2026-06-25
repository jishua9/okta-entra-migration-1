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
