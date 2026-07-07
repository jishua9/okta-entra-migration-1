import { MigrationRow } from "@/types/entra";

interface Props {
  history: MigrationRow[];
}

const statusBadge: Record<MigrationRow["status"], string> = {
  success: "bg-green-500/15 text-green-300",
  partial: "bg-amber-500/15 text-amber-300",
  failed: "bg-red-500/15 text-red-300",
};

export default function MigrationHistoryPanel({ history }: Props) {
  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-faint">
        <div className="text-center">
          <div className="text-5xl mb-4">←</div>
          <p className="text-lg">Select an application to view details</p>
          <p className="text-sm mt-1 text-faint">No migrations recorded yet</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold text-foreground">
          Migration History
          <span className="ml-2 text-sm font-normal text-faint">
            ({history.length} migration{history.length !== 1 ? "s" : ""})
          </span>
        </h2>
      </div>
      <div className="space-y-3">
        {history.map((entry) => (
          <div key={entry.id} className="bg-panel rounded-xl border border-line p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{entry.oktaLabel}</p>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge[entry.status]}`}
                  >
                    {entry.status}
                  </span>
                </div>
                <p className="text-xs text-faint mt-0.5">
                  From Okta: <span className="font-mono">{entry.oktaAppId}</span>
                </p>
              </div>
              <span className="text-xs text-faint shrink-0">
                {new Date(entry.migratedAt).toLocaleString()}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Entra App ID</dt>
              <dd className="font-mono text-foreground truncate">{entry.entraAppId ?? "—"}</dd>
              <dt className="text-muted">Object ID</dt>
              <dd className="font-mono text-foreground truncate">{entry.entraObjectId ?? "—"}</dd>
              <dt className="text-muted">Assigned</dt>
              <dd className="text-foreground">
                {entry.assignedGroups} group{entry.assignedGroups !== 1 ? "s" : ""},{" "}
                {entry.assignedUsers} user{entry.assignedUsers !== 1 ? "s" : ""}
              </dd>
            </dl>
            {entry.warnings.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-amber-400 cursor-pointer hover:text-amber-300">
                  {entry.warnings.length} warning(s)
                </summary>
                <ul className="mt-1 text-xs text-amber-300 space-y-0.5 pl-2">
                  {entry.warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              </details>
            )}
            {entry.errors.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-red-400 cursor-pointer hover:text-red-300">
                  {entry.errors.length} error(s)
                </summary>
                <ul className="mt-1 text-xs text-red-300 space-y-0.5 pl-2">
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
