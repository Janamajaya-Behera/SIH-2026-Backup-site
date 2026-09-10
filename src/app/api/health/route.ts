export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";

// Never cache: the snapshot must always reflect a live DB probe.
export const dynamic = "force-dynamic";

export async function GET() {
  let db = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }
  return NextResponse.json({
    ok: db === "up",
    data: {
      status: db === "up" ? "healthy" : "degraded",
      db,
      geofence: { dangerM: CONFIG.DANGER_RADIUS_M, bufferEndM: CONFIG.BUFFER_END_M },
      time: new Date().toISOString(),
    },
  });
}
