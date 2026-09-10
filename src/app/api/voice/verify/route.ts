export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { voiceVerifySchema } from "@/lib/validation";
import { speakerVerifier } from "@/lib/speaker-verification";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { CONFIG, SIM_LABELS } from "@/lib/config";
import { isValidCoord } from "@/lib/geo";

/**
 * Voice-trigger SOS (§15, Scenario 9): verification passes ONLY with the
 * enrolled phrase AND the device enrollment token — a random user saying the
 * phrase (without the token) fails. On success, initiates the SOS flow.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const body = voiceVerifySchema.parse(await req.json());
    if (!isValidCoord(body.lat, body.lng)) throw new ApiError("GPS_INVALID");

    // Duplicate SOS guard (§25) before anything else.
    const live = await prisma.incident.findFirst({
      where: { victimId: user.id, status: { in: ["COUNTDOWN", "ACTIVE"] } },
    });
    if (live) throw new ApiError("DUPLICATE_SOS", "An SOS is already active.", { existingIncidentId: live.id });

    const result = await speakerVerifier.verify(
      user.id,
      body.phrase,
      body.token,
      user.wakePhraseHash
        ? { phraseHash: user.wakePhraseHash, enrollmentToken: user.speakerEnrollment ?? "" }
        : null
    );

    if (!result.pass) {
      return ok({
        verified: false,
        confidence: result.confidence,
        reason: result.reason,
        label: SIM_LABELS.speaker,
        // Do NOT reveal which factor failed to callers without the token.
        sosInitiated: false,
      });
    }

    const now = new Date();
    const countdownEndsAt = new Date(now.getTime() + CONFIG.COUNTDOWN_SECONDS * 1000);
    const incident = await prisma.incident.create({
      data: {
        victimId: user.id,
        type: "GENERAL",
        lat: body.lat,
        lng: body.lng,
        lastLat: body.lat,
        lastLng: body.lng,
        lastAccuracy: body.accuracy,
        status: "COUNTDOWN",
        countdownEndsAt,
        voiceTriggered: true,
        speakerVerified: true,
      },
    });

    await prisma.$transaction(async (tx) => {
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.INCIDENT_CREATED,
        data: { type: "GENERAL", lat: body.lat, lng: body.lng, voiceTriggered: true },
      });
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.VOICE_TRIGGERED,
        data: { confidence: result.confidence, mode: "SIMULATED" },
      });
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.GPS_CAPTURED,
        data: { lat: body.lat, lng: body.lng, accuracy: body.accuracy ?? null },
      });
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.COUNTDOWN_STARTED,
        data: { seconds: CONFIG.COUNTDOWN_SECONDS },
      });
    });

    return ok({
      verified: true,
      confidence: result.confidence,
      label: SIM_LABELS.speaker,
      sosInitiated: true,
      incident: { id: incident.id, status: incident.status, countdownEndsAt: incident.countdownEndsAt },
    });
  } catch (err) {
    return fail(err);
  }
}
