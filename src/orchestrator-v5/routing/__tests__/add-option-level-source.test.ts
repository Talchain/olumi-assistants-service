/**
 * C2 — WHOSE AN OPTION'S LEVEL IS, CARRIED THROUGH THE ONE APPROVAL (Runtime #70 5844173937; Canonical ruling 5844217159).
 *
 * The typed add-option builder stamped every level `source: 'user_specified'`, and its params schema is
 * non-strict, so an Agent-suggested figure could only arrive as the user's (an extra `source` was silently
 * dropped). The wire is now `source?: 'user_specified' | 'cee_hypothesis'` per intervention:
 *   · absent                   → `user_specified` (today's bytes);
 *   · `cee_hypothesis`         → stamped as given — the SAME literal an adopted Olumi level already carries;
 *   · anything else            → `parameters_invalid`, refused loudly, nothing held (never dropped).
 *
 * Every row drives the REAL seams: `dispatchAddOptionTransaction` holds it, `executeGmHeldResume` applies it
 * on approval, `projectGraphForPersistence` is the stored shape, and `GraphV3.safeParse` is the run path.
 * The fixture is Paul's served graph (DL `bf-20260926T054503Z`, turn 3) before the add.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { buildAddOptionsTransaction } from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-f4-pre-addon.bf-054503.json', import.meta.url), 'utf8'),
) as { nodes: Json[]; edges: Json[] };
const STORED = projectGraphForPersistence(structuredClone(SERVED)) as typeof SERVED;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;

const LABEL = 'Raise to £64';
const single = (source?: unknown): Json => ({
  parent_decision_id: 'decision_mrr',
  label: LABEL,
  interventions: [{ factor_id: 'pro_plan_price', value: 0.32, ...(source === undefined ? {} : { source }) }],
});
const withNewFactor = (source?: unknown): Json => ({
  parent_decision_id: 'decision_mrr',
  label: 'Keep £49 and add a paid AI add-on',
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.245 },
    { factor_key: 'addon', value: 0.2, ...(source === undefined ? {} : { source }) },
  ],
  new_factors: [{ key: 'addon', label: 'Paid AI add-on', affects: [{ node_id: 'mrr', effect_direction: 'positive' }] }],
});

const hold = (spec: Json) => dispatchAddOptionTransaction({
  parameters: spec, currentGraph: STORED, currentGraphHash: HASH, freshness: 'none',
  mode: 'live', scenarioId: 's', turnId: 't', requestId: 'r', stage: 'decide',
} as never) as Json;

/** Approve the one hold through the real confirm path; return the stored graph and its run-path parse. */
function approve(spec: Json): { stored: Json; parsed: Json } {
  const out = hold(spec);
  expect(out.kind, 'premise: the change is held for approval').toBe('held');
  const read = readGmHeldResume(out.pendingActions[0]) as Json;
  const executed = executeGmHeldResume({
    operations: read.operations, ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
    currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
    scenarioId: 's', turnId: 't-confirm', requestId: 'r-confirm',
  }) as Json;
  expect(executed.status, 'premise: the approval executes').toBe('executed');
  const stored = projectGraphForPersistence(structuredClone(executed.mutatedGraph)) as Json;
  const parsed = GraphV3.safeParse(stored);
  expect(parsed.success, 'premise: the run path parses the stored graph').toBe(true);
  return { stored, parsed: parsed.data as Json };
}

const optionNamed = (g: Json, label: string) => g.nodes.find((n: Json) => n.kind === 'option' && n.label === label);
const levelSource = (g: Json, label: string, factorId: string) => optionNamed(g, label)?.interventions?.[factorId]?.source;

describe('C2 — an option level says whose it is, through the one approval', () => {
  it('⭐ an Olumi estimate lands as `cee_hypothesis` — stored AND on the run path', () => {
    const { stored, parsed } = approve(single('cee_hypothesis'));
    expect(levelSource(stored, LABEL, 'pro_plan_price')).toBe('cee_hypothesis');
    expect(levelSource(parsed, LABEL, 'pro_plan_price')).toBe('cee_hypothesis');
  });

  it('CONTROL — no `source` is the user\'s, exactly as before', () => {
    const { stored, parsed } = approve(single());
    expect(levelSource(stored, LABEL, 'pro_plan_price')).toBe('user_specified');
    expect(levelSource(parsed, LABEL, 'pro_plan_price')).toBe('user_specified');
  });

  it('an explicit `user_specified` is the user\'s', () => {
    expect(levelSource(approve(single('user_specified')).stored, LABEL, 'pro_plan_price')).toBe('user_specified');
  });

  it('a NEW factor\'s level (`factor_key`) carries its stamp too', () => {
    const { stored } = approve(withNewFactor('cee_hypothesis'));
    const factorId = stored.nodes.find((n: Json) => n.label === 'Paid AI add-on')?.id as string;
    expect(factorId).toBeDefined();
    expect(levelSource(stored, 'Keep £49 and add a paid AI add-on', factorId)).toBe('cee_hypothesis');
    expect(levelSource(stored, 'Keep £49 and add a paid AI add-on', 'pro_plan_price'), 'its sibling level stays the user\'s')
      .toBe('user_specified');
  });

  it.each([
    ['a literal outside the contract', 'model_said_so'],
    ['the drafter\'s literal (never the Agent\'s)', 'brief_extraction'],
    ['a non-string', 1],
  ])('%s is REFUSED loudly (parameters_invalid) and nothing is held — never dropped and stamped as the user\'s', (_name, source) => {
    expect(buildAddOptionsTransaction(single(source), STORED as never)).toMatchObject({ matched: false, reason: 'parameters_invalid' });
    expect(hold(single(source)).kind).not.toBe('held');
  });

  it('PIN — whose a level is never moves the analysis identity (so re-attributing it cannot stale a run)', () => {
    const olumi = approve(single('cee_hypothesis')).stored;
    const user = approve(single()).stored;
    expect(computeAnalysisAffectingGraphHash(olumi as never)).toBe(computeAnalysisAffectingGraphHash(user as never));
  });

  it('PIN — an Olumi estimate counts as SET for readiness (no missing-value issue names that option)', () => {
    const { stored } = approve(single('cee_hypothesis'));
    const optionId = optionNamed(stored, LABEL).id as string;
    const issues = ((resolveRunAdmission(stored) as Json).assessment?.issues ?? []) as Json[];
    expect(issues.filter((i) => i.option_id === optionId && i.code === 'MISSING_OPTION_VALUE')).toEqual([]);
  });
});
