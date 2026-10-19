"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { API_URL } from "@/lib/api";

const AUTH_PAGES = new Set(["/login", "/register", "/forgot", "/reset", "/verify"]);

export default function DesktopAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const authPage = AUTH_PAGES.has(pathname.replace(/\/$/, ""));
  const [mode, setMode] = useState<"checking" | "local" | "community" | "error">("checking");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!authPage) return;
    const controller = new AbortController();
    setMode("checking");
    fetch(`${API_URL}/app-config`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Configuration unavailable");
        return response.json();
      })
      .then((config) => setMode(config.local_mode === true ? "local" : "community"))
      .catch(() => { if (!controller.signal.aborted) setMode("error"); });
    return () => controller.abort();
  }, [authPage, retry]);

  if (!authPage || mode === "community") return children;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4 p-6">
        <h1 className="font-display text-3xl">{mode === "local" ? "Your local workspace" : "Opening ChessRabbit"}</h1>
        <p className="text-sm text-muted">
          {mode === "local" ? "No ChessRabbit email account is needed on desktop. Open the board to import your public games."
            : mode === "error" ? "Could not reach the app service. Retry or restart ChessRabbit."
              : "Checking the app service…"}
        </p>
        <div className="flex gap-2">
          <Link href="/app" className="btn-primary">Open board</Link>
          <button className="btn" onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </div>
      </div>
    </main>
  );
}
