import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { EntraAppPayload, MigrationGroupRef, MigrationUserRef, SamlAttributeStatement } from "@/types/entra";

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function makeGraphClient(config: EntraConfig): Client {
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

function oDataEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// Maps common Okta EL user attribute expressions to Entra ID claim source/ID pairs.
const OKTA_EXPR_TO_ENTRA: Record<string, { Source: string; ID: string }> = {
  "user.email":         { Source: "user", ID: "mail" },
  "user.login":         { Source: "user", ID: "userprincipalname" },
  "user.firstName":     { Source: "user", ID: "givenname" },
  "user.lastName":      { Source: "user", ID: "surname" },
  "user.displayName":   { Source: "user", ID: "displayname" },
  "user.department":    { Source: "user", ID: "department" },
  "user.employeeNumber":{ Source: "user", ID: "employeeid" },
  "user.mobilePhone":   { Source: "user", ID: "telephonenumber" },
  "user.title":         { Source: "user", ID: "jobtitle" },
  "user.streetAddress": { Source: "user", ID: "streetaddress" },
  "user.city":          { Source: "user", ID: "city" },
  "user.state":         { Source: "user", ID: "state" },
  "user.countryCode":   { Source: "user", ID: "country" },
  "user.postalCode":    { Source: "user", ID: "postalcode" },
};

function keyToPem(base64Key: string): string {
  const lines = base64Key.match(/.{1,64}/g)?.join("\n") ?? base64Key;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

interface SamlConfigResult {
  signingCertificate: string;
  certExpiry: string;
  claimsMapped: number;
  claimsPolicyId?: string;
  warnings: string[];
}

async function configureSaml(
  client: Client,
  appObjectId: string,
  spId: string,
  payload: {
    acsUrl: string;
    entityId: string;
    relayState: string;
    attributeStatements: SamlAttributeStatement[];
    displayName: string;
  },
): Promise<SamlConfigResult> {
  const warnings: string[] = [];

  // Set SAML SSO mode and ACS URL on the service principal
  await client.api(`/servicePrincipals/${spId}`).patch({
    preferredSingleSignOnMode: "saml",
    samlSingleSignOnSettings: { relayState: payload.relayState || null },
    ...(payload.acsUrl ? { replyUrls: [payload.acsUrl] } : {}),
  });

  // Set entity ID (audience) on the app registration
  if (payload.entityId) {
    await client.api(`/applications/${appObjectId}`).patch({
      identifierUris: [payload.entityId],
    });
  }

  // Build claims schema from Okta attribute statements
  const claimsSchema = payload.attributeStatements.flatMap((stmt) => {
    const value = stmt.values?.[0];
    if (!value) return [];
    const entra = OKTA_EXPR_TO_ENTRA[value];
    if (!entra) {
      warnings.push(`Could not map attribute "${stmt.name}" (expression: ${value}) — configure manually`);
      return [];
    }
    return [{ ...entra, SamlClaimType: stmt.name }];
  });

  let claimsPolicyId: string | undefined;
  if (claimsSchema.length > 0) {
    try {
      const policyDef = JSON.stringify({
        ClaimsMappingPolicy: {
          Version: 1,
          IncludeBasicClaimSet: "true",
          ClaimsSchema: claimsSchema,
        },
      });
      const policy = await client.api("/policies/claimsMappingPolicies").post({
        definition: [policyDef],
        displayName: `${payload.displayName} — Claims Mapping`,
        isOrganizationDefault: false,
      });
      claimsPolicyId = policy.id;

      await client
        .api(`/servicePrincipals/${spId}/claimsMappingPolicies/$ref`)
        .post({
          "@odata.id": `https://graph.microsoft.com/v1.0/policies/claimsMappingPolicies/${claimsPolicyId}`,
        });
    } catch (e) {
      warnings.push(
        `Claims mapping policy could not be created (requires Policy.ReadWrite.ApplicationConfiguration permission): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Read back the auto-generated SAML signing certificate
  let signingCertificate = "";
  let certExpiry = "";
  try {
    const sp = await client
      .api(`/servicePrincipals/${spId}`)
      .select("keyCredentials")
      .get();
    const signingKey = (sp.keyCredentials as Array<{
      usage: string;
      type: string;
      key?: string;
      endDateTime?: string;
    }>)?.find((k) => k.usage === "Sign" && k.type === "AsymmetricX509Cert");

    if (signingKey?.key) {
      signingCertificate = keyToPem(signingKey.key);
      certExpiry = signingKey.endDateTime ?? "";
    }
  } catch {
    warnings.push("Could not read signing certificate — retrieve it manually from Entra ID");
  }

  return {
    signingCertificate,
    certExpiry,
    claimsMapped: claimsSchema.length,
    claimsPolicyId,
    warnings,
  };
}

export async function createEntraApplication(
  payload: EntraAppPayload,
  config: EntraConfig,
): Promise<{
  entraAppId: string;
  entraObjectId: string;
  entraSPId: string;
  displayName: string;
  samlConfigured?: boolean;
  samlSigningCertificate?: string;
  samlCertExpiry?: string;
  samlClaimsMapped?: number;
  samlWarnings?: string[];
}> {
  const client = makeGraphClient(config);

  const app = await client.api("/applications").post({
    displayName: payload.displayName,
    signInAudience: "AzureADMyOrg",
    web: payload.replyUrls?.length
      ? {
          redirectUris: payload.replyUrls,
          implicitGrantSettings: { enableIdTokenIssuance: false },
        }
      : undefined,
    requiredResourceAccess: [],
    tags: ["okta-migrated"],
    notes: payload.notes,
  });

  const sp = await client.api("/servicePrincipals").post({
    appId: app.appId,
    tags: ["HideApp", "okta-migrated"],
  });

  let samlResult: SamlConfigResult | undefined;
  if (payload.signOnMode === "SAML_2_0") {
    samlResult = await configureSaml(client, app.id, sp.id, {
      acsUrl: payload.samlAcsUrl ?? "",
      entityId: payload.samlEntityId ?? "",
      relayState: payload.samlRelayState ?? "",
      attributeStatements: payload.samlAttributeStatements ?? [],
      displayName: payload.displayName,
    });
  }

  return {
    entraAppId: app.appId,
    entraObjectId: app.id,
    entraSPId: sp.id,
    displayName: app.displayName,
    ...(samlResult && {
      samlConfigured: true,
      samlSigningCertificate: samlResult.signingCertificate,
      samlCertExpiry: samlResult.certExpiry,
      samlClaimsMapped: samlResult.claimsMapped,
      samlWarnings: samlResult.warnings,
    }),
  };
}

type AssignResult = { ok: true } | { ok: false; message: string } | null;

export async function assignAppMembers(
  servicePrincipalId: string,
  groups: MigrationGroupRef[],
  users: MigrationUserRef[],
  config: EntraConfig,
): Promise<{ assignedGroups: number; assignedUsers: number; errors: string[] }> {
  const client = makeGraphClient(config);
  const errors: string[] = [];
  let assignedGroups = 0;
  let assignedUsers = 0;

  const groupResults = await Promise.all(
    groups.map(async (group): Promise<AssignResult> => {
      if (!group.name) return null;
      try {
        const result = await client
          .api("/groups")
          .filter(`displayName eq '${oDataEscape(group.name)}'`)
          .select("id,displayName")
          .get();
        const entraGroup = result.value[0];
        if (!entraGroup) return { ok: false, message: `Group not found in Entra: ${group.name}` };
        await client.api(`/servicePrincipals/${servicePrincipalId}/appRoleAssignedTo`).post({
          principalId: entraGroup.id,
          resourceId: servicePrincipalId,
          appRoleId: "00000000-0000-0000-0000-000000000000",
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: `Failed to assign group "${group.name}": ${e instanceof Error ? e.message : String(e)}` };
      }
    }),
  );

  for (const r of groupResults) {
    if (!r) continue;
    if (r.ok) assignedGroups++;
    else errors.push(r.message);
  }

  const userResults = await Promise.all(
    users.map(async (user): Promise<AssignResult> => {
      if (!user.userName) return null;
      try {
        const result = await client
          .api("/users")
          .filter(`userPrincipalName eq '${oDataEscape(user.userName)}'`)
          .select("id,userPrincipalName")
          .get();
        const entraUser = result.value[0];
        if (!entraUser) return { ok: false, message: `User not found in Entra: ${user.userName}` };
        await client.api(`/servicePrincipals/${servicePrincipalId}/appRoleAssignedTo`).post({
          principalId: entraUser.id,
          resourceId: servicePrincipalId,
          appRoleId: "00000000-0000-0000-0000-000000000000",
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: `Failed to assign user "${user.userName}": ${e instanceof Error ? e.message : String(e)}` };
      }
    }),
  );

  for (const r of userResults) {
    if (!r) continue;
    if (r.ok) assignedUsers++;
    else errors.push(r.message);
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
