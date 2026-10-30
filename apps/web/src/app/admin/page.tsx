"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AdminApiError, adminApi, getAdminToken, setAdminToken,
} from "@/lib/adminApi";

/**
 * The admin door. Deliberately its own page and its own credential.
 *
 * Nothing in the player-facing app links here, and signing in through /login
 * does not grant access to anything below /admin — the API issues a different
 * token type for this form and refuses player tokens on every admin route.
 *
 * The page says as little as possible: no product chrome, no branding beyond
 * the name, and an error message that never distinguishes "not an admin" from
 * "wrong password" (the server does not tell us which, on purpose).
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getAdminToken()) router.replace("/admin/dashboard");
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAdminToken(await adminApi.login(email, password));
      router.replace("/admin/dashboard");
    } catch (err) {
      setError(
        err instanceof AdminApiError
          ? err.status === 429
            ? err.message
            : "Incorrect email or password"
          : "Could not reach the server"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="font-display text-xl">Admin sign in</h1>
          <p className="mt-1 text-xs text-muted">
            Operator access only. This is a separate login from your player
            account.
          </p>
        </div>

        {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        <input
          className="input"
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-[11px] leading-relaxed text-muted/70">
          Sessions last one hour and cannot be extended. Every sign-in attempt
          is recorded.
        </p>
      </form>
    </main>
  );
}
