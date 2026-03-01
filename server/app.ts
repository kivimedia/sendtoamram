import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./config";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerHealthRoutes } from "./routes/health";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerOAuthRoutes } from "./routes/oauth";
import { registerSettingsRoutes } from "./routes/settings";
import { registerWhatsAppRoutes } from "./routes/whatsapp";
import { registerDeepScanRoutes } from "./routes/deep-scan";
import { registerBillingRoutes, registerStripeWebhook } from "./routes/billing";
import { registerAccountantRoutes } from "./routes/accountant";
import { registerAuthRoutes } from "./routes/auth";

export async function createServer() {
  const app = Fastify({
    logger: env.NODE_ENV === "development",
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedOrigins = env.CORS_ORIGIN.split(",").map((entry) => entry.trim());
      callback(null, allowedOrigins.includes(origin));
    },
    credentials: false,
  });

  // Override JSON parser to capture raw body for Stripe webhook verification
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const str = (body as string) || "";
      done(null, str.length > 0 ? JSON.parse(str) : {});
    } catch (err: any) {
      done(err, undefined);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues }, "Validation error");
      reply.status(400).send({
        message: "Invalid request payload",
        issues: error.issues,
      });
      return;
    }

    if (error instanceof Error) {
      if (["Business not found", "Document not found", "Inbox not found"].includes(error.message)) {
        reply.status(404).send({ message: error.message });
        return;
      }
      if (error.message === "Email is already in use") {
        reply.status(409).send({ message: error.message });
        return;
      }
      if (error.message.includes("not configured")) {
        reply.status(400).send({ message: error.message });
        return;
      }
    }

    request.log.error(error);
    reply.status(500).send({ message: "Internal server error" });
  });

  await app.register(async (api) => {
    await registerHealthRoutes(api);
    await registerOnboardingRoutes(api);
    await registerOAuthRoutes(api);
    await registerWhatsAppRoutes(api);
    await registerDashboardRoutes(api);
    await registerSettingsRoutes(api);
    await registerDeepScanRoutes(api);
    await registerBillingRoutes(api);
    await registerAccountantRoutes(api);
    await registerAuthRoutes(api);
  }, { prefix: "/api" });

  // Stripe webhook — registered at /api/webhooks/stripe (outside api prefix group for raw body)
  await app.register(async (webhookApp) => {
    await registerStripeWebhook(webhookApp);
  }, { prefix: "/api" });

  return app;
}
