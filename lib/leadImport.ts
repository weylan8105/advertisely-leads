// Shared CSV → Lead mapping used by the admin "Import leads (CSV)" flow.
// Handles the GoHighLevel-style export columns we deliver against and
// normalizes messy data (state casing, money ranges, trade slugs).

const US_STATES: Record<string, string> = {
  alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",
  connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",
  illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",
  maine:"ME",maryland:"MD",massachusetts:"MA",michigan:"MI",minnesota:"MN",
  mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",
  pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA",
  "west virginia":"WV",wisconsin:"WI",wyoming:"WY",
};
const VALID_STATES = new Set(Object.values(US_STATES));

/** Normalize a state value to a 2-letter uppercase code. Returns {code, unknown}. */
export function normalizeState(raw: string): { code: string; unknown: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { code: "", unknown: false };
  if (VALID_STATES.has(s.toUpperCase())) return { code: s.toUpperCase(), unknown: false };
  if (US_STATES[s.toLowerCase()]) return { code: US_STATES[s.toLowerCase()], unknown: false };
  return { code: s, unknown: true };
}

/** RFC-ish CSV parser: handles quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0, field = "", row: string[] = [], inQ = false;
  text = text.replace(/^﻿/, "");
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function humanize(s: string): string {
  return (s ?? "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).trim();
}
function moneyLow(s: string): number | null {
  const m = (s ?? "").replace(/,/g, "").match(/\d+/g);
  return m ? parseInt(m[0], 10) : null;
}
function toDate(s: string): Date {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d : new Date();
}

export interface MappedLead {
  externalId: string | null;
  name: string;
  phone: string;
  email: string;
  state: string;
  income: number | null;
  occupation: string | null;
  intentReason: string | null;
  consentTime: Date;
  receivedAt: Date;
  rawFormData: Record<string, unknown>;
}

export interface MapResult {
  leads: MappedLead[];
  warnings: string[];
  unknownStateRows: number[];
}

/**
 * Map parsed CSV rows into lead records. Column matching is case-insensitive
 * and tolerant of the exact GHL export header set we've seen.
 */
export function mapCsvToLeads(rows: string[][]): MapResult {
  if (rows.length === 0) return { leads: [], warnings: ["Empty file"], unknownStateRows: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const data = rows.slice(1);
  const col = (...names: string[]) => {
    for (const n of names) {
      const idx = header.indexOf(n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const iId = col("contact id", "id", "external id");
  const iFn = col("first name", "firstname");
  const iLn = col("last name", "lastname");
  const iName = col("name", "full name");
  const iState = col("state");
  const iPhone = col("phone", "phone number");
  const iEmail = col("email", "email address");
  const iCreated = col("created", "created at", "date");
  const iTrade = col("trade", "occupation");
  const iAgeRange = col("age range");
  const iTimeline = col("retirement timeline");
  const iIncome = col("household income", "income");
  const iBudget = col("monthly budget", "budget");
  const iNote = col("last note", "note");

  const warnings: string[] = [];
  const unknownStateRows: number[] = [];
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const leads = data.map((r, idx) => {
    const name = iName >= 0
      ? get(r, iName)
      : `${get(r, iFn)} ${get(r, iLn)}`.trim();
    const st = normalizeState(get(r, iState));
    if (st.unknown && st.code) unknownStateRows.push(idx + 1);
    return {
      externalId: get(r, iId) || null,
      name,
      phone: get(r, iPhone),
      email: get(r, iEmail).toLowerCase(),
      state: st.code,
      income: moneyLow(get(r, iIncome)),
      occupation: humanize(get(r, iTrade)) || null,
      intentReason: get(r, iTimeline) ? `Retirement timeline: ${humanize(get(r, iTimeline))}` : null,
      consentTime: toDate(get(r, iCreated)),
      receivedAt: toDate(get(r, iCreated)),
      rawFormData: {
        contactId: get(r, iId), ageRange: get(r, iAgeRange), retirementTimeline: get(r, iTimeline),
        householdIncome: get(r, iIncome), monthlyBudget: get(r, iBudget), trade: get(r, iTrade),
        created: get(r, iCreated), lastNote: get(r, iNote),
      },
    };
  });

  // Basic validation warnings
  leads.forEach((l, i) => {
    if (!l.email || !l.email.includes("@")) warnings.push(`Row ${i + 1} (${l.name || "no name"}): missing/invalid email`);
    if (l.phone.replace(/\D/g, "").length < 10) warnings.push(`Row ${i + 1} (${l.name || "no name"}): phone looks short`);
  });

  return { leads, warnings, unknownStateRows };
}
