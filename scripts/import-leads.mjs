#!/usr/bin/env node
/**
 * Import a client-ready CSV of leads, assign them to a specific user + order,
 * and mark the order delivered. Idempotent: upserts on externalId (Contact Id),
 * so re-running won't create duplicates.
 *
 * Usage:
 *   node scripts/import-leads.mjs --csv <path> --email <client email> [--send] [--commit]
 *
 * Without --commit it does a DRY RUN (parses, maps, reports — writes nothing).
 * --send additionally fires the delivery email via fulfillment's notifier
 *   (off by default; we already emailed Nick, so leave it off).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!(m[1]in process.env)||process.env[m[1]]==="")process.env[m[1]]=v;}}catch{}}
loadEnv(".env.local"); loadEnv(".env");

function arg(name, def){const i=process.argv.indexOf(`--${name}`);if(i===-1)return def;const n=process.argv[i+1];if(n===undefined||n.startsWith("--"))return true;return n;}
const csvPath = arg("csv");
const email = arg("email");
const commit = !!arg("commit", false);
if (!csvPath || !email) { console.error("Need --csv and --email"); process.exit(1); }

// ── minimal CSV parser (handles quoted fields w/ commas) ─────────────
function parseCSV(text){
  const rows=[]; let i=0,f="",row=[],q=false;
  text=text.replace(/^﻿/,"");
  while(i<text.length){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i+=2;continue;} q=false;i++;continue;} f+=c;i++;continue;}
    if(c==='"'){q=true;i++;continue;}
    if(c===','){row.push(f);f="";i++;continue;}
    if(c==='\r'){i++;continue;}
    if(c==='\n'){row.push(f);rows.push(row);row=[];f="";i++;continue;}
    f+=c;i++;
  }
  if(f.length||row.length){row.push(f);rows.push(row);}
  return rows.filter(r=>r.some(c=>c.trim()!==""));
}

const raw = parseCSV(readFileSync(csvPath,"utf8"));
const hdr = raw[0]; const data = raw.slice(1);
const col = (name)=>hdr.indexOf(name);
const iId=col("Contact Id"), iFn=col("First Name"), iLn=col("Last Name"),
  iState=col("State"), iPhone=col("Phone"), iEmail=col("Email"),
  iCreated=col("Created"), iTrade=col("Trade"), iAgeRange=col("Age Range"),
  iTimeline=col("Retirement Timeline"), iIncome=col("Household Income"),
  iBudget=col("Monthly Budget"), iNote=col("Last Note");

function humanize(s){return (s||"").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase()).trim();}
function moneyLow(s){const m=(s||"").replace(/,/g,"").match(/\d+/g);return m?parseInt(m[0],10):null;}
function toDate(s){const d=s?new Date(s):null;return d&&!isNaN(d)?d:new Date();}

// Package + source context for this batch (blue-collar IUL Meta campaign)
const PACKAGE_ID = "blue-collar-iul";
const SOURCE = "Meta - Blue Collar ER";
const CAMPAIGN = "Blue Collar ER - Updated Messaging";

const mapped = data.map(r=>{
  const name = `${(r[iFn]||"").trim()} ${(r[iLn]||"").trim()}`.trim();
  return {
    externalId: (r[iId]||"").trim() || null,
    name, phone: (r[iPhone]||"").trim(), email: (r[iEmail]||"").trim().toLowerCase(),
    state: (r[iState]||"").trim(),
    income: moneyLow(r[iIncome]),
    occupation: humanize(r[iTrade]) || null,
    intentReason: r[iTimeline] ? `Retirement timeline: ${humanize(r[iTimeline])}` : null,
    packageId: PACKAGE_ID, source: SOURCE, campaignName: CAMPAIGN,
    consentTime: toDate(r[iCreated]), receivedAt: toDate(r[iCreated]),
    rawFormData: {
      contactId: r[iId], ageRange: r[iAgeRange], retirementTimeline: r[iTimeline],
      householdIncome: r[iIncome], monthlyBudget: r[iBudget], trade: r[iTrade],
      created: r[iCreated], lastNote: r[iNote],
    },
  };
});

console.log(`Parsed ${mapped.length} leads from ${csvPath.split("/").pop()}`);
console.log("Sample:", JSON.stringify({...mapped[0], rawFormData:"…"}, null, 2));

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({ where:{ email:{ equals:email, mode:"insensitive" } } });
  if (!user) throw new Error(`No user for ${email}`);
  const order = await prisma.order.findFirst({
    where:{ userId:user.id, packageId:PACKAGE_ID }, orderBy:{ createdAt:"desc" },
  });
  if (!order) throw new Error(`No ${PACKAGE_ID} order for ${email}`);
  console.log(`\nTarget → user ${user.name} (${user.id})`);
  console.log(`Target → order ${order.id} qty=${order.quantity} fulfilled=${order.fulfilledCount} status=${order.status}`);

  if (!commit) {
    console.log(`\nDRY RUN — nothing written. Re-run with --commit to import all ${mapped.length}.`);
    process.exit(0);
  }

  let created=0, updated=0;
  for (const m of mapped) {
    const base = {
      name:m.name, phone:m.phone, email:m.email, state:m.state,
      income:m.income, occupation:m.occupation, intentReason:m.intentReason,
      packageId:m.packageId, source:m.source, campaignName:m.campaignName,
      consentMethod:"TCPA_WEB_FORM", consentTime:m.consentTime, receivedAt:m.receivedAt,
      rawFormData:m.rawFormData, status:"NEW",
      assignedUserId:user.id, assignedAt:new Date(), orderId:order.id,
    };
    if (m.externalId) {
      const existed = await prisma.lead.findUnique({ where:{ externalId:m.externalId } });
      await prisma.lead.upsert({
        where:{ externalId:m.externalId },
        update:{ assignedUserId:user.id, assignedAt:new Date(), orderId:order.id },
        create:{ externalId:m.externalId, ...base },
      });
      existed ? updated++ : created++;
    } else {
      await prisma.lead.create({ data: base }); created++;
    }
  }

  const assignedCount = await prisma.lead.count({ where:{ orderId:order.id } });
  await prisma.order.update({
    where:{ id:order.id },
    data:{ fulfilledCount:assignedCount, status: assignedCount>=order.quantity?"DELIVERED":"DELIVERING", fulfilledAt: assignedCount>=order.quantity?new Date():null },
  });

  console.log(`\n✓ Imported. created:${created} updated:${updated}`);
  console.log(`✓ Order ${order.id} → fulfilled ${assignedCount}/${order.quantity}, status ${assignedCount>=order.quantity?"DELIVERED":"DELIVERING"}`);
} catch(e){
  console.error("IMPORT ERROR:", e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
