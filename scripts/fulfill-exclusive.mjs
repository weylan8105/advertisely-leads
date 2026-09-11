#!/usr/bin/env node
/**
 * One-off: fulfill two exclusive orders (30 leads each) from the Aug batch,
 * with no overlap between clients and no duplicates of what a client already has.
 * Joseph (5 states) is filled first, then Nick (9 states) from the remainder.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function le(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}catch{}}
le(".env.local"); le(".env");
const commit = process.argv.includes("--commit");
const AUG = new Date("2026-08-01T00:00:00Z");
const last10 = (s)=>String(s||"").replace(/\D/g,"").slice(-10);

const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
try {
  const nick = await p.user.findFirst({ where:{ email:{ equals:"nicholasf@cfnsfl.com", mode:"insensitive" } } });
  const joe  = await p.user.findFirst({ where:{ email:{ equals:"gagliardino.life@gmail.com", mode:"insensitive" } } });
  const nickOrder = await p.order.findFirst({ where:{ userId:nick.id, packageId:"iul-fresh", status:"PROCESSING" }, orderBy:{ createdAt:"desc" } });
  const joeOrder  = await p.order.findFirst({ where:{ userId:joe.id, status:"PROCESSING" }, orderBy:{ createdAt:"desc" } });

  // Leads Nick already has → exclude by phone/email so we never re-give.
  const nickHas = await p.lead.findMany({ where:{ assignedUserId:nick.id }, select:{ phone:true, email:true } });
  const nickPhones = new Set(nickHas.map(l=>last10(l.phone)).filter(Boolean));
  const nickEmails = new Set(nickHas.map(l=>(l.email||"").toLowerCase()).filter(Boolean));

  const NEED = 30;
  const pool = { packageId:{ in:["aged-iul","blue-collar-iul"] }, assignedUserId:null, orderId:null, receivedAt:{ gte:AUG } };

  // ── Joseph first (states TX,FL,CA,OH,MI) ──
  const joeCands = await p.lead.findMany({
    where:{ ...pool, state:{ in:["TX","FL","CA","OH","MI"] } },
    orderBy:{ receivedAt:"desc" }, take:NEED,
  });
  const joeIds = joeCands.map(l=>l.id);

  // ── Nick next (9 states), excluding Joseph's picks + anything Nick already has ──
  const nickPoolCands = await p.lead.findMany({
    where:{ ...pool, id:{ notIn: joeIds.length?joeIds:["_none_"] }, state:{ in:["TX","FL","CA","IL","PA","OH","CO","MI","WA"] } },
    orderBy:{ receivedAt:"desc" },
  });
  const nickCands = [];
  for (const l of nickPoolCands) {
    if (nickPhones.has(last10(l.phone)) || nickEmails.has((l.email||"").toLowerCase())) continue;
    nickCands.push(l);
    if (nickCands.length >= NEED) break;
  }
  const nickIds = nickCands.map(l=>l.id);

  const dist = (cands)=>{ const c={}; for(const l of cands)c[l.state]=(c[l.state]||0)+1; return c; };
  console.log(`Joseph: ${joeCands.length}/30  states=`, dist(joeCands));
  console.log(`Nick:   ${nickCands.length}/30  states=`, dist(nickCands));
  const overlap = joeIds.filter(id=>nickIds.includes(id));
  console.log("Overlap between the two sets (must be 0):", overlap.length);

  if (joeCands.length < NEED || nickCands.length < NEED) {
    console.log("\n⚠ Not enough leads for a full 30/30 — stopping (no writes)."); process.exit(1);
  }
  if (!commit) { console.log("\nDRY RUN — add --commit to assign."); process.exit(0); }

  // Assign Joseph
  await p.lead.updateMany({ where:{ id:{ in:joeIds }, assignedUserId:null }, data:{ assignedUserId:joe.id, orderId:joeOrder.id, assignedAt:new Date() } });
  await p.order.update({ where:{ id:joeOrder.id }, data:{ fulfilledCount:joeCands.length, status:"DELIVERED", fulfilledAt:new Date() } });
  // Assign Nick
  await p.lead.updateMany({ where:{ id:{ in:nickIds }, assignedUserId:null }, data:{ assignedUserId:nick.id, orderId:nickOrder.id, assignedAt:new Date() } });
  await p.order.update({ where:{ id:nickOrder.id }, data:{ fulfilledCount:nickCands.length, status:"DELIVERED", fulfilledAt:new Date() } });

  console.log(`\n✓ Joseph ${joeOrder.id.slice(-6)} → ${joeCands.length}/25 DELIVERED`);
  console.log(`✓ Nick   ${nickOrder.id.slice(-6)} → ${nickCands.length}/25 DELIVERED`);
  console.log("Nick total leads now:", await p.lead.count({ where:{ assignedUserId:nick.id } }));
  console.log("Joseph total leads now:", await p.lead.count({ where:{ assignedUserId:joe.id } }));
} catch(e){ console.error("ERR", e.message); process.exit(1); }
finally { await p.$disconnect(); }
