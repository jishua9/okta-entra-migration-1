import { NextResponse } from "next/server";
import { getOktaApplicationDetail } from "@/lib/okta";
import { OktaAppDetail } from "@/types/okta";
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
    const detail: OktaAppDetail = await getOktaApplicationDetail(appId, {
      orgUrl: config.oktaOrgUrl,
      apiToken: config.oktaApiToken,
    });

    const filename = `okta-app-${appId}-export.json`;
    return new NextResponse(JSON.stringify(detail, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
