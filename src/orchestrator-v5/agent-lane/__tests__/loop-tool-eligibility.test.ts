/**
 * WIRING: the agent loop asks for ELIGIBLE tools, not the whole catalogue.
 *
 * `toolsFor()` has exactly one non-test call site — `agent-loop.ts` — so this is
 * the single seam where a verified context packet can actually save a round
 * trip. Until now the helper was inert: complete, tested, and reachable by
 * nobody.
 *
 * ⛔ THE SAFETY DIRECTION. When no packet is supplied the loop must behave
 * EXACTLY as before — the full tool set for the mode. Absence of context can
 * only ever give the model MORE read tools, never more authority, so the
 * fallback is safe in the direction it fails. The first test is the contrast
 * control that pins that: same tools as `toolsFor(mode)`, byte for byte.
 *
 * ⚠ `agent-loop.ts` is NOT a leased file (the lease names `agent-v1-turn.ts`
 * and `agent-capabilities.ts`), but it is plainly inside OpenAI Integration's
 * blast radius, so this change is declared on the PR rather than taken quietly.
 */
import { describe, it, expect, vi } from 'vitest';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { toolsFor } from '../runtime/agent-tools.js';
import { issueContextPacket } from '../runtime/request-assembly.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const USER = 'user-a';
const REV = 'a'.repeat(64);
const SECRET = 'server-secret';

const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'req-1' };
const caps = {} as never;

/** Captures the request the loop would send, then ends the turn. */
function captureModel() {
  const seen: { tools?: readonly unknown[] }[] = [];
  const callModel = vi.fn(async (req: { tools?: readonly unknown[] }) => {
    seen.push(req);
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] } as never;
  });
  return { seen, callModel: callModel as never };
}

const names = (req: { tools?: readonly unknown[] }) =>
  (req.tools ?? []).map((t) => (t as { name: string }).name);

const base = { ctx, history: [], message: 'hello', instructions: 'be precise', maxOutputTokens: 256 };

const expectation = {
  scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: REV,
  current_turn: 3, binding_secret: SECRET,
};
const freshPacket = () =>
  issueContextPacket(
    { scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: REV, captured_at_turn: 3, state: { entities: [] } },
    SECRET,
  );

describe('agent loop tool eligibility', () => {
  it('CONTRAST CONTROL — with NO canonical context the tool set is unchanged', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn({ ...base, mode: 'full' }, caps, callModel);
    expect(names(seen[0])).toEqual(toolsFor('full').map((t) => t.name));
  });

  it('a VERIFIED fresh packet omits get_canonical_state — the measured saving', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn(
      { ...base, mode: 'full', canonicalContext: { packet: freshPacket(), expectation } },
      caps,
      callModel,
    );
    expect(names(seen[0])).not.toContain('get_canonical_state');
  });

  it('⛔ a FORGED packet keeps the tool — verification happens at this seam too', async () => {
    const forged = { ...freshPacket(), binding: 'f'.repeat(64) };
    const { seen, callModel } = captureModel();
    await runAgentTurn(
      { ...base, mode: 'full', canonicalContext: { packet: forged, expectation } },
      caps,
      callModel,
    );
    expect(names(seen[0])).toContain('get_canonical_state');
  });

  it('⛔ a STALE packet keeps the tool', async () => {
    const stale = issueContextPacket(
      { scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: 'b'.repeat(64), captured_at_turn: 3, state: {} },
      SECRET,
    );
    const { seen, callModel } = captureModel();
    await runAgentTurn({ ...base, mode: 'full', canonicalContext: { packet: stale, expectation } }, caps, callModel);
    expect(names(seen[0])).toContain('get_canonical_state');
  });

  it('⛔ PREVIEW STAYS READ-ONLY even with a perfectly valid packet', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn(
      { ...base, mode: 'preview', canonicalContext: { packet: freshPacket(), expectation } },
      caps,
      callModel,
    );
    const offered = names(seen[0]);
    for (const m of ['propose_model_change', 'authorise_change', 'propose_assumptions', 'propose_option_interventions']) {
      expect(offered, `${m} must never be offered in preview`).not.toContain(m);
    }
  });
});
