#!/usr/bin/env node
/**
 * One-off / reusable lead-delivery sender.
 *
 * Sends a branded Advertisely "your leads are ready" email to a client with
 * the leads CSV attached, via the Resend REST API.
 *
 * Reads RESEND_API_KEY (and optional EMAIL_FROM) from .env.local / .env in the
 * project root. It does NOT hard-code any secret.
 *
 * Usage:
 *   node scripts/send-delivery.mjs \
 *     --to nicholasf@cfnsfl.com \
 *     --name Nick \
 *     --subject "Your 25 Blue-Collar IUL leads are ready, Nick" \
 *     --html /abs/path/email_preview.html \
 *     --csv  /abs/path/Advertisely_Leads_ClientReady_2026-07-23.csv \
 *     --attachname Advertisely_Leads_ClientReady_2026-07-23.csv
 *
 * Add --send to actually send. Without it, the script does a dry run and
 * prints exactly what WOULD be sent (recipient, subject, from, attachment
 * size) so you can eyeball it first.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── tiny .env loader (no dependency) ─────────────────────────────────
function loadEnv(file) {
  try {
    const txt = readFileSync(resolve(ROOT, file), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env) || process.env[m[1]] === "") process.env[m[1]] = v;
    }
  } catch { /* file may not exist */ }
}
loadEnv(".env.local");
loadEnv(".env");

// ── args ─────────────────────────────────────────────────────────────
function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) return true; // flag
  return next;
}

const to = arg("to");
const name = arg("name", "there");
const subject = arg("subject", `Your leads are ready, ${name}`);
const htmlPath = arg("html");
const csvPath = arg("csv");
const attachName = arg("attachname", csvPath ? csvPath.split("/").pop() : "leads.csv");
const doSend = !!arg("send", false);

const FROM = process.env.EMAIL_FROM ?? "Advertisely <leads@advertisely.io>";
const KEY = process.env.RESEND_API_KEY;

function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

if (!to) fail("Missing --to <recipient email>");
if (!htmlPath) fail("Missing --html <path to email body html>");
if (!csvPath) fail("Missing --csv <path to attachment csv>");

const html = readFileSync(htmlPath, "utf8");
const csvBuf = readFileSync(csvPath);
const csvB64 = csvBuf.toString("base64");

console.log("──────────────────────────────────────────────");
console.log("  Advertisely lead delivery");
console.log("──────────────────────────────────────────────");
console.log("  From:       ", FROM);
console.log("  To:         ", to);
console.log("  Subject:    ", subject);
console.log("  Attachment: ", attachName, `(${(csvBuf.length / 1024).toFixed(1)} KB)`);
console.log("  HTML body:  ", `${(html.length / 1024).toFixed(1)} KB`);
console.log("  Resend key: ", KEY ? "present ✓" : "MISSING ✗");
console.log("──────────────────────────────────────────────");

if (!KEY) {
  fail("RESEND_API_KEY not found in .env.local or .env — add it, then re-run.");
}

if (!doSend) {
  console.log("\nDRY RUN — nothing sent. Re-run with --send to actually deliver.\n");
  process.exit(0);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: FROM,
    to: [to],
    subject,
    html,
    attachments: [{ filename: attachName, content: csvB64 }],
  }),
});

const text = await res.text();
if (!res.ok) {
  fail(`Resend returned ${res.status}: ${text}`);
}
console.log(`\n✓ Sent. Resend response: ${text}\n`);
