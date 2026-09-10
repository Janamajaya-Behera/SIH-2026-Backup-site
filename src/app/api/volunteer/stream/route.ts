export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sseStream } from "@/lib/sse";
import { CHANNEL } from "@/lib/events";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VOLUNTEER"]);
    return sseStream(req, [CHANNEL.user(user.id)]);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
