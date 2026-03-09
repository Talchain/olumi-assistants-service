/**
 * OpenAI provider unit tests.
 * Uses module-level mocking to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelConfig } from "../../src/providers/types.js";

const mockCreate = vi.fn();

// Mock the openai module before importing the provider.
// Use a plain function (not arrow) so `new OpenAI(...)` works.
vi.mock("openai", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockOpenAI(this: any) {
    this.responses = { create: mockCreate };
  }
  MockOpenAI.APIError = class APIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  };
  return { default: MockOpenAI };
});

const { OpenAIProvider } = await import("../../src/providers/openai-provider.js");

const BASE_CONFIG: ModelConfig = {
  id: "gpt-4o",
  provider: "openai",
  model: "gpt-4o",
  timeout_ms: 5000,
};

function setKey(val: string | undefined) {
  if (val === undefined) delete process.env["OPENAI_API_KEY"];
  else process.env["OPENAI_API_KEY"] = val;
}

beforeEach(() => {
  vi.clearAllMocks();
  setKey("test-key-abc");
});

describe("OpenAIProvider — success path", () => {
  it("returns ok:true with trimmed text", async () => {
    mockCreate.mockResolvedValueOnce({
      output_text: "  Hello world  ",
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    const provider = new OpenAIProvider();
    const result = await provider.chat("sys", "user msg", BASE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Hello world");
    expect(result.error).toBeNull();
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.input_tokens).toBe(20);
    expect(result.output_tokens).toBe(10);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("OpenAIProvider — failure paths", () => {
  it("returns ok:false when API key is missing", async () => {
    setKey(undefined);
    const provider = new OpenAIProvider();
    const result = await provider.chat("sys", "user", BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.error).toContain("OPENAI_API_KEY");
    expect(result.latency_ms).toBe(0);
  });

  it("returns ok:false with error string on API rejection", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Connection refused"));

    const provider = new OpenAIProvider();
    const result = await provider.chat("sys", "user", BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.error).toContain("Connection refused");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("does not throw on API failure — returns LLMResult", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Some error"));
    const provider = new OpenAIProvider();
    await expect(provider.chat("sys", "user", BASE_CONFIG)).resolves.toBeDefined();
  });
});
