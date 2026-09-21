import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRoutingLogEntry } from '../routing-log-reader.js';

const TMP_DIR = join(tmpdir(), 'routing-log-reader-tests');
const LOG_PATH = join(TMP_DIR, 'test-routing-log.jsonl');

function makeRecord(turn_id: string): Record<string, unknown> {
  return {
    turn_id,
    scenario_id: 'sess-1',
    stage: 'ideate',
    intent_class: 'execute',
    handler_id: 'add_node',
    coaching_mode: null,
    resolution_status: 'resolved',
    routing_error_cause: null,
    validation_error_code: null,
    compound_detected: false,
    compound_pattern_matched: null,
    raw_user_message: 'add a factor',
    sonnet_text: null,
    sonnet_text_hash: null,
    redacted: false,
    created_at: new Date().toISOString(),
    label_tier: 'unreviewed',
    graph_node_count: 3,
    graph_edge_count: 2,
    graph_hash: 'abc123',
    graph_mapped_nodes: 3,
    graph_dropped_by_unknown_kind: 0,
    graph_dropped_by_missing_id: 0,
    graph_lookup_outcome: 'ok',
    cqe_message_length: 12,
    cqe_result_count: 0,
    cqe_match_count: 0,
    cqe_compromise_match_count: 0,
    cqe_patterns_matched: [],
    cqe_duration_ms: 8,
    cqe_timeout: false,
    cqe_message_too_long: false,
    cqe_word_range_missed: false,
    cqe_ambiguous_phrasing_detected: false,
  };
}

async function writeLogs(records: Record<string, unknown>[]): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(LOG_PATH, content, 'utf8');
}

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('readRoutingLogEntry', () => {
  it('returns the matching record when found', async () => {
    await writeLogs([makeRecord('turn-A'), makeRecord('turn-B'), makeRecord('turn-C')]);
    const result = await readRoutingLogEntry('turn-B', LOG_PATH);
    expect(result).not.toBeNull();
    expect(result).not.toBe('file_absent');
    expect((result as { turn_id: string }).turn_id).toBe('turn-B');
  });

  it('returns null when turn_id is not in the file', async () => {
    await writeLogs([makeRecord('turn-A')]);
    const result = await readRoutingLogEntry('turn-missing', LOG_PATH);
    expect(result).toBeNull();
  });

  it("returns 'file_absent' when the JSONL file does not exist", async () => {
    const result = await readRoutingLogEntry('turn-X', join(TMP_DIR, 'nonexistent.jsonl'));
    expect(result).toBe('file_absent');
  });

  it('skips malformed JSONL lines without throwing', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const content = 'not-json\n' + JSON.stringify(makeRecord('turn-good')) + '\n';
    await writeFile(LOG_PATH, content, 'utf8');
    const result = await readRoutingLogEntry('turn-good', LOG_PATH);
    expect(result).not.toBeNull();
    expect((result as { turn_id: string }).turn_id).toBe('turn-good');
  });

  it('handles empty file gracefully', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(LOG_PATH, '', 'utf8');
    const result = await readRoutingLogEntry('turn-X', LOG_PATH);
    expect(result).toBeNull();
  });

  it('returns the first matching record when duplicates exist', async () => {
    const first = { ...makeRecord('turn-dup'), cqe_duration_ms: 10 };
    const second = { ...makeRecord('turn-dup'), cqe_duration_ms: 20 };
    await writeLogs([first, second]);
    const result = await readRoutingLogEntry('turn-dup', LOG_PATH);
    expect(result).not.toBeNull();
    expect((result as { cqe_duration_ms: number }).cqe_duration_ms).toBe(10);
  });
});
