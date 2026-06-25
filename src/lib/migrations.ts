import crypto from "crypto";
import db from "@/lib/db";

export interface MigrationRecordInput {
  userId: string;
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
}

export interface MigrationRow extends Omit<MigrationRecordInput, "userId"> {
  id: string;
  migratedAt: string;
}

export function recordMigration(input: MigrationRecordInput): string {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO migrations
      (id, user_id, okta_app_id, okta_label, sign_on_mode, status,
       entra_app_id, entra_object_id, entra_sp_id, assigned_groups, assigned_users,
       warnings, errors, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.userId, input.oktaAppId, input.oktaLabel, input.signOnMode ?? null,
    input.status, input.entraAppId ?? null, input.entraObjectId ?? null,
    input.entraSpId ?? null, input.assignedGroups, input.assignedUsers,
    JSON.stringify(input.warnings), JSON.stringify(input.errors),
    new Date().toISOString(),
  );
  return id;
}

type DbRow = {
  id: string; okta_app_id: string; okta_label: string; sign_on_mode: string | null;
  status: MigrationRow["status"]; entra_app_id: string | null; entra_object_id: string | null;
  entra_sp_id: string | null; assigned_groups: number; assigned_users: number;
  warnings: string | null; errors: string | null; created_at: string;
};

export function listMigrations(userId: string): MigrationRow[] {
  const rows = db.prepare(
    "SELECT * FROM migrations WHERE user_id = ? ORDER BY created_at DESC",
  ).all(userId) as DbRow[];
  return rows.map((r) => ({
    id: r.id, oktaAppId: r.okta_app_id, oktaLabel: r.okta_label,
    signOnMode: r.sign_on_mode ?? undefined, status: r.status,
    entraAppId: r.entra_app_id ?? undefined, entraObjectId: r.entra_object_id ?? undefined,
    entraSpId: r.entra_sp_id ?? undefined, assignedGroups: r.assigned_groups,
    assignedUsers: r.assigned_users, warnings: JSON.parse(r.warnings ?? "[]"),
    errors: JSON.parse(r.errors ?? "[]"), migratedAt: r.created_at,
  }));
}
