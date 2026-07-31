#!/usr/bin/env node
/**
 * Bulk-import raw Meta lead-form CSV exports into the DB as an UNASSIGNED pool.
 * New orders auto-fulfill from this pool (matched by package + state).
 *
 * Handles: UTF-16, tab-delimited, `p:` phone prefix, messy states, income ranges.
 * Dedupes: within the batch (email/phone) AND against existing DB leads, so
 * already-delivered leads (e.g. Nick's 25) are never re-added.
 *
 * Usage:
 *   node scripts/import-pool.mjs --dir <folder of CSVs> [--package blue-collar-iul] [--commit]
 * Dry run (default) writes nothing; --commit performs the insert.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(f){try{for(const l of readFileSync(resolve(ROOT,f),"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!(m[1]in process.env)||process.env[m[1]]==="")process.env[m[1]]=v;}}catch{}}
loadEnv(".env.local"); loadEnv(".env");

function arg(n,d){const i=process.argv.indexOf(`--${n}`);if(i===-1)return d;const x=process.argv[i+1];if(x===undefined||x.startsWith("--"))return true;return x;}
const dir = arg("dir");
const PACKAGE_ID = arg("package","blue-collar-iul");
const commit = !!arg("commit",false);
if(!dir){console.error("Need --dir <folder of CSVs>");process.exit(1);}

// ── state normalization ──────────────────────────────────────────────
const STATES={alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",maine:"ME",maryland:"MD",massachusetts:"MA",michigan:"MI",minnesota:"MN",mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA","west virginia":"WV",wisconsin:"WI",wyoming:"WY"};
const VALID=new Set(Object.values(STATES));
function normState(s){s=(s||"").trim();if(!s)return{code:"",unknown:false};if(VALID.has(s.toUpperCase()))return{code:s.toUpperCase(),unknown:false};if(STATES[s.toLowerCase()])return{code:STATES[s.toLowerCase()],unknown:false};return{code:s,unknown:true};}
function humanize(s){return (s||"").replace(/_/g," ").replace(/\s*\/\s*/g," / ").replace(/\b\w/g,m=>m.toUpperCase()).trim();}
function moneyLow(s){const m=(s||"").replace(/,/g,"").match(/\d+/g);return m?parseInt(m[0],10):null;}
function digits(s){return (s||"").replace(/\D/g,"");}
function last10(s){const d=digits(s);return d.slice(-10);}
function cleanPhone(s){return (s||"").replace(/^p:/i,"").trim();}
function toDate(s){const d=s?new Date(s):null;return d&&!isNaN(d)?d:new Date();}

// ── read all CSVs (UTF-16, tab-delimited) ────────────────────────────
function walk(d){let out=[];for(const e of readdirSync(d)){const p=join(d,e);const st=statSync(p);if(st.isDirectory())out=out.concat(walk(p));else if(e.toLowerCase().endsWith(".csv"))out.push(p);}return out;}
// Strip Meta's wrapping quotes from a tab-delimited cell (handles "" escapes).
function unq(s){let t=(s??"").trim();while(t.length>=2&&t[0]==='"'&&t[t.length-1]==='"'){t=t.slice(1,-1).replace(/""/g,'"');}return t;}
function parseTab(text){return text.split(/\r?\n/).filter(l=>l.trim()!=="").map(l=>l.split("\t").map(unq));}
function readCsv(f){const raw=readFileSync(f);for(const enc of ["utf-16le","utf-8"]){try{let t=raw.toString(enc);if(t.charCodeAt(0)===0xFEFF)t=t.slice(1);const rows=parseTab(t);if(rows.length&&rows[0].length>3)return rows;}catch{}}return[];}

const files=walk(resolve(dir));
let header=null; const raw=[];
for(const f of files){const rows=readCsv(f);if(!rows.length)continue;if(!header)header=rows[0];for(const r of rows.slice(1))raw.push(r);}
const idx={};header.forEach((h,i)=>idx[h.trim()]=i);
const G=(r,c)=>{const i=idx[c];return i>=0&&i<r.length?(r[i]||"").trim():"";};

const COL={id:"id",created:"created_time",name:"full_name",email:"email",phone:"phone_number",altphone:"user_provided_phone_number",state:"state",trade:"what_trade_do_you_work_in?",age:"_what's_your_age_range?",retire:"when_would_you_ideally_like_to_retire?",income:"what's_your_current_household_income?",budget:"how_much_could_you_comfortably_put_towards_building_your_tax-free_retirement_each_month?",form:"form_name",campaign:"campaign_name",adname:"ad_name",adid:"ad_id",adset:"adset_id"};

// ── map + intra-batch dedupe ─────────────────────────────────────────
const seenEmail=new Set(), seenPhone=new Set();
let intraDupes=0, unknownStates=0;
const mapped=[];
for(const r of raw){
  const email=G(r,COL.email).toLowerCase();
  const phone=cleanPhone(G(r,COL.phone)||G(r,COL.altphone));
  const p10=last10(phone);
  if((email&&seenEmail.has(email))||(p10&&seenPhone.has(p10))){intraDupes++;continue;}
  if(email)seenEmail.add(email); if(p10)seenPhone.add(p10);
  const st=normState(G(r,COL.state));
  if(st.unknown&&st.code)unknownStates++;
  mapped.push({
    externalId:G(r,COL.id)||null,
    name:G(r,COL.name), email, phone, p10,
    state:st.code,
    income:moneyLow(G(r,COL.income)),
    occupation:humanize(G(r,COL.trade))||null,
    intentReason:G(r,COL.retire)?`Retirement timeline: ${humanize(G(r,COL.retire))}`:null,
    packageId:PACKAGE_ID,
    source:`Meta - ${G(r,COL.form)||"Lead Form"}`,
    campaignName:G(r,COL.campaign)||null,
    adsetId:G(r,COL.adset)||null, creativeId:G(r,COL.adid)||null,
    consentTime:toDate(G(r,COL.created)), receivedAt:toDate(G(r,COL.created)),
    rawFormData:{ ageRange:G(r,COL.age), retirementTimeline:G(r,COL.retire), householdIncome:G(r,COL.income), monthlyBudget:G(r,COL.budget), trade:G(r,COL.trade), adName:G(r,COL.adname), created:G(r,COL.created) },
  });
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  // Existing DB leads → dedupe so we never re-add already-present people.
  const existing = await prisma.lead.findMany({ select:{ email:true, phone:true, externalId:true } });
  const exEmail=new Set(existing.map(l=>(l.email||"").toLowerCase()).filter(Boolean));
  const exPhone=new Set(existing.map(l=>last10(l.phone)).filter(Boolean));
  const exExt=new Set(existing.map(l=>l.externalId).filter(Boolean));

  const fresh=[]; let skipExisting=0;
  for(const m of mapped){
    if((m.email&&exEmail.has(m.email))||(m.p10&&exPhone.has(m.p10))||(m.externalId&&exExt.has(m.externalId))){skipExisting++;continue;}
    fresh.push(m);
  }

  const stateDist={};
  for(const m of fresh)stateDist[m.state||"?"]=(stateDist[m.state||"?"]||0)+1;

  console.log(`Files: ${files.length}   Raw rows: ${raw.length}`);
  console.log(`Intra-batch dupes removed: ${intraDupes}`);
  console.log(`Already in DB (skipped — includes Nick's delivered leads): ${skipExisting}`);
  console.log(`Unknown/unmatched states: ${unknownStates}`);
  console.log(`\n➡  NEW pool leads to stage: ${fresh.length}   (package: ${PACKAGE_ID})`);
  console.log(`State distribution:`, Object.fromEntries(Object.entries(stateDist).sort((a,b)=>b[1]-a[1])));

  if(!commit){ console.log(`\nDRY RUN — nothing written. Re-run with --commit to load the pool.`); process.exit(0); }

  let created=0;
  for(const m of fresh){
    const data={ name:m.name, phone:m.phone, email:m.email, state:m.state, income:m.income, occupation:m.occupation, intentReason:m.intentReason, packageId:m.packageId, source:m.source, campaignName:m.campaignName, adsetId:m.adsetId, creativeId:m.creativeId, consentMethod:"TCPA_WEB_FORM", consentTime:m.consentTime, receivedAt:m.receivedAt, rawFormData:m.rawFormData, status:"NEW", assignedUserId:null, orderId:null };
    if(m.externalId){ await prisma.lead.upsert({ where:{externalId:m.externalId}, update:{}, create:{ externalId:m.externalId, ...data } }); }
    else { await prisma.lead.create({ data }); }
    created++;
  }
  const poolCount = await prisma.lead.count({ where:{ assignedUserId:null, packageId:PACKAGE_ID } });
  console.log(`\n✓ Loaded. Created ${created} pool leads. Unassigned ${PACKAGE_ID} inventory now: ${poolCount}`);
} catch(e){ console.error("POOL IMPORT ERROR:", e.message); process.exit(1); }
finally { await prisma.$disconnect(); }
