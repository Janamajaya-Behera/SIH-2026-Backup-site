import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { hashPassword, createSession } from "@/lib/auth";
import { registerSchema } from "@/lib/validation";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    const body = registerSchema.parse(await req.json());

    // Role-assignment security (§20): POLICE and TEST_ATTACKER only via
    // Simulation/Test Mode on loopback; never self-assigned in normal mode.
    if (body.role === "POLICE" || body.role === "TEST_ATTACKER") {
      const host = req.headers.get("host") ?? "";
      const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("::1");
      if (!isLocal) {
        throw new ApiError("FORBIDDEN_ROLE", "This role can only be created in Test Mode on the host machine.");
      }
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) throw new ApiError("VALIDATION", "An account with this email already exists.");

    const passwordHash = await hashPassword(body.password);
    const isVol = body.role === "VOLUNTEER";
    const user = await prisma.user.create({
      data: {
        id: `u_${nanoid(12)}`,
        name: body.name,
        email: body.email.toLowerCase(),
        phone: body.phone || null,
        passwordHash,
        role: body.role,
        isSimulated: body.isSimulated ?? false,
        consentLocation: body.consentLocation,
        consentVolunteer: isVol ? body.consentVolunteer : false,
        volunteerStatus: isVol && body.consentVolunteer ? body.volunteerStatus ?? "ACTIVE" : null,
        verificationStatus: isVol ? body.verificationStatus ?? "UNVERIFIED" : "UNVERIFIED",
        certifications: isVol && body.verificationStatus === "MEDICAL_CERTIFIED" ? JSON.stringify(["MEDICAL"]) : null,
      },
    });

    const res = NextResponse.json({ ok: true, data: { user: safeUser(user) } }, { status: 201 });
    await createSession(
      { id: user.id, name: user.name, role: user.role as SessionRole, isSimulated: user.isSimulated },
      res
    );
    return res;
  } catch (err) {
    return fail(err);
  }
}

type SessionRole = "VICTIM" | "VOLUNTEER" | "POLICE" | "TEST_ATTACKER";

function safeUser(u: { id: string; name: string; email: string; role: string; consentLocation: boolean; consentVolunteer: boolean; verificationStatus: string; anonId: string; isSimulated: boolean }) {
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
