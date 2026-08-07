/**
 * M2 production prompt candidate — contract pin (activation gate 1).
 *
 * The v0.4.3 benchmark prompt (Paul-adopted canonical baseline, 8 Jul) is
 * BENCHMARK-ONLY and contract-DIVERGENT from the live seam: it forbids
 * numeric edge parameters and label-identified endpoints, while the live
 * PROPOSALS_JSON_SCHEMA/merge REQUIRE node ids/kinds and full edge priors
 * (strength{mean,std}, exists_probability, effect_direction) with id-matched
 * endpoints. A literal upload of v0.4.3 would make every mutating proposal
 * fail schema validation (node_schema_invalid / edge_schema_invalid) and the
 * stage would permanently degrade with no_proposals_applied.
 *
 * This test pins the PRODUCTION candidate (tools/prompts/
 * olumi_m2_graph_review_v1.0.txt — the copy the PMS row is installed from)
 * to the live contract:
 *   - provisioned (sentinel-free, real length) and not benchmark-watermarked;
 *   - teaches all 7 proposal types and the object-root envelope;
 *   - teaches the live numeric edge contract and canonical node ids;
 *   - carries the engine-boundary FORBIDDEN vocabulary (G14 alignment);
 *   - clears the G17 sentinel gate through the REAL reviewDraftGraph wiring
 *     (fails on to the model-resolution gate, proving fail-closed order and
 *     that the candidate content itself never trips the sentinel check).
 *
 * The candidate file is the versioned source of truth for the PMS install
 * (repository seeding stays blocklisted — provisioning remains a deliberate
 * operator action; nothing here changes the fail-closed default).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { isM2PromptProvisioned } from '../prompt-sentinel.js';
import { PROPOSAL_TYPES, PROPOSAL_CAP } from '../proposals.js';
import { PROPOSAL_FIELD_CAPS } from '../guards.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

const CANDIDATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tools/prompts/olumi_m2_graph_review_v1.0.txt',
);

function loadCandidate(): string {
  return readFileSync(CANDIDATE_PATH, 'utf8');
}

describe('M2 production prompt candidate v1.0 (tools/prompts/olumi_m2_graph_review_v1.0.txt)', () => {
  it('exists, is provisioned copy (sentinel-free), and is not benchmark-watermarked', () => {
    const content = loadCandidate();
    expect(content.length).toBeGreaterThan(1_000);
    // System-prompt budget sanity: the M2 call rides inside the draft request
    // budget; the candidate must stay far from the ~58k draft-prompt scale.
    expect(content.length).toBeLessThan(20_000);
    expect(isM2PromptProvisioned(content)).toBe(true);
    expect(content).not.toMatch(/BENCHMARK-ONLY/i);
    // PMS row provisioning floor (repository requires usable copy, >= 10 chars).
    expect(content.trim().length).toBeGreaterThanOrEqual(10);
  });

  it('teaches every live proposal type and the object-root envelope', () => {
    const content = loadCandidate();
    for (const type of PROPOSAL_TYPES) {
      expect(content, `candidate must teach proposal type "${type}"`).toContain(type);
    }
    expect(content).toContain('"proposals"');
    expect(content).toContain(String(PROPOSAL_CAP));
  });

  it('teaches the live numeric edge contract (the v0.4.3 divergence)', () => {
    const content = loadCandidate();
    // Live EdgeV3 delta requires full priors — the candidate must name them.
    expect(content).toContain('exists_probability');
    expect(content).toContain('effect_direction');
    expect(content).toMatch(/strength/i);
    expect(content).toMatch(/"mean"|\bmean\b/);
    expect(content).toMatch(/"std"|\bstd\b/);
    // Bounds anchors: mean range and the std cap rule.
    expect(content).toContain('-1');
    expect(content).toMatch(/0\.5/);
    // Endpoints are ids, and option/decision endpoints are closed to M2.
    expect(content).toMatch(/\bid\b/i);
    expect(content).toMatch(/option or decision|option\/decision/i);
  });

  it('teaches node contract: id + kind, allowed kinds per type, dedup', () => {
    const content = loadCandidate();
    expect(content).toMatch(/"kind"|\bkind\b/);
    // added_risk -> risk; added_assumption -> factor|risk (live ALLOWED_NODE_KINDS).
    expect(content).toMatch(/\brisk\b/);
    expect(content).toMatch(/\bfactor\b/);
    // Canonical id charset guidance (NodeV3 CANONICAL_ID_REGEX).
    expect(content).toMatch(/lowercase/i);
    // Duplicate-label rejection guidance.
    expect(content).toMatch(/duplicate/i);
  });

  it('carries the engine-boundary FORBIDDEN vocabulary (G14 alignment)', () => {
    const content = loadCandidate();
    for (const term of [
      'EVPI',
      'VOI',
      'robustness',
      'flip point',
      'sensitivity analys',
      'win probabilit',
      'expected value of',
      'analysis shows',
    ]) {
      expect(content.toLowerCase(), `FORBIDDEN section must cover "${term}"`).toContain(
        term.toLowerCase(),
      );
    }
  });

  it('respects the live text caps in its own guidance', () => {
    const content = loadCandidate();
    // The rationale word guidance must fit the 500-char rationale cap and the
    // evidence pointer guidance the 300-char cap — assert the caps are named
    // so prompt guidance and guard enforcement cannot silently drift.
    expect(content).toContain(String(PROPOSAL_FIELD_CAPS.rationale));
    expect(content).toContain(String(PROPOSAL_FIELD_CAPS.evidence_pointer));
  });
});

describe('candidate clears the G17 sentinel gate through the REAL reviewDraftGraph wiring', () => {
  it('with the candidate as resolved prompt, review proceeds to the model-resolution gate (fail-closed order intact)', async () => {
    vi.resetModules();
    const content = loadCandidate();
    vi.doMock('../../../adapters/llm/prompt-loader.js', () => ({
      getSystemPrompt: vi.fn().mockResolvedValue(content),
    }));
    const { reviewDraftGraph } = await import('../m2-review.js');

    const graph: GraphV3T = {
      nodes: [
        { id: 'goal_x', kind: 'goal', label: 'Goal' },
        { id: 'fac_y', kind: 'factor', label: 'Factor' },
      ],
      edges: [
        {
          from: 'fac_y',
          to: 'goal_x',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.8,
          effect_direction: 'positive',
        },
      ],
    } as GraphV3T;

    const res = await reviewDraftGraph({
      graph,
      brief: 'A real brief long enough to matter.',
      analysisReady: null,
      requestId: 'req-candidate-wiring',
      scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      pipelineElapsedMs: 10_000,
    });

    // Sentinel cleared -> the NEXT fail-closed gate (explicit
    // CEE_MODEL_M2_REVIEW) fires. No adapter/LLM involvement.
    expect(res.kind).toBe('model_not_resolved');
    if (res.kind === 'model_not_resolved') {
      expect(res.cause).toBe('model_unset');
    }

    vi.doUnmock('../../../adapters/llm/prompt-loader.js');
    vi.resetModules();
  });
});
