import { haversineMeters, LatLng } from "./geo";
import { SIM_LABELS } from "./config";

/**
 * ROUTING (§1, §C, §22): modular provider.
 *  - GoogleRouteProvider: real Google Directions when a server key is configured.
 *  - FallbackRouteProvider: straight-line distance + ETA estimate, clearly
 *    labelled "SIMULATED ROUTING — no turn-by-turn". App never breaks (§3).
 */

export interface RouteResult {
  provider: "GOOGLE" | "SIMULATED";
  label: string;
  distanceM: number;
  etaSec: number;
  /** Decoded polyline of the real route (Google) or null (fallback). */
  polyline?: Array<{ lat: number; lng: number }>;
  /** Waypoints for multi-stop medical routing (§10). */
  stops?: Array<LatLng & { label: string }>;
  error?: string;
}

export interface RouteProvider {
  route(from: LatLng, to: LatLng, opts?: { stops?: Array<LatLng & { label: string }> }): Promise<RouteResult>;
}

const WALK_SPEED_MPS = 1.4;
const DRIVE_SPEED_MPS = 8.9; // ~32 km/h urban average

export class GoogleRouteProvider implements RouteProvider {
  constructor(private apiKey: string) {}

  async route(from: LatLng, to: LatLng, opts?: { stops?: Array<LatLng & { label: string }> }): Promise<RouteResult> {
    const origin = opts?.stops?.length
      ? { lat: from.lat, lng: from.lng }
      : from;
    const waypoints = (opts?.stops ?? [])
      .map((s) => `${s.lat},${s.lng}`)
      .join("|");

    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.lat},${origin.lng}` +
      `&destination=${to.lat},${to.lng}` +
      (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
      `&mode=walking&key=${this.apiKey}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        status: string;
        routes?: Array<{
          overview_polyline?: { points: string };
          legs?: Array<{ distance: { value: number }; duration: { value: number } }>;
        }>;
      };
      if (json.status !== "OK" || !json.routes?.length) {
        throw new Error(`Directions status: ${json.status}`);
      }
      const r = json.routes[0];
      const legs = r.legs ?? [];
      const distanceM = legs.reduce((s, l) => s + l.distance.value, 0);
      const etaSec = legs.reduce((s, l) => s + l.duration.value, 0);
      return {
        provider: "GOOGLE",
        label: SIM_LABELS.routingGoogle,
        distanceM,
        etaSec,
        polyline: r.overview_polyline ? decodePolyline(r.overview_polyline.points) : undefined,
        stops: opts?.stops,
      };
    } catch (err) {
      // Never break: fall back on any failure (§3).
      const fb = await new FallbackRouteProvider().route(from, to, opts);
      return { ...fb, error: err instanceof Error ? err.message : "Routing failed" };
    }
  }
}

export class FallbackRouteProvider implements RouteProvider {
  async route(from: LatLng, to: LatLng, opts?: { stops?: Array<LatLng & { label: string }> }): Promise<RouteResult> {
    // Chain the legs: from → stop1 → stop2 … → to (straight-line each).
    const pts: LatLng[] = [from, ...(opts?.stops ?? []), to];
    let distanceM = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      distanceM += haversineMeters(pts[i], pts[i + 1]);
    }
    // Walking pace for the estimate; volunteers are on foot (safe-observer model).
    const etaSec = Math.round(distanceM / WALK_SPEED_MPS);
    return {
      provider: "SIMULATED",
      label: SIM_LABELS.routingSimulated,
      distanceM: Math.round(distanceM),
      etaSec,
      stops: opts?.stops,
    };
  }
}

/** Minimal Google encoded-polyline decoder. */
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }
  return out;
}

/** Returns the best available provider for the server environment. */
export function getRouteProvider(): RouteProvider {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key ? new GoogleRouteProvider(key) : new FallbackRouteProvider();
}
