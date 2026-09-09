import { prisma } from "./db";
import { bus, CHANNEL } from "./events";
import { SIM_LABELS } from "./config";

/**
 * In-app notification system (§22). External push (Web Push / FCM) is
 * deliberately isolated behind this module — a future provider would plug in
 * here without touching callers. Label: SIM_LABELS.push.
 */

type Kind = "ALERT" | "INTEL" | "STATUS" | "SYSTEM";

interface NotifyArgs {
  userId: string;
  incidentId?: string;
  kind: Kind;
  title: string;
  body: string;
}

export async function notify(args: NotifyArgs): Promise<void> {
  try {
    const n = await prisma.notification.create({
      data: {
        userId: args.userId,
        incidentId: args.incidentId,
        kind: args.kind,
        title: args.title,
        body: args.body,
      },
    });
    bus.publish(CHANNEL.user(args.userId), "notification:new", {
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      incidentId: n.incidentId,
      createdAt: n.createdAt.toISOString(),
    });
    // FUTURE (isolated): web-push/FCM delivery would hook in here.
  } catch (err) {
    // Notification failure must never break the SOS flow (§16).
    console.error("[notifications] failed to create notification:", err);
  }
}

export const NOTIFICATION_LABEL = SIM_LABELS.push;
