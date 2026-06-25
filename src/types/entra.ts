export interface MigrationGroupRef {
  id: string;
  name?: string;
}

export interface MigrationUserRef {
  id: string;
  userName?: string;
}

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
  groups?: MigrationGroupRef[];
  users?: MigrationUserRef[];
  samlAcsUrl?: string;
  samlEntityId?: string;
  samlRelayState?: string;
  samlAttributeStatements?: SamlAttributeStatement[];
  confirmedPrincipals?: ConfirmedPrincipal[];
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

export interface MigrationHistoryEntry {
  id: string;
  oktaAppId: string;
  oktaLabel: string;
  entraAppId: string;
  entraObjectId: string;
  displayName: string;
  migratedAt: string;
  assignedGroups: number;
  assignedUsers: number;
  assignmentErrors: string[];
}

export interface MigrateConfirmPayload {
  displayName: string;
  replyUrls: string[];
  samlAcsUrl?: string;
  samlEntityId?: string;
}
