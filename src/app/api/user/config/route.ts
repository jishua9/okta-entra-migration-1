import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { getUserConfig, setUserConfig } from "@/lib/user-config";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const config = getUserConfig(auth.userId);
  if (!config) return NextResponse.json({ configured: false });

  return NextResponse.json({
    configured: true,
    oktaOrgUrl: config.oktaOrgUrl,
    azureTenantId: config.azureTenantId,
  });
}

export async function PUT(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const { oktaOrgUrl, oktaApiToken, azureTenantId, azureClientId, azureClientSecret } = body;

  if (!oktaOrgUrl || !oktaApiToken || !azureTenantId || !azureClientId || !azureClientSecret) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  setUserConfig(auth.userId, { oktaOrgUrl, oktaApiToken, azureTenantId, azureClientId, azureClientSecret });
  return NextResponse.json({ ok: true });
}
