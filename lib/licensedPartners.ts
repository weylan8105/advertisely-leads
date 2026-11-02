import type { PrismaClient } from "@prisma/client";
import { US_STATES } from "@/data/states";

/**
 * Licensed Partners: the public list of licensed agents/agencies who receive
 * requests from our consumer funnels (ABCA + HWA). The funnels are run by
 * Advertisely Media LLC as a marketing company (publisher model), so the
 * licensed parties who may contact a consumer are listed here, built
 * automatically from agent profiles (Settings → profile & licensing).
 */

export const OPERATOR_NAME = "Advertisely Media LLC";
export const SUPPORT_EMAIL = "support@advertisely.io";

// Lead sources written by the funnels (ABCA quiz, HWA quiz).
export const FUNNEL_LEAD_SOURCES = ["early-retirement-quiz", "healthcare-wealth-quiz"];
// An agent stays listed this long after their last funnel lead.
export const PARTNER_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const LICENSE_FIELDS = [
  "licenseName",
  "licenseResidentState",
  "licenseNpn",
  "licenseCaNumber",
  "licenseTxNumber",
] as const;
export type LicenseField = (typeof LICENSE_FIELDS)[number];
export type LicenseData = Partial<Record<LicenseField, string | null>>;

const RESIDENT_STATES = new Set([...US_STATES, "DC"]);

/**
 * Validate + normalize the license fields from a profile update. Only keys
 * present in the body are returned; an empty value clears the field (null).
 */
export function cleanLicenseFields(body: Record<string, unknown>): { data: LicenseData; error?: string } {
  const data: LicenseData = {};
  const str = (k: LicenseField) => (typeof body[k] === "string" ? (body[k] as string).trim() : undefined);

  const name = str("licenseName");
  if (name !== undefined) {
    if (name.length > 120) return { data, error: "Licensed name must be 120 characters or fewer." };
    data.licenseName = name.replace(/\s+/g, " ") || null;
  }
  const state = str("licenseResidentState");
  if (state !== undefined) {
    const code = state.toUpperCase();
    if (code && !RESIDENT_STATES.has(code)) return { data, error: "Choose a valid resident state." };
    data.licenseResidentState = code || null;
  }
  const npn = str("licenseNpn");
  if (npn !== undefined) {
    const digits = npn.replace(/[\s-]/g, "");
    if (digits && !/^\d{1,10}$/.test(digits)) return { data, error: "NPN must be up to 10 digits." };
    data.licenseNpn = digits || null;
  }
  const ca = str("licenseCaNumber");
  if (ca !== undefined) {
    const v = ca.toUpperCase().replace(/[\s-]/g, "");
    if (v && !/^[0-9A-Z]{5,10}$/.test(v)) return { data, error: "California license # should be letters and digits, e.g. 0L12345." };
    data.licenseCaNumber = v || null;
  }
  const tx = str("licenseTxNumber");
  if (tx !== undefined) {
    const v = tx.toUpperCase().replace(/[\s-]/g, "");
    if (v && !/^[0-9A-Z]{4,12}$/.test(v)) return { data, error: "Texas license # should be letters and digits." };
    data.licenseTxNumber = v || null;
  }
  return { data };
}

export type LicensedPartner = {
  name: string;
  residentState: string;
  npn: string;
  caLicense: string | null;
  txLicense: string | null;
};

/**
 * Agents with a complete license profile (name + resident state + NPN) who
 * received a funnel lead in the last PARTNER_WINDOW_DAYS or have an order
 * being filled. Identical entries (same license, several logins) collapse.
 */
export async function listLicensedPartners(db: PrismaClient, now = new Date()): Promise<LicensedPartner[]> {
  const since = new Date(now.getTime() - PARTNER_WINDOW_DAYS * DAY_MS);
  const users = await db.user.findMany({
    where: {
      licenseName: { not: null },
      licenseResidentState: { not: null },
      licenseNpn: { not: null },
      OR: [
        { assignedLeads: { some: { source: { in: FUNNEL_LEAD_SOURCES }, receivedAt: { gte: since } } } },
        { orders: { some: { status: { in: ["PROCESSING", "DELIVERING"] } } } },
      ],
    },
    select: {
      licenseName: true,
      licenseResidentState: true,
      licenseNpn: true,
      licenseCaNumber: true,
      licenseTxNumber: true,
    },
    orderBy: { licenseName: "asc" },
  });

  const seen = new Set<string>();
  const partners: LicensedPartner[] = [];
  for (const u of users) {
    const p: LicensedPartner = {
      name: u.licenseName!,
      residentState: u.licenseResidentState!,
      npn: u.licenseNpn!,
      caLicense: u.licenseCaNumber,
      txLicense: u.licenseTxNumber,
    };
    const key = `${p.npn}|${p.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    partners.push(p);
  }
  return partners;
}

// ─── Public page ─────────────────────────────────────────────────────

export type PartnerSite = "abca" | "hwa";

const SITES: Record<PartnerSite, { name: string; l1: string; primary: string; home: string; privacy: string; terms: string }> = {
  abca: {
    name: "American Blue Collar Advantage",
    l1: "AMERICAN BLUE COLLAR",
    primary: "#B9411A",
    home: "https://www.americanbluecollaradvantage.com/",
    privacy: "https://www.americanbluecollaradvantage.com/privacy",
    terms: "https://www.americanbluecollaradvantage.com/terms",
  },
  hwa: {
    name: "Healthcare Wealth Advantage",
    l1: "HEALTHCARE WEALTH",
    primary: "#0E8A82",
    home: "/hwa-quiz.html",
    privacy: "/hwa-privacy.html",
    terms: "/hwa-terms.html",
  },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderLicensedPartnersPage(opts: { partners: LicensedPartner[]; site: PartnerSite; generatedAt: Date }): string {
  const site = SITES[opts.site];
  const updated = opts.generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
  const rows = opts.partners
    .map((p) => {
      const lic = [`Resident state: ${esc(p.residentState)}`, `NPN ${esc(p.npn)}`];
      if (p.caLicense) lic.push(`CA license #${esc(p.caLicense)}`);
      if (p.txLicense) lic.push(`TX license #${esc(p.txLicense)}`);
      return `<li class="pt"><div class="pn">${esc(p.name)}</div><div class="pl">${lic.join(" &middot; ")}</div></li>`;
    })
    .join("\n      ");
  const list = opts.partners.length
    ? `<ul class="plist">\n      ${rows}\n    </ul>`
    : `<p class="empty">Our partner agents' license details are being updated.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Licensed Partners | ${esc(site.name)}</title>
<meta name="description" content="Licensed insurance agents and agencies who may receive quote requests submitted through ${esc(site.name)}, operated by ${OPERATOR_NAME}.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap">
<style>
  :root{
    --navy:#101C2B; --navy-line:#28394E; --off:#F5F6F8; --card:#FFFFFF; --card-line:#E2E6EB;
    --primary:${site.primary}; --ink:#101C2B; --ink-2:#42505F; --ink-faint:#6B7788; --onnavy:#EDF1F5;
    --font-head:'Archivo',system-ui,-apple-system,Segoe UI,sans-serif;
    --font-body:'Barlow',system-ui,-apple-system,Segoe UI,sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--font-body);background:var(--off);color:var(--ink);-webkit-font-smoothing:antialiased;line-height:1.6}
  a{color:var(--primary)}
  header{background:var(--navy);border-bottom:1px solid var(--navy-line)}
  .wrap{max-width:820px;margin:0 auto;padding:0 20px}
  .hd{height:60px;display:flex;align-items:center}
  .brand{display:flex;flex-direction:column;line-height:1.04;text-decoration:none}
  .brand .l1{font-family:var(--font-head);font-weight:700;font-size:11.5px;letter-spacing:.11em;color:var(--onnavy)}
  .brand .l2{font-family:var(--font-head);font-weight:800;font-size:15px;color:var(--primary)}
  main{padding:32px 0 48px}
  .doc{background:var(--card);border:1px solid var(--card-line);border-radius:12px;padding:28px 24px}
  h1{font-family:var(--font-head);font-size:30px;line-height:1.15;letter-spacing:-.01em}
  .eff{margin-top:6px;color:var(--ink-faint);font-size:14px}
  p{color:var(--ink-2);font-size:15.5px;margin-top:12px}
  .plist{list-style:none;margin-top:20px;border-top:1px solid var(--card-line)}
  .pt{padding:12px 0;border-bottom:1px solid var(--card-line)}
  .pn{font-family:var(--font-head);font-weight:700;font-size:16px;color:var(--ink);overflow-wrap:anywhere}
  .pl{font-size:14px;color:var(--ink-2);margin-top:2px}
  .empty{margin-top:20px;padding:14px;border:1px dashed var(--card-line);border-radius:10px}
  footer{padding:0 0 40px;color:var(--ink-faint);font-size:13px;text-align:center}
  footer a{color:var(--ink-faint);margin:0 8px}
  @media (min-width:640px){ .doc{padding:40px 44px} }
</style>
</head>
<body>
<header><div class="wrap hd"><a class="brand" href="${site.home}"><span class="l1">${site.l1}</span><span class="l2">Advantage</span></a></div></header>
<main><div class="wrap"><article class="doc">
  <h1>Licensed Partners</h1>
  <p class="eff">Updated ${esc(updated)}</p>
  <p>${esc(site.name)} is operated by ${OPERATOR_NAME}, a marketing company. Advertisely is not an insurance company, agency, or producer and does not sell insurance. When you request a quote, your information may be shared with Enhanced Wealth and the licensed insurance agents and agencies listed below, who may contact you about your request.</p>
  <p>This list updates automatically as partners join or stop receiving requests. Each partner is shown with the name, resident state, and National Producer Number (NPN) on their insurance license, plus their California and Texas license numbers where they hold them.</p>
    ${list}
  <p>To find out which licensed agent received your request, or with any other question, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</article></div></main>
<footer><a href="${site.home}">Home</a>·<a href="${site.privacy}">Privacy Policy</a>·<a href="${site.terms}">Terms of Use</a></footer>
</body>
</html>
`;
}
