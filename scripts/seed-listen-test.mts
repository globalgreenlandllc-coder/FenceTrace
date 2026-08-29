// One-off: seed a sample proposal so the portal "Listen" flow can be
// smoke-tested end to end. Safe to re-run (upserts by a fixed token).
// Delete the row afterwards or keep it as a demo.
import { PrismaClient, Prisma } from "@prisma/client";
import {
  sampleProposal,
  deriveTotalCentsFromData,
} from "../lib/proposal-mock";

const db = new PrismaClient();
const TOKEN = "listen-smoke-test";

const user = await db.user.findFirst({
  where: { email: "globalgreenlandllc@gmail.com" },
});
if (!user) {
  console.error("owner user not found");
  process.exit(1);
}

const data = sampleProposal as unknown as Prisma.InputJsonValue;
const row = await db.proposal.upsert({
  where: { publicToken: TOKEN },
  create: {
    userId: user.id,
    publicToken: TOKEN,
    address: sampleProposal.address,
    clientName: "Listen Smoke Test",
    clientEmail: "listen-test@example.com",
    status: "SENT",
    totalCents: deriveTotalCentsFromData(sampleProposal),
    data,
    contractorSnap: {
      companyName: "FenceTrace Test Co",
      phone: "",
      email: "globalgreenlandllc@gmail.com",
    } as Prisma.InputJsonValue,
    sentAt: new Date(),
  },
  update: { data, audioUrl: null, audioScriptHash: null },
});
console.log("seeded proposal", row.id, "token:", row.publicToken);
await db.$disconnect();
