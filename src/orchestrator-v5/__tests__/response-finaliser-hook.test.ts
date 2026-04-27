/**
 * V5 finaliser — runtime hook tests (mechanism B).
 *
 * The preSerialization hook is the runtime half of the defence-in-depth
 * contract. Mechanism A (type brand + status-keyed Reply) catches Fastify
 * send-shape bypasses at compile time. This hook catches casts that
 * evaded the type system at runtime — substitutes the egress-violation
 * fallback, logs `v5.finaliser.bypass_detected` for production
 * observability.
 *
 * Tests cover:
 *   1. Non-V5 routes (route URL mismatch) → payload returned unchanged
 *   2. V5 route, non-200 status → payload returned unchanged
 *   3. V5 route, 200, branded payload → payload returned unchanged
 *   4. V5 route, 200, unbranded payload → fallback substituted
 *
 * Cases 1-3 are negative: the hook must NOT fire substitution. Case 4 is
 * the positive bypass-detection case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

import { v5FinaliserPreSerializationHook } from '../../orchestrator/route-v2.js';
import { finaliseV5Response } from '../response-finaliser.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

function makeRequest(routeUrl: string): FastifyRequest {
  return {
    routeOptions: { url: routeUrl },
    headers: { 'x-request-id': 'test-req-id' },
  } as unknown as FastifyRequest;
}

function makeReply(statusCode: number): FastifyReply {
  return { statusCode } as unknown as FastifyReply;
}

const RAW_OLUMI_RESPONSE: OlumiResponse = {
  response_version: 2,
  assistant_text: 'raw',
  blocks: [],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'frame',
};

describe('v5FinaliserPreSerializationHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes payload through unchanged on non-V5 routes', async () => {
    const result = await v5FinaliserPreSerializationHook(
      makeRequest('/some/other/route'),
      makeReply(200),
      RAW_OLUMI_RESPONSE,
    );
    expect(result).toBe(RAW_OLUMI_RESPONSE);
  });

  it('passes payload through unchanged on V5 route with non-200 status', async () => {
    const result = await v5FinaliserPreSerializationHook(
      makeRequest('/orchestrate/v2/turn'),
      makeReply(500),
      { request_id: 'r', error: 'INTERNAL_ERROR', validator: 'x' } as unknown,
    );
    expect((result as { error: string }).error).toBe('INTERNAL_ERROR');
  });

  it('passes branded payload through on V5 route 200', async () => {
    const branded = finaliseV5Response(RAW_OLUMI_RESPONSE, {});
    const result = await v5FinaliserPreSerializationHook(
      makeRequest('/orchestrate/v2/turn'),
      makeReply(200),
      branded,
    );
    expect(result).toBe(branded);
  });

  it('substitutes fallback when V5 route 200 receives an unbranded payload', async () => {
    const result = (await v5FinaliserPreSerializationHook(
      makeRequest('/orchestrate/v2/turn'),
      makeReply(200),
      RAW_OLUMI_RESPONSE,
    )) as OlumiResponse;
    expect(result).not.toBe(RAW_OLUMI_RESPONSE);
    expect(result.response_version).toBe(2);
    expect(result.blocks).toHaveLength(1);
    expect((result.blocks[0] as { type: string; error_code: string }).type).toBe('error');
    expect((result.blocks[0] as { type: string; error_code: string }).error_code).toBe(
      'EGRESS_CONTRACT_VIOLATION',
    );
  });

  it('detects bypass even when payload structurally matches OlumiResponse — only WeakSet membership counts', async () => {
    // The bypass detection is identity-based, not shape-based. Two payloads
    // with identical content but different references are distinguishable:
    // only the one that went through `finaliseV5Response` is in the WeakSet.
    const branded = finaliseV5Response(RAW_OLUMI_RESPONSE, {});
    const lookalike = { ...branded }; // structurally identical, fresh reference
    const out = (await v5FinaliserPreSerializationHook(
      makeRequest('/orchestrate/v2/turn'),
      makeReply(200),
      lookalike,
    )) as OlumiResponse;
    // Lookalike was not in the WeakSet → fallback substituted
    expect(out.blocks).toHaveLength(1);
    expect((out.blocks[0] as { error_code: string }).error_code).toBe(
      'EGRESS_CONTRACT_VIOLATION',
    );
  });
});
