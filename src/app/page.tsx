"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    // Signed-in users go straight to their role's workspace.
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const role = j?.data?.user?.role;
        if (!role) return;
        const dest = role === "POLICE" ? "/police" : role === "VOLUNTEER" ? "/volunteer" : role === "VICTIM" ? "/victim" : "/sim";
        window.location.href = dest;
      })
      .catch(() => {});
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <img src="/icon.svg" alt="SafeGuard SOS" className="mx-auto h-20 w-20" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">SafeGuard SOS</h1>
        <p className="mt-2 text-sm text-slate-400">
          Decentralized, opt-in emergency response. Observe safely — never engage.
        </p>
      </div>

      <div className="mt-8 space-y-3">
        <Link href="/login" className="btn-primary w-full py-3 text-lg">
          Sign in
        </Link>
        <Link href="/register" className="btn-ghost w-full py-3 text-lg">
          Create account
        </Link>
        <Link
          href="/sim"
          className="btn w-full border border-amber-700/60 bg-amber-950/40 py-3 text-amber-300 hover:bg-amber-900/40"
        >
          🧪 Open Test / Simulation Mode
        </Link>
      </div>

      <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
        <p className="font-semibold text-slate-300">Demo accounts (password: Demo@1234)</p>
        <p className="mt-1">victim@safeguard.test · helper@safeguard.test · medic@safeguard.test · police@safeguard.test</p>
      </div>
    </main>
  );
}
