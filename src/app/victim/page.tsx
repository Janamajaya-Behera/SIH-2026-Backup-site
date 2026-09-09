"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useSSE } from "@/hooks/useSSE";
import ErrorState from "@/components/ErrorState";
import MapCanvas from "@/components/maps/MapCanvas";
import { EMERGENCY_TYPES, EMERGENCY_TYPE_LABELS, EmergencyType } from "@/lib/config";

interface IncidentView {
  id: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  countdownEndsAt: string | null;
  createdAt: string;
  activatedAt: string | null;
  displayedResponders: number;
  intel: Array<{ id: string; senderAnonId: string; category: string; message: string; createdAt: string }>;
}

type Phase = "loading" | "idle" | "countdown" | "active";

export default function VictimPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [incident, setIncident] = useState<IncidentView | null>(null);
  const [type, setType] = useState<EmergencyType>("GENERAL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [voiceEnrolled, setVoiceEnrolled] = useState(false);
  const [evidenceStatus, setEvidenceStatus] = useState<string>("NOT_STARTED");
  const [intelRefresh, setIntelRefresh] = useState(0);

  const active = phase === "active";
  const geo = useGeolocation(active);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resume an in-flight incident after reload / duplicate-SOS recovery (§25).
  useEffect(() => {
    api
      .get<{ incident: IncidentView | null }>("/api/victim/incident")
      .then((d) => {
        if (d.incident) {
          setIncident(d.incident);
          if (d.incident.status === "ACTIVE") setPhase("active");
          else if (d.incident.status === "COUNTDOWN") {
            setPhase("countdown");
            const remain = d.incident.countdownEndsAt ? Math.max(0, Math.ceil((new Date(d.incident.countdownEndsAt).getTime() - Date.now()) / 1000)) : 10;
            setCountdown(remain);
          } else setPhase("idle");
        } else setPhase("idle");
      })
      .catch(() => setPhase("idle"));
  }, []);

  // Countdown ticker (server countdownEndsAt is authoritative; this is UX).
  useEffect(() => {
    if (phase === "countdown" && incident?.countdownEndsAt) {
      const end = new Date(incident.countdownEndsAt).getTime();
      countdownTimer.current = setInterval(() => {
        const remain = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        setCountdown(remain);
        if (remain <= 0) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          void doActivate();
        }
      }, 250);
      return () => {
        if (countdownTimer.current) clearInterval(countdownTimer.current);
      };
    }
  }, [phase, incident?.countdownEndsAt]);

  // Live incident updates via SSE with polling fallback.
  const refresh = useCallback(() => {
    api.get<{ incident: IncidentView | null }>("/api/victim/incident").then((d) => {
      if (d.incident) {
        setIncident(d.incident);
        setPhase(d.incident.status === "ACTIVE" ? "active" : d.incident.status === "COUNTDOWN" ? "countdown" : "idle");
      } else {
        setIncident(null);
        setPhase("idle");
      }
    }).catch(() => {});
  }, []);

  useSSE(active && incident ? `/api/incidents/${incident.id}/stream` : null, () => refresh(), refresh);

  async function doActivate() {
    if (!incident) return;
    setBusy(true);
    try {
      await api.post(`/api/sos/activate`, { incidentId: incident.id });
      refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Activation failed.");
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  async function triggerSos() {
    setError(null);
    if (geo.lat === null || geo.lng === null) {
      setError("Location not ready yet. Waiting for GPS…");
      return;
    }
    setBusy(true);
    try {
      const d = await api.post<{ incident: { id: string; status: string; countdownEndsAt: string } }>("/api/sos/initiate", {
        type,
        lat: geo.lat,
        lng: geo.lng,
        accuracy: geo.accuracy ?? undefined,
      });
      setIncident({ ...d.incident, type, createdAt: new Date().toISOString(), activatedAt: null, displayedResponders: 1, intel: [], countdownEndsAt: d.incident.countdownEndsAt, status: d.incident.status, lat: geo.lat, lng: geo.lng } as IncidentView);
      setPhase("countdown");
      setCountdown(10);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "DUPLICATE_SOS") {
        // Recovery (§16): adopt the existing incident instead of erroring out.
        refresh();
        return;
      }
      setError(err instanceof ApiClientError ? err.message : "Could not start SOS. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSos() {
    if (!incident) return;
    setBusy(true);
    try {
      await api.post("/api/sos/cancel", { incidentId: incident.id });
      setPhase("idle");
      setIncident(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  }

  async function markSafe() {
    if (!incident) return;
    setBusy(true);
    try {
      await api.post(`/api/incidents/${incident.id}/resolve-victim`, {});
      setPhase("idle");
      setIncident(null);
    } catch {
      setError("Could not mark you safe. Police can resolve the incident.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEvidence() {
    if (!incident) return;
    try {
      const action = evidenceStatus === "SIMULATED" || evidenceStatus === "ACTIVE" ? "STOP" : "START";
      const d = await api.post<{ status: string }>(`/api/incidents/${incident.id}/evidence`, { action, type: "AUDIO" });
      setEvidenceStatus(d.status);
    } catch {
      setError("Evidence stream control failed.");
    }
  }

  async function enrollVoice(phrase: string) {
    const d = await api.post<{ enrolled: boolean }>("/api/voice/enroll", { phrase });
    if (d.enrolled) setVoiceEnrolled(true);
  }

  // ─────────────────── Render ───────────────────

  if (phase === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading SafeGuard…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="font-bold">SafeGuard SOS</span>
        </div>
        <Link href="/" className="text-sm text-slate-400 hover:underline" onClick={async (e) => { e.preventDefault(); await api.post("/api/auth/logout"); window.location.href = "/"; }}>
          Sign out
        </Link>
        <div className="flex items-center gap-1 text-xs">
          <span className={`h-2 w-2 rounded-full ${geo.status === "ok" ? "bg-emerald-500" : geo.status === "poor-accuracy" ? "bg-amber-500" : "bg-red-500"}`} />
          {geo.status === "ok" ? "GPS ready" : geo.status === "poor-accuracy" ? "Weak GPS" : geo.status === "acquiring" ? "Locating…" : "GPS issue"}
        </div>
      </header>

      {error && <div className="mt-4"><ErrorState title="Something went wrong" message={error} retry={() => setError(null)} /></div>}

      {phase === "idle" && (
        <section className="mt-6">
          <h2 className="text-center text-lg font-semibold text-slate-300">What kind of emergency?</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {EMERGENCY_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-xl border px-2 py-3 text-xs font-semibold transition-colors ${
                  type === t ? "border-red-500 bg-red-950/50 text-red-200" : "border-slate-700 bg-slate-900 text-slate-300"
                }`}
              >
                {EMERGENCY_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-center">
            <button
              onClick={triggerSos}
              disabled={busy || geo.status === "denied" || geo.status === "unavailable"}
              className={`flex h-56 w-56 flex-col items-center justify-center rounded-full text-white transition-transform active:scale-95 ${
                geo.status === "denied" || geo.status === "unavailable" ? "bg-slate-700" : "animate-pulse_sos bg-red-600 shadow-2xl shadow-red-900/50"
              }`}
            >
              <span className="text-4xl font-black tracking-widest">SOS</span>
              <span className="mt-1 text-xs opacity-90">{busy ? "Sending…" : "Press for help"}</span>
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              A 10-second countdown starts. You can cancel within it.
            </p>
          </div>

          {/* GPS error cards with retry (§16) */}
          {(geo.status === "denied" || geo.status === "unavailable" || geo.status === "poor-accuracy") && (
            <div className="mt-6">
              <ErrorState
                title={geo.status === "denied" ? "Location permission denied" : geo.status === "unavailable" ? "Location unavailable" : "Weak GPS signal"}
                message={geo.error ?? ""}
                retry={geo.requestOnce}
                retryLabel="Retry GPS"
              />
            </div>
          )}

          {/* Voice SOS setup (§15) */}
          <div className="mt-6">
            <button className="btn-ghost w-full" onClick={() => setVoiceSetupOpen((v) => !v)}>
              🎙️ Voice SOS {voiceEnrolled ? "(enrolled)" : "(not set up)"} {voiceSetupOpen ? "▲" : "▼"}
            </button>
            {voiceSetupOpen && (
              <VoiceSetup onEnroll={enrollVoice} enrolled={voiceEnrolled} />
            )}
          </div>
        </section>
      )}

      {phase === "countdown" && (
        <section className="mt-10 flex flex-col items-center">
          <div className="text-lg font-semibold text-red-300">Sending emergency alert in</div>
          <div className="relative mt-4 flex h-56 w-56 items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#334155" strokeWidth="6" />
              <circle
                cx="50" cy="50" r="45" fill="none" stroke="#d93025" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 45}
                strokeDashoffset={2 * Math.PI * 45 * (1 - countdown / 10)}
                style={{ transition: "stroke-dashoffset 0.25s linear" }}
              />
            </svg>
            <span className="text-6xl font-black">{countdown}</span>
          </div>
          <button onClick={cancelSos} disabled={busy} className="mt-6 w-56 rounded-2xl bg-slate-800 py-4 text-lg font-bold text-white hover:bg-slate-700">
            CANCEL
          </button>
          <p className="mt-3 text-center text-xs text-slate-500">
            {EMERGENCY_TYPE_LABELS[type as EmergencyType] ?? "General Emergency"} · Cancel logs a false alarm record.
          </p>
        </section>
      )}

      {phase === "active" && incident && (
        <section className="mt-6 space-y-4">
          <div className="rounded-xl border border-red-800 bg-red-950/50 p-4 text-center">
            <div className="text-xl font-bold text-red-200">SOS ACTIVE</div>
            <div className="mt-1 text-sm text-red-300/80">
              {EMERGENCY_TYPE_LABELS[incident.type as EmergencyType] ?? "Emergency"} · Police and nearby volunteers have been notified.
            </div>
            <div className="mt-2 text-sm text-slate-300">
              <span className="font-bold text-white">{incident.displayedResponders}</span> {incident.displayedResponders === 1 ? "person is" : "people are"} aware — do not rely on others acting.
            </div>
          </div>

          <MapCanvas
            center={{ lat: incident.lat, lng: incident.lng }}
            dangerM={50}
            bufferEndM={100}
            victim={{ lat: geo.lat ?? incident.lat, lng: geo.lng ?? incident.lng }}
            heightClass="h-64"
          />

          {/* Intel from volunteers (read-only, §12 victim visibility) */}
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300">Live updates from volunteers</h3>
            {incident.intel.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No updates yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {incident.intel.slice(-5).reverse().map((m) => (
                  <li key={m.id} className="rounded-lg bg-slate-900 p-2 text-sm">
                    <span className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleTimeString()} · volunteer {m.senderAnonId.slice(-4)}</span>
                    <p className="text-slate-200">{m.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Evidence stream control (Prototype / Simulated, §13) */}
          <div className="card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">Evidence stream</h3>
              <span className="badge bg-amber-900/60 text-amber-300">Prototype / Simulated</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Status: {evidenceStatus} — a simulated evidentiary audio stream tied to this incident.</p>
            <button onClick={toggleEvidence} className={evidenceStatus === "SIMULATED" || evidenceStatus === "ACTIVE" ? "btn-ghost mt-3 w-full" : "btn-primary mt-3 w-full"}>
              {evidenceStatus === "SIMULATED" || evidenceStatus === "ACTIVE" ? "Stop evidence stream" : "Start audio evidence (simulated)"}
            </button>
          </div>

          <button onClick={markSafe} disabled={busy} className="btn-safe w-full py-4 text-lg">
            I'm safe — end emergency
          </button>
        </section>
      )}
    </main>
  );
}

function VoiceSetup({ onEnroll, enrolled }: { onEnroll: (phrase: string) => Promise<void>; enrolled: boolean }) {
  const [phrase, setPhrase] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="card mt-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-300">Custom wake phrase</p>
        <span className="badge bg-amber-900/60 text-amber-300">Prototype / Simulated Speaker Verification</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        The phrase alone never triggers SOS — verification requires your enrolled device token. A random person saying the phrase is rejected.
      </p>
      {enrolled ? (
        <p className="mt-3 rounded-lg bg-emerald-950/50 p-3 text-sm text-emerald-300">Voice SOS enrolled on this device.</p>
      ) : (
        <>
          <input className="input mt-3" placeholder='e.g. "safeguard sentinel"' value={phrase} onChange={(e) => setPhrase(e.target.value)} />
          <button
            className="btn-primary mt-3 w-full"
            disabled={busy || phrase.trim().length < 4}
            onClick={async () => {
              setBusy(true);
              try {
                const d = await api.post<{ enrolled: boolean; enrollmentToken: string }>("/api/voice/enroll", { phrase });
                if (d.enrolled) {
                  setToken(d.enrollmentToken);
                  localStorage.setItem("sg_speaker_token", d.enrollmentToken);
                  await onEnroll(phrase);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Enroll wake phrase
          </button>
          {token && <p className="mt-2 break-all text-xs text-slate-500">Device token stored locally: {token.slice(0, 12)}…</p>}
        </>
      )}
    </div>
  );
}
