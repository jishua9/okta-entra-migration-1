import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { ConfirmedPrincipal, EntraAppPayload } from "@/types/entra";
import { buildClaimsSchema } from "@/lib/saml-claims";
import { keyToPem } from "@/lib/saml-cert";
import { withRetry } from "@/lib/graph-retry";
import { mapWithConcurrency } from "@/lib/concurrency";

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

// Global-service "Custom" (non-gallery) application template for configuring SSO.
const GENERIC_TEMPLATE_ID = "8adf8e6e-67b2-4cf2-a259-e3dc5476c621";

export function makeGraphClient(config: EntraConfig): Client {
  const credential = new ClientSecretCredential(
    config.tenantId,
    config.clientId,
    config.clientSecret,
  );
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });
  return Client.initWithMiddleware({ authProvider });
}

export function oDataEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// Tracks what has been created so rollback can clean up after a CORE failure.
interface CreatedState {
  appObjectId?: string;
  spId?: string;
  claimsPolicyId?: string;
}

export class MigrationCoreError extends Error {
  cause: unknown;
  rollback: { performed: boolean; errors: string[] };
  constructor(cause: unknown, rollback: { performed: boolean; errors: string[] }) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "MigrationCoreError";
    this.cause = cause;
    this.rollback = rollback;
  }
}

// Best-effort cleanup after a CORE failure: claims policy → SP → application.
async function rollback(
  client: Client,
  created: CreatedState,
): Promise<{ performed: boolean; errors: string[] }> {
  const errors: string[] = [];
  let performed = false;

  if (created.claimsPolicyId) {
    performed = true;
    try {
      await withRetry(() =>
        client.api(`/policies/claimsMappingPolicies/${created.claimsPolicyId}`).delete(),
      );
    } catch (e) {
      errors.push(
        `Failed to delete claims mapping policy ${created.claimsPolicyId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (created.spId) {
    performed = true;
    try {
      await withRetry(() => client.api(`/servicePrincipals/${created.spId}`).delete());
    } catch (e) {
      errors.push(
        `Failed to delete service principal ${created.spId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (created.appObjectId) {
    performed = true;
    try {
      await withRetry(() => client.api(`/applications/${created.appObjectId}`).delete());
    } catch (e) {
      errors.push(
        `Failed to delete application ${created.appObjectId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { performed, errors };
}

interface SamlConfigResult {
  signingCertificate: string;
  certExpiry: string;
  claimsMapped: number;
}

// CONFIGURATION steps for SAML. Each failure is captured as a warning and never
// triggers rollback. `created.claimsPolicyId` is recorded for completeness.
async function configureSaml(
  client: Client,
  appObjectId: string,
  spId: string,
  payload: EntraAppPayload,
  created: CreatedState,
  warnings: string[],
): Promise<SamlConfigResult> {
  // Reply / ACS URL on the service principal.
  if (payload.samlAcsUrl) {
    try {
      await withRetry(() =>
        client.api(`/servicePrincipals/${spId}`).patch({ replyUrls: [payload.samlAcsUrl] }),
      );
    } catch (e) {
      warnings.push(
        `Could not set reply/ACS URL: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Entity ID (identifier URI) on the application. Entra often rejects this for
  // unverified domains — that is a warning, not a rollback.
  if (payload.samlEntityId) {
    try {
      await withRetry(() =>
        client.api(`/applications/${appObjectId}`).patch({
          identifierUris: [payload.samlEntityId],
        }),
      );
    } catch (e) {
      warnings.push(
        `Could not set Entity ID "${payload.samlEntityId}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Claims mapping policy.
  const { schema, warnings: claimWarnings } = buildClaimsSchema(
    payload.samlAttributeStatements ?? [],
  );
  warnings.push(...claimWarnings);

  let claimsMapped = 0;
  if (schema.length > 0) {
    try {
      const policyDef = JSON.stringify({
        ClaimsMappingPolicy: {
          Version: 1,
          IncludeBasicClaimSet: "true",
          ClaimsSchema: schema,
        },
      });
      const policy = await withRetry(() =>
        client.api("/policies/claimsMappingPolicies").post({
          definition: [policyDef],
          displayName: `${payload.displayName} — Claims Mapping`,
          isOrganizationDefault: false,
        }),
      );
      created.claimsPolicyId = policy.id;

      await withRetry(() =>
        client.api(`/servicePrincipals/${spId}/claimsMappingPolicies/$ref`).post({
          "@odata.id": `https://graph.microsoft.com/v1.0/policies/claimsMappingPolicies/${policy.id}`,
        }),
      );
      claimsMapped = schema.length;
    } catch (e) {
      warnings.push(
        `Claims mapping policy could not be created/assigned (requires Policy.ReadWrite.ApplicationConfiguration permission): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // SAML token signing certificate (THE FIX) + activation.
  let signingCertificate = "";
  let certExpiry = "";
  try {
    const endDateTime = new Date();
    endDateTime.setFullYear(endDateTime.getFullYear() + 3);
    const endDateTimeIso = endDateTime.toISOString();

    const cert = await withRetry(() =>
      client.api(`/servicePrincipals/${spId}/addTokenSigningCertificate`).post({
        displayName: `CN=${payload.displayName}`,
        endDateTime: endDateTimeIso,
      }),
    );

    await withRetry(() =>
      client.api(`/servicePrincipals/${spId}`).patch({
        preferredTokenSigningKeyThumbprint: cert.thumbprint,
      }),
    );

    if (cert.key) signingCertificate = keyToPem(cert.key);
    certExpiry = endDateTimeIso;
  } catch (e) {
    warnings.push(
      `Could not generate/activate SAML signing certificate: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { signingCertificate, certExpiry, claimsMapped };
}

export async function createEntraApplication(
  payload: EntraAppPayload,
  config: EntraConfig,
): Promise<{
  entraAppId: string;
  entraObjectId: string;
  entraSPId: string;
  displayName: string;
  warnings: string[];
  samlConfigured?: boolean;
  samlSigningCertificate?: string;
  samlCertExpiry?: string;
  samlClaimsMapped?: number;
  samlWarnings?: string[];
}> {
  const client = makeGraphClient(config);
  const warnings: string[] = [];
  const created: CreatedState = {};

  let appObjectId: string;
  let spId: string;
  let appId: string;

  // ---- CORE steps: any failure rolls everything back and throws. ----
  try {
    const res = await withRetry(() =>
      client.api(`/applicationTemplates/${GENERIC_TEMPLATE_ID}/instantiate`).post({
        displayName: payload.displayName,
      }),
    );
    appObjectId = res.application.id;
    spId = res.servicePrincipal.id;
    appId = res.application.appId;
    created.appObjectId = appObjectId;
    created.spId = spId;

    if (payload.signOnMode === "SAML_2_0") {
      await withRetry(() =>
        client.api(`/servicePrincipals/${spId}`).patch({
          preferredSingleSignOnMode: "saml",
        }),
      );
    } else if (payload.replyUrls?.length) {
      await withRetry(() =>
        client.api(`/applications/${appObjectId}`).patch({
          web: {
            redirectUris: payload.replyUrls,
            implicitGrantSettings: { enableIdTokenIssuance: false },
          },
        }),
      );
    }
  } catch (e) {
    const rollbackResult = await rollback(client, created);
    throw new MigrationCoreError(e, rollbackResult);
  }

  // ---- CONFIGURATION steps (SAML only): failures warn, never rollback. ----
  let samlResult: SamlConfigResult | undefined;
  if (payload.signOnMode === "SAML_2_0") {
    samlResult = await configureSaml(client, appObjectId, spId, payload, created, warnings);
  }

  return {
    entraAppId: appId,
    entraObjectId: appObjectId,
    entraSPId: spId,
    displayName: payload.displayName,
    warnings,
    ...(samlResult
      ? {
          samlConfigured: true,
          samlSigningCertificate: samlResult.signingCertificate,
          samlCertExpiry: samlResult.certExpiry,
          samlClaimsMapped: samlResult.claimsMapped,
          samlWarnings: warnings,
        }
      : {}),
  };
}

export async function assignAppMembers(
  servicePrincipalId: string,
  principals: ConfirmedPrincipal[],
  config: EntraConfig,
): Promise<{ assignedGroups: number; assignedUsers: number; errors: string[] }> {
  const client = makeGraphClient(config);
  const errors: string[] = [];
  let assignedGroups = 0;
  let assignedUsers = 0;

  const results = await mapWithConcurrency(principals, 5, async (principal) => {
    try {
      await withRetry(() =>
        client.api(`/servicePrincipals/${servicePrincipalId}/appRoleAssignedTo`).post({
          principalId: principal.entraId,
          resourceId: servicePrincipalId,
          appRoleId: "00000000-0000-0000-0000-000000000000",
        }),
      );
      return { ok: true as const, principalType: principal.principalType };
    } catch (e) {
      return {
        ok: false as const,
        message: `Failed to assign ${principal.principalType} "${principal.label}": ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  for (const r of results) {
    if (r.ok) {
      if (r.principalType === "group") assignedGroups++;
      else assignedUsers++;
    } else {
      errors.push(r.message);
    }
  }

  return { assignedGroups, assignedUsers, errors };
}

export async function listEntraApplications(
  config: EntraConfig,
): Promise<{ appId: string; displayName: string }[]> {
  const client = makeGraphClient(config);
  const apps: { appId: string; displayName: string }[] = [];

  let response = await client
    .api("/applications")
    .select("appId,displayName")
    .top(999)
    .get();

  apps.push(...response.value);

  while (response["@odata.nextLink"]) {
    response = await client.api(response["@odata.nextLink"]).get();
    apps.push(...response.value);
  }

  return apps;
}
