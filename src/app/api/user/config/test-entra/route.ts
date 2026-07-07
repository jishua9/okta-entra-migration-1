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
    const credential = new ClientSecretCredential(tenantId.trim(), clientId.trim(), clientSecret.trim());
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });
    const client = Client.initWithMiddleware({ authProvider });

    // Validate against the permission the migration actually needs
    // (Application.ReadWrite.All). Reading /organization would require
    // Organization.Read.All / Directory.Read.All, which this tool does not
    // request — so testing it would spuriously fail a correctly-configured app.
    await client.api("/applications").select("appId").top(1).get();

    // Best-effort friendly tenant name; not required, so ignore if not permissioned.
    let tenantName = tenantId.trim();
    try {
      const org = await client.api("/organization").select("displayName").get();
      tenantName = org.value?.[0]?.displayName ?? tenantName;
    } catch {
      /* organization read not granted — fine, the tool doesn't need it */
    }

    return NextResponse.json({ ok: true, tenantName });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connection failed";
    return NextResponse.json({ ok: false, error: message });
  }
}
