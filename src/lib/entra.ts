import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import {
  ConfirmedPrincipal,
  EntraAppPayload,
  MigrationStep,
  PreflightResult,
  ResolvedAssignment,
} from "@/types/entra";
import { buildClaimsSchema } from "@/lib/saml-claims";
import { keyToPem, selectSigningCert, type KeyCredential } from "@/lib/saml-cert";
import { withRetry } from "@/lib/graph-retry";
import { mapWithConcurrency } from "@/lib/concurrency";
import { classifyMatch } from "@/lib/assignment-match";
import { validateIdentifierUri } from "@/lib/entra-identifiers";

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
  steps: MigrationStep[],
): Promise<SamlConfigResult> {
  // Reply / ACS URL. Per Microsoft's SAML-SSO Graph guidance this is the
  // application's web.redirectUris, NOT the service principal's replyUrls —
  // setting it on the SP fails with "properties … do not match the application
  // object". Newly instantiated objects can lag in replication (404); retry.
  if (payload.samlAcsUrl) {
    try {
      await withRetry(
        () =>
          client.api(`/applications/${appObjectId}`).patch({
            web: { redirectUris: [payload.samlAcsUrl] },
          }),
        { retryOn: [404], retries: 6 },
      );
      steps.push({ label: "ACS / reply URL", status: "done", detail: payload.samlAcsUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`Could not set reply/ACS URL: ${msg}`);
      steps.push({ label: "ACS / reply URL", status: "failed", detail: msg });
    }
  } else {
    steps.push({ label: "ACS / reply URL", status: "skipped", detail: "none provided" });
  }

  // SAML relay state on the service principal (only when Okta supplied one).
  if (payload.samlRelayState) {
    try {
      await withRetry(
        () =>
          client.api(`/servicePrincipals/${spId}`).patch({
            samlSingleSignOnSettings: { relayState: payload.samlRelayState },
          }),
        { retryOn: [404], retries: 6 },
      );
      steps.push({ label: "Relay state", status: "done", detail: payload.samlRelayState });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`Could not set SAML relay state: ${msg}`);
      steps.push({ label: "Relay state", status: "failed", detail: msg });
    }
  }

  // Entity ID (identifier URI) on the application. Entra often rejects this for
  // unverified domains — that is a warning, not a rollback.
  if (payload.samlEntityId) {
    try {
      await withRetry(
        () =>
          client.api(`/applications/${appObjectId}`).patch({
            identifierUris: [payload.samlEntityId],
          }),
        { retryOn: [404], retries: 6 },
      );
      steps.push({ label: "Entity ID", status: "done", detail: payload.samlEntityId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`Could not set Entity ID "${payload.samlEntityId}": ${msg}`);
      steps.push({ label: "Entity ID", status: "failed", detail: msg });
    }
  } else {
    steps.push({ label: "Entity ID", status: "skipped", detail: "none provided" });
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
      steps.push({
        label: "Claims mapping",
        status: "done",
        detail: `${schema.length} attribute statement(s) mapped`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(
        `Claims mapping policy could not be created/assigned (requires Policy.ReadWrite.ApplicationConfiguration permission): ${msg}`,
      );
      steps.push({ label: "Claims mapping", status: "failed", detail: msg });
    }
  } else {
    steps.push({
      label: "Claims mapping",
      status: "skipped",
      detail: claimWarnings.length
        ? "no attributes could be mapped automatically"
        : "no attribute statements",
    });
  }

  // SAML token signing certificate (THE FIX) + activation.
  let signingCertificate = "";
  let certExpiry = "";
  try {
    const endDateTime = new Date();
    endDateTime.setFullYear(endDateTime.getFullYear() + 3);
    const endDateTimeIso = endDateTime.toISOString();

    const cert = await withRetry(
      () =>
        client.api(`/servicePrincipals/${spId}/addTokenSigningCertificate`).post({
          displayName: `CN=${payload.displayName}`,
          endDateTime: endDateTimeIso,
        }),
      { retryOn: [404], retries: 6 },
    );

    await withRetry(
      () =>
        client.api(`/servicePrincipals/${spId}`).patch({
          preferredTokenSigningKeyThumbprint: cert.thumbprint,
        }),
      { retryOn: [404], retries: 6 },
    );

    let publicKey: string | undefined = cert.key;
    if (!publicKey) {
      const sp = await withRetry(
        () => client.api(`/servicePrincipals/${spId}`).select("keyCredentials").get(),
        { retryOn: [404], retries: 6 },
      );
      const found = selectSigningCert((sp.keyCredentials ?? []) as KeyCredential[]);
      publicKey = found?.key;
    }
    if (publicKey) signingCertificate = keyToPem(publicKey);
    certExpiry = endDateTimeIso;
    steps.push({
      label: "Signing certificate",
      status: "done",
      detail: `expires ${endDateTimeIso.slice(0, 10)}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Could not generate/activate SAML signing certificate: ${msg}`);
    steps.push({ label: "Signing certificate", status: "failed", detail: msg });
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
  steps: MigrationStep[];
  samlConfigured?: boolean;
  samlSigningCertificate?: string;
  samlCertExpiry?: string;
  samlClaimsMapped?: number;
  samlWarnings?: string[];
}> {
  const client = makeGraphClient(config);
  const warnings: string[] = [];
  const steps: MigrationStep[] = [];
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
    steps.push({ label: "App registration", status: "done", detail: appId });
    steps.push({ label: "Service principal", status: "done", detail: spId });

    // Newly instantiated objects can lag in replication; tolerate 404s here.
    if (payload.signOnMode === "SAML_2_0") {
      await withRetry(
        () =>
          client.api(`/servicePrincipals/${spId}`).patch({
            preferredSingleSignOnMode: "saml",
          }),
        { retryOn: [404], retries: 6 },
      );
      steps.push({ label: "SAML sign-on mode", status: "done" });
    } else if (payload.replyUrls?.length) {
      await withRetry(
        () =>
          client.api(`/applications/${appObjectId}`).patch({
            web: {
              redirectUris: payload.replyUrls,
              implicitGrantSettings: { enableIdTokenIssuance: false },
            },
          }),
        { retryOn: [404], retries: 6 },
      );
      steps.push({
        label: "Redirect URIs",
        status: "done",
        detail: `${payload.replyUrls.length} URI(s)`,
      });
    }
  } catch (e) {
    const rollbackResult = await rollback(client, created);
    throw new MigrationCoreError(e, rollbackResult);
  }

  // ---- CONFIGURATION steps (SAML only): failures warn, never rollback. ----
  let samlResult: SamlConfigResult | undefined;
  if (payload.signOnMode === "SAML_2_0") {
    samlResult = await configureSaml(client, appObjectId, spId, payload, created, warnings, steps);
  }

  return {
    entraAppId: appId,
    entraObjectId: appObjectId,
    entraSPId: spId,
    displayName: payload.displayName,
    warnings,
    steps,
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

export async function getVerifiedDomains(config: EntraConfig): Promise<string[]> {
  const client = makeGraphClient(config);
  const res = await client.api("/domains").select("id,isVerified").get();
  return (res.value as { id: string; isVerified: boolean }[])
    .filter((d) => d.isVerified)
    .map((d) => d.id);
}

export async function resolveAssignments(
  groups: { name?: string }[],
  users: { userName?: string }[],
  entityId: string | undefined,
  config: EntraConfig,
): Promise<PreflightResult> {
  const client = makeGraphClient(config);

  const resolveOne = async (
    name: string,
    kind: "group" | "user",
  ): Promise<ResolvedAssignment> => {
    const path = kind === "group" ? "/groups" : "/users";
    const field = kind === "group" ? "displayName" : "userPrincipalName";
    const res = await withRetry(() =>
      client
        .api(path)
        .filter(`${field} eq '${oDataEscape(name)}'`)
        .select(`id,${field}`)
        .get(),
    );
    const m = classifyMatch(name, res.value ?? []);
    return {
      sourceName: name,
      status: m.status,
      entraId: m.entraId,
      principalType: kind,
      candidates: m.candidates?.map((c) => ({
        id: c.id,
        label: c.displayName ?? c.userPrincipalName ?? c.id,
      })),
    };
  };

  const groupResults = await mapWithConcurrency(
    groups.filter((g) => g.name),
    5,
    (g) => resolveOne(g.name!, "group"),
  );
  const userResults = await mapWithConcurrency(
    users.filter((u) => u.userName),
    5,
    (u) => resolveOne(u.userName!, "user"),
  );

  let entityIdValidation;
  if (entityId) {
    try {
      const domains = await getVerifiedDomains(config);
      entityIdValidation = validateIdentifierUri(entityId, domains);
    } catch {
      // Reading /domains needs Domain.Read.All / Directory.Read.All, which this
      // tool does not require. Skip Entity ID domain validation rather than
      // failing the whole preflight (group/user resolution still succeeds).
      entityIdValidation = undefined;
    }
  }
  return { groups: groupResults, users: userResults, entityIdValidation };
}
