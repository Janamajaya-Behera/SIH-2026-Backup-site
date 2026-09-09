import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { voiceEnrollSchema } from "@/lib/validation";
import { speakerVerifier } from "@/lib/speaker-verification";
import { SIM_LABELS } from "@/lib/config";

/**
 * Voice SOS enrollment (§15). Stores a hash of the wake phrase plus a
 * per-user enrollment token. Label: Prototype / Simulated Speaker Verification.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const body = voiceEnrollSchema.parse(await req.json());

    const profile = await speakerVerifier.enroll(user.id, body.phrase);
    await prisma.user.update({
      where: { id: user.id },
      data: { wakePhraseHash: profile.phraseHash, speakerEnrollment: profile.enrollmentToken },
    });

    return ok({
      enrolled: true,
      // The token simulates the device-bound voice profile a real biometric
      // API would produce. Keep it safe; verification requires it.
      enrollmentToken: profile.enrollmentToken,
      label: SIM_LABELS.speaker,
    });
  } catch (err) {
    return fail(err);
  }
}
