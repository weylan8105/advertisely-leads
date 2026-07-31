#!/usr/bin/env node
/**
 * Build a DRAFT branded delivery email (with the client's leads listed inline)
 * + a client-ready CSV — WITHOUT sending. Writes HTML preview + CSV to --out.
 *
 * ── CANONICAL DELIVERY EMAIL TEMPLATE ──────────────────────────────────
 * This layout is the standard for EVERY delivery email and must not change:
 *   1. Red "Advertisely / Lead Delivery" header
 *   2. Intro line: "Here's your <Package> order — <N> verified, consent-
 *      captured leads across <S> states. They're listed below for a quick
 *      look, and attached as a CSV to import straight into your dialer or CRM."
 *   3. Three stat boxes: Leads delivered | States covered | Delivered <date>
 *   4. State-count chips row (e.g. "CA 7 · FL 5 · …")
 *   5. Table: # · Name · State · Phone · Email · Trade · Timeline · Income
 *   6. Footer signed "The Advertisely Team"
 * Keep lib/email.ts sendLeadDeliveryEmail in sync with this.
 *
 * Usage: node scripts/build-delivery-preview.mjs --email <client> --out <dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function le(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}catch{}}
le(".env.local"); le(".env");
function arg(n,d){const i=process.argv.indexOf(`--${n}`);if(i===-1)return d;const x=process.argv[i+1];if(x===undefined||x.startsWith("--"))return true;return x;}
const email = arg("email"); const outDir = arg("out");
if(!email||!outDir){console.error("Need --email and --out");process.exit(1);}
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const hum=s=>String(s??"").replace(/_/g," ").replace(/\s*\/\s*/g," / ").replace(/\b\w/g,m=>m.toUpperCase()).trim();
const money=s=>String(s??"").replace(/_/g," ").trim();

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({ where:{ email:{ equals:email, mode:"insensitive" } } });
  if(!user) throw new Error(`No user for ${email}`);
  const order = await prisma.order.findFirst({ where:{ userId:user.id, status:"DELIVERED" }, orderBy:{ fulfilledAt:"desc" } });
  if(!order) throw new Error(`No delivered order for ${email}`);
  const leads = await prisma.lead.findMany({ where:{ orderId:order.id }, orderBy:{ receivedAt:"desc" } });
  const first = user.name?.split(" ")[0] || "there";
  const pkgName = "Blue-Collar IUL Leads";
  const states = [...new Set(leads.map(l=>l.state))].sort();
  const delivered = order.fulfilledAt ? new Date(order.fulfilledAt) : new Date();
  const deliveredStr = delivered.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  const counts={}; for(const l of leads) counts[l.state]=(counts[l.state]||0)+1;
  const chips = Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0])).map(([s,n])=>`<span style="color:#0f172a;font-weight:600;">${esc(s)}</span> <span style="color:#94a3b8;">${n}</span>`).join(' <span style="color:#cbd5e1;">·</span> ');

  const box=(label,val)=>`<td style="width:33.3%;padding:0 6px;vertical-align:top;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">${label}</div><div style="font-size:22px;font-weight:700;color:#dc2626;margin-top:6px;">${val}</div></div></td>`;

  const rows = leads.map((l,i)=>{
    const rf=l.rawFormData||{};
    return `<tr style="border-bottom:1px solid #eef2f7;">
<td style="padding:8px 10px;font-size:12px;color:#94a3b8;">${i+1}</td>
<td style="padding:8px 10px;font-size:13px;font-weight:600;color:#0f172a;">${esc(l.name)}</td>
<td style="padding:8px 10px;font-size:12px;"><span style="background:#f1f5f9;border-radius:4px;padding:2px 6px;">${esc(l.state)}</span></td>
<td style="padding:8px 10px;font-size:12px;color:#0f172a;white-space:nowrap;">${esc(l.phone)}</td>
<td style="padding:8px 10px;font-size:12px;color:#0f172a;">${esc(l.email)}</td>
<td style="padding:8px 10px;font-size:12px;color:#475569;">${esc(l.occupation||hum(rf.trade))}</td>
<td style="padding:8px 10px;font-size:12px;color:#475569;">${esc(hum(rf.retirementTimeline))}</td>
<td style="padding:8px 10px;font-size:12px;color:#475569;white-space:nowrap;">${esc(money(rf.householdIncome))}</td></tr>`;
  }).join("");

  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 12px;"><tr><td align="center">
<table width="760" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
<tr><td style="background:#dc2626;padding:24px 32px;"><div style="color:#fff;font-size:20px;font-weight:700;">Advertisely</div><div style="color:#fca5a5;font-size:13px;margin-top:2px;">Lead Delivery</div></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 10px;font-size:24px;font-weight:700;color:#0f172a;">Your ${leads.length} leads are ready, ${esc(first)}</p>
<p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">Here's your <strong>${pkgName}</strong> order — <strong>${leads.length}</strong> verified, consent-captured leads across ${states.length} states. Download them below or import the attached CSV straight into your dialer or CRM.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px 18px;"><tr>${box("Leads delivered",leads.length)}${box("States covered",states.length)}${box("Delivered",deliveredStr)}</tr></table>
<p style="margin:0 0 22px;font-size:13px;line-height:1.9;">${chips}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">
<thead><tr style="background:#0f172a;text-align:left;">
${["#","Name","State","Phone","Email","Trade","Timeline","Income"].map(h=>`<th style="padding:10px;font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.03em;">${h}</th>`).join("")}
</tr></thead><tbody>${rows}</tbody></table>
<div style="text-align:center;margin:24px 0 4px;"><a href="https://advertisely.io/api/exports/csv" style="display:inline-block;background:#dc2626;color:#fff;font-size:15px;font-weight:600;padding:14px 34px;border-radius:8px;text-decoration:none;">⬇&nbsp;&nbsp;Download your leads (CSV)</a></div>
<p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">The CSV is also attached to this email. Full details (consent timestamps, source, etc.) are in your dashboard. Speed matters — top agents call within 5 minutes.</p>
<div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:20px;">
<p style="margin:0 0 4px;font-size:14px;color:#475569;">To your success,</p>
<p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#0f172a;">The Advertisely Team</p>
<p style="margin:0;font-size:13px;color:#94a3b8;"><a href="https://advertisely.io" style="color:#94a3b8;text-decoration:none;">advertisely.io</a></p>
</div></td></tr></table></td></tr></table></body></html>`;

  const cols=["Name","State","Phone","Email","Trade","Retirement Timeline","Household Income","Monthly Budget","Consent Time"];
  const ce=v=>{const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const csv=[cols.join(",")].concat(leads.map(l=>{const rf=l.rawFormData||{};return [l.name,l.state,l.phone,l.email,l.occupation||hum(rf.trade),hum(rf.retirementTimeline),money(rf.householdIncome),money(rf.monthlyBudget),l.consentTime?.toISOString?.()||""].map(ce).join(",");})).join("\r\n");

  const safe=user.email.replace(/[^a-zA-Z0-9._-]/g,"_");
  writeFileSync(`${outDir}/RJ_delivery_preview.html`,html);
  writeFileSync(`${outDir}/Advertisely_Leads_${safe}.csv`,csv);
  console.log("Client:",user.name,`(${user.email})`);
  console.log("Leads:",leads.length,"| States:",states.length,"|",states.join(", "),"| Delivered:",deliveredStr);
  console.log("HTML:",`${outDir}/RJ_delivery_preview.html`);
} catch(e){ console.error("ERROR:",e.message); process.exit(1); }
finally { await prisma.$disconnect(); }
