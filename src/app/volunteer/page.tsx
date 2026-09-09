"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useSSE } from "@/hooks/useSSE";
import ErrorState from "@/components/ErrorState";
import MapCanvas from "@/components/maps/MapCanvas";
import { INTEL_CATEGORIES, INTEL_CATEGORY_LABELS, IntelCategory } from "@/lib/config";

interface AlertView {
  incidentId: string;
  type: string;
  status: string;
  ageSec: number;
  distanceM: number | null;
  zone: string | null;
  urgency: "HIGH" | "MEDIUM";
  displayedResponders: number;
  victimLocation?: { lat: number; lng: number; lastUpdateSec: number };
  clusterSize?: number;
  myResponse?: { status: string; flagged: boolean };
}

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Emergency",
  MEDICAL: "Medical",
  CRIME: "Crime / Personal Safety",
  FIRE: "Fire",
  OTHER: "Other",
};

export default function VolunteerPage() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<{ label: string; distanceM: number; etaSec: number; provider: string; polyline?: Array<{ lat: number; lng: number }>; error?: string } | null>(null);
  const [intelMsg, setIntelMsg] = useState("");
  const [intelCat, setIntelCat] = useState<IntelCategory>("OBSERVED");
  const [intelSent, setIntelSent] = useState<string | null>(null);
  const [consent, setConsent] = useState(true);

  const hasActive = alerts.some((a) => a.myResponse && ["RESPONDED", "OBSERVING"].includes(a.myResponse.status));
  const geo = useGeolocation(hasActive, { highFrequency: true });

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ alerts: AlertView[]; notice?: string }>("/api/volunteer/alerts");
      setAlerts(d.alerts);
      setNotice(d.notice ?? null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load alerts.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Push volunteer location while an accepted incident is active (§11).
  useEffect(() => {
    if (!hasActive || geo.lat === null || geo.lng === null || !consent) return;
    const t = setInterval(() => {
      api.post("/api/volunteer/location", { lat: geo.lat, lng: geo.lng }).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [hasActive, geo.lat, geo.lng, consent]);

  // SSE live alerts + polling fallback.
  useSSE("/api/volunteer/stream", () => load(), load);

  async function respond(incidentId: string, action: "ACCEPT" | "OBSERVE" | "REPORT_POLICE" | "WITHDRAW") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/incidents/${incidentId}/responses`, {
        action,
        lat: geo.lat ?? undefined,
        lng: geo.lng ?? undefined,
      });
      await load();
      if (action === "ACCEPT" || action === "OBSERVE") setSelected(incidentId);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function fetchRoute(incidentId: string) {
    setBusy(true);
    setError(null);
    try {
      const d = await api.get<{ route: { label: string; distanceM: number; etaSec: number; provider: string; polyline?: Array<{ lat: number; lng: number }>; error?: string } }>(
        `/api/volunteer/route?incidentId=${incidentId}${geo.lat !== null ? `&lat=${geo.lat}&lng=${geo.lng}` : ""}`
      );
      setRoute(d.route);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Routing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendIntel(incidentId: string) {
    if (!intelMsg.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/incidents/${incidentId}/intel`, {
        category: intelCat,
        message: intelMsg.trim(),
        lat: geo.lat ?? undefined,
        lng: geo.lng ?? undefined,
      });
      setIntelMsg("");
      setIntelSent("Update sent to police ✓");
      setTimeout(() => setIntelSent(null), 3000);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not send update.");
    } finally {
      setBusy(false);
    }
  }

  const selectedAlert = alerts.find((a) => a.incidentId === selected);

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-4">
      {/* WITNESS / SAFETY MANDATE (§9) — always pinned */}
      <div className="sticky top-0 z-40 -mx-4 mb-4 border-b-4 border-black bg-yellow-400 px-4 py-2 text-black">
        <div className="text-center">
          <div className="text-base font-black leading-tight tracking-tight">DO NOT ENGAGE — OBSERVE SAFELY</div>
          <div className="text-[11px] font-semibold opacity-80">Maintain distance · Record · Report · Never confront</div>
        </div>
      </div>

      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Volunteer</h1>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-slate-400">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            share location
          </label>
          <Link href="/" onClick={async (e) => { e.preventDefault(); await api.post("/api/auth/logout"); window.location.href = "/"; }} className="text-slate-400 hover:underline">
            Sign out
          </Link>
        </div>
      </header>

      {error && <div className="mt-3"><ErrorState title="Action failed" message={error} retry={() => setError(null)} /></div>}
      {notice && <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-sm text-amber-300">{notice}</div>}

      {/* Active mission view (after acceptance) */}
      {selectedAlert && selectedAlert.victimLocation ? (
        <section className="mt-4 space-y-4">
          <div className="card border-purple-900/60">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold">{TYPE_LABELS[selectedAlert.type] ?? "Emergency"}</h2>
                <p className="text-xs text-slate-400">
                  {selectedAlert.distanceM !== null ? `${selectedAlert.distanceM} m away · ` : ""}
                  {selectedAlert.victimLocation.lastUpdateSec}s ago · {selectedAlert.myResponse?.status}
                </p>
              </div>
              <span className="badge bg-emerald-900/60 text-emerald-300">{selectedAlert.displayedResponders} responding</span>
            </div>
          </div>

          <MapCanvas
            center={selectedAlert.victimLocation}
            dangerM={50}
            bufferEndM={100}
            victim={selectedAlert.victimLocation}
            volunteer={geo.lat !== null && geo.lng !== null ? { lat: geo.lat, lng: geo.lng } : null}
            routePolyline={
              route?.polyline ??
              (route && geo.lat !== null && geo.lng !== null
                ? [{ lat: geo.lat, lng: geo.lng }, selectedAlert.victimLocation]
                : null)
            }
            heightClass="h-72"
          />

          {/* Navigate to Victim (§1) with labelled fallback (§C) */}
          <div className="card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">Navigate to victim</h3>
              <span className={`badge ${route?.provider === "GOOGLE" ? "bg-blue-900/60 text-blue-300" : "bg-amber-900/60 text-amber-300"}`}>
                {route ? (route.provider === "GOOGLE" ? "Live Google routing" : "SIMULATED ROUTING") : "not loaded"}
              </span>
            </div>
            {route && (
              <div className="mt-2 text-sm text-slate-300">
                <p>
                  Distance <b>{(route.distanceM / 1000).toFixed(2)} km</b> · ETA ~<b>{Math.max(1, Math.round(route.etaSec / 60))} min</b> (walking)
                </p>
                <p className="mt-1 text-xs text-slate-500">{route.label}</p>
                {route.error && <p className="mt-1 text-xs text-red-400">Live routing failed ({route.error}) — showing fallback.</p>}
                <p className="mt-1 text-xs text-slate-500">
                  Destination: {selectedAlert.victimLocation.lat.toFixed(5)}, {selectedAlert.victimLocation.lng.toFixed(5)} (updates live)
                </p>
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => fetchRoute(selectedAlert.incidentId)}>
                Navigate to Victim
              </button>
              <a
                className="btn-ghost"
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedAlert.victimLocation.lat},${selectedAlert.victimLocation.lng}&travelmode=walking`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps app
              </a>
            </div>
          </div>

          {/* Actions (§2B) */}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-safe" disabled={busy} onClick={() => respond(selectedAlert.incidentId, "OBSERVE")}>
              👁️ I'm observing safely
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => respond(selectedAlert.incidentId, "REPORT_POLICE")}>
              🚔 Report to Police
            </button>
          </div>

          {/* Live intelligence composer (§12) */}
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300">Send live update to police</h3>
            {intelSent && <p className="mt-1 text-xs text-emerald-400">{intelSent}</p>}
            <select className="input mt-2" value={intelCat} onChange={(e) => setIntelCat(e.target.value as IntelCategory)}>
              {INTEL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {INTEL_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <textarea
              className="input mt-2"
              rows={2}
              maxLength={280}
              placeholder="What do you observe? (max 280 chars)"
              value={intelMsg}
              onChange={(e) => setIntelMsg(e.target.value)}
            />
            <button className="btn-primary mt-2 w-full" disabled={busy || !intelMsg.trim()} onClick={() => sendIntel(selectedAlert.incidentId)}>
              Send update
            </button>
          </div>

          <button className="btn-ghost w-full" disabled={busy} onClick={() => respond(selectedAlert.incidentId, "WITHDRAW")}>
            Withdraw from this incident
          </button>
        </section>
      ) : (
        /* Alerts list (pre-acceptance: NO victim coordinates shown, §2) */
        <section className="mt-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-400">
            {alerts.length > 0 ? "Emergencies near you (nearest first)" : "No active emergencies in your area"}
          </h2>
          {alerts.map((a) => (
            <div key={a.incidentId} className={`card ${a.urgency === "HIGH" ? "border-red-800" : "border-slate-700"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold">{TYPE_LABELS[a.type] ?? a.type}</h3>
                    {a.urgency === "HIGH" && <span className="badge bg-red-900/70 text-red-300">HIGH</span>}
                    {a.clusterSize && a.clusterSize > 1 && <span className="badge bg-amber-900/60 text-amber-300">{a.clusterSize} related incidents</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {a.distanceM !== null ? `${a.distanceM} m away` : "distance unknown — share your location"} ·
                    {" "}{Math.floor(a.ageSec / 60)}m {a.ageSec % 60}s ago
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <b className="text-slate-300">{a.displayedResponders}</b> {a.displayedResponders === 1 ? "person is" : "people are"} responding — every observer matters.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-safe" disabled={busy} onClick={() => respond(a.incidentId, "ACCEPT")}>
                  Accept &amp; view location
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => respond(a.incidentId, "OBSERVE")}>
                  Observe safely
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Exact location unlocks only after you accept — privacy step enforced on the server.
              </p>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="card text-center text-sm text-slate-500">
              You'll be alerted here when a nearby emergency activates. The button stays live in the background.
            </div>
          )}
        </section>
      )}
    </main>
  );
}
