// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// The reader used only the first block of the reply. Newer models (the 5.5 family) think by
// default, so the first block is a thinking block and every receipt came back as 0 / "unknown".

let parseExtractedJson: (response: Anthropic.Message) => {
  vendorName: string; amountCents: number; currency: string; isReceipt?: boolean; confidence: number;
};

beforeAll(async () => {
  ({ parseExtractedJson } = await import("../../server/services/ai"));
}, 120_000);

function reply(content: unknown[]): Anthropic.Message {
  return { content } as unknown as Anthropic.Message;
}

const RECEIPT_JSON =
  '{"vendorName":"fal - Features & Labels, Inc.","amountCents":1000,"currency":"USD","vatCents":null,' +
  '"issuedAt":"2026-11-19","type":"RECEIPT","category":"תוכנה","confidence":0.9,"isReceipt":true}';

describe("reading the AI reply", () => {
  it("reads the JSON when a thinking block comes first", () => {
    const r = parseExtractedJson(reply([
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: RECEIPT_JSON },
    ]));
    expect(r.vendorName).toBe("fal - Features & Labels, Inc.");
    expect(r.amountCents).toBe(1000);
    expect(r.currency).toBe("USD");
  });

  it("reads the JSON when the model wraps it in a sentence or a code fence", () => {
    const r = parseExtractedJson(reply([{ type: "text", text: "Here it is:\n```json\n" + RECEIPT_JSON + "\n```" }]));
    expect(r.amountCents).toBe(1000);
  });

  it("keeps the model's verdict that an email is not a receipt", () => {
    const r = parseExtractedJson(reply([{ type: "text", text: RECEIPT_JSON.replace('"isReceipt":true', '"isReceipt":false') }]));
    expect(r.isReceipt).toBe(false);
  });

  it("treats a missing verdict as a receipt", () => {
    const r = parseExtractedJson(reply([{ type: "text", text: RECEIPT_JSON.replace(',"isReceipt":true', "") }]));
    expect(r.isReceipt).toBe(true);
  });
});
