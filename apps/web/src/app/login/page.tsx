"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { api, setTokens, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setTokens(await api.login(email, password));
      router.push("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm animate-rise space-y-4 p-7">
        <Wordmark href="/" className="mb-3" />
        <h1 className="font-display text-3xl leading-none">Sign in</h1>

        {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-sm text-muted">
          No account?{" "}
          <Link href="/register" className="text-brassLit hover:underline">
            Register
          </Link>
          {" · "}
          <Link href="/forgot" className="text-brassLit hover:underline">
            Forgot password?
          </Link>
        </p>
      </form>
    </main>
  );
}
