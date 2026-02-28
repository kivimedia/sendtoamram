import Stripe from "stripe";
import { FastifyInstance } from "fastify";
import { store } from "../store";
import { env } from "../config";

const ONBOARDING_AMOUNT = 1300; // $13 USD in cents (~40 NIS)
const MONTHLY_AMOUNT = 700; // $7 USD in cents (~21.5 NIS)

function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
  return new Stripe(env.STRIPE_SECRET_KEY);
}

function isBillingEnabled(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  // Get billing status
  app.get<{ Params: { businessId: string } }>(
    "/billing/:businessId/status",
    async (request) => {
      const { businessId } = request.params;

      // If Stripe not configured, everything is unlocked (dev mode)
      if (!isBillingEnabled()) {
        return { onboardingPaid: true, subscriptionStatus: "active", billingEnabled: false };
      }

      const billing = await store.getBusinessBilling(businessId);
      return {
        onboardingPaid: billing.onboardingPaid,
        subscriptionStatus: billing.subscriptionStatus,
        billingEnabled: true,
      };
    },
  );

  // Create checkout session (onboarding $10 + monthly $5 subscription)
  app.post<{ Params: { businessId: string } }>(
    "/billing/:businessId/create-checkout",
    async (request, reply) => {
      if (!isBillingEnabled()) {
        reply.code(400);
        return { error: "Billing not configured" };
      }

      const { businessId } = request.params;
      const stripe = getStripe();
      const billing = await store.getBusinessBilling(businessId);

      // Already paid — no need for another checkout
      if (billing.onboardingPaid && billing.subscriptionStatus === "active") {
        return { alreadyPaid: true };
      }

      const baseUrl = env.FRONTEND_BASE_URL;

      try {
        // Get or create Stripe customer
        let customerId = billing.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            metadata: { businessId },
          });
          customerId = customer.id;
          await store.updateBusinessBilling(businessId, { stripeCustomerId: customerId });
        }

        // Pre-create an invoice item for the one-time setup fee
        // This gets added to the subscription's first invoice automatically
        await stripe.invoiceItems.create({
          customer: customerId!,
          amount: ONBOARDING_AMOUNT,
          currency: "usd",
          description: "SendToAmram — Account Setup (one-time)",
        });

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          line_items: [
            // Monthly subscription
            {
              price_data: {
                currency: "usd",
                product_data: { name: "SendToAmram — Monthly Plan" },
                unit_amount: MONTHLY_AMOUNT,
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
          ],
          success_url: `${baseUrl}/onboarding?payment=success&businessId=${businessId}`,
          cancel_url: `${baseUrl}/onboarding?payment=cancelled&businessId=${businessId}`,
          metadata: { businessId },
        });

        return { checkoutUrl: session.url };
      } catch (err: any) {
        console.error("[billing] Stripe checkout error:", err.message);
        reply.code(500);
        return { error: err.message || "Failed to create checkout session" };
      }
    },
  );

  // Create Stripe billing portal session (for managing subscription)
  app.post<{ Params: { businessId: string } }>(
    "/billing/:businessId/portal",
    async (request, reply) => {
      if (!isBillingEnabled()) {
        reply.code(400);
        return { error: "Billing not configured" };
      }

      const { businessId } = request.params;
      const stripe = getStripe();
      const billing = await store.getBusinessBilling(businessId);

      if (!billing.stripeCustomerId) {
        reply.code(400);
        return { error: "No billing account found" };
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url: `${env.FRONTEND_BASE_URL}/dashboard`,
      });

      return { portalUrl: session.url };
    },
  );
}

// Stripe webhook — registered separately to handle raw body
export async function registerStripeWebhook(app: FastifyInstance): Promise<void> {
  app.post(
    "/webhooks/stripe",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      if (!isBillingEnabled() || !env.STRIPE_WEBHOOK_SECRET) {
        reply.code(400);
        return { error: "Stripe webhook not configured" };
      }

      const stripe = getStripe();
      const sig = request.headers["stripe-signature"] as string;
      const rawBody = (request as any).rawBody;

      if (!rawBody || !sig) {
        reply.code(400);
        return { error: "Missing signature or body" };
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
      } catch (err: any) {
        console.error("[stripe] Webhook signature verification failed:", err.message);
        reply.code(400);
        return { error: "Invalid signature" };
      }

      console.log(`[stripe] Received event: ${event.type}`);

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const businessId = session.metadata?.businessId;
          if (!businessId) break;

          await store.updateBusinessBilling(businessId, {
            onboardingPaid: true,
            subscriptionStatus: "active",
            stripeSubscriptionId: session.subscription as string,
          });
          console.log(`[stripe] Business ${businessId} — checkout completed, onboarding paid`);

          // Auto-start deep scan after payment
          try {
            const inboxes = await store.getGmailInboxes(businessId);
            if (inboxes.length > 0) {
              const existing = await store.getActiveScanJob(businessId);
              if (!existing) {
                const afterDate = new Date();
                afterDate.setFullYear(afterDate.getFullYear() - 3);
                const afterStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;
                const gmailQuery = `after:${afterStr} (has:attachment OR subject:(חשבונית OR invoice OR receipt OR קבלה OR payment OR תשלום OR billing OR הזמנה))`;
                await store.createScanJob(businessId, inboxes[0].id, gmailQuery, afterDate.toISOString().slice(0, 10));
                console.log(`[stripe] Auto-started deep scan for business ${businessId}`);
              }
            }
          } catch (err) {
            console.error("[stripe] Failed to auto-start deep scan:", err);
          }
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;
          const business = await store.getBusinessByStripeCustomerId(customerId);
          if (!business) break;

          const statusMap: Record<string, string> = {
            active: "active",
            past_due: "past_due",
            canceled: "canceled",
            unpaid: "past_due",
            trialing: "active",
          };
          await store.updateBusinessBilling(business.id, {
            subscriptionStatus: statusMap[subscription.status] ?? subscription.status,
          });
          console.log(`[stripe] Business ${business.id} subscription → ${subscription.status}`);
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;
          const business = await store.getBusinessByStripeCustomerId(customerId);
          if (!business) break;

          await store.updateBusinessBilling(business.id, {
            subscriptionStatus: "canceled",
          });
          console.log(`[stripe] Business ${business.id} subscription canceled`);
          break;
        }
      }

      return { received: true };
    },
  );
}
