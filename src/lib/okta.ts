import { OktaApp, OktaAppDetail, OktaAppGroup, OktaAppUser } from "@/types/okta";

export interface OktaConfig {
  orgUrl: string;
  apiToken: string;
}

function oktaHeaders(apiToken: string) {
  return {
    Authorization: `SSWS ${apiToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function fetchAllPages<T>(startUrl: string, apiToken: string): Promise<T[]> {
  const items: T[] = [];
  let url: string = startUrl;

  while (url) {
    const res = await fetch(url, { headers: oktaHeaders(apiToken) });
    if (!res.ok) {
      throw new Error(`Okta API error ${res.status}: ${await res.text()}`);
    }
    const data: T[] = await res.json();
    items.push(...data);

    const linkHeader = res.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }

  return items;
}

export async function listOktaApplications(config: OktaConfig): Promise<OktaApp[]> {
  return fetchAllPages<OktaApp>(
    `${config.orgUrl}/api/v1/apps?limit=200`,
    config.apiToken,
  );
}

export async function getOktaApplicationDetail(
  appId: string,
  config: OktaConfig,
): Promise<OktaAppDetail> {
  const appRes = await fetch(`${config.orgUrl}/api/v1/apps/${appId}`, {
    headers: oktaHeaders(config.apiToken),
  });

  if (!appRes.ok) {
    throw new Error(`Okta API error ${appRes.status}: ${await appRes.text()}`);
  }

  const app = await appRes.json();

  const [groups, users] = await Promise.all([
    fetchAllPages<OktaAppGroup>(
      `${config.orgUrl}/api/v1/apps/${appId}/groups?limit=200`,
      config.apiToken,
    ),
    fetchAllPages<OktaAppUser>(
      `${config.orgUrl}/api/v1/apps/${appId}/users?limit=200`,
      config.apiToken,
    ),
  ]);

  return { app, groups, users };
}
