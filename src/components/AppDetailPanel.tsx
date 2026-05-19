import { OktaAppDetail } from "@/types/okta";
import { getRedirectUris } from "@/lib/okta-utils";
import ReadinessChecklist from "@/components/ReadinessChecklist";

interface Props {
  detail: OktaAppDetail;
}

export default function AppDetailPanel({ detail }: Props) {
  const { app, groups, users } = detail;
  const replyUrls = getRedirectUris(app);

  return (
    <div className="space-y-6">
      <ReadinessChecklist detail={detail} />

      {/* Basic Info */}
      <section className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-700 mb-3">Application Info</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="App ID" value={app.id} mono />
          <Row label="Name" value={app.name} />
          <Row label="Label" value={app.label} />
          <Row label="Status" value={app.status} />
          <Row label="Sign-On Mode" value={app.signOnMode} />
          <Row label="Created" value={new Date(app.created).toLocaleString()} />
          <Row
            label="Last Updated"
            value={new Date(app.lastUpdated).toLocaleString()}
          />
          {app.features && app.features.length > 0 && (
            <Row label="Features" value={app.features.join(", ")} />
          )}
        </dl>
      </section>

      {/* Redirect / Reply URLs */}
      {replyUrls.length > 0 && (
        <section className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">
            Redirect / Reply URLs
          </h3>
          <ul className="space-y-1">
            {replyUrls.map((url: string) => (
              <li
                key={url}
                className="text-sm font-mono bg-gray-50 px-3 py-1 rounded border border-gray-200"
              >
                {url}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Settings (raw) */}
      {app.settings && (
        <section className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Settings</h3>
          <pre className="text-xs bg-gray-50 p-3 rounded border overflow-auto max-h-64">
            {JSON.stringify(app.settings, null, 2)}
          </pre>
        </section>
      )}

      {/* Credentials */}
      {app.credentials && (
        <section className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Credentials</h3>
          <pre className="text-xs bg-gray-50 p-3 rounded border overflow-auto max-h-64">
            {JSON.stringify(app.credentials, null, 2)}
          </pre>
        </section>
      )}

      {/* Assigned Groups */}
      <section className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-700 mb-3">
          Assigned Groups ({groups.length})
        </h3>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-400">No groups assigned</p>
        ) : (
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g.id} className="text-sm flex items-center gap-2">
                <span className="font-mono text-xs text-gray-400">{g.id}</span>
                <span>{g.profile?.name ?? "(no name)"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Assigned Users */}
      <section className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-700 mb-3">
          Assigned Users ({users.length})
        </h3>
        {users.length === 0 ? (
          <p className="text-sm text-gray-400">No users assigned</p>
        ) : (
          <ul className="space-y-1">
            {users.map((u) => (
              <li key={u.id} className="text-sm flex items-center gap-2">
                <span className="font-mono text-xs text-gray-400">{u.id}</span>
                <span>{u.credentials?.userName ?? "(no username)"}</span>
                {u.status && (
                  <span className="text-xs text-gray-400">({u.status})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{value}</dd>
    </>
  );
}
