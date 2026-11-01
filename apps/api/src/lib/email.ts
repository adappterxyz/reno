import type { Env } from "../env.js";

/**
 * Send the OTP email. Uses Resend (https://resend.com) via its HTTP API when
 * RESEND_API_KEY is set — no SMTP, works from Workers. When the key is absent
 * (local/dev), we log the code instead so the flow is testable without email infra.
 *
 * Returns true if an email was actually dispatched.
 */
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[otp] (dev, no RESEND_API_KEY) code for ${to}: ${code}`);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.OTP_FROM_EMAIL,
      to: [to],
      subject: `Your ${env.APP_NAME} sign-in code: ${code}`,
      text: `Your ${env.APP_NAME} sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
      html: otpHtml(env.APP_NAME, code),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[otp] Resend failed ${res.status}: ${body}`);
    throw new Error("Failed to send email");
  }
  return true;
}

function otpHtml(appName: string, code: string): string {
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:420px;margin:auto">
  <h2 style="color:#2f6df6">${appName}</h2>
  <p>Your sign-in code is:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f5f7fb;padding:16px 24px;border-radius:12px;text-align:center">${code}</p>
  <p style="color:#667">It expires in 10 minutes. If you didn't request this, ignore this email.</p>
</div>`;
}
