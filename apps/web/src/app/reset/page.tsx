"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { API_URL } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);

    const res = await fetch(`${API_URL}/auth/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: password }),
    });

    if (res.ok) {
      router.push("/login?reset=1");
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.detail?.message ?? "Reset failed");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="text-sm text-muted">
        This reset link is malformed.{" "}
        <Link href="/forgot" className="text-brassLit hover:underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <input
        className="input"
        type="password"
        placeholder="New password (min 8 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <input
        className="input"
        type="password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm animate-rise space-y-4 p-7">
        <Wordmark href="/" className="mb-3" />
        <h1 className="font-display text-3xl leading-none">Choose a new password</h1>
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
