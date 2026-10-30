"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { API_URL } from "@/lib/api";

function VerifyInner() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "fail">("working");

  useEffect(() => {
    if (!token) {
      setState("fail");
      return;
    }
    fetch(`${API_URL}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.ok ? "ok" : "fail"))
      .catch(() => setState("fail"));
  }, [token]);

  if (state === "working")
    return <p className="text-sm text-muted">Verifying…</p>;

  if (state === "ok")
    return (
      <>
        <p className="text-sm">Your email is verified. You&apos;re all set.</p>
        <Link href="/app" className="btn-primary inline-block">
          Open the board
        </Link>
      </>
    );

  return (
    <p className="text-sm text-muted">
      This verification link is invalid or has expired. Sign in and use
      &ldquo;Resend verification&rdquo; to get a fresh one.
    </p>
  );
}

export default function VerifyPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm animate-rise space-y-4 p-7 text-center">
        <Wordmark href="/" className="mb-3" />
        <h1 className="font-display text-3xl leading-none">Email verification</h1>
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <VerifyInner />
        </Suspense>
      </div>
    </main>
  );
}
