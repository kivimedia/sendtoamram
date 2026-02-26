import { createHmac, randomBytes } from "crypto";
import { env } from "../config";
import { store } from "../store";

const TOKEN_SECRET = env.ACCOUNTANT_TOKEN_SECRET ?? env.OAUTH_STATE_SECRET;
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface AccountantTokenPayload {
  email: string;
  iat: number;
  exp: number;
}

/**
 * Create a signed JWT-like token for accountant auth.
 * Uses HMAC-SHA256 for simple, stateless verification.
 */
export function createAccountantToken(email: string): string {
  const payload: AccountantTokenPayload = {
    email: email.toLowerCase(),
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verify an accountant token and return the email.
 */
export function verifyAccountantToken(token: string): { email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");

  if (signature !== expectedSig) return null;

  try {
    const payload: AccountantTokenPayload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );
    if (Date.now() > payload.exp) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Create a magic link token — short-lived (15 min) for the login email.
 */
export function createMagicLinkToken(email: string): string {
  const payload = {
    email: email.toLowerCase(),
    iat: Date.now(),
    exp: Date.now() + 15 * 60 * 1000, // 15 minutes
    nonce: randomBytes(8).toString("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a magic link token and return the email.
 */
export function verifyMagicLinkToken(token: string): { email: string } | null {
  return verifyAccountantToken(token); // Same verification logic
}

/**
 * Send magic link email via Resend.
 */
export async function sendMagicLinkEmail(email: string): Promise<{ sent: boolean }> {
  const exists = await store.accountantEmailExists(email);
  if (!exists) {
    // Don't reveal whether the email exists — silently succeed
    console.log(`[accountant-auth] Magic link requested for unknown email: ${email}`);
    return { sent: true };
  }

  const token = createMagicLinkToken(email);
  const magicLink = `${env.FRONTEND_BASE_URL}/accountant/verify?token=${encodeURIComponent(token)}`;

  if (!env.RESEND_API_KEY) {
    console.log(`[accountant-auth] Magic link for ${email}: ${magicLink}`);
    return { sent: true };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(env.RESEND_API_KEY);

  const result = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: email,
    subject: "כניסה לפורטל רואה חשבון – SendToAmram",
    html: `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">SendToAmram</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="font-size:16px;color:#333;">שלום,</p>
      <p style="font-size:15px;color:#555;">
        לחצ/י על הכפתור למטה כדי להיכנס לפורטל רואה החשבון שלך:
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${magicLink}"
           style="display:inline-block;padding:12px 32px;background:#ee5a24;color:#fff;
                  text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          כניסה לפורטל
        </a>
      </div>
      <p style="font-size:13px;color:#999;">
        הקישור תקף ל-15 דקות. אם לא ביקשת כניסה, ניתן להתעלם מהמייל הזה.
      </p>
    </div>
  </div>
</body>
</html>`,
  });

  if (result.error) {
    throw new Error(`Failed to send magic link: ${result.error.message}`);
  }

  return { sent: true };
}
