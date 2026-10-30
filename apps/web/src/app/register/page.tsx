"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { api, setTokens, ApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setTokens(await api.register(email, password, name));
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
        <h1 className="font-display text-3xl leading-none">Create account</h1>

        {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        <input
          className="input"
          placeholder="Display name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
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
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>

        {/* Shown before the button is pressed, not linked from a page you
            reach afterwards: agreement has to be available at the moment it
            is given. Not a tick-box — an unticked box blocking signup is a
            worse experience and no more informative. */}
        <p className="text-xs leading-relaxed text-muted">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="text-brassLit hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-brassLit hover:underline">
            Privacy Policy
          </Link>
          .
        </p>

        <p className="text-sm text-muted">
          Have an account?{" "}
          <Link href="/login" className="text-brassLit hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
