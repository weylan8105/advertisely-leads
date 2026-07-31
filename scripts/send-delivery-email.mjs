#!/usr/bin/env node
/**
 * Send the branded "your leads are ready" email to a client for their most
 * recent delivered order. Reads leads from the DB, sends via Resend using the
 * local RESEND_API_KEY. Footer signed "The Advertisely Team".
 *
 * Usage: node scripts/send-delivery-email.mjs --email <client> [--send]
 * Dry run by default; --send actually delivers.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function le(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}catch{}}
le(".env.local"); le(".env");
function arg(n,d){const i=process.argv.indexOf(`--${n}`);if(i===-1)return d;const x=process.argv[i+1];if(x===undefined||x.startsWith("--"))return true;return x;}

const email = arg("email");
const doSend = !!arg("send", false);
if(!email){console.error("Need --email");process.exit(1);}
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? "Advertisely <leads@advertisely.io>";

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({ where:{ email:{ equals:email, mode:"insensitive" } } });
  if(!user) throw new Error(`No user for ${email}`);
  const order = await prisma.order.findFirst({ where:{ userId:user.id, status:"DELIVERED" }, orderBy:{ fulfilledAt:"desc" } });
  if(!order) throw new Error(`No delivered order for ${email}`);
  const leadCount = await prisma.lead.count({ where:{ orderId:order.id } });
  const first = user.name?.split(" ")[0] || "there";
  const pkgName = "Blue-Collar IUL Leads";
  const subject = `🎯 ${leadCount} ${pkgName} — ready in your dashboard`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
<tr><td style="background:#dc2626;padding:24px 32px;"><div style="color:#fff;font-size:20px;font-weight:700;">Advertisely</div><div style="color:#fca5a5;font-size:13px;margin-top:2px;">Lead Delivery</div></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${leadCount} leads are ready, ${first}</p>
<p style="margin:0 0 24px;font-size:15px;color:#64748b;">Your <strong>${pkgName}</strong> order has been delivered. All ${leadCount} leads are live in your dashboard now — states, contact info, and consent records included.</p>
<div style="text-align:center;margin-bottom:24px;"><a href="https://advertisely.io/leads" style="display:inline-block;background:#dc2626;color:#fff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">View your leads →</a></div>
<p style="margin:0 0 20px;font-size:13px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px;">Speed matters — the best agents contact new leads within 5 minutes. Don't let these go cold.</p>
<div style="border-top:1px solid #f1f5f9;padding-top:20px;">
<p style="margin:0 0 4px;font-size:14px;color:#475569;">To your success,</p>
<p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#0f172a;">The Advertisely Team</p>
<p style="margin:0;font-size:13px;color:#94a3b8;"><a href="https://advertisely.io" style="color:#94a3b8;text-decoration:none;">advertisely.io</a></p>
</div></td></tr></table></td></tr></table></body></html>`;

  console.log("From:", FROM, "\nTo:", user.email, "\nSubject:", subject, "\nLeads:", leadCount, "\nKey:", KEY?"present":"MISSING");
  if(!doSend){ console.log("\nDRY RUN — add --send to deliver."); process.exit(0); }
  if(!KEY) throw new Error("RESEND_API_KEY missing");
  const res = await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:FROM,to:[user.email],subject,html})});
  const t = await res.text();
  if(!res.ok) throw new Error(`Resend ${res.status}: ${t}`);
  console.log("\n✓ Sent. Resend:", t);
} catch(e){ console.error("ERROR:", e.message); process.exit(1); }
finally { await prisma.$disconnect(); }
