import crypto from "crypto";

/**
 * Google Sheets append via a service account — no per-client OAuth.
 *
 * One service account (owned by us) is granted access to a client's sheet when
 * the client shares that sheet with the service account's email. We sign a
 * short-lived JWT with the service account's private key, exchange it for an
 * access token, and call the Sheets API directly (no SDK dependency).
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL        - e.g. advertisely-sheets@proj.iam.gserviceaccount.com
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  - the PEM private key (\n escapes are handled)
 */

export const sheetsServiceAccountEmail =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";

export const isSheetsConfigured =
  !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_TAB = "Sheet1";

type SheetsResult = { ok: boolean; status: number; error?: string };

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// Cache the access token across invocations within a warm serverless instance.
let cachedToken: { token: string; expEpoch: number } | null = null;

async function getAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expEpoch - 60 > nowSec) {
    return cachedToken.token;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  // Env-stored keys usually have literal "\n" sequences instead of newlines.
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(
    /\\n/g,
    "\n",
  );

  const exp = nowSec + 3600;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = base64url(
    crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey),
  );
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google token exchange ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  cachedToken = { token: data.access_token, expEpoch: exp };
  return data.access_token;
}

/**
 * Extract a spreadsheet ID from a full Google Sheets URL or a raw ID.
 * Returns null if it doesn't look like either.
 */
export function parseSpreadsheetId(input: string): string | null {
  if (!input) return null;
  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/** Read the top-left cell (A1) of the first tab, or null if empty/unreadable. */
export async function getFirstCell(
  spreadsheetId: string,
  sheetName = DEFAULT_TAB,
): Promise<{ ok: boolean; status: number; value: string | null; error?: string }> {
  try {
    const token = await getAccessToken();
    const range = encodeURIComponent(`${sheetName}!A1`);
    const res = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, value: null, error: await res.text() };
    }
    const data = (await res.json()) as { values?: string[][] };
    return { ok: true, status: res.status, value: data.values?.[0]?.[0] ?? null };
  } catch (err) {
    return { ok: false, status: 0, value: null, error: (err as Error).message };
  }
}

/** Append rows to the first tab of a spreadsheet. */
export async function appendRows(
  spreadsheetId: string,
  rows: (string | number)[][],
  sheetName = DEFAULT_TAB,
): Promise<SheetsResult> {
  if (!isSheetsConfigured) {
    return { ok: false, status: 0, error: "Google Sheets is not configured." };
  }
  if (rows.length === 0) return { ok: true, status: 200 };
  try {
    const token = await getAccessToken();
    const range = encodeURIComponent(`${sheetName}!A1`);
    const url =
      `${SHEETS_API}/${spreadsheetId}/values/${range}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: rows }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}
