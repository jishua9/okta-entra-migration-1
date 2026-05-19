import { OktaApp } from "@/types/okta";
import { SamlAttributeStatement } from "@/types/entra";

export function getRedirectUris(app: OktaApp): string[] {
  return (
    (app.settings as { app?: { redirectUris?: string[] } })?.app?.redirectUris ??
    (app.credentials as { oauthClient?: { redirectUris?: string[] } })?.oauthClient
      ?.redirectUris ??
    []
  );
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
