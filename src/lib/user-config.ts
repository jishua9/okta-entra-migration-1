import db from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

export interface UserConfig {
  oktaOrgUrl: string;
  oktaApiToken: string;
  azureTenantId: string;
  azureClientId: string;
  azureClientSecret: string;
}

type ConfigRow = {
  okta_org_url: string;
  okta_api_token: string;
  azure_tenant_id: string;
  azure_client_id: string;
  azure_client_secret: string;
};

export function getUserConfig(userId: string): UserConfig | null {
  const row = db
    .prepare("SELECT * FROM user_config WHERE user_id = ?")
    .get(userId) as ConfigRow | undefined;

  if (!row) return null;

  return {
    oktaOrgUrl: row.okta_org_url,
    oktaApiToken: decrypt(row.okta_api_token),
    azureTenantId: row.azure_tenant_id,
    azureClientId: decrypt(row.azure_client_id),
    azureClientSecret: decrypt(row.azure_client_secret),
  };
}

export function setUserConfig(userId: string, config: UserConfig): void {
  db.prepare(`
    INSERT INTO user_config
      (user_id, okta_org_url, okta_api_token, azure_tenant_id, azure_client_id, azure_client_secret, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      okta_org_url     = excluded.okta_org_url,
      okta_api_token   = excluded.okta_api_token,
      azure_tenant_id  = excluded.azure_tenant_id,
      azure_client_id  = excluded.azure_client_id,
      azure_client_secret = excluded.azure_client_secret,
      updated_at       = excluded.updated_at
  `).run(
    userId,
    config.oktaOrgUrl,
    encrypt(config.oktaApiToken),
    config.azureTenantId,
    encrypt(config.azureClientId),
    encrypt(config.azureClientSecret),
    new Date().toISOString(),
  );
}
