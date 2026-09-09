import { EventEmitter } from "events";

/**
 * In-process event bus powering all SSE real-time channels (§22).
 * Channels: user:{id}, incident:{id}, dashboard
 */
class SafeGuardBus extends EventEmitter {
  publish(channel: string, event: string, payload: unknown): void {
    this.emit(channel, { event, payload: JSON.stringify(payload) });
  }
  subscribe(channel: string, listener: (msg: { event: string; payload: string }) => void): () => void {
    this.addListener(channel, listener);
    return () => this.removeListener(channel, listener);
  }
}

const g = globalThis as unknown as { __safeguardBus?: SafeGuardBus };
export const bus: SafeGuardBus = g.__safeguardBus ?? new SafeGuardBus();
if (process.env.NODE_ENV !== "production") g.__safeguardBus = bus;

export const CHANNEL = {
  user: (id: string) => `user:${id}`,
  incident: (id: string) => `incident:${id}`,
  DASHBOARD: "dashboard",
} as const;
