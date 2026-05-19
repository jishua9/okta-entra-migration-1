import { NextResponse } from "next/server";
import { listEntraApplications } from "@/lib/entra";
import { requireUserConfig } from "@/lib/api-helpers";

export async function GET() {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config } = result;

  try {
    const apps = await listEntraApplications({
      tenantId: config.azureTenantId,
      clientId: config.azureClientId,
      clientSecret: config.azureClientSecret,
    });
    return NextResponse.json({ apps });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
