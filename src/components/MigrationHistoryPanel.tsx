import { MigrationRow } from "@/types/entra";

interface Props {
  history: MigrationRow[];
}

const statusBadge: Record<MigrationRow["status"], string> = {
  success: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

export default function MigrationHistoryPanel({ history }: Props) {
  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-5xl mb-4">←</div>
          <p className="text-lg">Select an application to view details</p>
          <p className="text-sm mt-1 text-gray-300">No migrations recorded yet</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold text-gray-900">
          Migration History
          <span className="ml-2 text-sm font-normal text-gray-400">
            ({history.length} migration{history.length !== 1 ? "s" : ""})
          </span>
        </h2>
      </div>
      <div className="space-y-3">
        {history.map((entry) => (
          <div key={entry.id} className="bg-white rounded-xl border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900">{entry.oktaLabel}</p>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge[entry.status]}`}
                  >
                    {entry.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  From Okta: <span className="font-mono">{entry.oktaAppId}</span>
                </p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {new Date(entry.migratedAt).toLocaleString()}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-gray-500">Entra App ID</dt>
              <dd className="font-mono text-gray-700 truncate">{entry.entraAppId ?? "—"}</dd>
              <dt className="text-gray-500">Object ID</dt>
              <dd className="font-mono text-gray-700 truncate">{entry.entraObjectId ?? "—"}</dd>
              <dt className="text-gray-500">Assigned</dt>
              <dd className="text-gray-700">
                {entry.assignedGroups} group{entry.assignedGroups !== 1 ? "s" : ""},{" "}
                {entry.assignedUsers} user{entry.assignedUsers !== 1 ? "s" : ""}
              </dd>
            </dl>
            {entry.warnings.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-amber-600 cursor-pointer hover:text-amber-700">
                  {entry.warnings.length} warning(s)
                </summary>
                <ul className="mt-1 text-xs text-amber-700 space-y-0.5 pl-2">
                  {entry.warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              </details>
            )}
            {entry.errors.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-red-600 cursor-pointer hover:text-red-700">
                  {entry.errors.length} error(s)
                </summary>
                <ul className="mt-1 text-xs text-red-700 space-y-0.5 pl-2">
                  {entry.errors.map((e) => (
                    <li key={e}>• {e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
