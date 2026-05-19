import { NextResponse } from "next/server";
import { getOktaApplicationDetail } from "@/lib/okta";
import { requireUserConfig } from "@/lib/api-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config } = result;

  try {
    const { appId } = await params;
    const detail = await getOktaApplicationDetail(appId, {
      orgUrl: config.oktaOrgUrl,
      apiToken: config.oktaApiToken,
    });
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
