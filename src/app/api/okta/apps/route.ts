import { NextResponse } from "next/server";
import { listOktaApplications } from "@/lib/okta";
import { requireUserConfig } from "@/lib/api-helpers";

export async function GET() {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config } = result;

  try {
    const apps = await listOktaApplications({ orgUrl: config.oktaOrgUrl, apiToken: config.oktaApiToken });
    return NextResponse.json({ apps });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
