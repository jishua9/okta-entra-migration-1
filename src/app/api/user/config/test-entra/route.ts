import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tenantId, clientId, clientSecret } = await req.json();
  if (!tenantId || !clientId || !clientSecret) {
    return NextResponse.json({ error: "tenantId, clientId, and clientSecret are required" }, { status: 400 });
  }

  try {
    const credential = new ClientSecretCredential(tenantId.trim(), clientId.trim(), clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });
    const client = Client.initWithMiddleware({ authProvider });

    const org = await client.api("/organization").select("displayName,id").get();
    const displayName = org.value?.[0]?.displayName ?? tenantId;
    return NextResponse.json({ ok: true, tenantName: displayName });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connection failed";
    return NextResponse.json({ ok: false, error: message });
  }
}
