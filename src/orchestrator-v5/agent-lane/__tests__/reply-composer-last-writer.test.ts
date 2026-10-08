/**
 * ⛔ THE COMPOSER IS THE ONE LAST WRITER OF A CHAT REPLY (S-A, lane COPY-SHAPE; DL 0fd71f, 7 Oct 10:4xZ: "the composer must
 * be the ONE last writer. Add a wire row that fails if any other module writes assistant_text after it").
 *
 * Source rows over the served route `routes/agent-v1-turn.ts` (the only Agent-lane send point):
 *   1. exactly ONE `composeReplyShape(` call;
 *   2. from that call to the route's registration, nothing writes `assistant_text` except the composer's own result, and no
 *      known text writer runs; every later use only READS the text (history, durable row, worksheet check, send);
 *   3. `_answer_shape` is attached at exactly ONE site across the route and `agent-lane/**` (the composer's), so no
 *      second shaping mechanism survives.
 * The behavioural half (the sent text is the shape's derivation and the durable row holds the same bytes) is pinned by
 * `agent-run-reply-answer-shape.test.ts` through the real route.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
const CALL = 'const composedReply = composeReplyShape(';
const REGISTRATION = "app.post('/agent/v1/turn'";
/** Functions that compose or rewrite reply text upstream of the composer; none may run after it. */
const TEXT_WRITERS = [
  'withDisclosures(', 'withWriteOutcome(', 'withB3LinesAtRest(', 'withBreakEvenAnswer(', 'withScreenLinesOwed(',
  'withA7AfterGate(', 'enforceAgentLaneLeaderClaimsAtWire(', 'enforceLeaderLicenceAtFinalEgress(',
  'withoutDriverAbsenceClaimsAtEgress(', 'withLeftOutOptionCorrectionAtEgress(',
  'withoutProposalIds(', 'composeDirectAnswerResponse(', 'textAtRest(',
];

const afterComposer = (src: string): string => {
  const at = src.indexOf(CALL);
  const end = src.indexOf(REGISTRATION, at);
  if (at === -1 || end === -1) throw new Error('the composer call or the route registration is missing');
  return src.slice(at, end);
};
/** Writes of `assistant_text` in a slice: object-literal keys and assignments (reads like `.assistant_text ??` are not). */
const textWrites = (slice: string): string[] => [
  ...[...slice.matchAll(/\bassistant_text\s*:\s*([^,}\n]{1,80})/g)].map((m) => `assistant_text: ${m[1]!.trim()}`),
  ...[...slice.matchAll(/\.assistant_text\s*=[^=]/g)].map((m) => m[0]),
];

describe('the reply composer is the ONE last writer of `assistant_text` on the Agent route', () => {
  // ⭐ 2b-0 (DL APPROVE #2783): the current-Run REPLAY applies the SAME composer to the same typed parts, and its shape
  // rides only when the composed text equals the stored words and still derives the text after the final gates
  // (`withShapeOnlyIfItDerives`). Exactly these two named sites; any third is a second shaping mechanism.
  const REPLAY_CALL = ': composeReplyShape({ text: withoutProposalIds(replayText), obligations: replayObligations,';
  it('1. exactly two composer calls: the live one and the parity-proven replay', () => {
    expect(ROUTE.split('composeReplyShape(').length - 1).toBe(2);
    expect(ROUTE).toContain(CALL);
    expect(ROUTE).toContain(REPLAY_CALL);
    expect(ROUTE).toContain('&& composedCandidate.text === prior.assistant_message ? composedCandidate : null;');
    expect(ROUTE).toContain('return withShapeOnlyIfItDerives(gatedReplay);');
  });
  it('1-MUTANT (in memory): a third composer call is caught', () => {
    const mutant = ROUTE.replace(CALL, `const extra = composeReplyShape({ text: '' });\n    ${CALL}`);
    expect(mutant.split('composeReplyShape(').length - 1).not.toBe(2);
  });

  it('2. after it, the only text write is the composer’s own, and no text writer runs', () => {
    const slice = afterComposer(ROUTE);
    expect(slice.length, 'the control: the slice reaches the send').toBeGreaterThan(2000);
    expect(slice, 'the control: the send is in the slice').toContain('return reply.code(200).send({');
    expect(textWrites(slice)).toEqual(['assistant_text: composedReply.text']);
    for (const writer of TEXT_WRITERS) expect(slice, writer).not.toContain(writer);
  });

  it('2-CONTROL: the same scan over the WHOLE route finds the upstream writers (the probe sees writes and writers)', () => {
    expect(textWrites(ROUTE).length).toBeGreaterThan(5);
    for (const writer of ['withDisclosures(', 'withBreakEvenAnswer(', 'enforceLeaderLicenceAtFinalEgress(']) expect(ROUTE).toContain(writer);
  });

  it('2-MUTANT (in memory): a text write placed after the composer is caught', () => {
    const at = ROUTE.indexOf('    const sentText = String(wireBody.assistant_text ?? text);');
    expect(at).toBeGreaterThan(ROUTE.indexOf(CALL));
    const mutant = `${ROUTE.slice(0, at)}    wireBody = { ...wireBody, assistant_text: \`\${wireBody.assistant_text} More.\` };\n${ROUTE.slice(at)}`;
    expect(textWrites(afterComposer(mutant))).not.toEqual(['assistant_text: composedReply.text']);
  });

  it('3. `_answer_shape` is attached at exactly the two composer sites across the route and agent-lane', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p);
      return p.endsWith('.ts') ? [p] : [];
    });
    const lane = new URL('..', import.meta.url).pathname;
    const sources = [...files(lane).map((p) => readFileSync(p, 'utf8')), ROUTE];
    // An attach is `_answer_shape: <value>`; a drop is a destructuring alias (`_answer_shape: _stale`).
    const attaches = sources.flatMap((src) => [...src.matchAll(/\b_answer_shape\s*:\s*(?!_)([A-Za-z][\w.]{0,60})/g)].map((m) => m[1]));
    expect(attaches).toEqual(['replayComposed.shape', 'composedReply.shape']);
  });
});
