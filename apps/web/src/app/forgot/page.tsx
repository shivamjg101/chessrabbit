"use client";

import { useState } from "react";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { API_URL } from "@/lib/api";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Always shows the same message - the API deliberately never reveals
    // whether an email is registered.
    await fetch(`${API_URL}/auth/forgot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setSent(true);
    setBusy(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm animate-rise space-y-4 p-7">
        <Wordmark href="/" className="mb-3" />
        <h1 className="font-display text-3xl leading-none">Reset password</h1>

        {sent ? (
          <p className="text-sm text-muted">
            If an account exists for <span className="text-ink">{email}</span>,
            a reset link is on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted">
              Enter your email and we&apos;ll send a link to set a new password.
            </p>
            <input
              className="input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="text-sm text-muted">
          <Link href="/login" className="text-brassLit hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
