#!/usr/bin/env node
/**
 * Fulfill a client's order from existing DB pool inventory (not a CSV).
 * Selects the NEWEST unassigned leads from --from-package that match the
 * order's requested states, assigns them to the order, retags them to the
 * order's package, and marks the order delivered.
 *
 * Usage:
 *   node scripts/fulfill-from-pool.mjs --email <client> --from-package aged-iul [--count N] [--commit]
 * Dry run by default; --commit performs the writes.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function le(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}catch{}}
le(".env.local"); le(".env");
function arg(n,d){const i=process.argv.indexOf(`--${n}`);if(i===-1)return d;const x=process.argv[i+1];if(x===undefined||x.startsWith("--"))return true;return x;}

const email = arg("email");
const fromPackage = arg("from-package","aged-iul");
const commit = !!arg("commit",false);
if(!email){console.error("Need --email");process.exit(1);}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({ where:{ email:{ equals:email, mode:"insensitive" } } });
  if(!user) throw new Error(`No user for ${email}`);
  // Most recent order that still needs leads.
  const order = await prisma.order.findFirst({
    where:{ userId:user.id, status:{ in:["PENDING","PROCESSING","DELIVERING"] } },
    orderBy:{ createdAt:"desc" },
  });
  if(!order) throw new Error(`No open order for ${email}`);
  const need = order.quantity - order.fulfilledCount;
  const count = arg("count", need) === true ? need : parseInt(arg("count", need),10);

  const stateFilter = order.filterStates.length ? { state:{ in: order.filterStates } } : {};
  const candidates = await prisma.lead.findMany({
    where:{ assignedUserId:null, orderId:null, packageId:fromPackage, ...stateFilter },
    orderBy:{ receivedAt:"desc" }, // NEWEST first
    take: count,
  });

  console.log(`Client: ${user.name} (${user.email})`);
  console.log(`Order:  ${order.id}  pkg=${order.packageId}  qty=${order.quantity}  need=${need}  states=[${order.filterStates.join(",")||"ANY"}]`);
  console.log(`Pulling newest ${count} from '${fromPackage}' matching those states → retag to '${order.packageId}'`);
  const dist={}; for(const c of candidates) dist[c.state]=(dist[c.state]||0)+1;
  console.log(`Selected ${candidates.length} leads. States:`, dist);
  console.log(`Newest: ${candidates[0]?.receivedAt?.toISOString?.().slice(0,10)}  Oldest of the 25: ${candidates[candidates.length-1]?.receivedAt?.toISOString?.().slice(0,10)}`);
  if(candidates.length < count) console.log(`⚠ Only ${candidates.length} available in those states (need ${count}).`);

  if(!commit){ console.log(`\nDRY RUN — nothing written. Add --commit to assign.`); process.exit(0); }

  const ids = candidates.map(c=>c.id);
  await prisma.$transaction(async(tx)=>{
    await tx.lead.updateMany({
      where:{ id:{ in:ids }, assignedUserId:null },
      data:{ assignedUserId:user.id, assignedAt:new Date(), orderId:order.id, packageId:order.packageId },
    });
    await tx.leadActivity.createMany({ data: ids.map(id=>({ leadId:id, type:"LEAD_ASSIGNED", body:`Assigned to ${user.name} via order ${order.id} (from ${fromPackage} pool).` })) });
    const fulfilled = order.fulfilledCount + candidates.length;
    await tx.order.update({ where:{ id:order.id }, data:{ fulfilledCount:fulfilled, status: fulfilled>=order.quantity?"DELIVERED":"DELIVERING", fulfilledAt: fulfilled>=order.quantity?new Date():null } });
  });

  const remainAged = await prisma.lead.count({ where:{ assignedUserId:null, packageId:fromPackage } });
  console.log(`\n✓ Assigned ${candidates.length} to ${user.name}. Order → ${order.fulfilledCount+candidates.length}/${order.quantity} DELIVERED.`);
  console.log(`✓ Remaining '${fromPackage}' pool: ${remainAged}`);
} catch(e){ console.error("ERROR:", e.message); process.exit(1); }
finally { await prisma.$disconnect(); }
