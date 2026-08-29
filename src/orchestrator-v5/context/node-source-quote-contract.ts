/** Leaf contract shared by final ContextPack binding, schema and telemetry. */

export const SOURCE_QUOTE_POLICY = 'exact_or_withheld' as const;
export const SOURCE_QUOTE_POLICY_VERSION = 1 as const;
/** ECMAScript Unicode code points, not UTF-16 code units. */
export const SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT = 512;
/** Candidate nodes, not total graph nodes and not quote-only nodes. */
export const SOURCE_QUOTE_CANDIDATE_NODE_LIMIT = 50;
/** Exact final buildUserMessage additive delta, measured in UTF-16 units. */
export const SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT = 4_096;
/** Compact JSON size of the content-free in-band disclosure. */
export const SOURCE_QUOTE_DISCLOSURE_UTF16_LIMIT = 512;

export interface SourceQuotesContextBudgetDisclosure {
  readonly policy: typeof SOURCE_QUOTE_POLICY;
  readonly version: typeof SOURCE_QUOTE_POLICY_VERSION;
  readonly per_quote_code_point_limit: typeof SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT;
  readonly candidate_node_limit: typeof SOURCE_QUOTE_CANDIDATE_NODE_LIMIT;
  readonly prompt_delta_utf16_limit: typeof SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT;
  /** Nodes with an own string-valued quote (including empty) or literal authored=true. */
  readonly candidate_count: number;
  /** Candidate nodes retaining at least one feature field in the final prompt. */
  readonly retained_count: number;
  /** Explicit empty strings withheld whole. */
  readonly empty_quote_withheld_count: number;
  /** Non-empty quotes withheld whole for exceeding the code-point limit. */
  readonly per_quote_withheld_count: number;
  /** Candidate nodes withheld as a whole because the candidate wall was exceeded. */
  readonly node_limit_withheld_count: number;
  /** Nodes with otherwise eligible fields withheld by aggregate/headroom fallback. */
  readonly aggregate_withheld_count: number;
}
