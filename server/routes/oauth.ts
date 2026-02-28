import { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config";
import { store } from "../store";
import {
  OAuthProvider,
  buildOAuthStartUrl,
  exchangeOAuthCode,
  fetchOAuthProfile,
  isOAuthConfigured,
  parseOAuthState,
} from "../services/oauth";

const providerSchema = z.object({
  provider: z.enum(["gmail", "outlook"]),
});

const startQuerySchema = z.object({
  businessId: z.string().min(1),
});

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

function onboardingRedirect(params: {
  status: "success" | "error";
  provider: OAuthProvider;
  businessId?: string;
  message?: string;
  displayName?: string;
}): string {
  const query = new URLSearchParams();
  query.set("oauth", params.status);
  query.set("provider", params.provider);
  if (params.businessId) {
    query.set("businessId", params.businessId);
  }
  if (params.message) {
    query.set("message", params.message);
  }
  if (params.displayName) {
    query.set("displayName", params.displayName);
  }
  return `${env.FRONTEND_BASE_URL}/onboarding?${query.toString()}`;
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/oauth/:provider/start", async (request) => {
    const { provider } = providerSchema.parse(request.params);
    const { businessId } = startQuerySchema.parse(request.query);
    store.getOnboardingState(businessId);

    if (!isOAuthConfigured(provider, env)) {
      throw new Error(`${provider} OAuth is not configured on the server`);
    }
    return {
      provider,
      authUrl: buildOAuthStartUrl(provider, businessId, env),
    };
  });

  app.get("/oauth/:provider/callback", async (request, reply) => {
    const { provider } = providerSchema.parse(request.params);
    const query = callbackQuerySchema.parse(request.query);

    if (query.error) {
      return reply.redirect(
        onboardingRedirect({
          status: "error",
          provider,
          message: query.error_description ?? query.error,
        }),
      );
    }
    if (!query.code || !query.state) {
      return reply.redirect(
        onboardingRedirect({
          status: "error",
          provider,
          message: "Missing OAuth callback parameters",
        }),
      );
    }

    const state = parseOAuthState(query.state, env);
    if (!state || state.provider !== provider) {
      return reply.redirect(
        onboardingRedirect({
          status: "error",
          provider,
          message: "Invalid OAuth state",
        }),
      );
    }

    try {
      const tokens = await exchangeOAuthCode(provider, query.code, env);
      const profile = await fetchOAuthProfile(provider, tokens.accessToken, env);
      store.upsertOAuthInbox({
        businessId: state.businessId,
        provider,
        email: profile.email,
        externalAccountId: profile.externalAccountId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        expiresAt: tokens.expiresAt,
      });

      // Save the user's display name from their Google/Outlook profile
      if (profile.displayName) {
        try {
          await store.updateOwnerName(state.businessId, profile.displayName);
        } catch {
          // Non-critical - name is nice to have
        }
      }

      return reply.redirect(
        onboardingRedirect({
          status: "success",
          provider,
          businessId: state.businessId,
          displayName: profile.displayName ?? undefined,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth connection failed";
      return reply.redirect(
        onboardingRedirect({
          status: "error",
          provider,
          businessId: state.businessId,
          message,
        }),
      );
    }
  });
}
