export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { verifyPassword, createSession } from "@/lib/auth";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    if (!email || !password) throw new ApiError("VALIDATION", "Email and password required.");

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new ApiError("VALIDATION", "Invalid email or password.");

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new ApiError("VALIDATION", "Invalid email or password.");

    const res = NextResponse.json({ ok: true, data: { user: publicUser(user) } });
    await createSession(
      { id: user.id, name: user.name, role: user.role as "VICTIM" | "VOLUNTEER" | "POLICE" | "TEST_ATTACKER", isSimulated: user.isSimulated },
      res
    );
    return res;
  } catch (err) {
    return fail(err);
  }
}

function publicUser(u: { id: string; name: string; email: string; role: string; consentLocation: boolean; consentVolunteer: boolean; verificationStatus: string; anonId: string; isSimulated: boolean }) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    consentLocation: u.consentLocation,
    consentVolunteer: u.consentVolunteer,
    verificationStatus: u.verificationStatus,
    anonId: u.anonId,
    isSimulated: u.isSimulated,
  };
}
