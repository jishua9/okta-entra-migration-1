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
}

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
