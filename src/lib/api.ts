import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

// ─────────────────────────── Error registry (§16) ───────────────────────────

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN_ROLE"
  | "VALIDATION"
  | "GPS_INVALID"
  | "GPS_UNAVAILABLE"
  | "DUPLICATE_SOS"
  | "NOT_FOUND"
  | "CONFLICT_STATE"
  | "NODE_FLAGGED"
  | "OUT_OF_ZONE"
  | "MISSING_LOCATION"
  | "DB_UNAVAILABLE"
  | "SIM_VERIFICATION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL";

const ERRORS: Record<ErrorCode, { status: number; message: string; retryable: boolean }> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required.", retryable: false },
  SESSION_EXPIRED: { status: 401, message: "Session expired — please sign in again.", retryable: false },
  FORBIDDEN_ROLE: { status: 403, message: "Your role is not authorized for this action.", retryable: false },
  VALIDATION: { status: 400, message: "Invalid request.", retryable: false },
  GPS_INVALID: { status: 400, message: "Invalid GPS coordinates.", retryable: true },
  GPS_UNAVAILABLE: { status: 503, message: "Location unavailable.", retryable: true },
  DUPLICATE_SOS: { status: 409, message: "An SOS is already active for this account.", retryable: false },
  NOT_FOUND: { status: 404, message: "Not found.", retryable: false },
  CONFLICT_STATE: { status: 409, message: "Action not allowed in the current state.", retryable: false },
  NODE_FLAGGED: { status: 403, message: "This node is flagged for the active incident and cannot respond.", retryable: false },
  OUT_OF_ZONE: { status: 409, message: "You are not in the eligible helper zone for this incident.", retryable: true },
  MISSING_LOCATION: { status: 400, message: "Location required for this action.", retryable: true },
  DB_UNAVAILABLE: { status: 503, message: "Database temporarily unavailable.", retryable: true },
  SIM_VERIFICATION_FAILED: { status: 401, message: "Speaker verification failed.", retryable: true },
  RATE_LIMITED: { status: 429, message: "Too many requests — retry shortly.", retryable: true },
  INTERNAL: { status: 500, message: "Unexpected server error.", retryable: true },
};

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  details?: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    const base = ERRORS[code];
    super(message ?? base.message);
    this.code = code;
    this.status = base.status;
    this.retryable = base.retryable;
    this.details = details;
  }
}

// ─────────────────────────── Response envelope ───────────────────────────

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message, retryable: err.retryable, details: err.details } },
      { status: err.status }
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION", message: "Invalid request.", retryable: false, details: err.flatten().fieldErrors } },
      { status: 400 }
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Prisma unique-constraint races are idempotent conflicts, not crashes.
  if (typeof msg === "string" && msg.includes("Unique constraint")) {
    return NextResponse.json(
      { ok: false, error: { code: "CONFLICT_STATE", message: "Already exists.", retryable: true } },
      { status: 409 }
    );
  }
  if (typeof msg === "string" && (msg.includes("Can't reach database") || msg.includes("Connection refused"))) {
    return NextResponse.json(
      { ok: false, error: { code: "DB_UNAVAILABLE", message: ERRORS.DB_UNAVAILABLE.message, retryable: true } },
      { status: 503 }
    );
  }
  console.error("[api] internal error:", err);
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: ERRORS.INTERNAL.message, retryable: true } },
    { status: 500 }
  );
}

// ─────────────────────────── Route wrapper ───────────────────────────

type Handler = (req: NextRequest, ctx: { params?: Record<string, string> }) => Promise<NextResponse>;

/** Wraps a route handler with bootstrap + uniform error handling. */
export function route(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      const { ensureBootstrap } = await import("./bootstrap");
      ensureBootstrap();
      return await handler(req, ctx);
    } catch (err) {
      return fail(err);
    }
  };
}
