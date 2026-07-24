#!/usr/bin/env node
// Read-only DB introspection for lead-delivery planning.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!(m[1]in process.env)||process.env[m[1]]==="")process.env[m[1]]=v;}}catch{}}
loadEnv(".env.local"); loadEnv(".env");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const target = "nicholasf@cfnsfl.com";
try {
  const totalUsers = await prisma.user.count();
  const totalLeads = await prisma.lead.count();
  const totalOrders = await prisma.order.count();
  console.log(`DB totals → users:${totalUsers}  orders:${totalOrders}  leads:${totalLeads}`);

  const nick = await prisma.user.findFirst({
    where: { email: { equals: target, mode: "insensitive" } },
    select: { id:true, name:true, email:true, role:true, agency:true, createdAt:true },
  });
  console.log("\nNick's account:", nick ?? "NOT FOUND");

  if (nick) {
    const orders = await prisma.order.findMany({ where: { userId: nick.id } });
    console.log(`\nNick's orders (${orders.length}):`);
    for (const o of orders) console.log(`  ${o.id}  pkg=${o.packageId}  qty=${o.quantity}  fulfilled=${o.fulfilledCount}  status=${o.status}  states=[${o.filterStates}]`);
    const assigned = await prisma.lead.count({ where: { assignedUserId: nick.id } });
    console.log(`\nLeads currently assigned to Nick: ${assigned}`);
  }

  // Distinct list of users so we can see who exists
  const users = await prisma.user.findMany({ select: { email:true, name:true, role:true }, take: 20 });
  console.log("\nAll users (up to 20):");
  for (const u of users) console.log(`  ${u.email}  (${u.name ?? "no name"}, ${u.role})`);
} catch (e) {
  console.error("DB ERROR:", e.message);
} finally {
  await prisma.$disconnect();
}
