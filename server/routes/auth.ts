import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomInt } from "crypto";
import { Resend } from "resend";
import { pool } from "../db";
import { env } from "../config";
import { hashPassword, verifyPassword, createOwnerToken } from "../services/user-auth";

// Reset codes stored in DB (users.reset_code + users.reset_code_expires_at)

const signupSchema = z.object({
  businessId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Check if an email already has an account
  app.post("/auth/check-email", async (request) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);
    const email = body.email.trim().toLowerCase();
    const result = await pool.query(
      `SELECT id, password_hash IS NOT NULL AS has_password FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (result.rows.length === 0) {
      return { exists: false, hasAccount: false, hasPassword: false };
    }
    return { exists: true, hasAccount: true, hasPassword: result.rows[0].has_password };
  });

  app.post("/auth/signup", async (request, reply) => {
    const body = signupSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();

    // Find the owner user for this business
    const ownerResult = await pool.query(
      `SELECT u.id, u.email, u.password_hash
       FROM users u
       JOIN business_members bm ON bm.user_id = u.id
       WHERE bm.business_id = $1 AND bm.role = 'OWNER'
       LIMIT 1`,
      [body.businessId],
    );

    if (ownerResult.rows.length === 0) {
      return reply.status(404).send({ message: "Business not found" });
    }

    const owner = ownerResult.rows[0];

    // If already has a password, don't allow re-signup
    if (owner.password_hash) {
      return reply.status(409).send({ message: "Account already exists. Use login instead." });
    }

    // Check email uniqueness (if changing from the placeholder)
    if (email !== owner.email) {
      const emailCheck = await pool.query(
        `SELECT id FROM users WHERE email = $1 AND id != $2`,
        [email, owner.id],
      );
      if (emailCheck.rows.length > 0) {
        return reply.status(409).send({ message: "Email is already in use" });
      }
    }

    // Hash password and update user
    const passwordHash = await hashPassword(body.password);
    await pool.query(
      `UPDATE users SET email = $1, full_name = COALESCE($2, full_name), password_hash = $3, updated_at = now() WHERE id = $4`,
      [email, body.fullName ?? null, passwordHash, owner.id],
    );

    const token = createOwnerToken(owner.id, body.businessId, email);
    return { token, userId: owner.id, businessId: body.businessId, email };
  });

  app.post("/auth/login", async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);
      const email = body.email.trim().toLowerCase();

      // Find user by email
      const userResult = await pool.query(
        `SELECT id, email, password_hash FROM users WHERE email = $1`,
        [email],
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].password_hash) {
        return reply.status(401).send({ message: "Invalid email or password" });
      }

      const user = userResult.rows[0];
      const valid = await verifyPassword(body.password, user.password_hash);
      if (!valid) {
        return reply.status(401).send({ message: "Invalid email or password" });
      }

      // Find their business
      const memberResult = await pool.query(
        `SELECT business_id FROM business_members WHERE user_id = $1 AND role = 'OWNER' LIMIT 1`,
        [user.id],
      );

      if (memberResult.rows.length === 0) {
        return reply.status(401).send({ message: "No business found for this account" });
      }

      const businessId = memberResult.rows[0].business_id;
      const token = createOwnerToken(user.id, businessId, user.email);
      return { token, userId: user.id, businessId, email: user.email };
    } catch (err: any) {
      console.error("[auth/login] Error:", err?.message, err?.stack);
      return reply.status(500).send({ message: "Login failed", detail: err?.message });
    }
  });

  // Request password reset - sends a 6-digit code via email
  app.post("/auth/forgot-password", async (request, reply) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);
    const email = body.email.trim().toLowerCase();

    // Always return success (don't reveal if email exists)
    const userResult = await pool.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );

    if (userResult.rows.length > 0 && env.RESEND_API_KEY) {
      const code = String(randomInt(100000, 999999));
      await pool.query(
        `UPDATE users SET reset_code = $1, reset_code_expires_at = now() + interval '10 minutes' WHERE email = $2`,
        [code, email],
      );

      try {
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: env.RESEND_FROM_EMAIL,
          to: email,
          subject: "SendToAmram - איפוס סיסמה",
          html: `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:20px 28px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">SendToAmram</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="font-size:16px;color:#333;">קוד האיפוס שלך:</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
        <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#ee5a24;">${code}</span>
      </div>
      <p style="font-size:14px;color:#888;">הקוד תקף ל-10 דקות.</p>
    </div>
  </div>
</body>
</html>`,
        });
        console.log(`[auth] Reset code sent to ${email}`);
      } catch (err: any) {
        console.error(`[auth] Failed to send reset email:`, err.message);
      }
    }

    return { sent: true };
  });

  // Verify reset code and set new password
  app.post("/auth/reset-password", async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      code: z.string().length(6),
      newPassword: z.string().min(8),
    }).parse(request.body);
    const email = body.email.trim().toLowerCase();

    // Check code from DB
    const codeResult = await pool.query(
      `SELECT id, reset_code, reset_code_expires_at FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const stored = codeResult.rows[0];
    if (!stored || stored.reset_code !== body.code || !stored.reset_code_expires_at || new Date(stored.reset_code_expires_at) < new Date()) {
      return reply.status(400).send({ message: "קוד שגוי או שפג תוקפו." });
    }

    // Update password and clear reset code
    const passwordHash = await hashPassword(body.newPassword);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, reset_code = NULL, reset_code_expires_at = NULL, updated_at = now() WHERE email = $2 RETURNING id`,
      [passwordHash, email],
    );

    if (result.rowCount === 0) {
      return reply.status(404).send({ message: "User not found" });
    }

    // Auto-login after reset
    const user = result.rows[0];
    const memberResult = await pool.query(
      `SELECT business_id FROM business_members WHERE user_id = $1 AND role = 'OWNER' LIMIT 1`,
      [user.id],
    );

    if (memberResult.rows.length === 0) {
      return { reset: true };
    }

    const businessId = memberResult.rows[0].business_id;
    const token = createOwnerToken(user.id, businessId, email);
    return { reset: true, token, userId: user.id, businessId, email };
  });
}
