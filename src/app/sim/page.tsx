"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client";
import ErrorState from "@/components/ErrorState";

const SIM_HEADERS = { "x-safeguard-sim": "1" };

interface Device {
  id: string;
  name: string;
  role: string;
  email: string;
  anonId: string;
  consentLocation: boolean;
  consentVolunteer: boolean;
  volunteerStatus: string | null;
  verificationStatus: string;
  lat: number | null;
  lng: number | null;
  lastSeen: string | null;
}

interface ScenarioResult {
  n: number;
  title: string;
  expected: string;
  pass: boolean;
  steps: Array<{ step: string; result: string; pass: boolean }>;
}

interface SimIncident {
  incidentId: string;
  type: string;
  status: string;
  trueResponderCount: number;
  displayedResponderCount: number;
  alertCount: number;
  flaggedCount: number;
  clusterId: string | null;
  createdAt: string;
}

const SCENARIOS = [
  { n: 1, label: "S1 · Attacker gets no alert" },
  { n: 2, label: "S2 · Helper alerted (≥100m)" },
  { n: 3, label: "S3 · Urgency Offset (2→1)" },
  { n: 4, label: "S4 · Victim moves → donut" },
  { n: 5, label: "S5 · Enter danger → flagged" },
  { n: 6, label: "S6 · Cluster, no spam" },
  { n: 7, label: "S7 · Cancel countdown" },
  { n: 8, label: "S8 · Invalid GPS error" },
  { n: 9, label: "S9 · Voice verification" },
  { n: 10, label: "S10 · Audit chain valid" },
];

export default function SimPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [results, setResults] = useState<Record<number, ScenarioResult>>({});
  const [incidents, setIncidents] = useState<SimIncident[]>([]);
  const [busyN, setBusyN] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openScenario, setOpenScenario] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ devices: Device[] }>("/api/sim/devices", SIM_HEADERS);
      setDevices(d.devices);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load sim devices.");
    }
  }, []);

  const loadIncidents = useCallback(async () => {
    try {
      const d = await api.get<{ incidents: SimIncident[] }>("/api/police/incidents");
      setIncidents(d.incidents.filter((i) => i.status !== "CLOSED"));
    } catch {
      /* police-only panel; ignore when not staffed */
    }
  }, []);

  useEffect(() => {
    load();
    loadIncidents();
  }, [load, loadIncidents]);

  async function moveDevice(d: Device, northM: number, eastM: number) {
    if (d.lat === null || d.lng === null) return;
    const lat = d.lat + northM / 111_320;
    const lng = d.lng + eastM / (111_320 * Math.cos((d.lat * Math.PI) / 180));
    try {
      await api.post("/api/sim/inject", { deviceId: d.id, lat, lng }, SIM_HEADERS);
      await load();
      await loadIncidents();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Inject failed.");
    }
  }

  async function run(n: number) {
    setBusyN(n);
    setError(null);
    try {
      const r = await api.post<ScenarioResult>("/api/sim/scenarios", { n }, SIM_HEADERS);
      setResults((prev) => ({ ...prev, [n]: r }));
      setOpenScenario(n);
      await load();
      await loadIncidents();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : `Scenario ${n} failed to run.`);
    } finally {
      setBusyN(null);
    }
  }

  async function reset() {
    setBusyN(-1);
    try {
      await api.post("/api/sim/reset", {}, SIM_HEADERS);
      setResults({});
      setOpenScenario(null);
      await load();
      await loadIncidents();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reset failed.");
    } finally {
      setBusyN(null);
    }
  }

  return (
    <main className="sim-watermark mx-auto min-h-screen max-w-6xl px-4 py-6">
      {/* TEST MODE banner (§17/§21): impossible to confuse with a real emergency */}
      <div className="rounded-xl border-2 border-amber-600 bg-amber-950/70 p-3 text-center">
        <div className="text-lg font-black tracking-wide text-amber-300">🧪 TEST MODE — SIMULATED DEVICES</div>
        <div className="text-xs text-amber-200/80">
          These are simulated users and coordinates exercising the real SafeGuard engine. No real emergencies here.
        </div>
      </div>

      {error && <div className="mt-4"><ErrorState title="Simulation error" message={error} retry={() => setError(null)} /></div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          {/* Device table with coordinates + zone actions (§17 test dashboard) */}
          <div className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Simulated devices</h2>
              <button className="btn-ghost text-xs" onClick={reset} disabled={busyN === -1}>
                {busyN === -1 ? "Resetting…" : "Reset simulation"}
              </button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1">Device</th><th>Role</th><th>Lat, Lng</th><th>Consent</th><th>Move</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="border-t border-slate-800">
                      <td className="py-1.5 font-semibold">{d.name}</td>
                      <td>{d.role === "TEST_ATTACKER" ? <span className="text-purple-400">attacker</span> : d.role.toLowerCase()}</td>
                      <td className="font-mono">{d.lat !== null ? `${d.lat.toFixed(5)}, ${d.lng!.toFixed(5)}` : "—"}</td>
                      <td>{d.consentVolunteer ? "volunteer ✓" : d.consentLocation ? "location ✓" : "—"}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800" title="Move 100m toward victim area (north)" onClick={() => moveDevice(d, -100, 0)}>↑100m</button>
                          <button className="rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800" title="Move 30m north (toward danger)" onClick={() => moveDevice(d, 30, 0)}>+30m N</button>
                          <button className="rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800" title="Move 60m east" onClick={() => moveDevice(d, 0, 60)}>+60m E</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scenario runner (§17 scenarios 1–10) */}
          <div className="card">
            <h2 className="font-bold">Scenarios 1–10</h2>
            <p className="mt-1 text-xs text-slate-500">Each runs server-side against the real engine and reports per-step PASS/FAIL.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {SCENARIOS.map((s) => {
                const r = results[s.n];
                return (
                  <button
                    key={s.n}
                    onClick={() => run(s.n)}
                    disabled={busyN !== null}
                    className={`rounded-lg border p-2 text-left text-xs font-semibold transition-colors ${
                      r ? (r.pass ? "border-emerald-700 bg-emerald-950/40 text-emerald-300" : "border-red-700 bg-red-950/40 text-red-300") : "border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {busyN === s.n ? "running…" : s.label}
                    {r && <span className="ml-1">{r.pass ? "✅" : "❌"}</span>}
                  </button>
                );
              })}
            </div>

            {openScenario !== null && results[openScenario] && (
              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-200">{results[openScenario].title}</h3>
                  <span className={`badge ${results[openScenario].pass ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/70 text-red-300"}`}>
                    {results[openScenario].pass ? "PASS" : "FAIL"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">Expected: {results[openScenario].expected}</p>
                <ol className="mt-2 space-y-1 text-xs">
                  {results[openScenario].steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span>{s.pass ? "✅" : "❌"}</span>
                      <span><b className="text-slate-300">{s.step}:</b> <span className="text-slate-400">{s.result}</span></span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          {/* Live incidents visible to police role (§17 test dashboard) */}
          <div className="card">
            <h2 className="text-sm font-bold">Active sim incidents</h2>
            {incidents.length === 0 && <p className="mt-2 text-xs text-slate-500">Run a scenario to create incidents.</p>}
            <div className="mt-2 space-y-2">
              {incidents.slice(0, 8).map((i) => (
                <div key={i.incidentId} className="rounded-lg bg-slate-900 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{i.type}</span>
                    <span className={`badge ${i.status === "ACTIVE" ? "bg-red-900/70 text-red-300" : "bg-slate-800 text-slate-400"}`}>{i.status}</span>
                  </div>
                  <p className="mt-1 text-slate-400">
                    true={i.trueResponderCount} · displayed={i.displayedResponderCount} · alerted={i.alertCount} · flagged={i.flaggedCount}
                    {i.clusterId ? " · ⛓clustered" : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="card text-xs text-slate-400">
            <h2 className="text-sm font-bold text-slate-200">How to multi-device test (§18)</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Laptop: keep this Test Mode open.</li>
              <li>Phone 1: sign in as <b>victim@safeguard.test</b> → press SOS.</li>
              <li>Phone 2/3: sign in as <b>helper@safeguard.test</b> / <b>medic@safeguard.test</b>.</li>
              <li>Laptop/Phone 4: sign in as <b>police@safeguard.test</b> → dashboard.</li>
              <li>Real phones use real GPS; sim devices move via this panel. Both paths run the same engine.</li>
            </ol>
          </div>
        </section>
      </div>
    </main>
  );
}
