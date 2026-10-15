"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  adminApi, adminTokenExpiresAt, clearAdminToken, getAdminToken,
} from "@/lib/adminApi";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit" },
] as const;

/**
 * Chrome and access guard for every admin page except the login itself.
 *
 * The guard here is a convenience, NOT the security boundary. This is a static
 * export: the bundle ships to anyone who asks for it and there is no server
 * render to gate. What actually protects the data is that every /admin request
 * needs an admin token the API minted, and the API re-checks is_admin on each
 * one. This component only saves the operator from staring at a page of failed
 * requests.
 */
export default function AdminShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const bounce = useCallback(() => {
    clearAdminToken();
    router.replace("/admin");
  }, [router]);

  useEffect(() => {
    if (!getAdminToken()) {
      bounce();
      return;
    }
    // The token may be unexpired but no longer valid — the admin flag can be
    // revoked mid-session, and the API re-reads it on every request. Ask once
    // before rendering a dashboard that would otherwise fail piecemeal.
    adminApi
      .me()
      .then(() => setReady(true))
      .catch(bounce);
  }, [bounce]);

  // Admin tokens cannot be refreshed, so the session simply ends. Counting it
  // down beats having a form silently fail on submit an hour in.
  useEffect(() => {
    const tick = () => {
      const expiry = adminTokenExpiresAt();
      if (!expiry) return;
      const left = expiry - Date.now();
      if (left <= 0) {
        bounce();
        return;
      }
      setRemaining(left);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [bounce]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Checking admin session…</p>
      </main>
    );
  }

  const minutes = remaining === null ? null : Math.floor(remaining / 60_000);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ivory/[0.07] bg-panel/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            <Image src="/chessrabbit-mark.svg" alt="" width={24} height={24} aria-hidden="true" />
            <span>ChessRabbit <span className="text-accent">admin</span></span>
          </span>

          <nav className="seg">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`seg-item ${
                  pathname?.startsWith(item.href) ? "seg-item-on" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {minutes !== null && (
              <span
                className={`font-mono text-[11px] ${
                  minutes <= 5 ? "text-bad" : "text-muted"
                }`}
                title="Admin sessions expire and cannot be refreshed"
              >
                {minutes}m left
              </span>
            )}
            <button
              className="btn text-xs"
              onClick={() => adminApi.logout().finally(() => router.replace("/admin"))}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-xl">{title}</h1>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}
