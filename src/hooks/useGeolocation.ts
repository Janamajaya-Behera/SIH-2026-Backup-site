"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GpsStatus = "idle" | "acquiring" | "ok" | "denied" | "unavailable" | "poor-accuracy";

export interface GeoState {
  status: GpsStatus;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  error: string | null;
}

/**
 * GPS state machine (§16): denied / unavailable / poor-accuracy / ok,
 * each with a clear recovery action. Continuous watching is ONLY enabled
 * while an incident is active (battery-conscious §11) — pass `active`.
 */
export function useGeolocation(active: boolean, options?: { highFrequency?: boolean }) {
  const [state, setState] = useState<GeoState>({ status: "idle", lat: null, lng: null, accuracy: null, error: null });
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  const requestOnce = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "unavailable", lat: null, lng: null, accuracy: null, error: "This browser does not support location." });
      return;
    }
    setState((s) => ({ ...s, status: "acquiring", error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        setState({
          status: acc > 100 ? "poor-accuracy" : "ok",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: acc,
          error: acc > 100 ? `Accuracy ±${Math.round(acc)}m — position may be imprecise.` : null,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState({ status: "denied", lat: null, lng: null, accuracy: null, error: "Location permission denied. Enable it in your browser settings to trigger SOS." });
        } else if (err.code === err.POSITION_UNAVAILABLE || err.code === err.TIMEOUT) {
          setState({ status: "unavailable", lat: null, lng: null, accuracy: null, error: "Location unavailable. Move to an open area or check device location services." });
        } else {
          setState({ status: "unavailable", lat: null, lng: null, accuracy: null, error: err.message });
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }, []);

  // Continuous tracking only while `active` (incident live).
  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;
    const interval = (options?.highFrequency ? 5000 : 15000);
    const id = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lastSent.current = Date.now();
          setState({
            status: pos.coords.accuracy > 100 ? "poor-accuracy" : "ok",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            error: null,
          });
        },
        () => {
          /* keep last known; transient GPS dropouts must not kill the UI */
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
      );
    }, interval);
    return () => window.clearInterval(id);
  }, [active, options?.highFrequency]);

  useEffect(() => {
    requestOnce();
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [requestOnce]);

  return { ...state, requestOnce };
}
