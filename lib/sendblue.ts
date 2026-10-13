// Sendblue texting client — send iMessage/SMS/RCS to leads and receive replies.
//
// Auth is two headers (SB-API-KEY-ID / SB-API-SECRET-KEY). Each agent sends from
// their own Sendblue line (User.sendblueNumber). Inbound + status callbacks hit
// /api/sendblue/inbound (see that route). Docs: https://docs.sendblue.com
//
// Config (env, set in Vercel):
//   SENDBLUE_API_KEY_ID      — API Key   (dashboard.sendblue.com / `sendblue show-keys`)
//   SENDBLUE_API_SECRET_KEY  — API Secret
//   SENDBLUE_SEND_URL        — optional; defaults to the classic send endpoint
//   SENDBLUE_WEBHOOK_SECRET  — shared token we require on the inbound webhook URL

const KEY_ID = process.env.SENDBLUE_API_KEY_ID;
const SECRET = process.env.SENDBLUE_API_SECRET_KEY;
const SEND_URL = process.env.SENDBLUE_SEND_URL || "https://api.sendblue.co/api/send-message";

export function isSendblueConfigured(): boolean {
  return !!KEY_ID && !!SECRET;
}

/** Normalize a phone to E.164. Assumes US (+1) for 10-digit numbers. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

/** Last 10 digits — used to match inbound numbers to stored lead phones. */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
}

export interface SendResult {
  ok: boolean;
  messageHandle: string | null;
  status: string | null; // QUEUED/SENT/DELIVERED/ERROR/...
  service: string | null; // iMessage / SMS / RCS
  errorCode: number | null;
  errorMessage: string | null;
}

export async function sendMessage(opts: {
  fromNumber: string;
  toNumber: string;
  content?: string;
  mediaUrl?: string;
  statusCallback?: string;
  seatId?: string;
}): Promise<SendResult> {
  if (!isSendblueConfigured()) {
    return { ok: false, messageHandle: null, status: null, service: null, errorCode: null, errorMessage: "Sendblue not configured" };
  }
  const body: Record<string, unknown> = {
    from_number: opts.fromNumber,
    number: opts.toNumber,
  };
  if (opts.content) body.content = opts.content;
  if (opts.mediaUrl) body.media_url = opts.mediaUrl;
  if (opts.statusCallback) body.status_callback = opts.statusCallback;
  if (opts.seatId) body.seat_id = opts.seatId;

  const r = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "SB-API-KEY-ID": KEY_ID!,
      "SB-API-SECRET-KEY": SECRET!,
    },
    body: JSON.stringify(body),
  });

  const data = (await r.json().catch(() => ({}))) as Record<string, any>;
  const status = (data.status ?? null) as string | null;
  const errorCode = typeof data.error_code === "number" ? data.error_code : data.error_code ? Number(data.error_code) : null;
  const errorMessage = (data.error_message as string) ?? (!r.ok ? `Sendblue ${r.status}` : null);
  const ok = r.ok && status !== "ERROR" && status !== "DECLINED" && !(errorCode && errorCode !== 0);

  return {
    ok,
    messageHandle: (data.message_handle as string) ?? null,
    status,
    service: (data.service as string) ?? null,
    errorCode: errorCode ?? null,
    errorMessage: ok ? null : errorMessage,
  };
}
