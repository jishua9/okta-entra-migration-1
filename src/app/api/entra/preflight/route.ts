import { NextResponse } from "next/server";
import { resolveAssignments } from "@/lib/entra";
import { requireUserConfig } from "@/lib/api-helpers";
import { logEvent } from "@/lib/log";

export async function POST(req: Request) {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config, userId } = result;
  try {
    const body = await req.json();
    const out = await resolveAssignments(
      body.groups ?? [], body.users ?? [], body.entityId,
      { tenantId: config.azureTenantId, clientId: config.azureClientId, clientSecret: config.azureClientSecret },
    );
    return NextResponse.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logEvent("preflight.error", { userId, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
