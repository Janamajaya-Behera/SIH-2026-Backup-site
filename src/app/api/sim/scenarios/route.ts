import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { simScenarioSchema } from "@/lib/validation";
import { runScenario } from "@/lib/sim/scenarios";
import { SIM_LABELS } from "@/lib/config";

const SIM_GUARD = "x-safeguard-sim";

const SCENARIO_LIST = [
  { n: 1, title: "Attacker receives no alert", expected: "Attacker in danger zone gets 0 alerts; appears as flagged node to police." },
  { n: 2, title: "Helper in eligible zone alerted", expected: "Helper at ≥100m receives exactly one alert." },
  { n: 3, title: "Two responders → Urgency Offset", expected: "Police sees true=2; volunteer UI shows displayed=1." },
  { n: 4, title: "Victim moves → dynamic geofence", expected: "Donut re-centers; previously out-of-range helper becomes eligible after victim moves." },
  { n: 5, title: "Node enters danger zone → flagged", expected: "Flag created, response revoked, alerting stops for that node." },
  { n: 6, title: "Close incidents cluster", expected: "Two SOS within ~50m join one cluster; helper not double-alerted." },
  { n: 7, title: "Accidental SOS cancelled", expected: "Cancel within countdown logs false alarm; zero alerts." },
  { n: 8, title: "Invalid GPS → clear error", expected: "Server rejects invalid coordinates without crashing." },
  { n: 9, title: "Voice trigger verification", expected: "Enrolled user + token passes; random user blocked." },
  { n: 10, title: "Audit hash-chain validates", expected: "verifyChain returns valid for an unchanged incident." },
];

export async function GET() {
  return ok({ scenarios: SCENARIO_LIST, guard: SIM_GUARD });
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get(SIM_GUARD) !== "1") throw new ApiError("FORBIDDEN_ROLE", "Simulation guard header missing.");
    const body = simScenarioSchema.parse(await req.json());
    const result = await runScenario(body.n);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
