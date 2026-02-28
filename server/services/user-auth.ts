import { createHmac } from "crypto";
import bcrypt from "bcryptjs";
import { env } from "../config";

const TOKEN_SECRET = env.ACCOUNTANT_TOKEN_SECRET ?? env.OAUTH_STATE_SECRET;
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface OwnerTokenPayload {
  userId: string;
  businessId: string;
  email: string;
  iat: number;
  exp: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createOwnerToken(userId: string, businessId: string, email: string): string {
  const payload: OwnerTokenPayload = {
    userId,
    businessId,
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

export function verifyOwnerToken(token: string): { userId: string; businessId: string; email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");

  if (signature !== expectedSig) return null;

  try {
    const payload: OwnerTokenPayload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );
    if (Date.now() > payload.exp) return null;
    return { userId: payload.userId, businessId: payload.businessId, email: payload.email };
  } catch {
    return null;
  }
}
