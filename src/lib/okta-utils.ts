import { OktaApp } from "@/types/okta";
import { SamlAttributeStatement } from "@/types/entra";

export function getRedirectUris(app: OktaApp): string[] {
  const settings = app.settings as {
    app?: { redirectUris?: string[]; redirectURI?: string };
    oauthClient?: { redirect_uris?: string[] };
  } | undefined;
  const credentials = app.credentials as {
    oauthClient?: { redirectUris?: string[] };
  } | undefined;

  // Prefer any array-shaped source: standard OIDC apps expose
  // settings.oauthClient.redirect_uris (snake_case).
  const fromArray =
    settings?.oauthClient?.redirect_uris ??
    settings?.app?.redirectUris ??
    credentials?.oauthClient?.redirectUris;
  if (fromArray?.length) return fromArray;

  // Some Okta app templates (e.g. Okta Workflows) expose a single redirectURI.
  const single = settings?.app?.redirectURI;
  return single ? [single] : [];
}

interface SamlSettings {
  acsUrl: string;
  entityId: string;
  relayState: string;
  attributeStatements: SamlAttributeStatement[];
}

export function getSamlSettings(app: OktaApp): SamlSettings | null {
  if (app.signOnMode !== "SAML_2_0") return null;
  const signOn = (app.settings as { signOn?: Record<string, unknown> })?.signOn;
  if (!signOn) return null;

  return {
    acsUrl: (signOn.ssoAcsUrl as string) ?? "",
    entityId: (signOn.audience as string) ?? "",
    relayState: (signOn.defaultRelayState as string) ?? "",
    attributeStatements: (signOn.attributeStatements as SamlAttributeStatement[]) ?? [],
  };
}
