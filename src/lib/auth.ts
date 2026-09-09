import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { CONFIG, SESSION_COOKIE, SESSION_TTL_HOURS } from "./config";
import { ApiError } from "./api";
import { prisma } from "./db";

const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "safeguard-dev-secret-change-in-production-9f8e7d6c5b4a"
);

export interface SessionUser {
  id: string;
  name: string;
  role: "VICTIM" | "VOLUNTEER" | "POLICE" | "TEST_ATTACKER";
  isSimulated: boolean;
}

// ─────────────────────────── Password hashing ───────────────────────────

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// ─────────────────────────── Sessions ───────────────────────────

export async function createSession(user: SessionUser, res: NextResponse): Promise<void> {
  const token = await new SignJWT({ name: user.name, role: user.role, sim: user.isSimulated })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(secret);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function clearSession(res: NextResponse): Promise<void> {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Reads + verifies the session JWT from the request cookie. Throws ApiError. */
export async function getSession(req: NextRequest): Promise<SessionUser> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError("AUTH_REQUIRED");
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: String(payload.sub),
      name: String(payload.name ?? ""),
      role: payload.role as SessionUser["role"],
      isSimulated: Boolean(payload.sim),
    };
  } catch {
    throw new ApiError("SESSION_EXPIRED");
  }
}

export interface AuthContext {
  session: SessionUser;
  user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
}

/**
 * Loads the full DB user and enforces role membership (§20 RBAC).
 * Roles must match one of `roles`; defaults to "any authenticated user".
 */
export async function requireUser(
  req: NextRequest,
  roles?: Array<SessionUser["role"]>
): Promise<AuthContext> {
  const session = await getSession(req);
  if (roles && !roles.includes(session.role)) {
    throw new ApiError("FORBIDDEN_ROLE", `Requires role: ${roles.join(" or ")}`);
  }
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) throw new ApiError("SESSION_EXPIRED", "Account no longer exists.");
  return { session, user };
}

export function isVolunteerActive(user: { consentVolunteer: boolean; volunteerStatus: string | null }): boolean {
  return user.consentVolunteer && user.volunteerStatus === "ACTIVE";
}
