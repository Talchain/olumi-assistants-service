/**
 * ⭐⭐ THE PER-STRING-VALUE CEILING — the runaway CLASS closure (2026-07-25).
 *
 * WHAT THIS PINS, AND WHY IT IS NOT THE SAME AS THE FIX THAT PRECEDED IT.
 * `ea4229c1` dropped `data.display_value` from the sent grammar and took drafting
 * 5/16 -> 16/16. That move is NOT REPEATABLE: it was safe only because the field
 * was display-only AND had a deterministic replacement (`synthesiseDisplayValue`,
 * capped at 50 chars). `label` is REQUIRED and load-bearing; `uncertainty_drivers[]`
 * is an unbounded array of unbounded strings. Neither can be dropped, neither has
 * a formatter, and the grammar cannot bound either (`maxLength` unenforced and
 * stripped; `maxItems` 400s). Without a MECHANISM the 100% is one field-migration
 * away from 69% with no lever remaining.
 *
 * THE INVARIANT, true of 10 of 10 characterised failures: ONE JSON STRING VALUE
 * CONSUMED THE ENTIRE TOKEN BUDGET. It is period-agnostic (a repetition guard
 * catches only 5 of 10 — half the failures repeat a PHRASE, and one rambles
 * without repeating), field-agnostic, and derivable from a corpus.
 *
 * RED-FIRST: on `ea4229c1` this whole file fails at IMPORT —
 * `createJsonStringRunScanner`, `DRAFT_RUNAWAY_MAX_STRING_CHARS` and
 * `DraftRunawayTrigger` do not exist. Every behavioural assertion below is
 * therefore RED on the base commit by construction.
 */

import { describe, it, expect } from 'vitest';
import {
  createJsonStringRunScanner,
  DRAFT_RUNAWAY_MAX_STRING_CHARS,
  DRAFT_RUNAWAY_DETECT_CHARS,
  buildFailedCallLlmMeta,
} from '../draft-budget.js';
import {
  OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS,
  DRAFT_STRING_RUN_HEADROOM_FACTOR,
} from '../../../config/timeouts.js';
import { buildLlmMetadataProjection } from '../../../cee/unified-pipeline/llm-metadata-projection.js';

/**
 * ⭐ THE CORPUS. The longest single JSON string token in each of 20 live
 * `/assist/v1/draft-graph` drafts on `ea4229c1` (2026-07-25), across SIX brief
 * classes: A2killer x10, vague, moderate, complex, plus two briefs written to
 * stress the longest string fields the grammar can emit (a categorical brief for
 * `data.encoding_map`, and one carrying verbatim numeric targets for
 * `goal_constraints[].source_quote`).
 *
 * This is the complete census of that measurement, not a sample, and it is what
 * the ceiling is derived FROM. A recalibration edits THIS list and the constant
 * follows; editing the constant alone fails the pin below.
 *
 * ⚠ MEASURED WITH TWO INDEPENDENT LOCATORS, and they disagreed on the first run
 * (field-aware said 47, raw-byte said 76). The field-aware locator read
 * `uncertainty_drivers` from `node.data` — where the SENT GRAMMAR puts it — but
 * normalisation moves it to `node.observed_state`. Had only that locator been
 * run, this ceiling would have been derived ~38% too tight. Both now agree.
 */
const HEALTHY_MAX_STRING_CHARS: ReadonlyArray<{ brief: string; chars: number; field: string }> = [
  { brief: 'categorical_0', chars: 76, field: 'uncertainty_drivers[1]' },
  { brief: 'a2killer_4', chars: 60, field: 'node.label' },
  { brief: 'a2killer_7', chars: 60, field: 'node.label' },
  { brief: 'categorical_1', chars: 59, field: 'uncertainty_drivers[1]' },
  { brief: 'moderate_0', chars: 55, field: 'node.label' },
  { brief: 'constraints_0', chars: 54, field: 'node.label' },
  { brief: 'constraints_1', chars: 50, field: 'node.label' },
  { brief: 'complex_0', chars: 48, field: 'node.label' },
  { brief: 'complex_1', chars: 48, field: 'node.label' },
  { brief: 'a2killer_0', chars: 47, field: 'node.label' },
  { brief: 'a2killer_1', chars: 47, field: 'node.label' },
  { brief: 'a2killer_2', chars: 47, field: 'node.label' },
  { brief: 'a2killer_5', chars: 47, field: 'node.label' },
  { brief: 'a2killer_6', chars: 47, field: 'node.label' },
  { brief: 'a2killer_8', chars: 47, field: 'node.label' },
  { brief: 'vague_1', chars: 47, field: 'uncertainty_drivers[]' },
  { brief: 'moderate_1', chars: 46, field: 'node.label' },
  { brief: 'vague_0', chars: 44, field: 'uncertainty_drivers[]' },
  { brief: 'a2killer_3', chars: 41, field: 'node.label' },
  { brief: 'a2killer_9', chars: 40, field: 'node.provenance' },
];

// ---------------------------------------------------------------------------
describe('⭐ THE CEILING IS DERIVED FROM THE CORPUS, not hand-picked', () => {
  it('the observed constant equals the corpus maximum', () => {
    const corpusMax = Math.max(...HEALTHY_MAX_STRING_CHARS.map((d) => d.chars));
    expect(OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS).toBe(corpusMax);
    expect(corpusMax).toBe(76);
    expect(HEALTHY_MAX_STRING_CHARS).toHaveLength(20);
  });

  it('the ceiling is corpus-max x the documented headroom factor', () => {
    expect(DRAFT_RUNAWAY_MAX_STRING_CHARS).toBe(
      Math.ceil(OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS * DRAFT_STRING_RUN_HEADROOM_FACTOR),
    );
    expect(DRAFT_RUNAWAY_MAX_STRING_CHARS).toBe(1_900);
  });

  it('EVERY draft in the corpus clears the ceiling with the full factor to spare', () => {
    for (const d of HEALTHY_MAX_STRING_CHARS) {
      expect(d.chars).toBeLessThanOrEqual(OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS);
      expect(d.chars * DRAFT_STRING_RUN_HEADROOM_FACTOR).toBeLessThanOrEqual(
        DRAFT_RUNAWAY_MAX_STRING_CHARS,
      );
    }
  });

  it('the headroom factor is a real margin, and deliberately generous', () => {
    expect(DRAFT_STRING_RUN_HEADROOM_FACTOR).toBeGreaterThan(1);
    // The tail of THIS quantity is unexplored (source_quote quotes the user's
    // brief; encoding_map scales with category count; neither appeared at length
    // in the corpus), so the margin must be far larger than the token
    // yardstick's 1.5x. Pinned so a future edit cannot quietly tighten it.
    expect(DRAFT_STRING_RUN_HEADROOM_FACTOR).toBeGreaterThanOrEqual(10);
  });

  it('⭐ NOT A DEAD ALARM — it fires strictly before the total-char gate', () => {
    // A per-value ceiling at or above the total gate could never fire first
    // inside the nodes phase: the guard would exist and never execute.
    expect(DRAFT_RUNAWAY_MAX_STRING_CHARS).toBeLessThan(DRAFT_RUNAWAY_DETECT_CHARS);
  });

  it('⭐ THE TOTAL-CHAR GATE IS KEPT, and covers a class this one cannot see', () => {
    // Decision, recorded: the per-value ceiling does NOT strictly dominate the
    // total gate. A CARDINALITY runaway — many well-formed elements, no single
    // long string — trips the total gate and is invisible to this scanner. The
    // grammar cannot cap array length (`maxItems` 400s), so retiring the total
    // gate would leave that class with no early abort at all.
    expect(DRAFT_RUNAWAY_DETECT_CHARS).toBe(8_000);
    const scanner = createJsonStringRunScanner();
    // 400 nodes' worth of short, entirely legitimate strings: >8,000 total chars,
    // longest single string 12. The total gate sees it; this one must not.
    let longest = 0;
    for (let i = 0; i < 400; i++) longest = Math.max(longest, scanner.push(`{"label":"Factor ${i}"},`));
    expect(longest).toBeLessThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);
  });
});

// ---------------------------------------------------------------------------
describe('THE SCANNER — a single pass that cannot be fooled', () => {
  it('measures a string that spans many deltas (the streaming case)', () => {
    const s = createJsonStringRunScanner();
    expect(s.push('{"label":"aaa')).toBe(5); // "label" is itself a 5-char token
    expect(s.push('bbb')).toBe(6);
    expect(s.push('cc"}')).toBe(8);
  });

  it('resets on a closing quote — many short strings never accumulate', () => {
    const s = createJsonStringRunScanner();
    let max = 0;
    for (let i = 0; i < 500; i++) max = Math.max(max, s.push('"abcdefgh",'));
    expect(max).toBe(8);
  });

  it('⭐ AN ESCAPED QUOTE DOES NOT CLOSE THE STRING', () => {
    // Without escape handling a runaway containing `\\"` would silently reset the
    // counter and the guard would never fire — a mechanism defeated by one byte.
    const s = createJsonStringRunScanner();
    const payload = 'x\\"'.repeat(1_000); // 3,000 raw chars, zero real terminators
    expect(s.push(`"${payload}`)).toBe(3_000);
  });

  it('a trailing backslash carried across a delta boundary still escapes', () => {
    const s = createJsonStringRunScanner();
    expect(s.push('"aaaa\\')).toBe(5); // 4 chars + the backslash; delta ends mid-escape
    // The `"` opening the NEXT delta is the ESCAPED one, so the string must stay
    // open and the run must CONTINUE from 5 (5 + escaped-quote + 4 = 10). If the
    // escape state were not carried across the boundary the quote would close the
    // string and the run would reset to 4 — so this number, and only this number,
    // discriminates the bug.
    expect(s.push('"bbbb')).toBe(10);
  });

  it('a string that opens AND closes inside one delta is still measured', () => {
    // The trigger must see a whole runaway that arrives in a single chunk.
    const s = createJsonStringRunScanner();
    expect(s.push(`{"label":"${'z'.repeat(5_000)}"}`)).toBe(5_000);
  });

  it('is period-agnostic — a NON-REPEATING ramble trips it exactly as a loop does', () => {
    // This is why the guard is a LENGTH ceiling and not a repetition detector:
    // 5 of the 10 characterised failures repeat a PHRASE, not a character, and
    // one does not repeat at all. A repetition guard is half-covering.
    const rambleOnce = createJsonStringRunScanner();
    let ramble = '';
    for (let i = 0; i < 400; i++) ramble += `word${i} `;
    const nonRepeating = rambleOnce.push(`"${ramble}`);
    expect(nonRepeating).toBeGreaterThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);

    const charRun = createJsonStringRunScanner();
    expect(charRun.push(`"${'​'.repeat(3_000)}`)).toBeGreaterThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);

    const phraseLoop = createJsonStringRunScanner();
    expect(phraseLoop.push(`"${'No additional headcount hired in place currently. '.repeat(60)}`))
      .toBeGreaterThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);
  });

  it('⭐ REPLAY: the exact live runaway anatomy trips the ceiling', () => {
    // Verbatim from the 2026-07-25 wire capture: the field name varies, the
    // shape never does — a U+200B run inside one string value.
    const s = createJsonStringRunScanner();
    let tripped = -1;
    const head = '{"nodes":[{"id":"fac_headcount","kind":"factor","label":"Support headcount",' +
      '"data":{"value":0.4,"extractionType":"inferred","factor_type":"cost","display_value":' +
      '"No additional headcount hired yet (baseline)  ';
    let seen = s.push(head);
    for (let i = 0; i < 200 && tripped < 0; i++) {
      seen = Math.max(seen, s.push('​'.repeat(64)));
      if (seen >= DRAFT_RUNAWAY_MAX_STRING_CHARS) tripped = i;
    }
    expect(tripped).toBeGreaterThanOrEqual(0);
    // It fires long before the total-char gate could: the whole stream so far is
    // still far below 8,000 characters.
    expect(head.length + (tripped + 1) * 64).toBeLessThan(DRAFT_RUNAWAY_DETECT_CHARS);
  });

  it('POSITIVE CONTROL — the scanner can SEE a healthy draft as healthy', () => {
    // Trap #13: an absence assertion that has never demonstrated a presence is
    // vacuous. The two assertions above ("a runaway trips it") and this one
    // ("a real draft does not") must BOTH hold, or the guard proves nothing.
    const s = createJsonStringRunScanner();
    const realDraft = JSON.stringify({
      nodes: [
        { id: 'goal_support', kind: 'goal', label: 'Resolve Support Overwhelm and Maintain Customer Satisfaction' },
        {
          id: 'fac_infra', kind: 'factor', label: 'Infrastructure maturity',
          data: {
            value: 0.4, extractionType: 'inferred', factor_type: 'cost', unit: 'scale',
            uncertainty_drivers: ['Infrastructure maturity varies across UK, US-East, US-West, EU-Central, APAC'],
          },
        },
      ],
      edges: [{ from: 'fac_infra', to: 'goal_support', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
    });
    // Fed in realistic small chunks, as the provider streams it.
    let max = 0;
    for (let i = 0; i < realDraft.length; i += 17) max = Math.max(max, s.push(realDraft.slice(i, i + 17)));
    expect(max).toBe(OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS);
    expect(max).toBeLessThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);
  });
});

// ---------------------------------------------------------------------------
describe('THE ABORT IS VISIBLE ON THE WIRE (a guard whose firing cannot be seen is theatre)', () => {
  it('the failed-call meta carries the trigger ledger, and ONE builder produces it', () => {
    const meta = buildFailedCallLlmMeta({
      model: 'claude-sonnet-4-6',
      providerLatencyMs: 41_000,
      finishReason: 'skipped_unaffordable_final',
      runawayAbortCount: 2,
      runawayAbortTriggers: ['string', 'string'],
      maxTokens: 3_150,
    });
    expect(meta.runaway_abort_triggers).toEqual(['string', 'string']);
    expect(meta.runaway_abort_count).toBe(2);
  });

  it('⭐ THE FOURTH-COPY DEFECT IS CLOSED — every failure meta has the SAME key set', () => {
    // The regression this pins: the `skipped_unaffordable_final` throw was a
    // hand-built literal two keys short of the canonical meta, authored ~400
    // lines from the commit that deleted the THIRD such copy. A key added to one
    // must reach the others. Compare KEY SETS, not values — the skip path has no
    // response, so its response-derived values are legitimately undefined.
    const withResponse = buildFailedCallLlmMeta({
      model: 'm', providerLatencyMs: 1, runawayAbortCount: 0, runawayAbortTriggers: [],
      timeToEdgesMs: 14_000, tokenUsage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const skipPath = buildFailedCallLlmMeta({ model: 'm', providerLatencyMs: 1, runawayAbortCount: 2, runawayAbortTriggers: ['string'] });
    expect(Object.keys(skipPath).sort()).toEqual(Object.keys(withResponse).sort());
  });

  it('the wire projection carries the trigger ledger onto trace.pipeline.llm_metadata', () => {
    // The projection is a deliberate keep-list; a field the adapter emits but the
    // projection drops is invisible to every response body — exactly how
    // `runaway_abort_count` went missing from 60 captures.
    const projected = buildLlmMetadataProjection(
      { model: 'claude-sonnet-4-6', runaway_abort_count: 1, runaway_abort_triggers: ['string'] },
      'fallback',
    );
    expect(projected.runaway_abort_triggers).toEqual(['string']);
  });
});
