import fs from "fs";
import path from "path";
import crypto from "crypto";

let _secret: string | null = null;

export function getAppSecret(): string {
  if (_secret) return _secret;

  if (process.env.NEXTAUTH_SECRET) {
    _secret = process.env.NEXTAUTH_SECRET;
    return _secret;
  }

  const dataDir = path.join(process.cwd(), "data");
  const secretPath = path.join(dataDir, "secret.key");

  if (fs.existsSync(secretPath)) {
    _secret = fs.readFileSync(secretPath, "utf-8").trim();
    return _secret;
  }

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  _secret = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(secretPath, _secret, { mode: 0o600 });
  return _secret;
}
