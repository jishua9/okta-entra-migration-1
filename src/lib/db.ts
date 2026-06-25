import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "app.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_config (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    okta_org_url TEXT NOT NULL,
    okta_api_token TEXT NOT NULL,
    azure_tenant_id TEXT NOT NULL,
    azure_client_id TEXT NOT NULL,
    azure_client_secret TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS migrations (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    okta_app_id     TEXT NOT NULL,
    okta_label      TEXT NOT NULL,
    sign_on_mode    TEXT,
    status          TEXT NOT NULL,
    entra_app_id    TEXT,
    entra_object_id TEXT,
    entra_sp_id     TEXT,
    assigned_groups INTEGER NOT NULL DEFAULT 0,
    assigned_users  INTEGER NOT NULL DEFAULT 0,
    warnings        TEXT,
    errors          TEXT,
    created_at      TEXT NOT NULL
  );
`);

export default db;
