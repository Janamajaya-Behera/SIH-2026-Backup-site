export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { notificationsReadSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unread = notifications.filter((n) => !n.read).length;
    return ok({ notifications, unread });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const body = notificationsReadSchema.parse(await req.json().catch(() => ({})));
    await prisma.notification.updateMany({
      where: { userId: user.id, ...(body.ids ? { id: { in: body.ids } } : {}), read: false },
      data: { read: true },
    });
    return ok({ success: true });
  } catch (err) {
    return fail(err);
  }
}
