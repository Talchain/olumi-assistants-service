/**
 * #2576 item 6 (DL condition a, STOP2-SCALE-EXPOSURE.md "CEE"): THE USER-VISIBLE SCALE SURFACES ARE NO MORE THAN AT
 * SERVED STAGING, AND EVERY ONE THAT STATES A FACTOR'S SCALE NAMES IT AS OLUMI'S ASSUMPTION.
 *
 * A static scan of every non-test `src/**\/*.ts` line that interpolates `cap` / `scale_frame` / `plausible_max` (or the
 * formatted `formattedCap`) into a template literal. The manifest below is the set at staging c5fd360d (21 sites,
 * enumerated by this same detector on `git grep` at that commit), each classified. The row fails when:
 *   · a site exists at this head that the staging set does not hold (a new scale surface must be classified here first);
 *   · a manifest entry matches no line (the pin went stale);
 *   · an `olumi_scale` site does not say "Olumi assumed".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type SiteClass =
  /** States a factor's scale/cap to a user (or the Agent relays it): must name it as Olumi's assumption (DL item 5). */
  | 'olumi_scale'
  /** The scale is the PROPOSAL's own stated one, not Olumi's: labelling it Olumi's would mislabel the user's (kept). */
  | 'proposal_own_scale'
  /** States a scale but was not on the DL's site list; reported, unchanged here. */
  | 'flagged_unlabelled'
  /** Internal only (debug/log/validator detail), per STOP2-SCALE-EXPOSURE.md "Internal only". */
  | 'internal'
  /** `cap` is not a factor scale here (a list length, a batch size, a limit's own word). */
  | 'not_a_scale';

const STAGING_C5FD360D: ReadonlyArray<{ file: string; anchor: string; cls: SiteClass }> = [
  { file: 'src/cee/context-integrity/brief-audit-answer.ts', anchor: 'more (these are the first', cls: 'not_a_scale' },
  { file: 'src/cee/dual-draft/merge.ts', anchor: 'exceeds cap ${oversized.cap}', cls: 'not_a_scale' },
  { file: 'src/cee/factor-extraction/enricher.ts', anchor: 'Normalised factor value:', cls: 'internal' },
  { file: 'src/cee/transforms/graph-data-integrity.ts', anchor: 'inconsistent with raw_value/cap', cls: 'internal' },
  { file: 'src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts', anchor: 'Pruned weak edge', cls: 'not_a_scale' },
  { file: 'src/orchestrator-v5/agent-lane/admit-constraint.ts', anchor: "'floor' : 'cap'", cls: 'not_a_scale' },
  { file: 'src/orchestrator-v5/agent-lane/admit-model.ts', anchor: 'is measured on (0 to ${cap})', cls: 'flagged_unlabelled' },
  { file: 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', anchor: 'up to ${os.cap}', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', anchor: 'unframed.push({ factor: factor.label, detail:', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', anchor: 'reason: `${raw} is outside', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', anchor: 'notSet(`${shown} is outside the range', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/compose/repair-value-ask-response.ts', anchor: 'label.slice(0, cap - 1)', cls: 'not_a_scale' },
  { file: 'src/orchestrator-v5/graph-management/referee.ts', anchor: '-envelope cap.', cls: 'not_a_scale' },
  { file: 'src/orchestrator-v5/routing/edit-part-decomposition.ts', anchor: 'I can only show the first', cls: 'not_a_scale' },
  { file: 'src/orchestrator-v5/system-events/factor-value-edit.ts', anchor: '`raw_value ${rawValue}${cap !== undefined', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts', anchor: 'Cap must be positive', cls: 'proposal_own_scale' },
  { file: 'src/orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts', anchor: 'specific_issue: `Value ${effectiveRaw} is outside', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts', anchor: "exceeds the factor's cap of", cls: 'proposal_own_scale' },
  { file: 'src/orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts', anchor: '`${formattedInput} is above', cls: 'olumi_scale' },
  { file: 'src/orchestrator-v5/tools/handlers/set-factor-value.ts', anchor: 'for this factor now allows values up to', cls: 'olumi_scale' },
];
/** Sites per anchor at staging (the two `Value … is outside` refusals share one anchor). */
const STAGING_COUNT: Readonly<Record<string, number>> = { 'specific_issue: `Value ${effectiveRaw} is outside': 2 };
const STAGING_SITES = 21;

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCALE_WORD = /(?<![A-Za-z0-9_])(cap|scale_frame|plausible_max|formattedCap|levelCap)(?![A-Za-z0-9_])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'generated' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Every template interpolation of a scale word, as (file, line text). The detector the staging pin was taken with. */
function scaleSites(): Array<{ file: string; line: string }> {
  const out: Array<{ file: string; line: string }> = [];
  for (const path of sourceFiles(join(ROOT, 'src'))) {
    readFileSync(path, 'utf8').split('\n').forEach((line) => {
      if ([...line.matchAll(/\$\{([^}]*)\}/g)].some((m) => SCALE_WORD.test(m[1]!))) out.push({ file: relative(ROOT, path), line });
    });
  }
  return out;
}

describe('#2576 item 6: scale surfaces at this head ⊆ served staging c5fd360d, and each one that states a scale says it is Olumi\'s', () => {
  const sites = scaleSites();

  it('positive control: the detector sees the pinned sites (the probe is not blind)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
    expect(STAGING_C5FD360D.reduce((n, e) => n + (STAGING_COUNT[e.anchor] ?? 1), 0)).toBe(STAGING_SITES);
  });

  it('every site at this head is one the staging set holds (no new scale surface)', () => {
    const unknown = sites.filter((s) => !STAGING_C5FD360D.some((e) => e.file === s.file && s.line.includes(e.anchor)));
    expect(unknown.map((s) => `${s.file}: ${s.line.trim()}`)).toEqual([]);
    expect(sites.length).toBeLessThanOrEqual(STAGING_SITES);
  });

  it('every pinned entry still matches its site(s) (no stale pin)', () => {
    for (const e of STAGING_C5FD360D) {
      expect(sites.filter((s) => s.file === e.file && s.line.includes(e.anchor)).length, `${e.file}: ${e.anchor}`).toBe(STAGING_COUNT[e.anchor] ?? 1);
    }
  });

  it('every olumi_scale site names the scale as Olumi\'s assumption', () => {
    const olumi = STAGING_C5FD360D.filter((e) => e.cls === 'olumi_scale');
    expect(olumi.length).toBe(8);
    for (const e of olumi) {
      for (const s of sites.filter((x) => x.file === e.file && x.line.includes(e.anchor))) expect(s.line, `${e.file}`).toContain('Olumi assumed');
    }
  });
});
