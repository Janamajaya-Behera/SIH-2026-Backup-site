import { CONFIG, Zone } from "./config";

export type { Zone };

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Rejects NaN, out-of-range, and the (0,0) null-island sentinel (§16 invalid location). */
export function isValidCoord(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false; // GPS error sentinel
  return true;
}

/** Great-circle distance in meters via the Haversine formula (§5). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Donut-zone classification with LOCKED boundaries (§D):
 *   DANGER:  d <  50 m
 *   BUFFER:  50 ≤ d < 100 m      (never alerted)
 *   HELPER:  d ≥ 100 m           (alert-eligible, up to maxAlertRadiusM)
 *   OUT_OF_RANGE: d > maxAlertRadiusM
 */
export function classifyZone(distanceM: number): Zone {
  if (distanceM < CONFIG.DANGER_RADIUS_M) return "DANGER";
  if (distanceM < CONFIG.BUFFER_END_M) return "BUFFER";
  if (distanceM <= CONFIG.MAX_ALERT_RADIUS_M) return "HELPER";
  return "OUT_OF_RANGE";
}

export function classifyForPoint(victim: LatLng, node: LatLng): { distanceM: number; zone: Zone } {
  const distanceM = haversineMeters(victim, node);
  return { distanceM, zone: classifyZone(distanceM) };
}

export function zoneLabel(zone: Zone): string {
  switch (zone) {
    case "DANGER":
      return `Danger zone (<${CONFIG.DANGER_RADIUS_M} m)`;
    case "BUFFER":
      return `Buffer zone (${CONFIG.DANGER_RADIUS_M}–${CONFIG.BUFFER_END_M} m — no alerts)`;
    case "HELPER":
      return `Helper zone (≥${CONFIG.BUFFER_END_M} m)`;
    default:
      return "Out of range";
  }
}
