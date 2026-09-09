import { z } from "zod";
import { EMERGENCY_TYPES, INTEL_CATEGORIES } from "./config";

export const registerSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(120),
  phone: z.string().max(30).optional().or(z.literal("")),
  password: z.string().min(6).max(100),
  role: z.enum(["VICTIM", "VOLUNTEER", "POLICE", "TEST_ATTACKER"]).default("VICTIM"),
  consentLocation: z.boolean().default(false),
  consentVolunteer: z.boolean().default(false),
  volunteerStatus: z.enum(["ACTIVE", "PAUSED"]).optional(),
  verificationStatus: z.enum(["UNVERIFIED", "ID_VERIFIED", "MEDICAL_CERTIFIED"]).optional(),
  isSimulated: z.boolean().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const sosInitiateSchema = z.object({
  type: z.enum(EMERGENCY_TYPES).default("GENERAL"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000).optional(),
  voiceTriggered: z.boolean().default(false),
  speakerToken: z.string().max(200).optional(),
});

export const sosCancelSchema = z.object({
  incidentId: z.string().min(1),
  reason: z.string().max(200).optional(),
});

export const sosActivateSchema = z.object({
  incidentId: z.string().min(1),
});

export const locationUpdateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000).optional(),
});

export const responseActionSchema = z.object({
  action: z.enum(["ACCEPT", "OBSERVE", "REPORT_POLICE", "WITHDRAW"]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const intelSchema = z.object({
  category: z.enum(INTEL_CATEGORIES),
  message: z.string().min(1).max(280),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const statusChangeSchema = z.object({
  action: z.enum(["RESOLVE", "CLOSE", "REOPEN"]),
});

export const evidenceSchema = z.object({
  action: z.enum(["START", "STOP"]),
  type: z.enum(["AUDIO", "VIDEO"]).default("AUDIO"),
});

export const voiceEnrollSchema = z.object({
  phrase: z.string().min(4).max(60),
});

export const voiceVerifySchema = z.object({
  phrase: z.string().min(1).max(60),
  token: z.string().min(4).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000).optional(),
});

export const revealSchema = z.object({
  anonId: z.string().min(1),
});

export const simDeviceSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.enum(["VICTIM", "VOLUNTEER", "POLICE", "TEST_ATTACKER"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  consentLocation: z.boolean().default(true),
  consentVolunteer: z.boolean().default(true),
  volunteerStatus: z.enum(["ACTIVE", "PAUSED"]).default("ACTIVE"),
  verificationStatus: z.enum(["UNVERIFIED", "ID_VERIFIED", "MEDICAL_CERTIFIED"]).default("UNVERIFIED"),
});

export const simInjectSchema = z.object({
  deviceId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const simScenarioSchema = z.object({
  n: z.number().int().min(1).max(10),
});

export const notificationsReadSchema = z.object({
  ids: z.array(z.string()).optional(),
});
