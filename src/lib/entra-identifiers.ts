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
