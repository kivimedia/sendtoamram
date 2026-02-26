import Fastify from "fastify";
import { registerBridgeRoutes } from "./routes";

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT ?? "3002", 10);
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";

const app = Fastify({ logger: true });

// Auth middleware
app.addHook("onRequest", async (request, reply) => {
  // Skip auth for health check
  if (request.url === "/health") return;

  if (BRIDGE_SECRET) {
    const secret = request.headers["x-bridge-secret"];
    if (secret !== BRIDGE_SECRET) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  }
});

registerBridgeRoutes(app, { webhookUrl: WEBHOOK_URL, bridgeSecret: BRIDGE_SECRET });

app.get("/health", async () => ({
  ok: true,
  service: "sendtoamram-whatsapp-bridge",
  timestamp: new Date().toISOString(),
}));

app.listen({ port: BRIDGE_PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`WhatsApp Bridge running on port ${BRIDGE_PORT}`);
});
