import { describe, it, expect, vi } from "vitest";
import {
  assertModelAllowed,
  assertRequestBodyAllowed,
  guardAnthropicClient,
} from "../../server/services/model-policy";

// Model ids reach the SDK from env vars and per-call overrides, so the ban can only
// be proven at runtime. Built from parts so the id never appears literally in source.
const BANNED_MODEL = ["claude-", "fable-5-1"].join("");
const BANNED_SNAPSHOT = `${BANNED_MODEL}-20260214`;
const ALLOWED_MODEL = "claude-sonnet-5";

describe("model policy", () => {
  it("rejects the banned family, dated snapshots and future releases", () => {
    const banned = [BANNED_MODEL, BANNED_SNAPSHOT, ["claude-", "fable-6"].join(""), "CLAUDE-FABLE-9"];
    for (const model of banned) {
      expect(() => assertModelAllowed(model)).toThrow(/model-policy/);
    }
  });

  it("allows the models this repo actually uses", () => {
    for (const model of [ALLOWED_MODEL, "claude-haiku-4-5-20251001", "claude-opus-4-1"]) {
      expect(() => assertModelAllowed(model)).not.toThrow();
    }
  });

  it("blocks a guarded client before the request is made", () => {
    const create = vi.fn().mockResolvedValue({ ok: true });
    const client = guardAnthropicClient({ messages: { create } });

    expect(() => client.messages.create({ model: BANNED_SNAPSHOT, max_tokens: 8 })).toThrow(
      /Claude Fable is banned/,
    );
    expect(create).not.toHaveBeenCalled();

    client.messages.create({ model: ALLOWED_MODEL, max_tokens: 8 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("blocks at the client's fetch, so no SDK resource can route around it", () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const client = guardAnthropicClient({ fetch }) as { fetch: typeof fetch };

    const bannedBody = JSON.stringify({ model: BANNED_MODEL, max_tokens: 8 });
    expect(() => client.fetch("https://api.anthropic.com/v1/messages", { body: bannedBody })).toThrow(
      /Claude Fable is banned/,
    );

    const bannedBatch = JSON.stringify({ requests: [{ params: { model: BANNED_SNAPSHOT } }] });
    expect(() => client.fetch("https://api.anthropic.com/v1/messages/batches", { body: bannedBatch })).toThrow(
      /Claude Fable is banned/,
    );
    expect(fetch).not.toHaveBeenCalled();

    client.fetch("https://api.anthropic.com/v1/messages", {
      body: JSON.stringify({ model: ALLOWED_MODEL, max_tokens: 8 }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not misfire on invoice content that merely mentions the banned word", () => {
    const invoiceText = `Fable Ltd invoice, note: "model": "${BANNED_MODEL}" quoted by the vendor`;
    const body = JSON.stringify({
      model: ALLOWED_MODEL,
      messages: [{ role: "user", content: invoiceText }],
    });
    expect(() => assertRequestBodyAllowed(body)).not.toThrow();
  });
});
