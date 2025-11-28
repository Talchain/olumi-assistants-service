import type {
  CEEDraftGraphRequestV1,
  CEEDraftGraphResponseV1,
  CEEExplainGraphRequestV1,
  CEEExplainGraphResponseV1,
  CEEEvidenceHelperRequestV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckRequestV1,
  CEEBiasCheckResponseV1,
  CEEOptionsRequestV1,
  CEEOptionsResponseV1,
  CEESensitivityCoachRequestV1,
  CEESensitivityCoachResponseV1,
  CEETeamPerspectivesRequestV1,
  CEETeamPerspectivesResponseV1,
  CEEErrorResponseV1,
} from "./ceeTypes.js";
import type { OlumiConfig, RequestOptions, ErrorResponse } from "./types.js";
import { OlumiConfigError, OlumiAPIError, OlumiNetworkError } from "./errors.js";

export interface CEEClient {
  draftGraph(
    body: CEEDraftGraphRequestV1,
    options?: RequestOptions,
  ): Promise<CEEDraftGraphResponseV1>;

  explainGraph(
    body: CEEExplainGraphRequestV1,
    options?: RequestOptions,
  ): Promise<CEEExplainGraphResponseV1>;

  evidenceHelper(
    body: CEEEvidenceHelperRequestV1,
    options?: RequestOptions,
  ): Promise<CEEEvidenceHelperResponseV1>;

  biasCheck(
    body: CEEBiasCheckRequestV1,
    options?: RequestOptions,
  ): Promise<CEEBiasCheckResponseV1>;

  options(
    body: CEEOptionsRequestV1,
    options?: RequestOptions,
  ): Promise<CEEOptionsResponseV1>;

  sensitivityCoach(
    body: CEESensitivityCoachRequestV1,
    options?: RequestOptions,
  ): Promise<CEESensitivityCoachResponseV1>;

  teamPerspectives(
    body: CEETeamPerspectivesRequestV1,
    options?: RequestOptions,
  ): Promise<CEETeamPerspectivesResponseV1>;
}

interface InternalConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}

function validateConfig(config: OlumiConfig): InternalConfig {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new OlumiConfigError("API key is required");
  }

  const baseUrl = config.baseUrl || "https://olumi-assistants-service.onrender.com";

  try {
    // Validate base URL is a well-formed HTTP(S) URL
    // eslint-disable-next-line no-new
    new URL(baseUrl);
  } catch {
    throw new OlumiConfigError(
      `Invalid base URL: ${baseUrl}. Must be a valid HTTP(S) URL.`,
    );
  }

  const timeout = config.timeout && config.timeout > 0 ? config.timeout : 60_000;

  return {
    apiKey: config.apiKey,
    baseUrl,
    timeout,
  };
}

function buildTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  // Best-effort cleanup; consumers should not rely on this for critical logic.
  controller.signal.addEventListener("abort", () => clearTimeout(id));
  return controller.signal;
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof (AbortSignal as any).any === "function") {
    return (AbortSignal as any).any([a, b]);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
  } else {
    a.addEventListener("abort", abort);
    b.addEventListener("abort", abort);
  }
  return controller.signal;
}

async function requestCEE<T>(
  cfg: InternalConfig,
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const timeoutMs = options?.timeout && options.timeout > 0 ? options.timeout : cfg.timeout;

  let signal: AbortSignal;
  const timeoutSignal = buildTimeoutSignal(timeoutMs);

  if (options?.signal) {
    signal = combineSignals(options.signal, timeoutSignal);
  } else {
    signal = timeoutSignal;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Olumi-Assist-Key": cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    const text = await response.text();

    if (!response.ok) {
      // Try to parse a structured CEE error first, then fall back to a generic
      // error response compatible with OlumiAPIError.
      let apiError: OlumiAPIError;

      try {
        const raw = text ? (JSON.parse(text) as unknown) : undefined;
        apiError = mapToOlumiAPIError(response.status, response.statusText, raw);
      } catch {
        const fallback: ErrorResponse = {
          schema: "error.v1",
          code: (response.status >= 500 ? "INTERNAL" : "BAD_INPUT") as ErrorResponse["code"],
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
        apiError = new OlumiAPIError(response.status, fallback);
      }

      throw apiError;
    }

    if (!text) {
      // CEE endpoints always return JSON bodies on success; an empty body is a
      // server bug and surfaced as an API error.
      const err: ErrorResponse = {
        schema: "error.v1",
        code: "INTERNAL",
        message: "Server returned empty response body",
      };
      throw new OlumiAPIError(response.status, err);
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as T;
    } catch {
      const err: ErrorResponse = {
        schema: "error.v1",
        code: "INTERNAL",
        message: "Server returned malformed JSON",
      };
      throw new OlumiAPIError(response.status, err);
    }

    return data as T;
  } catch (error) {
    if (error instanceof OlumiAPIError) {
      throw error;
    }

    // Handle abort/timeout
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OlumiNetworkError(`Request timeout after ${timeoutMs}ms`, {
        timeout: true,
        cause: error,
      });
    }

    // Handle generic fetch/network failures
    if (error instanceof TypeError || (error instanceof Error && error.message.toLowerCase().includes("fetch"))) {
      throw new OlumiNetworkError("Network request failed", { cause: error });
    }

    throw new OlumiNetworkError("Unknown error", { cause: error });
  }
}

function mapToOlumiAPIError(
  status: number,
  statusText: string,
  raw: unknown,
): OlumiAPIError {
  // CEE error shape: CEEErrorResponseV1
  if (raw && typeof raw === "object" && (raw as any).schema === "cee.error.v1") {
    const cee = raw as CEEErrorResponseV1;

    const anyCee = cee as any;
    const baseDetails: Record<string, unknown> =
      cee.details && typeof cee.details === "object" ? { ...cee.details } : {};

    if (anyCee.reason !== undefined && (baseDetails as any).reason === undefined) {
      (baseDetails as any).reason = anyCee.reason;
    }
    if (anyCee.recovery !== undefined && (baseDetails as any).recovery === undefined) {
      (baseDetails as any).recovery = anyCee.recovery;
    }
    if (typeof anyCee.node_count === "number" && (baseDetails as any).node_count === undefined) {
      (baseDetails as any).node_count = anyCee.node_count;
    }
    if (typeof anyCee.edge_count === "number" && (baseDetails as any).edge_count === undefined) {
      (baseDetails as any).edge_count = anyCee.edge_count;
    }
    if (
      Array.isArray(anyCee.missing_kinds) &&
      (baseDetails as any).missing_kinds === undefined
    ) {
      (baseDetails as any).missing_kinds = anyCee.missing_kinds;
    }

    const details: Record<string, unknown> = {
      ...baseDetails,
      cee_code: cee.code,
      cee_retryable: cee.retryable === true,
      cee_trace: cee.trace,
    };

    const errorResponse: ErrorResponse = {
      schema: "error.v1",
      code: cee.code as any,
      message: cee.message,
      details,
      request_id: cee.trace?.request_id,
    };

    return new OlumiAPIError(status, errorResponse);
  }

  const anyRaw = raw as any;

  const fallback: ErrorResponse = {
    schema: "error.v1",
    code: (typeof anyRaw?.code === "string"
      ? (anyRaw.code as any)
      : (status >= 500 ? "INTERNAL" : "BAD_INPUT")) as ErrorResponse["code"],
    message:
      typeof anyRaw?.message === "string"
        ? anyRaw.message
        : `HTTP ${status}: ${statusText}`,
    details: anyRaw?.details,
    request_id: typeof anyRaw?.request_id === "string" ? anyRaw.request_id : undefined,
  };

  return new OlumiAPIError(status, fallback);
}

class DefaultCEEClient implements CEEClient {
  private readonly cfg: InternalConfig;

  constructor(config: OlumiConfig) {
    this.cfg = validateConfig(config);
  }

  draftGraph(
    body: CEEDraftGraphRequestV1,
    options?: RequestOptions,
  ): Promise<CEEDraftGraphResponseV1> {
    return requestCEE<CEEDraftGraphResponseV1>(this.cfg, "/assist/v1/draft-graph", body, options);
  }

  explainGraph(
    body: CEEExplainGraphRequestV1,
    options?: RequestOptions,
  ): Promise<CEEExplainGraphResponseV1> {
    return requestCEE<CEEExplainGraphResponseV1>(this.cfg, "/assist/v1/explain-graph", body, options);
  }

  evidenceHelper(
    body: CEEEvidenceHelperRequestV1,
    options?: RequestOptions,
  ): Promise<CEEEvidenceHelperResponseV1> {
    return requestCEE<CEEEvidenceHelperResponseV1>(this.cfg, "/assist/v1/evidence-helper", body, options);
  }

  biasCheck(
    body: CEEBiasCheckRequestV1,
    options?: RequestOptions,
  ): Promise<CEEBiasCheckResponseV1> {
    return requestCEE<CEEBiasCheckResponseV1>(this.cfg, "/assist/v1/bias-check", body, options);
  }

  options(
    body: CEEOptionsRequestV1,
    options?: RequestOptions,
  ): Promise<CEEOptionsResponseV1> {
    return requestCEE<CEEOptionsResponseV1>(this.cfg, "/assist/v1/options", body, options);
  }

  sensitivityCoach(
    body: CEESensitivityCoachRequestV1,
    options?: RequestOptions,
  ): Promise<CEESensitivityCoachResponseV1> {
    return requestCEE<CEESensitivityCoachResponseV1>(
      this.cfg,
      "/assist/v1/sensitivity-coach",
      body,
      options,
    );
  }

  teamPerspectives(
    body: CEETeamPerspectivesRequestV1,
    options?: RequestOptions,
  ): Promise<CEETeamPerspectivesResponseV1> {
    return requestCEE<CEETeamPerspectivesResponseV1>(
      this.cfg,
      "/assist/v1/team-perspectives",
      body,
      options,
    );
  }
}

export function createCEEClient(config: OlumiConfig): CEEClient {
  return new DefaultCEEClient(config);
}
