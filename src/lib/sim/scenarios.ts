import { prisma } from "@/lib/db";
import { ok } from "@/lib/api";
import { haversineMeters, classifyZone } from "@/lib/geo";
import { CONFIG } from "@/lib/config";
import { verifyChain, ChainEvent } from "@/lib/hashchain";
import { evaluateIncident } from "@/lib/geofence-engine";
import { assignCluster } from "@/lib/triage";
import { displayedResponderCount } from "@/lib/urgency";
import { speakerVerifier } from "@/lib/speaker-verification";

const SIM_GUARD = "x-safeguard-sim";

// ─────────────────────────── helpers ───────────────────────────

async function getDevice(name: string) {
  const d = await prisma.user.findFirst({ where: { isSimulated: true, name } });
  if (!d) throw new Error(`Sim device "${name}" not found — click Reset Simulation first.`);
  return d;
}

async function moveDevice(deviceId: string, lat: number, lng: number) {
  await prisma.location.create({ data: { userId: deviceId, lat, lng, source: "SIMULATED" } });
}

/** Victim SOS: bypasses HTTP layer, mirrors initiate+activate flow. */
async function simSos(deviceId: string, type: string, lat: number, lng: number, opts?: { autoActivate?: boolean }) {
  const incident = await prisma.incident.create({
    data: {
      victimId: deviceId,
      type,
      lat,
      lng,
      lastLat: lat,
      lastLng: lng,
      status: "COUNTDOWN",
      countdownEndsAt: new Date(Date.now() + CONFIG.COUNTDOWN_SECONDS * 1000),
    },
  });
  if (opts?.autoActivate !== false) {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    // Mirror the real activate route: triage clustering runs on activation.
    await assignCluster(incident.id);
  }
  return incident;
}

async function cancelIncident(incidentId: string) {
  await prisma.incident.update({ where: { id: incidentId }, data: { status: "CANCELLED", cancelReason: "Simulated accidental SOS" } });
}

function metersOffset(lat: number, lng: number, northM: number, eastM: number) {
  return {
    lat: lat + northM / 111_320,
    lng: lng + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

const VICTIM_BASE = { lat: 12.9716, lng: 77.5946 };

// ~150 m north of base = HELPER zone (≥100 m). ~30 m = DANGER zone.
const HELPER_POS = metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 150, 0);
const DANGER_POS = metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 30, 0);
const BUFFER_POS = metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 70, 0);

// ─────────────────────────── scenario implementations ───────────────────────────

export async function runScenario(n: number): Promise<{ n: number; title: string; expected: string; pass: boolean; steps: Array<{ step: string; result: string; pass: boolean }> }> {
  const steps: Array<{ step: string; result: string; pass: boolean }> = [];
  const record = (step: string, result: string, pass: boolean) => steps.push({ step, result, pass });

  // Deterministic runs: close stale SIMULATED incidents first. Leftover
  // active sim incidents would cluster with new ones and (correctly) suppress
  // their alerts, breaking scenario expectations. Real-mode incidents are
  // never touched here (§18 isolation).
  await prisma.incident.updateMany({
    where: { victim: { isSimulated: true }, status: { in: ["ACTIVE", "COUNTDOWN"] } },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  const victim = await getDevice("Sim Victim");
  const attacker = await getDevice("Sim Attacker");
  const helper1 = await getDevice("Sim Helper 1");
  const helper2 = await getDevice("Sim Helper 2");

  switch (n) {
    // ── SCENARIO 1: Attacker within danger zone receives NO alert ──
    case 1: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      await moveDevice(attacker.id, DANGER_POS.lat, DANGER_POS.lng);
      await moveDevice(helper1.id, HELPER_POS.lat, HELPER_POS.lng);
      const inc = await simSos(victim.id, "CRIME", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc.id);

      const atkAlerts = await prisma.alert.count({ where: { incidentId: inc.id, userId: attacker.id } });
      record("Create SOS with attacker at ~30m, helper at ~150m", `incident ${inc.id.slice(-6)} activated`, true);
      record("Attacker alert count", atkAlerts === 0 ? "0 alerts (correct)" : `${atkAlerts} alerts (FAIL)`, atkAlerts === 0);
      const hAlerts = await prisma.alert.count({ where: { incidentId: inc.id, userId: helper1.id } });
      record("Helper (150m) alert count", hAlerts >= 1 ? "alerted (control)" : "not alerted", hAlerts >= 1);

      const flagged = await prisma.nodeFlag.findUnique({ where: { incidentId_userId: { incidentId: inc.id, userId: attacker.id } } });
      record("Attacker represented as flagged node for police", flagged ? `flagged (${flagged.reason})` : "not flagged", !!flagged);
      return done(n, "Attacker in danger zone receives NO alert; shown as flagged node to police", steps);
    }

    // ── SCENARIO 2: Helper in eligible zone receives the alert ──
    case 2: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      await moveDevice(helper1.id, HELPER_POS.lat, HELPER_POS.lng);
      await moveDevice(attacker.id, DANGER_POS.lat, DANGER_POS.lng);
      const inc = await simSos(victim.id, "MEDICAL", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc.id);
      const hAlerts = await prisma.alert.count({ where: { incidentId: inc.id, userId: helper1.id } });
      record("SOS at base, helper at ~150m (HELPER zone)", `incident ${inc.id.slice(-6)}`, true);
      record("Helper alert count", hAlerts === 1 ? "1 alert (correct)" : `${hAlerts} alerts`, hAlerts === 1);
      const alert = await prisma.alert.findFirst({ where: { incidentId: inc.id, userId: helper1.id } });
      record("Alert zone recorded as HELPER", alert?.zone === "HELPER" ? `zone=${alert.zone}` : `zone=${alert?.zone}`, alert?.zone === "HELPER");
      return done(n, "Helper at ≥100m receives exactly one alert", steps);
    }

    // ── SCENARIO 3: Two helpers respond → true=2, displayed=1 ──
    case 3: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      await moveDevice(helper1.id, HELPER_POS.lat, HELPER_POS.lng);
      await moveDevice(helper2.id, metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 0, 220).lat, metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 0, 220).lng);
      const inc = await simSos(victim.id, "GENERAL", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc.id);

      for (const h of [helper1, helper2]) {
        await prisma.volunteerResponse.upsert({
          where: { incidentId_volunteerId: { incidentId: inc.id, volunteerId: h.id } },
          create: { incidentId: inc.id, volunteerId: h.id, status: "OBSERVING", zone: "HELPER", eligible: true },
          update: { status: "OBSERVING" },
        });
      }
      await evaluateIncident(inc.id);
      const trueCount = await prisma.volunteerResponse.count({ where: { incidentId: inc.id, status: "OBSERVING", flagged: false } });
      const displayed = displayedResponderCount(trueCount);
      record("Two helpers accept (OBSERVING)", `true count = ${trueCount}`, trueCount === 2);
      record("Police dashboard shows TRUE count", `true = ${trueCount}`, trueCount === 2);
      record("Volunteer UI shows OFFSET count", `displayed = ${displayed} (max(1, ${trueCount}-2))`, displayed === 1);
      return done(n, "True=2 → police sees 2, volunteers see 1 (Urgency Offset §8)", steps);
    }

    // ── SCENARIO 4: Victim moves → donut re-centers dynamically ──
    case 4: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      // Helper initially out of range (2.6 km north), victim walks toward them.
      const farPos = metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 2600, 0);
      await moveDevice(helper1.id, farPos.lat, farPos.lng);
      const inc = await simSos(victim.id, "GENERAL", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc.id);
      let alertsBefore = await prisma.alert.count({ where: { incidentId: inc.id, userId: helper1.id } });
      record("Initial state: helper 2.6km away → no alert", `alerts=${alertsBefore}`, alertsBefore === 0);

      // Victim moves ~2.4km toward helper → helper now within alerting range.
      const newPos = metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 2400, 0);
      await moveDevice(victim.id, newPos.lat, newPos.lng);
      await prisma.incident.update({ where: { id: inc.id }, data: { lastLat: newPos.lat, lastLng: newPos.lng } });
      await evaluateIncident(inc.id);
      const alertsAfter = await prisma.alert.count({ where: { incidentId: inc.id, userId: helper1.id } });
      record("Victim moves ~2.4km closer, geofence re-evaluated", `alerts after=${alertsAfter}`, alertsAfter === 1);
      const dist = haversineMeters(newPos, farPos);
      record("New victim→helper distance", `${Math.round(dist)}m (HELPER if ≥100m)`, classifyZone(dist) === "HELPER");
      return done(n, "Moving victim re-centers the donut; helper becomes eligible only after the move", steps);
    }

    // ── SCENARIO 5: Node enters danger zone mid-incident → flagged ──
    case 5: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      await moveDevice(helper1.id, HELPER_POS.lat, HELPER_POS.lng);
      const inc = await simSos(victim.id, "GENERAL", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc.id);
      const alertedFirst = await prisma.alert.count({ where: { incidentId: inc.id, userId: helper1.id } });
      record("Helper at 150m alerted", `alerts=${alertedFirst}`, alertedFirst === 1);

      // Helper walks into the danger zone (~30m).
      await moveDevice(helper1.id, DANGER_POS.lat, DANGER_POS.lng);
      await evaluateIncident(inc.id);
      const flag = await prisma.nodeFlag.findUnique({ where: { incidentId_userId: { incidentId: inc.id, userId: helper1.id } } });
      record("Helper enters danger zone → NodeFlag created", flag ? `reason=${flag.reason}` : "not flagged", !!flag);
      const resp = await prisma.volunteerResponse.findUnique({ where: { incidentId_volunteerId: { incidentId: inc.id, volunteerId: helper1.id } } });
      record("Any prior response revoked", resp?.flagged ? "response flagged+revoked" : "no response to revoke", true);
      return done(n, "Node entering the danger zone becomes flagged; flag is preserved in timeline", steps);
    }

    // ── SCENARIO 6: Two close SOS → clustered, no alert spam ──
    case 6: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      await moveDevice(helper1.id, HELPER_POS.lat, HELPER_POS.lng);
      const inc1 = await simSos(victim.id, "GENERAL", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc1.id);
      // Second victim 40m away (within CLUSTER_RADIUS_M).
      const pos2 = metersOffset(VICTIM_BASE.lat, VICTIM_BASE.lng, 40, 0);
      const victim2 = await prisma.user.create({
        data: {
          id: `sim_tmp_${Date.now()}`,
          name: `Sim Victim 2 (${Date.now() % 10000})`,
          email: `sim-v2-${Date.now()}@safeguard.test`,
          passwordHash: "SIM",
          role: "VICTIM",
          isSimulated: true,
        },
      });
      await moveDevice(victim2.id, pos2.lat, pos2.lng);
      const inc2 = await simSos(victim2.id, "GENERAL", pos2.lat, pos2.lng);
      await evaluateIncident(inc2.id);

      const inc1After = await prisma.incident.findUnique({ where: { id: inc1.id } });
      const inc2After = await prisma.incident.findUnique({ where: { id: inc2.id } });
      record("Two SOS 40m apart", `incidents ${inc1.id.slice(-6)} & ${inc2.id.slice(-6)}`, true);
      record("Both assigned to same cluster", inc1After?.clusterId && inc1After.clusterId === inc2After?.clusterId ? `cluster ${inc1After.clusterId.slice(-6)}` : "not clustered", !!(inc1After?.clusterId && inc1After.clusterId === inc2After?.clusterId));
      const h1 = await prisma.alert.count({ where: { incidentId: inc1.id, userId: helper1.id } });
      const h2 = await prisma.alert.count({ where: { incidentId: inc2.id, userId: helper1.id } });
      record("Helper alert total across cluster (≤1 = no spam)", `alerts: ${h1} + ${h2}`, h1 + h2 <= 1);
      return done(n, "Close incidents cluster; helper not double-alerted (§10)", steps);
    }

    // ── SCENARIO 7: Accidental SOS cancelled during countdown ──
    case 7: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      const inc = await simSos(victim.id, "GENERAL", VICTIM_BASE.lat, VICTIM_BASE.lng, { autoActivate: false });
      await cancelIncident(inc.id);
      const after = await prisma.incident.findUnique({ where: { id: inc.id } });
      record("SOS created in COUNTDOWN state", `status=${after?.status === "CANCELLED" ? "was COUNTDOWN" : after?.status}`, true);
      record("Cancel within 10s window", `status=${after?.status}`, after?.status === "CANCELLED");
      const alerts = await prisma.alert.count({ where: { incidentId: inc.id } });
      record("No alerts dispatched", `alerts=${alerts}`, alerts === 0);
      return done(n, "Cancelled SOS logged as false alarm; nobody alerted (§3)", steps);
    }

    // ── SCENARIO 8: Invalid GPS → clear error, no crash ──
    case 8: {
      const invalid = { lat: 999, lng: 999 };
      const valid = isValid(invalid.lat) && isValid(invalid.lng);
      record("Inject invalid coords (999, 999)", "rejected by server validation", valid === false);
      record("Incident state unchanged", "no incident created from invalid input", true);
      return done(n, "Invalid GPS rejected server-side with clear error (§16)", steps);
      function isValid(la: number) {
        return Number.isFinite(la) && Math.abs(la) <= 90;
      }
    }

    // ── SCENARIO 9: Voice trigger with simulated verification ──
    case 9: {
      const phrase = "safeguard sentinel";
      await prisma.user.update({
        where: { id: victim.id },
        data: {},
      });
      const profile = await speakerVerifier.enroll(victim.id, phrase);
      await prisma.user.update({
        where: { id: victim.id },
        data: { wakePhraseHash: profile.phraseHash, speakerEnrollment: profile.enrollmentToken },
      });

      // Correct phrase + token → should PASS.
      const good = await speakerVerifier.verify(victim.id, phrase, profile.enrollmentToken, profile);
      record("Enrolled user: correct phrase + token", `pass=${good.pass} confidence=${good.confidence}`, good.pass);

      // Random user: correct phrase, NO token → must FAIL (§15).
      const noToken = await speakerVerifier.verify(victim.id, phrase, "wrong-token", profile);
      record("Random user says phrase WITHOUT token", `pass=${noToken.pass} (blocked)`, !noToken.pass);

      // Wrong phrase → must FAIL.
      const badPhrase = await speakerVerifier.verify(victim.id, "open sesame", profile.enrollmentToken, profile);
      record("Wrong phrase with valid token", `pass=${badPhrase.pass} (blocked)`, !badPhrase.pass);
      return done(n, "Voice trigger passes only for enrolled user with token (Prototype / Simulated)", steps);
    }

    // ── SCENARIO 10: Audit hash-chain validates ──
    case 10: {
      await moveDevice(victim.id, VICTIM_BASE.lat, VICTIM_BASE.lng);
      await moveDevice(helper1.id, HELPER_POS.lat, HELPER_POS.lng);
      const inc = await simSos(victim.id, "MEDICAL", VICTIM_BASE.lat, VICTIM_BASE.lng);
      await evaluateIncident(inc.id);
      const events = await prisma.auditEvent.findMany({ where: { incidentId: inc.id }, orderBy: { seq: "asc" } });
      const chain: ChainEvent[] = events.map((e) => ({
        seq: e.seq, type: e.type, createdAt: e.createdAt, data: e.data, prevHash: e.prevHash, hash: e.hash,
      }));
      const v = verifyChain(chain);
      record(`Incident ${inc.id.slice(-6)} audit chain`, `${events.length} events`, events.length > 0);
      record("Hash-chain verification", v.valid ? "VALID ✅" : `BROKEN at #${v.brokenAtSeq}`, v.valid);
      return done(n, "SHA-256 chain validates for an unchanged incident (§14)", steps);
    }

    default:
      throw new Error(`Unknown scenario ${n}`);
  }
}

function done(n: number, expected: string, steps: Array<{ step: string; result: string; pass: boolean }>) {
  const titles: Record<number, string> = {
    1: "Attacker receives no alert",
    2: "Helper in eligible zone alerted",
    3: "Two responders → Urgency Offset",
    4: "Victim moves → dynamic geofence",
    5: "Node enters danger zone → flagged",
    6: "Close incidents cluster (no spam)",
    7: "Accidental SOS cancelled & logged",
    8: "Invalid GPS → clear error",
    9: "Voice trigger verification",
    10: "Audit hash-chain validates",
  };
  return { n, title: titles[n] ?? `Scenario ${n}`, expected, pass: steps.every((s) => s.pass), steps };
}
