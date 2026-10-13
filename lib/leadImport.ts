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

// Common colloquial / newspaper abbreviations and short forms that aren't the
// full name and aren't the 2-letter code (so the exact matches miss them).
// Facebook lead forms produce these constantly (free-text state field).
const STATE_ABBREV: Record<string, string> = {
  ca: "CA", cal: "CA", cali: "CA", calif: "CA",
  fl: "FL", fla: "FL", flo: "FL",
  mass: "MA",
  penn: "PA", penna: "PA",
  conn: "CT",
  tenn: "TN", tennvia: "TN",
  ariz: "AZ",
  colo: "CO",
  wash: "WA",
  wis: "WI", wisc: "WI",
  mich: "MI",
  minn: "MN",
  nev: "NV",
  okla: "OK",
  ore: "OR", oreg: "OR",
  kan: "KS", kans: "KS",
  neb: "NE", nebr: "NE",
  dela: "DE",
  mont: "MT",
  wyo: "WY",
  wva: "WV", wvirginia: "WV",
};

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Normalize a state value to a 2-letter uppercase code. Returns {code, unknown}.
 *
 * Facebook instant-form state fields are free text and arrive messy: full names
 * ("California"), codes ("CA"), abbreviations ("Calif.", "Fla"), city+state
 * ("Dallas, TX" / "DALLAS:TX"), and typos ("Florids"). Everything that resolves
 * to a real state is coerced to its code so coverage/round-robin matching works
 * and the lead doesn't leak to the house on a formatting mismatch. Anything we
 * genuinely can't resolve is returned unchanged with unknown=true.
 */
export function normalizeState(raw: string): { code: string; unknown: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { code: "", unknown: false };

  // 1. Exact 2-letter code / exact full name.
  if (VALID_STATES.has(s.toUpperCase())) return { code: s.toUpperCase(), unknown: false };
  if (US_STATES[s.toLowerCase()]) return { code: US_STATES[s.toLowerCase()], unknown: false };

  const letters = s.toLowerCase().replace(/[^a-z]/g, "");

  // 2. Punctuated 2-letter code ("N.Y." → NY) and known abbreviations.
  if (letters.length === 2 && VALID_STATES.has(letters.toUpperCase())) {
    return { code: letters.toUpperCase(), unknown: false };
  }
  if (STATE_ABBREV[letters]) return { code: STATE_ABBREV[letters], unknown: false };

  // 3. Embedded standalone 2-letter code ("Dallas, TX", "DALLAS:TX", "TX - Texas").
  //    Only when exactly one distinct valid code appears (avoids ambiguity).
  const tokens = (s.toUpperCase().match(/\b[A-Z]{2}\b/g) ?? []).filter((t) => VALID_STATES.has(t));
  const distinctTokens = [...new Set(tokens)];
  if (distinctTokens.length === 1) return { code: distinctTokens[0], unknown: false };

  // 4. Unique full-name prefix ("Calif" → California, "Penn" → Pennsylvania).
  if (letters.length >= 4) {
    const pref = Object.keys(US_STATES).filter((name) => name.replace(/\s/g, "").startsWith(letters));
    const prefCodes = [...new Set(pref.map((name) => US_STATES[name]))];
    if (prefCodes.length === 1) return { code: prefCodes[0], unknown: false };
  }

  // 5. Fuzzy full-name match for typos ("Florids" → Florida). Unique best only.
  if (letters.length >= 3) {
    let best: { code: string; dist: number } | null = null;
    let tie = false;
    for (const [name, code] of Object.entries(US_STATES)) {
      const d = levenshtein(letters, name.replace(/\s/g, ""));
      const limit = name.length >= 8 ? 2 : 1;
      if (d <= limit) {
        if (!best || d < best.dist) { best = { code, dist: d }; tie = false; }
        else if (d === best.dist && code !== best.code) tie = true;
      }
    }
    if (best && !tie) return { code: best.code, unknown: false };
  }

  // 6. Exactly one full state name appears as a word ("State of California").
  const named = [...new Set(
    Object.keys(US_STATES)
      .filter((name) => new RegExp(`\\b${name}\\b`, "i").test(s))
      .map((name) => US_STATES[name]),
  )];
  if (named.length === 1) return { code: named[0], unknown: false };

  return { code: s, unknown: true };
}

// Real US places that are never a sellable/orderable state in our system (no
// order or license covers them) but ARE legitimate locations — a lead here is
// a real person we just have no buyer for, not garbage data.
const US_TERRITORIES = new Set(["DC", "PR", "VI", "GU", "AS", "MP"]);
const TERRITORY_NAME_RE =
  /\b(district of columbia|washington dc|puerto rico|virgin islands|guam|american samoa|northern mariana)\b/i;

/**
 * Does this raw state value name a REAL US location (a 50-state or a US
 * territory / DC), even if we can't sell it? Used by fulfillment to tell a
 * "recognized state we just have no buyer for" (legit overflow) apart from a
 * "trash lead" with a garbage state field. Recognized overflow costs the house
 * a round-robin turn; trash does not.
 */
export function isRecognizedUsLocation(raw: string): boolean {
  const { code, unknown } = normalizeState(raw);
  if (!unknown && VALID_STATES.has(code)) return true;
  const up = (raw ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (US_TERRITORIES.has(up)) return true;
  return TERRITORY_NAME_RE.test(raw ?? "");
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
/**
 * Derive an integer age from an answer that may be an age RANGE ("40–49" /
 * "40-49", "50+", "18-29") or a plain number. Uses the lower bound (first run
 * of digits) — deterministic, never overstates, and the exact range is always
 * preserved in rawFormData. Returns null for empty/garbage/out-of-range values.
 */
export function ageFromAnswer(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = String(v).match(/\d{1,3}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) && n >= 13 && n <= 120 ? n : null;
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
  age: number | null;
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
      age: ageFromAnswer(get(r, iAgeRange)),
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
