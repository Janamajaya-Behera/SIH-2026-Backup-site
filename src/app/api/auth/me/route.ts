export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const unread = await prisma.notification.count({ where: { userId: user.id, read: false } });
    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        consentLocation: user.consentLocation,
        consentVolunteer: user.consentVolunteer,
        volunteerStatus: user.volunteerStatus,
        verificationStatus: user.verificationStatus,
        anonId: user.anonId,
        isSimulated: user.isSimulated,
      },
      unreadNotifications: unread,
    });
  } catch (err) {
    return fail(err);
  }
}
