/**
 * DL WIRING PORTS 3: each port's value reaches the SERVED reader the P2-ACCEPT table names, through the real records
 * build and the real reader — never a mock that writes the asserted field. Each row turns RED with its port removed.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNext as sealedRecords } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { narrateWriteOutcome, openQuestionsForReply } from '../write-outcome.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

async function build(records: DraftRecordSet, brief: string): Promise<{ result: ToolResult; writes: Record<string, unknown>[] }> {
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Record<string, unknown>); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief, dispatch,
    async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  return { result, writes };
}

const DEADLINE = 'Does "Monthly recurring revenue" get there within 9 months? The model holds the deadline; no result answers that yet.';

describe('PORT 1: the deadline question reaches the served reply and the wire list, first', () => {
  it('the reply status line says it first, and `_agent.open_questions` carries it first', async () => {
    const { result } = await build(sealedRecords(), BRIEF);
    expect(result.ok).toBe(true);
    // The wire list (`_agent.open_questions`, UI serverOpenQuestions) in the producer's order: the deadline FIRST.
    expect(openQuestionsForReply(result)[0]).toBe(DEADLINE);
    // The served reply's status line (`narrateWriteOutcome` → `openQuestionsLine`, first 2 shown) says it first.
    const { status } = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
    expect(status).toContain(`Questions this model does not answer yet: ${DEADLINE}`);
  });

  it('contrast: a brief with no deadline asks none (the first question is the compiler\'s own)', async () => {
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result.ok).toBe(true);
    expect(openQuestionsForReply(result).some((q) => /get there within|Which date does/.test(q))).toBe(false);
  });
});
