"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { SIM_LABELS } from "@/lib/config";

/**
 * Map visualization (§22): Leaflet + OpenStreetMap tiles — the automatic
 * fallback when no Google Maps key is configured. If tiles fail to load,
 * the donut geofence still renders over a neutral grid (never a blank map).
 * Label: SIM_LABELS.leaflet — visualization only, not turn-by-turn navigation.
 */

export interface MapNode {
  anonId: string;
  lat: number;
  lng: number;
  state: "flagged" | "accepted" | "alerted" | "attacker" | "victim";
  label?: string;
}

export interface MapCluster {
  centerLat: number;
  centerLng: number;
  radiusM: number;
}

interface Props {
  center: { lat: number; lng: number };
  dangerM: number;
  bufferEndM: number;
  victim?: { lat: number; lng: number } | null;
  nodes?: MapNode[];
  volunteer?: { lat: number; lng: number } | null;
  routePolyline?: Array<{ lat: number; lng: number }> | null;
  clusters?: MapCluster[];
  heightClass?: string;
  showDonut?: boolean;
}

export default function MapCanvas({
  center,
  dangerM,
  bufferEndM,
  victim,
  nodes = [],
  volunteer,
  routePolyline,
  clusters = [],
  heightClass = "h-72",
  showDonut = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      map.setView([center.lat, center.lng], 16);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      render();
    })();
    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render overlays whenever data changes.
  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, victim?.lat, victim?.lng, nodes, volunteer?.lat, volunteer?.lng, routePolyline, clusters, dangerM, bufferEndM, showDonut]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function render() {
    const L = await import("leaflet");
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const v = victim ?? center;

    // Cluster outlines (§10 visualization).
    for (const c of clusters) {
      L.circle([c.centerLat, c.centerLng], {
        radius: Math.max(c.radiusM, 60),
        color: "#f5a623",
        weight: 2,
        dashArray: "6 6",
        fill: false,
      }).addTo(layer);
    }

    if (showDonut) {
      // OUTER helper-zone lower bound (dashed green ring at 100m).
      L.circle([v.lat, v.lng], { radius: bufferEndM, color: "#188038", weight: 2, dashArray: "8 6", fill: false }).addTo(layer);
      // BUFFER band (50–100m, orange, never alerted).
      L.circle([v.lat, v.lng], { radius: bufferEndM, color: "#f29900", weight: 1, fillColor: "#f29900", fillOpacity: 0.10, stroke: true }).addTo(layer);
      // INNER danger zone (<50m, red).
      L.circle([v.lat, v.lng], { radius: dangerM, color: "#d93025", weight: 2, fillColor: "#d93025", fillOpacity: 0.22 }).addTo(layer);
    }

    // Route polyline (Google route or straight-line fallback line).
    if (routePolyline && routePolyline.length >= 2) {
      L.polyline(
        routePolyline.map((p) => [p.lat, p.lng]),
        { color: "#4285f4", weight: 4, opacity: 0.8, dashArray: routePolyline.length === 2 ? "10 8" : undefined }
      ).addTo(layer);
    }

    const dotIcon = (color: string, ring = false) =>
      L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid ${
          ring ? "#fff" : "rgba(255,255,255,0.7)"
        };box-shadow:0 0 6px ${color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

    // Victim marker: pulsing blue dot at the live position.
    L.marker([v.lat, v.lng], { icon: dotIcon("#4285f4", true) }).addTo(layer).bindTooltip("Victim (live)", { direction: "top" });

    // Volunteer's own position.
    if (volunteer) {
      L.marker([volunteer.lat, volunteer.lng], { icon: dotIcon("#9333ea") })
        .addTo(layer)
        .bindTooltip("You", { direction: "top" });
    }

    // Nodes colored by safety state.
    for (const n of nodes) {
      const color =
        n.state === "flagged" ? "#d93025" : n.state === "attacker" ? "#a855f7" : n.state === "accepted" ? "#188038" : "#5f6368";
      const m = L.marker([n.lat, n.lng], { icon: dotIcon(color) }).addTo(layer);
      m.bindTooltip(n.label ?? n.anonId.slice(-6), { direction: "top" });
    }

    map.setView([v.lat, v.lng], map.getZoom() ?? 16, { animate: false });
  }

  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-800 ${heightClass}`}>
      <div ref={containerRef} className="h-full w-full bg-slate-900" />
      <div className="pointer-events-none absolute bottom-1 left-2 z-[500] rounded bg-slate-950/80 px-2 py-0.5 text-[10px] text-slate-400">
        {SIM_LABELS.leaflet}
      </div>
    </div>
  );
}
