import type { Env } from "../env.js";

/**
 * Send the OTP email via Cloudflare Email Service (env.EMAIL.send). Fully
 * Cloudflare-native — no third-party provider.
 *
 * Prerequisites (one-time, in the Cloudflare dashboard):
 *   - Enable Email Sending on the account.
 *   - Verify the sender domain (10kbto.homes) — adds DKIM/SPF DNS records.
 *   - Sending to arbitrary recipients requires the Workers Paid plan; otherwise
 *     only verified destination addresses receive mail.
 *
 * Returns true if an email was dispatched. If the EMAIL binding is absent
 * (e.g. local `wrangler dev` without the feature), logs the code instead.
 */
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<boolean> {
  if (!env.EMAIL) {
    console.log(`[otp] (no EMAIL binding) code for ${to}: ${code}`);
    return false;
  }

  await env.EMAIL.send({
    to,
    from: env.OTP_FROM_EMAIL,
    subject: `Your ${env.APP_NAME} sign-in code: ${code}`,
    text: `Your ${env.APP_NAME} sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
    html: otpHtml(env.APP_NAME, code),
  });
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
