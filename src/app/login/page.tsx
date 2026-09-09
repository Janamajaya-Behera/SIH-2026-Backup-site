"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.post<{ user: { role: string } }>("/api/auth/login", { email, password });
      const next = params.get("next");
      const dest = next && next.startsWith("/") ? next : roleHome(data.user.role);
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold">Sign in to SafeGuard</h1>
      <p className="mt-1 text-sm text-slate-400">Enter your credentials to continue.</p>

      {params.get("expired") && (
        <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-sm text-amber-300">
          Your session expired — please sign in again.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-slate-300">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Password</label>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-400">
        No account?{" "}
        <Link href="/register" className="text-red-400 hover:underline">
          Create one
        </Link>
      </p>
      <p className="mt-1 text-sm text-slate-400">
        <Link href="/" className="hover:underline">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}

function roleHome(role: string) {
  return role === "POLICE" ? "/police" : role === "VOLUNTEER" ? "/volunteer" : role === "VICTIM" ? "/victim" : "/sim";
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
