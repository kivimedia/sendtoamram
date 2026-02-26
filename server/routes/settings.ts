import { FastifyInstance } from "fastify";
import { z } from "zod";
import { store } from "../store";

const businessParamsSchema = z.object({
  businessId: z.string().min(1),
});

const inboxParamsSchema = z.object({
  businessId: z.string().min(1),
  inboxId: z.string().min(1),
});

const accountPayloadSchema = z.object({
  fullName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  businessName: z.string().optional(),
  preferredLanguage: z.string().optional(),
  currency: z.string().optional(),
});

const accountantPayloadSchema = z.object({
  name: z.string().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  firmName: z.string().nullable().optional(),
  monthlyDeliveryDay: z.number().int().min(1).max(28).optional(),
  autoMonthlyDelivery: z.boolean().optional(),
});

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings/:businessId", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    return store.getSettings(businessId);
  });

  app.patch("/settings/:businessId/account", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const payload = accountPayloadSchema.parse(request.body);
    return store.updateAccountSettings({
      businessId,
      ...payload,
    });
  });

  app.patch("/settings/:businessId/accountant", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const payload = accountantPayloadSchema.parse(request.body);
    return store.updateAccountantSettings({
      businessId,
      ...payload,
    });
  });

  app.delete("/settings/:businessId/inboxes/:inboxId", async (request) => {
    const { businessId, inboxId } = inboxParamsSchema.parse(request.params);
    return store.disconnectInbox({ businessId, inboxId });
  });
}
