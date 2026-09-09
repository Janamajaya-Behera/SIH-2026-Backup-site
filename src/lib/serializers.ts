import { displayedResponderCount } from "./urgency";

/**
 * Role-shaped payload serializers (§2B, §20, §7).
 *
 * Privacy rules enforced HERE, server-side, in one place:
 *  - Volunteers never receive victim coordinates before an accepted response.
 *  - Volunteers never receive the true responder count (Urgency Offset §8).
 *  - TEST_ATTACKER callers receive 404s at the route level (existence hidden).
 */

export type IncidentLike = {
  id: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  lastLat: number;
  lastLng: number;
  createdAt: Date;
  activatedAt?: Date | null;
  resolvedAt?: Date | null;
  updatedAt?: Date | null;
  clusterId?: string | null;
};

export type ResponseLike = {
  volunteerId: string;
  status: string;
  flagged: boolean;
  zone?: string | null;
  distanceM?: number | null;
};

// ─────────────────── Volunteer-shaped incident (privacy-enforcing) ───────────────────

export interface VolunteerIncidentView {
  incidentId: string;
  type: string;
  status: string;
  ageSec: number;
  distanceM: number | null;
  zone: string | null;
  urgency: "HIGH" | "MEDIUM";
  /** Offset count (§8) — true count is NEVER serialized for volunteers. */
  displayedResponders: number;
  /** Victim coordinates — present ONLY after an authorized accepted response. */
  victimLocation?: { lat: number; lng: number; lastUpdateSec: number };
  clusterSize?: number;
  myResponse?: {
    status: string;
    flagged: boolean;
  };
}

/**
 * Volunteer incident payload. Coordinates are included ONLY when the server
 * has verified an accepted (RESPONDED/OBSERVING, unflagged) response.
 */
export function toVolunteerIncidentView(
  incident: IncidentLike,
  opts: {
    distanceM: number | null;
    zone: string | null;
    myResponse?: ResponseLike;
    clusterSize?: number;
    activeResponseCount: number;
    now?: Date;
  }
): VolunteerIncidentView {
  const now = opts.now ?? new Date();
  const accepted =
    !!opts.myResponse &&
    !opts.myResponse.flagged &&
    ["RESPONDED", "OBSERVING"].includes(opts.myResponse.status);

  const view: VolunteerIncidentView = {
    incidentId: incident.id,
    type: incident.type,
    status: incident.status,
    ageSec: Math.round((now.getTime() - incident.createdAt.getTime()) / 1000),
    distanceM: opts.distanceM === null ? null : Math.round(opts.distanceM),
    zone: opts.zone,
    urgency: incident.type === "MEDICAL" || incident.type === "CRIME" ? "HIGH" : "MEDIUM",
    displayedResponders: displayedResponderCount(opts.activeResponseCount),
    myResponse: opts.myResponse
      ? { status: opts.myResponse.status, flagged: opts.myResponse.flagged }
      : undefined,
    clusterSize: opts.clusterSize,
  };

  // THE privacy gate: exact location only after authorized acceptance.
  if (accepted) {
    const ref = incident.updatedAt ?? incident.createdAt;
    view.victimLocation = {
      lat: incident.lastLat,
      lng: incident.lastLng,
      lastUpdateSec: Math.round((now.getTime() - ref.getTime()) / 1000),
    };
  }
  return view;
}

// ─────────────────── Police-shaped incident (full visibility) ───────────────────

export interface PoliceIncidentView {
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
  activatedAt: string | null;
  resolvedAt: string | null;
}

export function toPoliceIncidentView(
  incident: IncidentLike & {
    victim: { anonId: string; name?: string; phone?: string | null; revealAuthorizedUntil?: Date | null };
    _count?: { alerts?: number; intel?: number; responses?: number };
    responses?: Array<{ status: string; flagged: boolean }>;
  },
  opts: { clusterSize?: number; now?: Date }
): PoliceIncidentView {
  const now = opts.now ?? new Date();
  const activeResponses = (incident.responses ?? []).filter(
    (r) => !r.flagged && ["RESPONDED", "OBSERVING"].includes(r.status)
  );
  const flaggedCount = (incident.responses ?? []).filter((r) => r.flagged).length;
  const revealed =
    incident.victim.revealAuthorizedUntil && incident.victim.revealAuthorizedUntil > now
      ? { name: incident.victim.name ?? "", phone: incident.victim.phone ?? null }
      : null;

  return {
    incidentId: incident.id,
    type: incident.type,
    status: incident.status,
    origin: { lat: incident.lat, lng: incident.lng },
    last: { lat: incident.lastLat, lng: incident.lastLng },
    lastUpdateSec: Math.round(
      (now.getTime() - new Date(incident.updatedAt ?? incident.createdAt).getTime()) / 1000
    ),
    victimAnonId: incident.victim.anonId,
    victimRevealed: revealed,
    trueResponderCount: activeResponses.length,
    displayedResponderCount: displayedResponderCount(activeResponses.length),
    alertCount: incident._count?.alerts ?? 0,
    flaggedCount,
    intelCount: incident._count?.intel ?? 0,
    clusterId: incident.clusterId ?? null,
    clusterSize: opts.clusterSize,
    createdAt: incident.createdAt.toISOString(),
    activatedAt: incident.activatedAt ? incident.activatedAt.toISOString() : null,
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
  };
}
