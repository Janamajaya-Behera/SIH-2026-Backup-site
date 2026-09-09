import { CONFIG } from "./config";

/**
 * URGENCY OFFSET (§8) — REQUIRED Phase-1 feature.
 * Displayed Responders = max(1, Actual Responders - 2)
 *   1 → 1, 2 → 1, 3 → 1, 5 → 3
 * Mitigates the bystander effect for volunteers; police always see the true count.
 */
export function displayedResponderCount(actualCount: number): number {
  const n = Math.max(0, Math.floor(actualCount));
  return Math.max(1, n - CONFIG.URGENCY_OFFSET_N);
}
