"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client";

type Role = "VICTIM" | "VOLUNTEER" | "POLICE";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "VICTIM" as Role,
    consentLocation: false,
    consentVolunteer: false,
    verificationStatus: "UNVERIFIED" as "UNVERIFIED" | "ID_VERIFIED" | "MEDICAL_CERTIFIED",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isVol = form.role === "VOLUNTEER";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isVol && !form.consentVolunteer) {
      setError("Volunteers must opt in to emergency assistance.");
      return;
    }
    if (form.role !== "POLICE" && !form.consentLocation) {
      setError("Location sharing consent is required — SafeGuard only works with explicit opt-in.");
      return;
    }
    setBusy(true);
    try {
      const data = await api.post<{ user: { role: string } }>("/api/auth/register", {
        ...form,
        volunteerStatus: isVol && form.consentVolunteer ? "ACTIVE" : undefined,
      });
      router.push(roleHome(data.user.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Registration failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-1 text-sm text-slate-400">Join the opt-in SafeGuard network.</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-slate-300">Full name</label>
          <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-slate-300">Email</label>
            <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-300">Phone (optional)</label>
            <input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Password (min 6 chars)</label>
          <input className="input" type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-300">I am joining as</label>
          <div className="grid grid-cols-3 gap-2">
            {(["VICTIM", "VOLUNTEER", "POLICE"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setForm({ ...form, role: r })}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                  form.role === r ? "border-red-500 bg-red-950/50 text-red-300" : "border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {r === "VICTIM" ? "Victim" : r === "VOLUNTEER" ? "Volunteer" : "Police"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Police registration is only permitted on the host machine (Test Mode) — the server rejects it elsewhere.
          </p>
        </div>

        {isVol && (
          <div>
            <label className="mb-1 block text-sm text-slate-300">Verification (optional)</label>
            <select
              className="input"
              value={form.verificationStatus}
              onChange={(e) => setForm({ ...form, verificationStatus: e.target.value as typeof form.verificationStatus })}
            >
              <option value="UNVERIFIED">No verification</option>
              <option value="ID_VERIFIED">ID verified</option>
              <option value="MEDICAL_CERTIFIED">Medical certified (first aid / BLS)</option>
            </select>
          </div>
        )}

        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-sm">
          <p className="font-semibold text-slate-300">Explicit opt-in (required)</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={form.consentLocation} onChange={(e) => setForm({ ...form, consentLocation: e.target.checked })} />
            <span className="text-slate-300">
              Share my location <span className="text-slate-500">— only while an emergency involving me is active, or when I respond to one.</span>
            </span>
          </label>
          {isVol && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={form.consentVolunteer} onChange={(e) => setForm({ ...form, consentVolunteer: e.target.checked })} />
              <span className="text-slate-300">
                Receive nearby emergency alerts and participate as a volunteer <span className="text-slate-500">(you can pause anytime).</span>
              </span>
            </label>
          )}
        </div>

        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-400">
        Already registered?{" "}
        <Link href="/login" className="text-red-400 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

function roleHome(role: string) {
  return role === "POLICE" ? "/police" : role === "VOLUNTEER" ? "/volunteer" : role === "VICTIM" ? "/victim" : "/sim";
}
