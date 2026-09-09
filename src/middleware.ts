import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Middleware runs on the Edge runtime, so it cannot touch the database.
 * It performs cheap cookie presence checks to fail fast, and blocks
 * Simulation-Mode API routes from non-loopback hosts (§20 isolation).
 * Full JWT verification + role checks happen per-route in Node.
 */

const PROTECTED_PREFIXES = ["/victim", "/volunteer", "/police", "/sim"];
const SIM_API_PREFIX = "/api/sim";
const SESSION_COOKIE = "sg_session";

function isLoopback(host: string | null): boolean {
  if (!host) return false;
  const h = host.split(":")[0];
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Simulation API isolation: loopback-only (§20). Returning a JSON 403
  // rather than a redirect keeps API clients well-behaved.
  if (pathname.startsWith(SIM_API_PREFIX)) {
    if (!isLoopback(req.headers.get("host"))) {
      return new NextResponse(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN_ROLE", message: "Simulation Mode is restricted.", retryable: false } }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }
    return NextResponse.next();
  }

  // Unauthenticated page access → redirect to login with return URL.
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (needsAuth && !req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/victim/:path*", "/volunteer/:path*", "/police/:path*", "/sim/:path*", "/api/sim/:path*"],
};
