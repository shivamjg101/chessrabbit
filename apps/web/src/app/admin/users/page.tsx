"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, AdminUser, UserPage } from "@/lib/adminApi";
import AdminShell from "@/components/admin/AdminShell";

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<UserPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => {
    adminApi.users({ page, q: query }).then(setData).catch((err) => setError(err.message));
  }, [page, query]);
  useEffect(load, [load]);
  async function toggle(user: AdminUser) {
    setBusy(user.id); setError(null);
    try { await (user.suspended ? adminApi.unsuspend(user.id) : adminApi.suspend(user.id)); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not update account"); }
    finally { setBusy(null); }
  }
  return <AdminShell title="Accounts"><div className="space-y-4">
    <h1 className="font-display text-2xl">Accounts</h1>
    <input className="input max-w-sm" aria-label="Search accounts" placeholder="Search email or name"
      value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
    {error && <p className="text-bad">{error}</p>}
    <div className="overflow-auto"><table className="w-full text-left text-sm">
      <thead><tr><th className="p-2">Account</th><th>Games</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{data?.users.map((user) => <tr key={user.id} className="border-t border-line/35">
        <td className="p-2">{user.display_name}<p className="text-xs text-muted">{user.email}</p></td>
        <td>{user.games}</td><td>{user.suspended ? "Suspended" : "Active"}{user.is_admin ? " · Admin" : ""}</td>
        <td><button className="btn text-xs" disabled={busy !== null || user.is_admin} onClick={() => toggle(user)}>{user.suspended ? "Restore" : "Suspend"}</button></td>
      </tr>)}</tbody>
    </table></div>
    <div className="flex items-center gap-3 text-xs">
      <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} · {data?.total ?? 0} accounts</span>
      <button className="btn" disabled={!data || page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  </div></AdminShell>;
}
