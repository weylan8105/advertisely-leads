// Advertisely Bucks Marketing Campaign (DRAFT): give every existing account its
// own referral code (FIRSTNAME + 2 random chars, e.g. WEYLAN7K). Safe to re-run —
// only fills accounts that don't have a code yet.
//
//   set -a; . ./.env; . ./.env.local; set +a; node scripts/backfill-referral-codes.mjs
//
// Requires prisma/sql/referral_program.sql to have been applied first.
import { PrismaClient } from "@prisma/client";
import { randomInt } from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // matches lib/referral.ts
const prisma = new PrismaClient();

function base(name, email) {
  const first = (name ?? "").trim().split(/\s+/)[0] || email.split("@")[0];
  const b = first.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
  return b.length >= 2 ? b : "AGENT";
}
const suffix = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const users = await prisma.user.findMany({ where: { referralCode: null }, select: { id: true, name: true, email: true } });
let done = 0;
for (const u of users) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = base(u.name, u.email) + suffix(attempt < 4 ? 2 : 4);
    try {
      await prisma.user.updateMany({ where: { id: u.id, referralCode: null }, data: { referralCode: code } });
      done++;
      break;
    } catch (e) {
      if (e?.code !== "P2002") throw e;
    }
  }
}
console.log(`Gave ${done} of ${users.length} accounts a referral code.`);
await prisma.$disconnect();
