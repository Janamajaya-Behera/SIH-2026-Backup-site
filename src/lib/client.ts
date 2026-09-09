"use client";

/**
 * Client API helper: unwraps {ok, data|error} envelopes, applies a 12s
 * timeout (§16 anti-infinite-loading), and handles session expiry.
 */

export class ApiClientError extends Error {
  code: string;
  retryable: boolean;
  details?: unknown;
  status: number;
  constructor(message: string, opts: { code: string; retryable: boolean; status: number; details?: unknown }) {
    super(message);
    this.code = opts.code;
    this.retryable = opts.retryable;
    this.status = opts.status;
    this.details = opts.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = await res.json().catch(() => null);
    if (!json) throw new ApiClientError("Server returned an invalid response.", { code: "INTERNAL", retryable: true, status: res.status });

    if (!json.ok) {
      const err = json.error ?? {};
      if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
        // Session expired → redirect to login, preserving the return path.
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}&expired=1`;
      }
      throw new ApiClientError(err.message ?? "Request failed.", {
        code: err.code ?? "INTERNAL",
        retryable: !!err.retryable,
        status: res.status,
        details: err.details,
      });
    }
    return json.data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T,>(path: string, headers?: Record<string, string>) => request<T>(path, { headers }),
  post: <T,>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers }),
};
