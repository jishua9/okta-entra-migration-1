import { NextResponse } from "next/server";
import { createEntraApplication, assignAppMembers } from "@/lib/entra";
import { EntraAppPayload } from "@/types/entra";
import { requireUserConfig } from "@/lib/api-helpers";

export async function POST(req: Request) {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config } = result;

  try {
    const body: EntraAppPayload = await req.json();

    if (!body.displayName) {
      return NextResponse.json({ error: "displayName is required" }, { status: 400 });
    }

    const entraConfig = {
      tenantId: config.azureTenantId,
      clientId: config.azureClientId,
      clientSecret: config.azureClientSecret,
    };

    const appResult = await createEntraApplication(body, entraConfig);

    let assignedGroups = 0;
    let assignedUsers = 0;
    let assignmentErrors: string[] = [];

    if (body.groups?.length || body.users?.length) {
      const assignment = await assignAppMembers(
        appResult.entraSPId,
        body.groups ?? [],
        body.users ?? [],
        entraConfig,
      );
      assignedGroups = assignment.assignedGroups;
      assignedUsers = assignment.assignedUsers;
      assignmentErrors = assignment.errors;
    }

    return NextResponse.json({
      success: true,
      entraAppId: appResult.entraAppId,
      entraObjectId: appResult.entraObjectId,
      displayName: appResult.displayName,
      assignedGroups,
      assignedUsers,
      assignmentErrors,
      samlConfigured: appResult.samlConfigured,
      samlSigningCertificate: appResult.samlSigningCertificate,
      samlCertExpiry: appResult.samlCertExpiry,
      samlClaimsMapped: appResult.samlClaimsMapped,
      samlWarnings: appResult.samlWarnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
