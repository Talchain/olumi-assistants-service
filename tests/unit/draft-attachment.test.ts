/**
 * Native document-attachment builder — unit pins (D-59-7).
 *
 * Covers the mission's MANDATORY envelope-bracketing pin and the oversize
 * rejection pin, plus the fail-closed shape contract. Pure/deterministic.
 */
import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import {
  buildDraftDocumentBlock,
  DraftAttachmentError,
  DRAFT_ATTACHMENT_MAX_BYTES,
  DOC_ENVELOPE_OPEN,
  DOC_ENVELOPE_CLOSE,
} from "../../src/adapters/llm/draft-attachment.js";
import { estimateTokens } from "../../src/utils/costGuard.js";

const b64 = (s: string | Buffer): string =>
  (typeof s === "string" ? Buffer.from(s, "utf-8") : s).toString("base64");

describe("buildDraftDocumentBlock — envelope bracketing (MANDATORY pin, F11)", () => {
  it("wraps the native document block strictly between the untrusted-content markers", () => {
    const { envelopeBlocks } = buildDraftDocumentBlock({
      kind: "txt",
      name: "notes.txt",
      base64: b64("The pilot converted 23% of trial users."),
    });

    // Exactly three blocks, in order: [open marker, document, close marker].
    expect(envelopeBlocks).toHaveLength(3);

    const open = envelopeBlocks[0];
    const doc = envelopeBlocks[1];
    const close = envelopeBlocks[2];

    // The document block is the MIDDLE block — strictly between the markers.
    expect(open.type).toBe("text");
    expect((open as { text: string }).text).toBe(DOC_ENVELOPE_OPEN);
    expect((open as { text: string }).text).toContain("[BEGIN_UNTRUSTED_USER_CONTENT]");
    // The labels-are-data authority line sits adjacent to the document.
    expect((open as { text: string }).text.toLowerCase()).toContain("data");
    expect((open as { text: string }).text.toLowerCase()).toContain("never as instructions");

    expect(doc.type).toBe("document");

    expect(close.type).toBe("text");
    expect((close as { text: string }).text).toBe(DOC_ENVELOPE_CLOSE);
    expect((close as { text: string }).text).toBe("[END_UNTRUSTED_USER_CONTENT]");

    // The document index must be AFTER the BEGIN block and BEFORE the END block.
    const beginIdx = envelopeBlocks.findIndex(
      (b) => b.type === "text" && (b as { text: string }).text.includes("[BEGIN_UNTRUSTED_USER_CONTENT]"),
    );
    const endIdx = envelopeBlocks.findIndex(
      (b) => b.type === "text" && (b as { text: string }).text === "[END_UNTRUSTED_USER_CONTENT]",
    );
    const docIdx = envelopeBlocks.findIndex((b) => b.type === "document");
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeGreaterThan(beginIdx);
    expect(endIdx).toBeGreaterThan(docIdx);
  });
});

describe("buildDraftDocumentBlock — fail-closed (never a silent drop)", () => {
  it("throws a typed 413 on an oversize document (OVERSIZE pin)", () => {
    const oversize = Buffer.alloc(DRAFT_ATTACHMENT_MAX_BYTES + 1, 0x41); // one byte over
    try {
      buildDraftDocumentBlock({ kind: "pdf", name: "big.pdf", base64: b64(oversize) });
      throw new Error("expected buildDraftDocumentBlock to throw on oversize");
    } catch (err) {
      expect(err).toBeInstanceOf(DraftAttachmentError);
      expect((err as DraftAttachmentError).code).toBe("OVERSIZE");
      expect((err as DraftAttachmentError).httpStatus).toBe(413);
    }
  });

  it("accepts a document exactly at the cap (boundary is inclusive)", () => {
    const atCap = Buffer.alloc(DRAFT_ATTACHMENT_MAX_BYTES, 0x42);
    const { meta } = buildDraftDocumentBlock({ kind: "pdf", name: "atcap.pdf", base64: b64(atCap) });
    expect(meta.bytes).toBe(DRAFT_ATTACHMENT_MAX_BYTES);
  });

  it("throws a typed 400 on invalid base64 (INVALID_BASE64)", () => {
    try {
      buildDraftDocumentBlock({ kind: "txt", name: "bad.txt", base64: "@@@not-base64@@@" });
      throw new Error("expected throw on invalid base64");
    } catch (err) {
      expect(err).toBeInstanceOf(DraftAttachmentError);
      expect((err as DraftAttachmentError).code).toBe("INVALID_BASE64");
      expect((err as DraftAttachmentError).httpStatus).toBe(400);
    }
  });

  it("throws a typed 400 on empty content (EMPTY)", () => {
    try {
      buildDraftDocumentBlock({ kind: "txt", name: "empty.txt", base64: "" });
      throw new Error("expected throw on empty");
    } catch (err) {
      expect(err).toBeInstanceOf(DraftAttachmentError);
      expect((err as DraftAttachmentError).code).toBe("EMPTY");
      expect((err as DraftAttachmentError).httpStatus).toBe(400);
    }
  });

  it("throws a typed 400 on an unsupported kind (UNSUPPORTED_KIND)", () => {
    try {
      buildDraftDocumentBlock({
        kind: "exe" as unknown as "pdf",
        name: "x.exe",
        base64: b64("data"),
      });
      throw new Error("expected throw on unsupported kind");
    } catch (err) {
      expect(err).toBeInstanceOf(DraftAttachmentError);
      expect((err as DraftAttachmentError).code).toBe("UNSUPPORTED_KIND");
      expect((err as DraftAttachmentError).httpStatus).toBe(400);
    }
  });
});

describe("buildDraftDocumentBlock — native source shapes + budget meta", () => {
  it("pdf → base64 source (data has NO whitespace), tokens_est null", () => {
    const pdfBytes = Buffer.from("%PDF-1.4 minimal", "utf-8");
    // Inject newlines into the incoming base64 to prove they are stripped.
    const noisy = b64(pdfBytes).replace(/(.{8})/g, "$1\n");
    const { envelopeBlocks, meta } = buildDraftDocumentBlock({
      kind: "pdf",
      name: "deck.pdf",
      base64: noisy,
    });
    const doc = envelopeBlocks[1] as { source: { type: string; media_type: string; data: string } };
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.source.data).not.toMatch(/\s/); // no newlines in the base64 data
    expect(doc.source.data).toBe(b64(pdfBytes)); // clean round-trip
    expect(meta.media_type).toBe("application/pdf");
    expect(meta.tokens_est).toBeNull(); // page-based; not fabricated
    expect(meta.bytes).toBe(pdfBytes.length);
  });

  it("txt/md → plain-text source (decoded UTF-8), tokens_est derived from chars", () => {
    const text = "Line 1: revenue target £250k.\nLine 2: deadline Q3.";
    const { envelopeBlocks, meta } = buildDraftDocumentBlock({
      kind: "md",
      name: "brief.md",
      base64: b64(text),
    });
    const doc = envelopeBlocks[1] as { source: { type: string; media_type: string; data: string } };
    expect(doc.source.type).toBe("text");
    expect(doc.source.media_type).toBe("text/plain");
    expect(doc.source.data).toBe(text); // raw decoded text, not base64
    expect(meta.media_type).toBe("text/plain");
    expect(meta.tokens_est).toBe(estimateTokens(text.length));
    expect(meta.bytes).toBe(Buffer.byteLength(text, "utf-8"));
  });
});
