/**
 * Olumi Assistants SDK Client
 *
 * Official TypeScript client for Olumi Assistants Service
 */

import type {
  OlumiConfig,
  DraftGraphRequest,
  DraftGraphResponse,
  SuggestOptionsRequest,
  SuggestOptionsResponse,
  ClarifyBriefRequest,
  ClarifyBriefResponse,
  CritiqueGraphRequest,
  CritiqueGraphResponse,
  ExplainDiffRequest,
  ExplainDiffResponse,
  EvidencePackRequest,
  EvidencePackResponse,
  ErrorResponse,
} from "./types.js";
import { OlumiAPIError, OlumiNetworkError, OlumiConfigError } from "./errors.js";

export class OlumiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: OlumiConfig) {
    if (!config.apiKey) {
      throw new OlumiConfigError("API key is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://olumi-assistants-service.onrender.com";
    this.timeout = config.timeout || 60000;
  }

  /**
   * Draft a decision graph from a brief description
   */
  async draftGraph(request: DraftGraphRequest): Promise<DraftGraphResponse> {
    return this.request<DraftGraphResponse>("/assist/draft-graph", request);
  }

  /**
   * Suggest new options for a question node
   */
  async suggestOptions(request: SuggestOptionsRequest): Promise<SuggestOptionsResponse> {
    return this.request<SuggestOptionsResponse>("/assist/suggest-options", request);
  }

  /**
   * Generate clarifying questions for an ambiguous brief
   */
  async clarifyBrief(request: ClarifyBriefRequest): Promise<ClarifyBriefResponse> {
    return this.request<ClarifyBriefResponse>("/assist/clarify-brief", request);
  }

  /**
   * Critique a decision graph for quality issues
   */
  async critiqueGraph(request: CritiqueGraphRequest): Promise<CritiqueGraphResponse> {
    return this.request<CritiqueGraphResponse>("/assist/critique-graph", request);
  }

  /**
   * Explain the differences between two graph versions
   */
  async explainDiff(request: ExplainDiffRequest): Promise<ExplainDiffResponse> {
    return this.request<ExplainDiffResponse>("/assist/explain-diff", request);
  }

  /**
   * Generate supporting evidence for a node
   */
  async evidencePack(request: EvidencePackRequest): Promise<EvidencePackResponse> {
    return this.request<EvidencePackResponse>("/assist/evidence-pack", request);
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ status: string; version: string }> {
    const response = await fetch(`${this.baseUrl}/healthz`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new OlumiNetworkError(`Health check failed: ${response.status}`);
    }

    return response.json() as Promise<{ status: string; version: string }>;
  }

  /**
   * Internal request helper
   */
  private async request<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": this.apiKey,
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();

      if (!response.ok) {
        const error = data as ErrorResponse;
        throw new OlumiAPIError(response.status, error);
      }

      return data as T;
    } catch (error) {
      if (error instanceof OlumiAPIError) {
        throw error;
      }

      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new OlumiNetworkError("Network request failed", error as Error);
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new OlumiNetworkError(`Request timeout after ${this.timeout}ms`);
      }

      throw new OlumiNetworkError("Unknown error", error as Error);
    }
  }
}
