export interface SamlAttributeStatement {
  name: string;
  namespace: string;
  values: string[];
}

export interface EntraAppPayload {
  displayName: string;
  replyUrls?: string[];
  notes?: string;
  signOnMode?: string;
  oktaAppId?: string;
  samlAcsUrl?: string;
  samlEntityId?: string;
  samlRelayState?: string;
  samlAttributeStatements?: SamlAttributeStatement[];
  confirmedPrincipals?: ConfirmedPrincipal[];
}

// A single migration action and how it ended up — drives the result summary UI.
export interface MigrationStep {
  label: string;
  status: "done" | "warning" | "skipped" | "failed";
  detail?: string;
}

export interface MigrationResult {
  success: boolean;
  entraAppId?: string;
  entraObjectId?: string;
  displayName?: string;
  assignedGroups?: number;
  assignedUsers?: number;
  assignmentErrors?: string[];
  error?: string;
  samlConfigured?: boolean;
  samlSigningCertificate?: string;
  samlCertExpiry?: string;
  samlClaimsMapped?: number;
  samlWarnings?: string[];
  steps?: MigrationStep[];
  status?: "success" | "failed" | "partial";
  rollbackPerformed?: boolean;
  rollbackErrors?: string[];
}

// Pre-flight resolution
export interface ResolvedAssignment {
  sourceName: string;
  status: "matched" | "ambiguous" | "not_found";
  entraId?: string;
  principalType: "group" | "user";
  candidates?: { id: string; label: string }[];
}

export interface PreflightResult {
  groups: ResolvedAssignment[];
  users: ResolvedAssignment[];
  entityIdValidation?: { accepted: boolean; reason?: string };
}

// What the migrate endpoint now receives: confirmed Entra principal IDs
export interface ConfirmedPrincipal { entraId: string; principalType: "group" | "user"; label: string }

// Client-safe mirror of the server's MigrationRow (src/lib/migrations.ts).
// Defined here so client code can import the type without pulling in
// better-sqlite3 via @/lib/migrations.
export interface MigrationRow {
  id: string;
  oktaAppId: string;
  oktaLabel: string;
  signOnMode?: string;
  status: "success" | "failed" | "partial";
  entraAppId?: string;
  entraObjectId?: string;
  entraSpId?: string;
  assignedGroups: number;
  assignedUsers: number;
  warnings: string[];
  errors: string[];
  migratedAt: string;
}

export interface MigrateConfirmPayload {
  displayName: string;
  replyUrls: string[];
  samlAcsUrl?: string;
  samlEntityId?: string;
  confirmedPrincipals: ConfirmedPrincipal[];
}
