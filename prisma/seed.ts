import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding SafeGuard SOS demo data…");
  const pw = await bcrypt.hash("Demo@1234", 10);
  const simPw = "SIMULATED_DEVICE_NO_LOGIN";

  // ── Demo accounts (all: Demo@1234) ──
  const accounts = [
    { name: "Demo Victim", email: "victim@safeguard.test", role: "VICTIM", consentLocation: true, consentVolunteer: false },
    { name: "Demo Helper", email: "helper@safeguard.test", role: "VOLUNTEER", consentLocation: true, consentVolunteer: true, volunteerStatus: "ACTIVE", verificationStatus: "ID_VERIFIED" },
    { name: "Demo Medic", email: "medic@safeguard.test", role: "VOLUNTEER", consentLocation: true, consentVolunteer: true, volunteerStatus: "ACTIVE", verificationStatus: "MEDICAL_CERTIFIED" },
    { name: "Demo Police", email: "police@safeguard.test", role: "POLICE", consentLocation: false, consentVolunteer: false },
  ];

  for (const a of accounts) {
    await prisma.user.upsert({
      where: { email: a.email },
      update: {},
      create: {
        name: a.name,
        email: a.email,
        passwordHash: pw,
        role: a.role,
        consentLocation: a.consentLocation,
        consentVolunteer: a.consentVolunteer,
        volunteerStatus: (a as { volunteerStatus?: string }).volunteerStatus ?? null,
        verificationStatus: (a as { verificationStatus?: string }).verificationStatus ?? "UNVERIFIED",
        certifications: a.verificationStatus === "MEDICAL_CERTIFIED" ? JSON.stringify(["MEDICAL"]) : null,
      },
    });
  }

  // ── Simulation devices A–E ──
  const devices = [
    { name: "Sim Victim", role: "VICTIM", lat: 12.9716, lng: 77.5946 },
    { name: "Sim Attacker", role: "TEST_ATTACKER", lat: 12.97156, lng: 77.59463 }, // ~30 m: danger zone
    { name: "Sim Helper 1", role: "VOLUNTEER", lat: 12.97295, lng: 77.5946 }, // ~150 m: helper zone
    { name: "Sim Helper 2", role: "VOLUNTEER", lat: 12.9716, lng: 77.5974 }, // ~260 m: helper zone
    { name: "Sim Police", role: "POLICE", lat: 12.975, lng: 77.6 },
  ];
  for (const d of devices) {
    const existing = await prisma.user.findFirst({ where: { isSimulated: true, name: d.name } });
    if (!existing) {
      const dev = await prisma.user.create({
        data: {
          name: d.name,
          email: `sim-${d.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}@safeguard.test`,
          passwordHash: simPw,
          role: d.role,
          isSimulated: true,
          consentLocation: true,
          consentVolunteer: d.role === "VOLUNTEER",
          volunteerStatus: d.role === "VOLUNTEER" ? "ACTIVE" : null,
          verificationStatus: d.role === "VOLUNTEER" ? "ID_VERIFIED" : "UNVERIFIED",
        },
      });
      await prisma.location.create({
        data: { userId: dev.id, lat: d.lat, lng: d.lng, source: "SIMULATED" },
      });
    }
  }

  console.log("✔ Demo accounts (password: Demo@1234):");
  console.log("  victim@safeguard.test · helper@safeguard.test · medic@safeguard.test · police@safeguard.test");
  console.log("✔ Simulation devices A–E ready (Sim Victim, Sim Attacker, Sim Helper 1/2, Sim Police)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
