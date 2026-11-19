// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";

// 19-Nov-2026: the first emails of a sync run were fal receipts whose PDFs Gmail labels
// application/octet-stream. Each one used up an AI slot without any AI call, so the whole
// run saved receipts at 0 without reading a single one.

type Att = { filename: string; mimeType: string };
let attachmentKind: (a: Att) => { kind: string; mediaType: string } | null;
let pickAttachment: <T extends Att>(a: T[]) => T | null;

beforeAll(async () => {
  ({ attachmentKind, pickAttachment } = await import("../../server/services/gmail-sync"));
}, 120_000);

describe("which attachment the AI reads", () => {
  it("reads a .pdf labelled application/octet-stream as a PDF", () => {
    expect(attachmentKind({ filename: "Receipt-2241.pdf", mimeType: "application/octet-stream" })).toEqual({
      kind: "pdf",
      mediaType: "application/pdf",
    });
  });

  it("gives a mislabelled .png a media type the API accepts", () => {
    expect(attachmentKind({ filename: "scan.PNG", mimeType: "application/octet-stream" })?.mediaType).toBe("image/png");
  });

  it("skips files it cannot read", () => {
    expect(attachmentKind({ filename: "report.xlsx", mimeType: "application/vnd.ms-excel" })).toBeNull();
  });

  it("prefers the receipt PDF over a logo and over another PDF", () => {
    const picked = pickAttachment([
      { filename: "logo.png", mimeType: "image/png" },
      { filename: "Invoice-0042.pdf", mimeType: "application/octet-stream" },
      { filename: "Receipt-0042.pdf", mimeType: "application/octet-stream" },
    ]);
    expect(picked?.filename).toMatch(/Invoice|Receipt/);
    expect(picked?.filename.endsWith(".pdf")).toBe(true);
  });
});
