import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { hashPassword, verifyPassword, createOwnerToken } from "../services/user-auth";

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
  // Check if an email already has an account (has password set)
  app.post("/auth/check-email", async (request) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);
    const email = body.email.trim().toLowerCase();
    const result = await pool.query(
      `SELECT id, password_hash IS NOT NULL AS has_account FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (result.rows.length === 0) {
      return { exists: false, hasAccount: false };
    }
    return { exists: true, hasAccount: result.rows[0].has_account };
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
  });
}
