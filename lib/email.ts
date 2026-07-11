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
}: {
  to: string;
  subject: string;
  html: string;
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

/* ─────────────────────────────────────────────────────────────
   Email Templates
───────────────────────────────────────────────────────────── */

/**
 * Notify an agent that new leads have been delivered to their account.
 */
export async function sendLeadDeliveryEmail({
  agentEmail,
  agentName,
  leadCount,
  packageName,
  orderId,
  dashboardUrl,
}: {
  agentEmail: string;
  agentName: string;
  leadCount: number;
  packageName: string;
  orderId: string;
  dashboardUrl?: string;
}) {
  const url = dashboardUrl ?? "https://advertisely.io/leads";
  const subject = `🎯 ${leadCount} new ${packageName} lead${leadCount === 1 ? "" : "s"} delivered`;

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
            <td style="background:#dc2626;padding:24px 32px;">
              <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Advertisely</div>
              <div style="color:#fca5a5;font-size:13px;margin-top:2px;">Lead Delivery Notification</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">
                ${leadCount} new lead${leadCount === 1 ? "" : "s"} ready for you
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">
                Hi ${agentName}, your <strong>${packageName}</strong> order just had ${leadCount} lead${leadCount === 1 ? "" : "s"} delivered. They're live in your CRM right now.
              </p>

              <table cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;padding:16px;width:100%;margin-bottom:24px;">
                <tr>
                  <td style="font-size:13px;color:#64748b;">Package</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;">${packageName}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#64748b;padding-top:8px;">Leads delivered</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;padding-top:8px;">${leadCount}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#64748b;padding-top:8px;">Order ID</td>
                  <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;padding-top:8px;font-family:monospace;">${orderId.slice(0, 16)}...</td>
                </tr>
              </table>

              <div style="text-align:center;margin-bottom:24px;">
                <a href="${url}" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">
                  View leads in CRM →
                </a>
              </div>

              <p style="margin:0;font-size:13px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px;">
                Speed matters. The best agents contact new leads within 5 minutes. Don't let these go cold.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                Advertisely · <a href="https://advertisely.io" style="color:#94a3b8;">advertisely.io</a>
                · You're receiving this because you have an active lead order.
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
