export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { sosInitiateSchema } from "@/lib/validation";
import { CONFIG, EmergencyType } from "@/lib/config";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { isValidCoord } from "@/lib/geo";
import { speakerVerifier } from "@/lib/speaker-verification";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const body = sosInitiateSchema.parse(await req.json());

    if (!isValidCoord(body.lat, body.lng)) throw new ApiError("GPS_INVALID");

    // Duplicate SOS prevention (§25): reject if a live incident already exists.
    const live = await prisma.incident.findFirst({
      where: { victimId: user.id, status: { in: ["COUNTDOWN", "ACTIVE"] } },
    });
    if (live) {
      throw new ApiError("DUPLICATE_SOS", "An SOS is already active. Use it or cancel before starting a new one.", {
        existingIncidentId: live.id,
        existingStatus: live.status,
      });
    }

    // Voice-trigger path requires passing simulated speaker verification (§15).
    let speakerVerified = false;
    if (body.voiceTriggered) {
      const result = await speakerVerifier.verify(
        user.id,
        body.speakerToken ?? "",
        body.speakerToken ?? "",
        { phraseHash: user.wakePhraseHash ?? "", enrollmentToken: user.speakerEnrollment ?? "" }
      );
      if (!result.pass) {
        throw new ApiError("SIM_VERIFICATION_FAILED", "Voice trigger rejected: speaker verification failed.");
      }
      speakerVerified = true;
    }

    const now = new Date();
    const countdownEndsAt = new Date(now.getTime() + CONFIG.COUNTDOWN_SECONDS * 1000);

    const incident = await prisma.incident.create({
      data: {
        victimId: user.id,
        type: body.type,
        lat: body.lat,
        lng: body.lng,
        lastLat: body.lat,
        lastLng: body.lng,
        lastAccuracy: body.accuracy,
        status: "COUNTDOWN",
        countdownEndsAt,
        voiceTriggered: body.voiceTriggered,
        speakerVerified,
      },
    });

    await prisma.$transaction(async (tx) => {
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.INCIDENT_CREATED,
        data: { type: body.type, lat: body.lat, lng: body.lng, voiceTriggered: body.voiceTriggered },
      });
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.GPS_CAPTURED,
        data: { lat: body.lat, lng: body.lng, accuracy: body.accuracy ?? null },
      });
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.COUNTDOWN_STARTED,
        data: { seconds: CONFIG.COUNTDOWN_SECONDS, endsAt: countdownEndsAt.toISOString() },
      });
      if (speakerVerified) {
        await appendAudit(tx, incident.id, {
          type: AUDIT_TYPES.SPEAKER_VERIFIED,
          data: { mode: "SIMULATED" },
        });
      }
    });

    bus.publish(CHANNEL.incident(incident.id), "incident:created", { incidentId: incident.id });
    bus.publish(CHANNEL.DASHBOARD, "incident:created", { incidentId: incident.id, victimId: user.id });

    return ok({
      incident: {
        id: incident.id,
        status: incident.status,
        type: incident.type,
        countdownEndsAt: incident.countdownEndsAt,
        lat: incident.lat,
        lng: incident.lng,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
