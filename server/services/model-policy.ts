// ── Model policy ───────────────────────────────────────────────
//
// Every model id in this service is resolved at RUNTIME: AI_MODEL_CHEAP and
// AI_MODEL_EXPENSIVE come from the environment, and deep-scan passes a per-call
// override. Nothing at author time can see which model an invocation will really
// use, so the ban has to be enforced on the wire.
//
// Claude Fable is banned outright (Ziv, 12-Sep-2026) after a single API key billed
// $2,723.46, $2,015.65 of it in 21 hours. Anthropic offers no per-key model
// allowlist, so this check is the only enforcement that exists.
//
// The check is a PATTERN, not an id list, so a dated snapshot or a future release
// of the same family cannot slip past it.

export const DENIED_MODEL_PATTERN = /fable/i;

export function assertModelAllowed(model: unknown): void {
  if (typeof model !== "string" || !DENIED_MODEL_PATTERN.test(model)) return;
  throw new Error(
    `[model-policy] Send-to-Amram refused to call "${model}". Claude Fable is banned (Ziv, 12-Sep-2026).`,
  );
}

// Only the value of a JSON key literally named "model" - invoice text travelling in
// the same body is escaped (\"model\") and can never match, so a vendor called
// "Fable" cannot block a legitimate extraction.
const MODEL_FIELD = /"model"\s*:\s*"([^"]+)"/g;

export function assertRequestBodyAllowed(body: unknown): void {
  if (typeof body !== "string") return;
  for (const match of body.matchAll(MODEL_FIELD)) assertModelAllowed(match[1]);
}

type AnyCall = (...args: any[]) => any;

/**
 * Wraps an Anthropic SDK client in place, once, at construction - so no future call
 * site can forget the check. Two layers on purpose: messages.create/stream throw
 * synchronously at the call site (readable stack), and the client's own fetch is the
 * backstop every other resource (batches, beta, token counting) still has to cross.
 */
export function guardAnthropicClient<T>(client: T): T {
  const target = client as any;
  if (!target) return client;

  const messages = target.messages as { create?: AnyCall; stream?: AnyCall } | undefined;
  if (messages) {
    for (const method of ["create", "stream"] as const) {
      const original = messages[method];
      if (typeof original !== "function") continue;
      const bound = original.bind(messages);
      messages[method] = (body: any, ...rest: any[]) => {
        assertModelAllowed(body?.model);
        return bound(body, ...rest);
      };
    }
  }

  if (typeof target.fetch === "function") {
    const originalFetch = target.fetch as AnyCall;
    target.fetch = (url: any, init?: any) => {
      assertRequestBodyAllowed(init?.body);
      return originalFetch.call(undefined, url, init);
    };
  }

  return client;
}
