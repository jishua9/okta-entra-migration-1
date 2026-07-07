import { OktaAppDetail } from "@/types/okta";
import { getRedirectUris } from "@/lib/okta-utils";

interface CheckItem {
  label: string;
  detail: string;
  status: "ok" | "warn";
}

function analyze(detail: OktaAppDetail): CheckItem[] {
  const { app, groups, users } = detail;
  const items: CheckItem[] = [];

  switch (app.signOnMode) {
    case "OIDC_CLIENT":
      items.push({ label: "Sign-on mode", detail: "OAuth/OIDC — redirect URIs migrated automatically", status: "ok" });
      break;
    case "SAML_2_0":
      items.push({ label: "Sign-on mode", detail: "SAML 2.0 — ACS URL, Entity ID, sign-on mode, and signing certificate configured automatically", status: "ok" });
      break;
    case "AUTO_LOGIN":
      items.push({ label: "Sign-on mode", detail: "SWA (form-fill) — no direct Entra equivalent; consider a linked app", status: "warn" });
      break;
    case "BOOKMARK":
      items.push({ label: "Sign-on mode", detail: "Bookmark — consider using My Apps in Entra instead", status: "warn" });
      break;
    default:
      items.push({ label: "Sign-on mode", detail: `${app.signOnMode} — manual review required`, status: "warn" });
  }

  const replyUrls = getRedirectUris(app);
  if (replyUrls.length > 0) {
    items.push({ label: "Redirect URIs", detail: `${replyUrls.length} URI(s) will be migrated`, status: "ok" });
  }

  const provisioningFeatures = ["PUSH_NEW_USERS", "PUSH_PROFILE_UPDATES", "PUSH_USER_DEACTIVATION", "REACTIVATE_USERS"];
  const hasProvisioning = app.features?.some((f) => provisioningFeatures.includes(f));
  items.push(
    hasProvisioning
      ? { label: "Provisioning (SCIM)", detail: "Enabled in Okta — must be reconfigured manually in Entra", status: "warn" }
      : { label: "Provisioning", detail: "Not configured", status: "ok" }
  );

  const attrStatements = (app.settings as { signOn?: { attributeStatements?: unknown[] } })?.signOn?.attributeStatements;
  if (Array.isArray(attrStatements) && attrStatements.length > 0) {
    items.push({
      label: "Custom claims",
      detail: `${attrStatements.length} attribute statement(s) — known user.* attributes mapped automatically; complex expressions require manual setup`,
      status: "ok",
    });
  } else {
    items.push({ label: "Custom claims", detail: "None configured", status: "ok" });
  }

  items.push({
    label: "Groups",
    detail: groups.length > 0 ? `${groups.length} group(s) will be assigned automatically` : "No groups assigned",
    status: "ok",
  });

  items.push({
    label: "Users",
    detail: users.length > 0 ? `${users.length} user(s) will be assigned automatically` : "No users assigned",
    status: "ok",
  });

  return items;
}

export default function ReadinessChecklist({ detail }: { detail: OktaAppDetail }) {
  const items = analyze(detail);
  const warnCount = items.filter((i) => i.status === "warn").length;

  return (
    <section className="bg-panel rounded-xl border border-line p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground">Migration Readiness</h3>
        {warnCount > 0 ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
            {warnCount} manual step{warnCount > 1 ? "s" : ""} required
          </span>
        ) : (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-300">
            Ready to migrate
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex gap-3 text-sm">
            <span
              className={`mt-0.5 shrink-0 font-bold ${
                item.status === "ok" ? "text-green-400" : "text-amber-400"
              }`}
            >
              {item.status === "ok" ? "✓" : "⚠"}
            </span>
            <div>
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="text-muted"> — {item.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
