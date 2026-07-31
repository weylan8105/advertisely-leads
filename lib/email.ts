/**
 * Email notifications via Resend.
 *
 * Set RESEND_API_KEY in your environment variables (Vercel dashboard).
 * Sign up at https://resend.com — free tier sends 3,000 emails/month.
 *
 * FROM address: Use a domain you've verified in Resend.
 * Default fallback: onboarding@resend.dev (works for testing, but goes to
 * the Resend account owner only — verify your domain for production).
 */

export const isEmailConfigured = !!process.env.RESEND_API_KEY;

const FROM_ADDRESS =
  process.env.EMAIL_FROM ?? "Advertisely <leads@advertisely.io>";

/**
 * Send an email via Resend REST API.
 * We call the API directly (no SDK) to avoid adding a dependency.
 */
async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
}): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured) {
    console.warn("Email: RESEND_API_KEY not set — skipping email to", to);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html,
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return { success: false, error: err };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Email send failed:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Escape untrusted values before interpolating into email HTML. Lead data
 * originates from external Meta lead forms, so it must never be trusted raw.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ─────────────────────────────────────────────────────────────
   Email Templates
───────────────────────────────────────────────────────────── */

/**
 * Notify an agent that new leads have been delivered to their account.
 */
export interface DeliveredLead {
  name: string;
  phone: string;
  email: string;
  state: string;
  occupation?: string | null;
  age?: number | null;
  income?: number | null;
  intentReason?: string | null;
}

export async function sendLeadDeliveryEmail({
  agentEmail,
  agentName,
  leadCount,
  packageName,
  orderId,
  dashboardUrl,
  leads = [],
}: {
  agentEmail: string;
  agentName: string;
  leadCount: number;
  packageName: string;
  orderId: string;
  dashboardUrl?: string;
  leads?: DeliveredLead[];
}) {
  // CANONICAL DELIVERY EMAIL — must stay identical to
  // scripts/build-delivery-preview.mjs. See memory: advertisely-delivery-email-template.
  const url = dashboardUrl ?? "https://advertisely.io/leads";
  const first = String(agentName ?? "there").split(" ")[0] || "there";
  const subject = `Your ${leadCount} ${packageName} lead${leadCount === 1 ? "" : "s"} are ready, ${first}`;

  const money = (n?: number | null) =>
    typeof n === "number" && n > 0 ? "$" + n.toLocaleString() : "";
  const timelineOf = (l: DeliveredLead) =>
    escapeHtml(String(l.intentReason ?? "").replace(/^Retirement timeline:\s*/i, ""));

  const states = Array.from(new Set(leads.map((l) => l.state).filter(Boolean)));
  const counts: Record<string, number> = {};
  for (const l of leads) if (l.state) counts[l.state] = (counts[l.state] || 0) + 1;
  const chips = Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([s, n]) => `<span style="color:#0f172a;font-weight:600;">${escapeHtml(s)}</span> <span style="color:#94a3b8;">${n}</span>`)
    .join(' <span style="color:#cbd5e1;">·</span> ');
  const deliveredStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const box = (label: string, val: string | number) =>
    `<td style="width:33.3%;padding:0 6px;vertical-align:top;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">${label}</div><div style="font-size:22px;font-weight:700;color:#dc2626;margin-top:6px;">${val}</div></div></td>`;

  const rows = leads
    .map((l, i) => `<tr style="border-bottom:1px solid #eef2f7;">
<td style="padding:8px 10px;font-size:12px;color:#94a3b8;">${i + 1}</td>
<td style="padding:8px 10px;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(l.name)}</td>
<td style="padding:8px 10px;font-size:12px;"><span style="background:#f1f5f9;border-radius:4px;padding:2px 6px;">${escapeHtml(l.state)}</span></td>
<td style="padding:8px 10px;font-size:12px;color:#0f172a;white-space:nowrap;">${escapeHtml(l.phone)}</td>
<td style="padding:8px 10px;font-size:12px;color:#0f172a;">${escapeHtml(l.email)}</td>
<td style="padding:8px 10px;font-size:12px;color:#475569;">${escapeHtml(l.occupation ?? "")}</td>
<td style="padding:8px 10px;font-size:12px;color:#475569;">${timelineOf(l)}</td>
<td style="padding:8px 10px;font-size:12px;color:#475569;white-space:nowrap;">${money(l.income)}</td></tr>`)
    .join("");

  const tableHtml = leads.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">
<thead><tr style="background:#0f172a;text-align:left;">${["#", "Name", "State", "Phone", "Email", "Trade", "Timeline", "Income"].map((h) => `<th style="padding:10px;font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.03em;">${h}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody></table>`
    : "";

  // Attach a client-ready CSV (same columns as the table).
  const csvEsc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csvHeader = ["Name", "State", "Phone", "Email", "Trade", "Timeline", "Income"];
  const csvBody = leads.map((l) =>
    [l.name, l.state, l.phone, l.email, l.occupation ?? "", String(l.intentReason ?? "").replace(/^Retirement timeline:\s*/i, ""), money(l.income)].map(csvEsc).join(","),
  );
  const csv = [csvHeader.join(","), ...csvBody].join("\r\n");
  const csvB64 = Buffer.from(csv, "utf8").toString("base64");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 12px;"><tr><td align="center">
<table width="760" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
<tr><td style="background:#dc2626;padding:24px 32px;"><div style="color:#fff;font-size:20px;font-weight:700;">Advertisely</div><div style="color:#fca5a5;font-size:13px;margin-top:2px;">Lead Delivery</div></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 10px;font-size:24px;font-weight:700;color:#0f172a;">Your ${leadCount} leads are ready, ${escapeHtml(first)}</p>
<p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">Here's your <strong>${escapeHtml(packageName)}</strong> order — <strong>${leadCount}</strong> verified, consent-captured leads across ${states.length} states. Download them below or import the attached CSV straight into your dialer or CRM.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px 18px;"><tr>${box("Leads delivered", leadCount)}${box("States covered", states.length)}${box("Delivered", deliveredStr)}</tr></table>
${chips ? `<p style="margin:0 0 22px;font-size:13px;line-height:1.9;">${chips}</p>` : ""}
${tableHtml}
<div style="text-align:center;margin:24px 0 4px;"><a href="${url}" style="display:inline-block;background:#dc2626;color:#fff;font-size:15px;font-weight:600;padding:14px 34px;border-radius:8px;text-decoration:none;">⬇&nbsp;&nbsp;Download your leads (CSV)</a></div>
<p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">The CSV is also attached to this email. Full details are in your dashboard. Speed matters — top agents call within 5 minutes.</p>
<div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:20px;">
<p style="margin:0 0 4px;font-size:14px;color:#475569;">To your success,</p>
<p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#0f172a;">The Advertisely Team</p>
<p style="margin:0;font-size:13px;color:#94a3b8;"><a href="https://advertisely.io" style="color:#94a3b8;text-decoration:none;">advertisely.io</a></p>
</div></td></tr></table></td></tr></table></body></html>`;

  return sendEmail({
    to: agentEmail,
    subject,
    html,
    attachments: leads.length ? [{ filename: "Advertisely_Leads.csv", content: csvB64 }] : undefined,
  });
}

/**
 * Send an order confirmation email when a new order is placed.
 */
export async function sendOrderConfirmationEmail({
  agentEmail,
  agentName,
  packageName,
  quantity,
  totalCents,
  orderId,
}: {
  agentEmail: string;
  agentName: string;
  packageName: string;
  quantity: number;
  totalCents: number;
  orderId: string;
}) {
  const totalFormatted = `$${(totalCents / 100).toFixed(2)}`;
  const subject = `Order confirmed — ${quantity}× ${packageName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td style="background:#dc2626;padding:24px 32px;">
              <div style="color:#ffffff;font-size:20px;font-weight:700;">Advertisely</div>
              <div style="color:#fca5a5;font-size:13px;margin-top:2px;">Order Confirmation</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Order confirmed ✓</p>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">
                Hi ${agentName}, your order for <strong>${quantity}× ${packageName}</strong> has been confirmed. We'll notify you the moment leads start arriving.
              </p>

              <table cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;padding:16px;width:100%;margin-bottom:24px;">
                <tr>
                  <td style="font-size:13px;color:#64748b;">Package</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;">${packageName}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#64748b;padding-top:8px;">Quantity</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;padding-top:8px;">${quantity} leads</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#64748b;padding-top:8px;">Total charged</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;padding-top:8px;">${totalFormatted}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#64748b;padding-top:8px;">Order ID</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;padding-top:8px;font-family:monospace;">${orderId.slice(0, 16)}...</td>
                </tr>
              </table>

              <div style="text-align:center;margin-bottom:24px;">
                <a href="https://advertisely.io/orders" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">
                  View order status →
                </a>
              </div>

              <p style="margin:0;font-size:13px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px;">
                Questions? Reply to this email or visit <a href="https://advertisely.io" style="color:#94a3b8;">advertisely.io</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                Advertisely · <a href="https://advertisely.io" style="color:#94a3b8;">advertisely.io</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendEmail({ to: agentEmail, subject, html });
}

/**
 * Send a warm thank-you email to the client immediately after they place an order.
 * This is personal and relationship-building — sets expectations for what happens next.
 * Signed off from the Advertisely Team.
 */
export async function sendThankYouEmail({
  clientEmail,
  clientName,
  packageName,
  quantity,
  totalCents,
  orderId,
}: {
  clientEmail: string;
  clientName: string;
  packageName: string;
  quantity: number;
  totalCents: number;
  orderId: string;
}) {
  const firstName = clientName.split(" ")[0] || clientName;
  const totalFormatted = `$${(totalCents / 100).toFixed(2)}`;
  const subject = `Thank you for your order, ${firstName} — here's what happens next`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:#dc2626;padding:28px 32px;">
              <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Advertisely</div>
              <div style="color:#fca5a5;font-size:13px;margin-top:4px;">Premium Lead Generation for Insurance Agents</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 28px;">
              <p style="margin:0 0 6px;font-size:24px;font-weight:700;color:#0f172a;">
                Thank you, ${firstName}!
              </p>
              <p style="margin:0 0 28px;font-size:16px;color:#475569;line-height:1.6;">
                Your order is confirmed and we're already working on it. You made a smart move investing in high-quality leads — and we're going to make sure you get every dollar's worth.
              </p>

              <!-- Order Summary Box -->
              <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;width:100%;margin-bottom:28px;">
                <tr>
                  <td colspan="2" style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;padding-bottom:12px;">Order Summary</td>
                </tr>
                <tr>
                  <td style="font-size:14px;color:#64748b;padding-bottom:8px;">Package</td>
                  <td style="font-size:14px;font-weight:600;color:#0f172a;text-align:right;padding-bottom:8px;">${packageName}</td>
                </tr>
                <tr>
                  <td style="font-size:14px;color:#64748b;padding-bottom:8px;">Leads ordered</td>
                  <td style="font-size:14px;font-weight:600;color:#0f172a;text-align:right;padding-bottom:8px;">${quantity} leads</td>
                </tr>
                <tr>
                  <td style="font-size:14px;color:#64748b;padding-bottom:8px;">Total charged</td>
                  <td style="font-size:14px;font-weight:700;color:#dc2626;text-align:right;padding-bottom:8px;">${totalFormatted}</td>
                </tr>
                <tr style="border-top:1px solid #e2e8f0;">
                  <td style="font-size:12px;color:#94a3b8;padding-top:10px;">Order ID</td>
                  <td style="font-size:12px;color:#94a3b8;text-align:right;padding-top:10px;font-family:monospace;">${orderId.slice(0, 16)}...</td>
                </tr>
              </table>

              <!-- What Happens Next -->
              <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#0f172a;">What happens next</p>
              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr>
                  <td style="vertical-align:top;padding-bottom:16px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:14px;">
                          <div style="width:28px;height:28px;background:#dc2626;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:13px;font-weight:700;">1</div>
                        </td>
                        <td style="vertical-align:top;">
                          <div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:2px;">Leads are matched to your order</div>
                          <div style="font-size:13px;color:#64748b;">Our system immediately starts matching ${packageName} leads to your account based on your filters.</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;padding-bottom:16px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:14px;">
                          <div style="width:28px;height:28px;background:#dc2626;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:13px;font-weight:700;">2</div>
                        </td>
                        <td style="vertical-align:top;">
                          <div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:2px;">You get notified the moment leads land</div>
                          <div style="font-size:13px;color:#64748b;">We'll email you as soon as leads are delivered to your CRM. Speed is everything — the best agents call within 5 minutes.</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:14px;">
                          <div style="width:28px;height:28px;background:#dc2626;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:13px;font-weight:700;">3</div>
                        </td>
                        <td style="vertical-align:top;">
                          <div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:2px;">Track everything in your dashboard</div>
                          <div style="font-size:13px;color:#64748b;">Log calls, update statuses, push to GoHighLevel, and request replacements — all from your Advertisely portal.</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="https://advertisely.io/dashboard" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;font-weight:600;padding:15px 36px;border-radius:8px;text-decoration:none;letter-spacing:-0.2px;">
                  Go to your dashboard →
                </a>
              </div>

              <!-- Sign-off -->
              <div style="border-top:1px solid #f1f5f9;padding-top:20px;">
                <p style="margin:0 0 4px;font-size:14px;color:#475569;">To your success,</p>
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#0f172a;">The Advertisely Team</p>
                <p style="margin:0;font-size:13px;color:#94a3b8;"><a href="https://advertisely.io" style="color:#94a3b8;text-decoration:none;">advertisely.io</a></p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                Advertisely &nbsp;·&nbsp; <a href="https://advertisely.io" style="color:#94a3b8;">advertisely.io</a>
                &nbsp;·&nbsp; You're receiving this because you placed an order.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendEmail({ to: clientEmail, subject, html });
}
