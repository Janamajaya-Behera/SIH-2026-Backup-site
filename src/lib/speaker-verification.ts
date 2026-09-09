import { createHash, randomBytes } from "crypto";

/**
 * VOICE SOS — SPEAKER VERIFICATION (§15).
 * Interface kept production-ready: a real speaker-biometrics API would
 * implement `SpeakerVerifier` and be swapped in here. The current
 * implementation is clearly labelled "Prototype / Simulated Speaker
 * Verification" (SIM_LABELS.speaker).
 */

export interface SpeakerProfile {
  phraseHash: string;
  enrollmentToken: string;
}

export interface SpeakerVerifyResult {
  pass: boolean;
  confidence: number; // 0..1 (simulated confidence)
  mode: "SIMULATED";
  reason?: string;
}

export interface SpeakerVerifier {
  enroll(userId: string, phrase: string): Promise<SpeakerProfile>;
  verify(userId: string, phrase: string, token: string, profile: SpeakerProfile | null): Promise<SpeakerVerifyResult>;
}

/**
 * Simulated verifier: verification passes ONLY when the phrase hash AND the
 * enrollment token both match. A random person saying the correct phrase
 * without the token FAILS — the §15 "prevent random trigger" requirement.
 */
export class SimulatedSpeakerVerifier implements SpeakerVerifier {
  async enroll(userId: string, phrase: string): Promise<SpeakerProfile> {
    const phraseHash = createHash("sha256").update(`${userId}:${phrase.toLowerCase().trim()}`).digest("hex");
    const enrollmentToken = randomBytes(24).toString("hex");
    return { phraseHash, enrollmentToken };
  }

  async verify(userId: string, phrase: string, token: string, profile: SpeakerProfile | null): Promise<SpeakerVerifyResult> {
    if (!profile) {
      return { pass: false, confidence: 0, mode: "SIMULATED", reason: "NO_ENROLLMENT" };
    }
    const phraseHash = createHash("sha256").update(`${userId}:${phrase.toLowerCase().trim()}`).digest("hex");
    const phraseOk = phraseHash === profile.phraseHash;
    const tokenOk = token === profile.enrollmentToken;
    const pass = phraseOk && tokenOk;
    const confidence = pass ? 0.97 : phraseOk ? 0.42 : 0.08;
    return {
      pass,
      confidence,
      mode: "SIMULATED",
      reason: pass ? undefined : !profile ? "NO_ENROLLMENT" : !tokenOk ? "TOKEN_MISMATCH" : "PHRASE_MISMATCH",
    };
  }
}

export const speakerVerifier: SpeakerVerifier = new SimulatedSpeakerVerifier();
