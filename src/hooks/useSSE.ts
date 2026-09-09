"use client";

import { useEffect, useRef, useState } from "react";

export interface SSEMessage {
  event: string;
  data: any;
}

/**
 * SSE subscription with resilience: reconnects with backoff on error and
 * falls back to HTTP polling if the stream keeps failing (§22 hybrid).
 */
export function useSSE(url: string | null, onMessage: (m: SSEMessage) => void, pollFallback?: () => void) {
  const [connected, setConnected] = useState(false);
  const attempts = useRef(0);
  const sourceRef = useRef<EventSource | null>(null);
  const msgRef = useRef(onMessage);
  msgRef.current = onMessage;
  const pollRef = useRef(pollFallback);
  pollRef.current = pollFallback;
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const startPolling = () => {
      if (pollTimer.current || !pollRef.current) return;
      pollTimer.current = setInterval(() => pollRef.current?.(), 5000);
    };
    const stopPolling = () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      const es = new EventSource(url);
      sourceRef.current = es;

      es.onopen = () => {
        attempts.current = 0;
        setConnected(true);
        stopPolling();
      };
      es.onmessage = (e) => {
        try {
          msgRef.current({ event: e.type || "message", data: JSON.parse(e.data) });
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        es.close();
        setConnected(false);
        if (disposed) return;
        attempts.current += 1;
        startPolling(); // graceful degradation while reconnecting
        const delay = Math.min(10000, 1000 * Math.pow(2, Math.min(attempts.current, 4)));
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      stopPolling();
      sourceRef.current?.close();
    };
  }, [url]);

  return { connected };
}
