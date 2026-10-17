"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { AdminApiError, AuditEntry, AuditPage, adminApi } from "@/lib/adminApi";

const ACTION_LABELS: Record<string, string> = {
  admin_login: "signed in",
  admin_login_failed: "failed to sign in",
  admin_logout: "signed out",
  suspend_user: "suspended",
  unsuspend_user: "unsuspended",
  override_plan: "changed the plan of",
};

/** Failed sign-ins and plan changes are what an operator scans this page for. */
function tone(action: string): string {
  if (action === "admin_login_failed") return "bg-bad/20 text-bad";
  if (action === "override_plan" || action === "suspend_user") return "bg-brass/20 text-brassLit";
  return "bg-ink/[0.07] text-muted";
}

function describe(entry: AuditEntry): string {
  const actor = entry.admin_email ?? "unknown";
  const verb = ACTION_LABELS[entry.action] ?? entry.action;
  const target = entry.target_email ?? (entry.detail.email as string | undefined);

  if (entry.action === "override_plan") {
    return `${actor} ${verb} ${target} — ${entry.detail.from} → ${entry.detail.to}`;
  }
  if (entry.action === "admin_login_failed") {
    return `${verb}: ${entry.detail.email ?? "unknown email"}`;
  }
  return target ? `${actor} ${verb} ${target}` : `${actor} ${verb}`;
}

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminApi
      .audit(page)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof AdminApiError && err.status === 401) return;
        setError(err instanceof AdminApiError ? err.message : "Could not load the audit log");
      })
      .finally(() => setLoading(false));
  }, [page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <AdminShell
      title="Audit log"
      actions={
        <span className="font-mono text-xs text-muted">
          {data ? `${data.total} entries` : ""}
        </span>
      }
    >
      <p className="mb-4 text-xs text-muted">
        Every admin action and every sign-in attempt against this surface,
        newest first.
      </p>

      {error && <p className="mb-3 text-sm text-bad">{error}</p>}

      <ul className="card divide-y divide-line/35">
        {data?.entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <span className={`chip ${tone(entry.action)}`}>
              {entry.action.replace(/_/g, " ")}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{describe(entry)}</span>
            {entry.detail.reason ? (
              <span className="w-full truncate text-xs text-muted/80">
                “{String(entry.detail.reason)}”
              </span>
            ) : null}
            <span className="font-mono text-[11px] text-muted">{entry.ip ?? "—"}</span>
            <span className="font-mono text-[11px] text-muted">
              {new Date(entry.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>

      {loading && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {!loading && data?.entries.length === 0 && (
        <p className="mt-4 text-center text-sm text-muted">Nothing recorded yet.</p>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button className="btn text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="font-mono text-xs text-muted">
            {page} / {pages}
          </span>
          <button className="btn text-xs" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </AdminShell>
  );
}
