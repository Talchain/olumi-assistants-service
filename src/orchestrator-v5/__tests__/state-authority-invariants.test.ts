/**
 * ⭐⭐ THE STATE-AUTHORITY GOAL, AS A REGRESSION GUARD OVER WHAT HAS LANDED.
 *
 * The goal: *"Every OpenAI interaction, analysis and UI surface reads one
 * authoritative current model with consistent values, provenance, freshness,
 * versions and receipts; edits and reloads cannot contradict or overwrite
 * committed state."*
 *
 * ⛔ WHY THIS FILE EXISTS. Parts of that goal are landed and served, and NOTHING
 * guarded them end to end — each was protected only by the spec of the PR that
 * introduced it, so a later refactor in a different file could quietly undo one
 * and every suite would stay green. Four of the properties below were established
 * by measurement on the deployed build and then, in three cases, nearly lost again
 * to my own edits. They are asserted here as ONE set, at the seam they matter.
 *
 * ⚠ WHAT THIS FILE IS NOT. It is a SOURCE-SHAPE guard, not a live witness. It
 * proves the wiring is present and correctly shaped; it cannot prove a served
 * build behaves. Every claim about a deployed build needs `/healthz`'s `build`
 * field and a driven journey. Stated here so nobody reads a green run as a
 * witness — the estate has made that mistake before.
 *
 * ⚠ AND IT DELIBERATELY DOES NOT ASSERT THE UNLANDED HALF. Freshness in the agent
 * lane, the deterministic value-change disclosure, reload admissibility and the
 * identity-space write expectation are open PRs. Asserting their absence would
 * pin the defects shut — the exact failure this lane has already committed three
 * times (an inverted assertion that made a gap look correct). When each lands, its
 * own spec guards it and a line is added here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectTurnReceipts } from '../agent-lane/turn-receipts.js';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const AGENT_ROUTE = read('../../routes/agent-v1-turn.ts');
const GRAPH_READ = read('../../routes/assist.v1.scenario-graph.ts');
const SET_FACTOR = read('../tools/handlers/set-factor-value.ts');

describe('VERSIONS & RECEIPTS — a turn says which version it produced', () => {
  it('⭐ the agent turn carries receipts, read back from the tools that wrote', () => {
    // Landed in #1747, merged and served (staging f6991cf5). Before it, the reply
    // said `mutated: true` and never which version the model had become.
    expect(AGENT_ROUTE).toContain('receipts: collectTurnReceipts(result.tool_results)');
  });

  it('⛔ receipts are IDENTIFIERS ONLY — no user content may ride this sidecar', () => {
    // The property that makes it safe to put on a client-visible sidecar at all.
    const r = collectTurnReceipts([
      { receipts: [{ version: 3, version_id: 'v3', mutation_id: 'm3', source_turn_id: null }] },
    ]);
    expect(r).toHaveLength(1);
    expect(Object.keys(r[0]).sort()).toEqual(['mutation_id', 'source_turn_id', 'version', 'version_id']);
  });

  it('⛔ NOTHING IS MINTED — a turn that wrote nothing reports an empty list', () => {
    expect(collectTurnReceipts([{ ok: true, mutated: false }])).toEqual([]);
    expect(collectTurnReceipts(undefined)).toEqual([]);
  });

  it('⛔ a version must be FINITE — `typeof NaN === "number"` bit twice in this lane', () => {
    // `Number(undefined)` is NaN and passes a bare typeof check, which put NaN on
    // the wire where a consumer expects a version to reconcile against.
    expect(collectTurnReceipts([{ model_version: { version_id: 'v', mutation_id: 'm' } }])).toEqual([]);
  });

  it('⭐ the model-creating turn is covered — it spells it `model_version`, SINGULAR', () => {
    // `build_model_from_brief` mints version 1 and returns `{ model_version }`,
    // not `{ receipts: [...] }`. Reading only the plural key left the sidecar
    // empty on exactly the turn where "which version?" matters most.
    const r = collectTurnReceipts([
      { model_version: { version_number: 1, version_id: 'v1', mutation_id: 'm1' } },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].version).toBe(1);
  });
});

describe('RELOAD — the graph read carries the readiness authority, not just bytes', () => {
  it('⭐ it ships `analysis_state` and `analysis_result`', () => {
    // ⚠ I once filed "a reload cannot reproduce readiness" by measuring the key
    // `analysis_ready` (0 occurrences) and reading its absence as the absence of
    // readiness — while these two sat on the same response, with a complete UI
    // consumer. A field name is not its meaning.
    expect(GRAPH_READ).toContain('analysis_state: analysis.analysis_state');
    expect(GRAPH_READ).toContain('analysis_result: analysis.analysis_result');
  });

  it('⭐ and the structural manifest, so a reload can say what is missing', () => {
    expect(GRAPH_READ).toContain('not_modelled: deriveNotModelledManifest(');
  });

  it('⛔ the read route still ships NO turn-shaped keys', () => {
    // The pin that keeps prose and turn semantics off a read: `analysis_ready`
    // carries `status_reason` and `user_questions`, and this route ships no
    // enforceable prose. Guarded here too because it is a property of the GOAL,
    // not only of that route's own suite.
    const send = GRAPH_READ.slice(GRAPH_READ.indexOf('layout_present:'));
    for (const forbidden of ['analysis_ready:', 'assistant_text:', 'suggested_actions:']) {
      expect(send, `the graph read must not ship \`${forbidden}\``).not.toContain(forbidden);
    }
  });
});

describe('PROVENANCE & VALUES — the user’s own figure survives a reload', () => {
  it('⭐ the single `observed_state` writer persists BOTH the stored and the approved figure', () => {
    // This is what makes a rescaled adoption honest across a reload: `value` is
    // the model-scale figure, `raw_value` is what the user actually approved, and
    // `value !== raw_value` is itself the durable record that the product
    // normalised rather than the user typing the normalised number.
    expect(SET_FACTOR).toContain('raw_value');
    expect(SET_FACTOR).toContain('observed_state');
  });

  it('⛔ a verified panel stamp overrides the default, and its absence CLEARS the citation', () => {
    // Both halves matter. Without the override a colleague's revealed number
    // renders as the owner's own work; without the clearing, the owner's own
    // retyped number keeps a named colleague's identity attached to it.
    expect(SET_FACTOR).toContain('appliedProvenance?.source ?? USER_EDIT_SOURCE');
    expect(SET_FACTOR).toContain('delete (merged as { elicited_from?: unknown }).elicited_from');
  });
});

describe('THE CAS POSTURE IS DERIVED, NEVER ASSERTED IN PROSE', () => {
  it('⛔ the enforcing consumers of `requiresExpectedHash` are named, not assumed', () => {
    // Measured: it has exactly two enforcing consumers and BOTH are Conventional.
    // The Agent lane never consults it — which is why the agent-lane writes need
    // their own expectation rather than inheriting one. If a third appears, or
    // one of these disappears, that changes the analysis and this must be re-read.
    const CONSUMERS = [
      '../handlers/edit-graph-dispatch.ts',
      '../turn-executor.ts',
    ];
    // ⛔ WORD-BOUNDED, NOT A SUBSTRING. My first version used `toContain`, and a
    // mutant renaming the symbol to `requiresExpectedHashXX` PASSED — the
    // substring is still there. That is the same shape as the verdict-marker
    // defect this estate has already been bitten by: a substring match cannot
    // tell a symbol from something that merely starts with it.
    for (const c of CONSUMERS) {
      expect(read(c), `${c} no longer consults requiresExpectedHash`).toMatch(/\brequiresExpectedHash\b/);
    }
  });
});
