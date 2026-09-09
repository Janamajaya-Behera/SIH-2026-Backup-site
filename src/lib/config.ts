// SafeGuard SOS — central configuration.
// LOCKED GEOFENCE BOUNDARIES (§D) — imported everywhere; no magic numbers elsewhere:
//   DANGER: distance < 50 m            → never alerted, node flagged
//   BUFFER: 50 m ≤ distance < 100 m    → never alerted (donut gap)
//   HELPER: distance ≥ 100 m           → alert-eligible

function num(v: string | undefined, dflt: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export const CONFIG = {
  // Donut geofence (locked)
  DANGER_RADIUS_M: num(process.env.DANGER_RADIUS_M, 50),
  BUFFER_END_M: num(process.env.BUFFER_END_M, 100),
  MAX_ALERT_RADIUS_M: num(process.env.MAX_ALERT_RADIUS_M, 2000),

  // SOS flow
  COUNTDOWN_SECONDS: num(process.env.COUNTDOWN_SECONDS, 10),

  // Battery-conscious location streaming (§11): high frequency only while an
  // incident is ACTIVE; effectively zero tracking otherwise.
  LOCATION_INTERVAL_MS: num(process.env.LOCATION_INTERVAL_MS, 5000),
  LOCATION_MAX_ACCURACY_M: num(process.env.LOCATION_MAX_ACCURACY_M, 100),
  LOCATION_STALE_MS: 30_000, // a node location older than this is not considered live

  // Triage / clustering (§10)
  CLUSTER_RADIUS_M: num(process.env.CLUSTER_RADIUS_M, 50),

  // Urgency Offset (§8): displayed = max(1, actual - URGENCY_OFFSET_N)
  URGENCY_OFFSET_N: 2,

  // Route recalculation triggers (victim moved significantly / volunteer drifted)
  ROUTE_RECALC_VICTIM_M: 20,
  ROUTE_RECALC_VOLUNTEER_M: 30,

  // Identity reveal authorization window once condition is met (§7)
  REVEAL_WINDOW_MINUTES: 30,

  // Engine sweep interval (periodic re-evaluation + countdown fail-safe)
  SWEEP_INTERVAL_MS: 10_000,
} as const;

export const ZONES = ["DANGER", "BUFFER", "HELPER", "OUT_OF_RANGE"] as const;
export type Zone = (typeof ZONES)[number];

export const EMERGENCY_TYPES = ["GENERAL", "MEDICAL", "CRIME", "FIRE", "OTHER"] as const;
export type EmergencyType = (typeof EMERGENCY_TYPES)[number];

export const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
  GENERAL: "General Emergency",
  MEDICAL: "Medical",
  CRIME: "Crime / Personal Safety",
  FIRE: "Fire",
  OTHER: "Other",
};

export const INTEL_CATEGORIES = [
  "OBSERVED",
  "MOVEMENT",
  "DIRECTION",
  "MEDICAL",
  "FIRE",
  "LOCATION_CHANGE",
  "OTHER",
] as const;
export type IntelCategory = (typeof INTEL_CATEGORIES)[number];

export const INTEL_CATEGORY_LABELS: Record<IntelCategory, string> = {
  OBSERVED: "Situation observed",
  MOVEMENT: "Person moving",
  DIRECTION: "Direction of movement",
  MEDICAL: "Medical assistance needed",
  FIRE: "Fire / smoke observed",
  LOCATION_CHANGE: "Location change",
  OTHER: "Other observation",
};

export const INCIDENT_STATUSES = ["COUNTDOWN", "ACTIVE", "CANCELLED", "RESOLVED", "CLOSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const SESSION_COOKIE = "sg_session";
export const SESSION_TTL_HOURS = 12;

// Honest-Simulation Register (§5/§23) — shown in the UI wherever used.
export const SIM_LABELS = {
  speaker: "Prototype / Simulated Speaker Verification",
  evidence: "Prototype / Simulated Evidence Stream",
  routingSimulated: "SIMULATED ROUTING — straight-line estimate, no turn-by-turn",
  routingGoogle: "Live routing via Google Directions",
  policeDb: "Phase 2 / No real government or police database connection",
  push: "In-app notifications (external push integration isolated)",
  leaflet: "Map visualization via OpenStreetMap (not turn-by-turn navigation)",
  audit: "Prototype forensic mechanism — not a legal guarantee of admissibility",
} as const;
