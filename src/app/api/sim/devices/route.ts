export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { simDeviceSchema } from "@/lib/validation";
import { nanoid } from "nanoid";

const SIM_GUARD = "x-safeguard-sim";

export async function GET(req: NextRequest) {
  if (req.headers.get(SIM_GUARD) !== "1") return ok({ devices: [], simGuard: false });

  const devices = await prisma.user.findMany({
    where: { isSimulated: true },
    include: { locations: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });

  return ok({
    simGuard: true,
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role,
      email: d.email,
      anonId: d.anonId,
      consentLocation: d.consentLocation,
      consentVolunteer: d.consentVolunteer,
      volunteerStatus: d.volunteerStatus,
      verificationStatus: d.verificationStatus,
      lat: d.locations[0]?.lat ?? null,
      lng: d.locations[0]?.lng ?? null,
      lastSeen: d.locations[0]?.createdAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get(SIM_GUARD) !== "1") return ok({ created: false, simGuard: false });
    const body = simDeviceSchema.parse(await req.json());

    const device = await prisma.user.create({
      data: {
        id: `sim_${nanoid(10)}`,
        name: body.name,
        email: `sim-${nanoid(8).toLowerCase()}@safeguard.test`,
        passwordHash: "SIMULATED_DEVICE_NO_LOGIN",
        role: body.role,
        isSimulated: true,
        consentLocation: body.consentLocation,
        consentVolunteer: body.role === "VOLUNTEER" ? body.consentVolunteer : false,
        volunteerStatus: body.role === "VOLUNTEER" && body.consentVolunteer ? body.volunteerStatus : null,
        verificationStatus: body.role === "VOLUNTEER" ? body.verificationStatus : "UNVERIFIED",
        certifications: body.role === "VOLUNTEER" && body.verificationStatus === "MEDICAL_CERTIFIED" ? JSON.stringify(["MEDICAL"]) : null,
      },
    });
    await prisma.location.create({
      data: { userId: device.id, lat: body.lat, lng: body.lng, source: "SIMULATED" },
    });

    return ok({ created: true, device: { id: device.id, name: device.name, role: device.role } });
  } catch (err) {
    return fail(err);
  }
}
