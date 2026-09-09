import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { responseActionSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { haversineMeters, classifyZone, Zone } from "@/lib/geo";
import { evaluateIncident } from "@/lib/geofence-engine";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["VOLUNTEER"]);
    const { id } = ctx.params;
    const body = responseActionSchema.parse(await req.json());

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");
    if (incident.status !== "ACTIVE") throw new ApiError("CONFLICT_STATE", `Incident is ${incident.status}.`);

    // Volunteer's current position (from request or last stored).
    let volLat = body.lat;
    let volLng = body.lng;
    if (volLat === undefined || volLng === undefined) {
      const last = await prisma.location.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      volLat = last?.lat;
      volLng = last?.lng;
    }

    const existing = await prisma.volunteerResponse.findUnique({
      where: { incidentId_volunteerId: { incidentId: id, volunteerId: user.id } },
    });

    // DANGER-ZONE GUARD (§6): a flagged node can never respond.
    const flag = await prisma.nodeFlag.findUnique({
      where: { incidentId_userId: { incidentId: id, userId: user.id } },
    });
    if (flag || existing?.flagged) {
      throw new ApiError("NODE_FLAGGED", "You are inside the danger zone for this incident — response blocked.");
    }

    // Zone re-validation at response time (server-side, §2/§20).
    let distanceM: number | null = null;
    let zone: Zone | null = null;
    if (volLat !== undefined && volLng !== undefined) {
      distanceM = haversineMeters({ lat: incident.lastLat, lng: incident.lastLng }, { lat: volLat, lng: volLng });
      zone = classifyZone(distanceM);
      if (zone === "DANGER") throw new ApiError("NODE_FLAGGED", "You are inside the danger zone.");
      // BUFFER nodes are never alerted; they may only respond if the incident
      // was already accepted before the buffer was entered. New accepts from
      // BUFFER are blocked to keep the donut contract (§5).
      if (zone === "BUFFER" && !existing) {
        throw new ApiError("OUT_OF_ZONE", "You are in the buffer zone (50–100m) — alerts are not sent there.");
      }
    }

    if (body.action === "WITHDRAW") {
      if (!existing) throw new ApiError("NOT_FOUND", "No response to withdraw.");
      await prisma.$transaction(async (tx) => {
        await tx.volunteerResponse.update({
          where: { id: existing.id },
          data: { status: "WITHDRAWN" },
        });
        await appendAudit(tx, id, {
          type: "VOLUNTEER_WITHDRAWN",
          data: { anonId: user.anonId },
        });
      });
      bus.publish(CHANNEL.incident(id), "response:new", { anonId: user.anonId, action: "WITHDRAW" });
      return ok({ status: "WITHDRAWN" });
    }

    if (body.action === "REPORT_POLICE") {
      // One-tap summary to the police channel (§2B "Report to Police").
      await prisma.$transaction(async (tx) => {
        await tx.intelMessage.create({
          data: {
            incidentId: id,
            senderId: user.id,
            senderAnonId: user.anonId,
            category: "OTHER",
            message: "REPORT_TO_POLICE: volunteer requested police dispatch with live summary.",
            lat: volLat,
            lng: volLng,
          },
        });
        await appendAudit(tx, id, {
          type: AUDIT_TYPES.INTEL_MESSAGE,
          data: { anonId: user.anonId, category: "OTHER", reportToPolice: true },
        });
      });
      bus.publish(CHANNEL.incident(id), "intel:new", { anonId: user.anonId, category: "OTHER" });
      bus.publish(CHANNEL.DASHBOARD, "intel:new", { incidentId: id, anonId: user.anonId, category: "OTHER" });
      return ok({ reported: true });
    }

    // ACCEPT / OBSERVE → upsert response (unique constraint = no duplicates §25).
    const status = body.action === "ACCEPT" ? "RESPONDED" : "OBSERVING";
    const response = await prisma.$transaction(async (tx) => {
      const upserted = await tx.volunteerResponse.upsert({
        where: { incidentId_volunteerId: { incidentId: id, volunteerId: user.id } },
        create: {
          incidentId: id,
          volunteerId: user.id,
          status,
          distanceM: distanceM,
          zone: zone,
          eligible: true,
          lat: volLat,
          lng: volLng,
        },
        update: { status, distanceM, zone, lat: volLat, lng: volLng },
      });
      await appendAudit(tx, id, {
        type: AUDIT_TYPES.VOLUNTEER_ACCEPTED,
        data: { anonId: user.anonId, action: body.action, distanceM: distanceM !== null ? Math.round(distanceM) : null },
      });
      return upserted;
    });

    // Consent-gated volunteer location storage (§7 opt-in).
    if (volLat !== undefined && volLng !== undefined && user.consentLocation) {
      await prisma.location.create({
        data: { userId: user.id, incidentId: id, lat: volLat, lng: volLng, source: "GPS" },
      });
    }

    bus.publish(CHANNEL.incident(id), "response:new", { anonId: user.anonId, action: body.action });
    bus.publish(CHANNEL.DASHBOARD, "response:new", { incidentId: id, anonId: user.anonId, action: body.action });

    return ok({
      response: {
        status: response.status,
        distanceM: response.distanceM,
        zone: response.zone,
        flagged: response.flagged,
      },
      // Authorization granted: victim location now released to this volunteer.
      victimLocation: { lat: incident.lastLat, lng: incident.lastLng },
    });
  } catch (err) {
    return fail(err);
  }
}
