import { NextResponse } from "next/server";
import { createEntraApplication, assignAppMembers, MigrationCoreError } from "@/lib/entra";
import { recordMigration } from "@/lib/migrations";
import { logEvent } from "@/lib/log";
import { EntraAppPayload } from "@/types/entra";
import { requireUserConfig } from "@/lib/api-helpers";

export async function POST(req: Request) {
  const result = await requireUserConfig();
  if (result instanceof NextResponse) return result;
  const { config, userId } = result;

  const body: EntraAppPayload = await req.json();

  if (!body.displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const entraConfig = {
    tenantId: config.azureTenantId,
    clientId: config.azureClientId,
    clientSecret: config.azureClientSecret,
  };

  logEvent("migrate.start", { userId, oktaAppId: body.oktaAppId });

  let appResult: Awaited<ReturnType<typeof createEntraApplication>>;
  try {
    appResult = await createEntraApplication(body, entraConfig);
  } catch (error) {
    if (error instanceof MigrationCoreError) {
      recordMigration({
        userId, oktaAppId: body.oktaAppId ?? "", oktaLabel: body.displayName,
        signOnMode: body.signOnMode, status: "failed",
        assignedGroups: 0, assignedUsers: 0,
        warnings: [], errors: [error.message, ...error.rollback.errors],
      });
      logEvent("migrate.failed", { userId, oktaAppId: body.oktaAppId, rollbackPerformed: error.rollback.performed });
      return NextResponse.json({
        success: false, status: "failed", error: error.message,
        rollbackPerformed: error.rollback.performed, rollbackErrors: error.rollback.errors,
      }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    recordMigration({
      userId, oktaAppId: body.oktaAppId ?? "", oktaLabel: body.displayName,
      signOnMode: body.signOnMode, status: "failed",
      assignedGroups: 0, assignedUsers: 0,
      warnings: [], errors: [message],
    });
    logEvent("migrate.error", { userId, oktaAppId: body.oktaAppId, message });
    return NextResponse.json({ success: false, status: "failed", error: message }, { status: 500 });
  }

  // Creation succeeded. Assignment failures from here are non-fatal: they
  // degrade the migration to "partial" but do not roll back the app.
  const confirmedPrincipals = body.confirmedPrincipals ?? [];
  let assignedGroups = 0, assignedUsers = 0, assignmentErrors: string[] = [];
  if (confirmedPrincipals.length) {
    const a = await assignAppMembers(appResult.entraSPId, confirmedPrincipals, entraConfig);
    assignedGroups = a.assignedGroups; assignedUsers = a.assignedUsers; assignmentErrors = a.errors;
  }

  const warnings = appResult.warnings ?? [];
  const status = (warnings.length || assignmentErrors.length) ? "partial" : "success";

  recordMigration({
    userId, oktaAppId: body.oktaAppId ?? "", oktaLabel: body.displayName,
    signOnMode: body.signOnMode, status,
    entraAppId: appResult.entraAppId, entraObjectId: appResult.entraObjectId, entraSpId: appResult.entraSPId,
    assignedGroups, assignedUsers, warnings, errors: assignmentErrors,
  });

  logEvent("migrate.done", { userId, oktaAppId: body.oktaAppId, status });

  return NextResponse.json({
    success: true, status,
    entraAppId: appResult.entraAppId,
    entraObjectId: appResult.entraObjectId,
    displayName: appResult.displayName,
    assignedGroups, assignedUsers, assignmentErrors,
    samlConfigured: appResult.samlConfigured,
    samlSigningCertificate: appResult.samlSigningCertificate,
    samlCertExpiry: appResult.samlCertExpiry,
    samlClaimsMapped: appResult.samlClaimsMapped,
    samlWarnings: appResult.samlWarnings,
  });
}
