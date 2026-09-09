"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client";
import { useSSE } from "@/hooks/useSSE";
import ErrorState from "@/components/ErrorState";
import MapCanvas, { MapNode, MapCluster } from "@/components/maps/MapCanvas";

interface IncidentView {
  incidentId: string;
  type: string;
  status: string;
  origin: { lat: number; lng: number };
  last: { lat: number; lng: number };
  lastUpdateSec: number;
  victimAnonId: string;
  victimRevealed?: { name: string; phone: string | null } | null;
  trueResponderCount: number;
  displayedResponderCount: number;
  alertCount: number;
  flaggedCount: number;
  intelCount: number;
  clusterId: string | null;
  clusterSize?: number;
  createdAt: string;
}

interface NodeRow {
  anonId: string;
  role: string;
  identityRevealed: { name: string; phone: string | null } | null;
  distanceM: number | null;
  zone: string | null;
  alerted: boolean;
  accepted: boolean;
  flagged: boolean;
  responseStatus: string | null;
  lastSeenSec: number | null;
  lastLat: number | null;
  lastLng: number | null;
}

interface IntelRow {
  id: string;
  senderAnonId: string;
  category: string;
  message: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

interface AuditRow {
  seq: number;
  type: string;
  data: any;
  createdAt: string;
  hash: string;
  prevHash: string;
}

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Emergency",
  MEDICAL: "Medical",
  CRIME: "Crime / Personal Safety",
  FIRE: "Fire",
  OTHER: "Other",
};

export default function PolicePage() {
  const [incidents, setIncidents] = useState<IncidentView[]>([]);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [intel, setIntel] = useState<IntelRow[]>([]);
  const [audit, setAudit] = useState<{ verification: { valid: boolean; length: number; brokenAtSeq: number | null; reason?: string }; events: AuditRow[]; label: string } | null>(null);
  const [evidence, setEvidence] = useState<{ status: string; type: string | null; reference: string | null; startedAt: string | null; stoppedAt: string | null; events: Array<{ type: string; status: string; at: string; reference: string | null }>; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showing, setShowing] = useState<"intel" | "audit" | "evidence">("intel");

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ incidents: IncidentView[]; clusters: Array<{ id: string; centerLat: number; centerLng: number; radiusM: number }> }>("/api/police/incidents");
      setIncidents(d.incidents);
      setClusters(d.clusters.map((c) => ({ centerLat: c.centerLat, centerLng: c.centerLng, radiusM: c.radiusM })));
      setSelectedId((cur) => cur ?? d.incidents[0]?.incidentId ?? null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load incidents.");
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const [n, i, a, e] = await Promise.all([
        api.get<{ nodes: NodeRow[] }>(`/api/police/incidents/${id}/nodes`),
        api.get<{ intel: IntelRow[] }>(`/api/incidents/${id}/intel`),
        api.get<{ verification: { valid: boolean; length: number; brokenAtSeq: number | null }; events: AuditRow[]; label: string }>(`/api/police/incidents/${id}/audit`),
        api.get<{ status: string; type: string | null; reference: string | null; startedAt: string | null; stoppedAt: string | null; events: Array<{ type: string; status: string; at: string; reference: string | null }>; label: string }>(`/api/incidents/${id}/evidence`).catch(() => null),
      ]);
      setNodes(n.nodes);
      setIntel(i.intel);
      setAudit(a);
      if (e) setEvidence(e);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load incident detail.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useSSE("/api/police/stream", () => load(), load);

  async function setStatus(id: string, action: "RESOLVE" | "CLOSE" | "REOPEN") {
    setBusy(true);
    try {
      await api.post(`/api/police/incidents/${id}/status`, { action });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Status change failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reveal(anonId: string) {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.post(`/api/police/incidents/${selectedId}/reveal`, { anonId });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reveal failed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = incidents.find((i) => i.incidentId === selectedId) ?? null;

  const mapNodes: MapNode[] = nodes
    .filter((n) => n.lastLat !== null && n.lastLng !== null)
    .map((n) => ({
      anonId: n.anonId,
      lat: n.lastLat!,
      lng: n.lastLng!,
      state: n.flagged ? "flagged" : n.role === "TEST_ATTACKER" ? "attacker" : n.accepted ? "accepted" : "alerted",
      label: `${n.anonId.slice(-6)} · ${n.zone ?? "?"} · ${n.distanceM ?? "?"}m${n.flagged ? " · FLAGGED" : ""}`,
    }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="text-xl font-bold">Police / Admin Dashboard</h1>
            <p className="text-xs text-slate-500">True responder counts shown here — volunteer UI shows the offset count (§8).</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="badge bg-emerald-900/60 text-emerald-300">Live · SSE</span>
          <Link href="/" onClick={async (e) => { e.preventDefault(); await api.post("/api/auth/logout"); window.location.href = "/"; }} className="text-slate-400 hover:underline">
            Sign out
          </Link>
        </div>
      </header>

      {error && <div className="mt-4"><ErrorState title="Dashboard error" message={error} retry={() => setError(null)} /></div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr_360px]">
        {/* ── LEFT: incident list ── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400">Active & recent incidents ({incidents.length})</h2>
          {incidents.length === 0 && <div className="card text-sm text-slate-500">No incidents. All quiet.</div>}
          {incidents.map((inc) => (
            <button
              key={inc.incidentId}
              onClick={() => setSelectedId(inc.incidentId)}
              className={`card w-full text-left transition-colors ${selectedId === inc.incidentId ? "border-red-600" : "hover:border-slate-600"} ${
                inc.status === "ACTIVE" ? "border-red-900/70" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{TYPE_LABELS[inc.type] ?? inc.type}</span>
                <StatusPill status={inc.status} />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(inc.createdAt).toLocaleTimeString()} · victim {inc.victimRevealed ? inc.victimRevealed.name : inc.victimAnonId.slice(-6)}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                <span className="rounded bg-slate-800 px-2 py-1">
                  TRUE responders: <b className="text-emerald-400">{inc.trueResponderCount}</b>
                </span>
                <span className="rounded bg-slate-800 px-2 py-1">
                  DISPLAYED to volunteers: <b className="text-amber-400">{inc.displayedResponderCount}</b>
                </span>
                <span className="rounded bg-slate-800 px-2 py-1">Alerted: <b>{inc.alertCount}</b></span>
                <span className="rounded bg-slate-800 px-2 py-1">Flagged: <b className={inc.flaggedCount > 0 ? "text-red-400" : ""}>{inc.flaggedCount}</b></span>
              </div>
              {inc.clusterSize && inc.clusterSize > 1 && (
                <p className="mt-1 text-xs text-amber-400">⛓ Clustered ({inc.clusterSize} incidents)</p>
              )}
            </button>
          ))}
        </section>

        {/* ── CENTER: map + node table ── */}
        <section className="space-y-4">
          {selected ? (
            <>
              <MapCanvas
                center={selected.last}
                dangerM={50}
                bufferEndM={100}
                victim={selected.last}
                nodes={mapNodes}
                clusters={clusters}
                heightClass="h-[420px]"
              />

              {/* Node table (anonymous until authorized reveal, §7) */}
              <div className="card overflow-x-auto">
                <h3 className="text-sm font-semibold text-slate-300">Nodes & zones (donut geofence: danger &lt;50m · buffer 50–100m · helper ≥100m)</h3>
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1">Node</th><th>Role</th><th>Distance</th><th>Zone</th><th>Alerted</th><th>Accepted</th><th>Flagged</th><th>Last seen</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <tr key={n.anonId} className="border-t border-slate-800">
                        <td className="py-1.5 font-mono">{n.identityRevealed ? `${n.identityRevealed.name} (${n.anonId.slice(-4)})` : `···${n.anonId.slice(-4)}`}</td>
                        <td>{n.role === "TEST_ATTACKER" ? "attacker (sim)" : n.role.toLowerCase()}</td>
                        <td>{n.distanceM !== null ? `${n.distanceM}m` : "—"}</td>
                        <td><ZoneBadge zone={n.zone} /></td>
                        <td>{n.alerted ? "✅" : "—"}</td>
                        <td>{n.accepted ? "✅" : "—"}</td>
                        <td>{n.flagged ? <span className="text-red-400">🚩</span> : "—"}</td>
                        <td>{n.lastSeenSec !== null ? `${n.lastSeenSec}s ago` : "—"}</td>
                        <td>
                          {!n.identityRevealed && (
                            <button className="text-xs text-blue-400 hover:underline disabled:opacity-40" disabled={busy || !n.accepted} onClick={() => reveal(n.anonId)} title={n.accepted ? "Reveal identity (audited)" : "Reveal requires an accepted response"}>
                              Reveal
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-slate-500">
                  Identity reveal is audited and requires the node to have an accepted response (authorization condition).
                </p>
              </div>

              {/* Police actions */}
              <div className="flex flex-wrap gap-2">
                {selected.status === "ACTIVE" && (
                  <button className="btn-safe" disabled={busy} onClick={() => setStatus(selected.incidentId, "RESOLVE")}>
                    Mark resolved
                  </button>
                )}
                {selected.status === "RESOLVED" && (
                  <button className="btn-ghost" disabled={busy} onClick={() => setStatus(selected.incidentId, "CLOSE")}>
                    Close incident
                  </button>
                )}
                {["RESOLVED", "CLOSED"].includes(selected.status) && (
                  <button className="btn-ghost" disabled={busy} onClick={() => setStatus(selected.incidentId, "REOPEN")}>
                    Reopen
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="card flex h-64 items-center justify-center text-slate-500">Select an incident to view its map.</div>
          )}
        </section>

        {/* ── RIGHT: intel / audit / evidence tabs ── */}
        <section className="space-y-3">
          <div className="flex gap-2">
            {(["intel", "audit", "evidence"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setShowing(t)}
                className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold ${
                  showing === t ? "border-red-600 bg-red-950/40 text-red-200" : "border-slate-700 text-slate-400"
                }`}
              >
                {t === "intel" ? "Live intel" : t === "audit" ? "Audit trail" : "Evidence"}
              </button>
            ))}
          </div>

          {showing === "intel" && (
            <div className="card max-h-[560px] space-y-2 overflow-y-auto">
              <h3 className="text-sm font-semibold text-slate-300">Live intelligence (chronological)</h3>
              {intel.length === 0 && <p className="text-sm text-slate-500">No intel yet.</p>}
              {intel.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-sm">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{new Date(m.createdAt).toLocaleTimeString()} · {m.senderAnonId.slice(-4)}</span>
                    <span className="badge bg-slate-800 text-slate-300">{m.category}</span>
                  </div>
                  <p className="mt-1 text-slate-200">{m.message}</p>
                  {m.lat !== null && m.lng !== null && (
                    <p className="mt-1 text-[11px] text-blue-400">📍 {m.lat.toFixed(5)}, {m.lng.toFixed(5)}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {showing === "audit" && audit && (
            <div className="card max-h-[560px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-300">Audit timeline</h3>
                <span className={`badge ${audit.verification.valid ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/70 text-red-300"}`}>
                  {audit.verification.valid ? `✅ Chain VALID (${audit.verification.length})` : `❌ BROKEN at #${audit.verification.brokenAtSeq}`}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{audit.label}</p>
              <ol className="mt-3 space-y-2">
                {audit.events.map((e) => (
                  <li key={e.seq} className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-300">#{e.seq}</span>
                      <span className="text-slate-500">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-200">{e.type}</div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-slate-400">{JSON.stringify(e.data)}</pre>
                    <div className="mt-1 font-mono text-[10px] text-slate-600">hash {e.hash}… ← prev {e.prevHash}…</div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {showing === "evidence" && evidence && (
            <div className="card">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-300">Evidence stream</h3>
                <span className={`badge ${evidence.status === "SIMULATED" || evidence.status === "ACTIVE" ? "bg-blue-900/60 text-blue-300" : "bg-slate-800 text-slate-300"}`}>
                  {evidence.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-amber-400/90">{evidence.label}</p>
              {evidence.reference && <p className="mt-1 text-xs text-slate-400">Stream ref: <span className="font-mono">{evidence.reference}</span></p>}
              {evidence.startedAt && <p className="text-xs text-slate-400">Started: {new Date(evidence.startedAt).toLocaleTimeString()}</p>}
              {evidence.stoppedAt && <p className="text-xs text-slate-400">Stopped: {new Date(evidence.stoppedAt).toLocaleTimeString()}</p>}
              <div className="mt-3 space-y-1">
                {evidence.events.map((ev, idx) => (
                  <div key={idx} className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-300">
                    {new Date(ev.at).toLocaleTimeString()} · {ev.type} → {ev.status}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Prototype: streams are simulated; a WebRTC module can replace this without changing the interface.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-red-600/90 text-white animate-pulse",
    COUNTDOWN: "bg-amber-600/90 text-black",
    RESOLVED: "bg-emerald-700/90 text-white",
    CANCELLED: "bg-slate-700 text-slate-300",
    CLOSED: "bg-slate-800 text-slate-400",
  };
  return <span className={`badge ${styles[status] ?? "bg-slate-700 text-white"}`}>{status}</span>;
}

function ZoneBadge({ zone }: { zone: string | null }) {
  if (!zone) return <span className="text-slate-500">—</span>;
  const styles: Record<string, string> = {
    DANGER: "bg-red-900/70 text-red-300",
    BUFFER: "bg-amber-900/70 text-amber-300",
    HELPER: "bg-emerald-900/70 text-emerald-300",
    OUT_OF_RANGE: "bg-slate-800 text-slate-400",
  };
  return <span className={`badge ${styles[zone] ?? ""}`}>{zone}</span>;
}
