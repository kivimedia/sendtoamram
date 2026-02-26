import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServer } from "../server/app";

let appPromise: Promise<Awaited<ReturnType<typeof createServer>>> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = createServer().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = await getApp();
    app.server.emit("request", req, res);
  } catch (err: any) {
    console.error("[handler] Fatal error:", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: err?.message }));
  }
}
