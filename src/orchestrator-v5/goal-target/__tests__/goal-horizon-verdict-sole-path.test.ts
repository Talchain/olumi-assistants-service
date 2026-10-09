import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// DL #2895 P2: explicit file/reason pairs, never broad directory exemptions.
const ALLOWLIST: Readonly<Record<string, string>> = {
  "orchestrator-v5/goal-target/goal-horizon-verdict.ts": "The sole goal-chance horizon verdict and read-time gate.",
  "orchestrator-v5/goal-target/horizon-basis.ts": "Parked attestation predicate; always false until S5 2b provenance enforcement.",
  "schemas/cee-v3.ts": "Declares goal-month schema and protected stored attestation fields.",
  "schemas/value-warrant-guard.ts": "Schema guard allow/deny lists; not a chance decision.",
  "adapters/llm/normalisation.ts": "Strips model-authored protected fields before admission.",
  "orchestrator-v5/graph-management/field-safety.ts": "Deny/strip lists for graph writes; cannot licence a chance.",
  "orchestrator-v5/context/graph-hash.ts": "Hash field list remains unchanged; horizon hash support is deferred to S6.",
  "orchestrator-v5/goal-target/goal-horizon-detail.ts": "Wording only: deadline and positional missing-input detail; verdict owns permission.",
  "orchestrator-v5/goal-target/goal-chance-licence.ts": "Formats zero-spread wording through the held-month accessor after goalHorizonVerdict decides.",
  "orchestrator-v5/agent-lane/decision-input-ask.ts": "Formats the held deadline and chance-free A7; goalHorizonVerdict owns permission.",
  "orchestrator-v5/agent-lane/horizon-attestation.ts": "Brief-to-deadline attestation documentation; not the parked steady-basis writer.",
  "orchestrator-v5/agent-lane/stated-by-user.ts": "Writes the brief-attested goal month; not a chance decision.",
  "orchestrator-v5/agent-lane/accumulation-identity.ts": "Admits a drafter accumulation carrier at the held goal month; not a chance licence.",
  "orchestrator-v5/agent-lane/admit-model.ts": "Documents goal-month drafter admission; not a chance decision.",
  "orchestrator-v5/agent-lane/runtime/build-model.ts": "Build-time deadline/carrier admission documentation; not a chance decision.",
  "orchestrator-v5/admission/target-testability.ts": "P1 current-level admission: validates every operand and unit, including accumulation horizon equality. Broader than evaluated goal-chance verdict; preserving existing behavior.",
  "orchestrator-v5/tools/handlers/run-analysis.ts": "withoutDriftedAccumulations removes every drifted carrier, even unbound ones and with no H, and formats its drift warning. Broader than goal-bound chance verdict; preserving existing behavior.",
};

const GATE_FILES = [
  'routes/scenario-graph-analysis-read.ts', 'routes/canonical-analysis-view.ts', 'routes/agent-v1-turn.ts',
  'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', 'orchestrator-v5/agent-lane/decision-sensitivity.ts',
  'orchestrator-v5/agent-lane/goal-certainty-for-agent.ts', 'orchestrator-v5/agent-lane/goal-chance-withheld.ts',
  'orchestrator-v5/goal-target/goal-chance-licence.ts', 'orchestrator-v5/goal-target/goal-chance-range-agent.ts',
  'orchestrator-v5/goal-target/goal-chance-sides.ts', 'orchestrator-v5/coaching/structural-challenge-compare.ts',
  'orchestrator-v5/context/analysis-fallback.ts', 'orchestrator-v5/compose.ts', 'orchestrator-v5/response-finaliser.ts',
  'orchestrator-v5/tools/handlers/run-analysis.ts', 'orchestrator-v5/agent-lane/decision-input-ask.ts',
  'orchestrator-v5/agent-lane/reply/compose-reply.ts',
] as const;

const TOKENS = /\b(?:horizon_basis\w*|goal_horizon_months)\b/;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(path);
    return /\.(?:test|spec)\./.test(entry.name) ? [] : [path];
  });
}
const offenders = (files: readonly { path: string; text: string }[]) =>
  files.filter(file => TOKENS.test(file.text) && !Object.hasOwn(ALLOWLIST, file.path)).map(file => file.path);

describe('S4: horizon token census', () => {
  it('all 17 gate files route through the sole verdict or its two public gates', () => {
    for (const file of GATE_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, file).toMatch(/(?:goalHorizonVerdict|withReadTimeHorizonGate|withholdGoalFiguresForUntestedHorizon)\(/);
      // Direct month tokens outside the verdict module have a reasoned allowlist entry: formatter, writer or admission.
      if (TOKENS.test(source)) expect(ALLOWLIST[file], file).toBeDefined();
    }
    for (const file of ['orchestrator-v5/goal-target/goal-chance-licence.ts',
      'orchestrator-v5/goal-target/goal-horizon-detail.ts', 'orchestrator-v5/agent-lane/decision-input-ask.ts']) {
      expect(readFileSync(join(ROOT, file), 'utf8'), `${file}: no local held-month read`).not.toMatch(/\.goal_horizon_months\b|\[\s*['"]goal_horizon_months['"]\s*\]/);
    }
    process.stdout.write(`S4 gate census: ${GATE_FILES.length} production gate files use the one verdict path\n`);
  });
  it(`rejects every non-test src horizon-token reader outside the ${Object.keys(ALLOWLIST).length}-file reasoned allowlist`, () => {
    const files = walk(ROOT).map(path => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
    expect(Object.values(ALLOWLIST).every(reason => reason.trim().length > 0)).toBe(true);
    expect(offenders(files), 'Unallowlisted horizon-token readers').toEqual([]);
    expect(files.filter(file => /\b(?:accumulationTestedAtGoalHorizon|horizonSteadyAttested)\b/.test(file.text)
      && !['orchestrator-v5/goal-target/goal-horizon-verdict.ts', 'orchestrator-v5/goal-target/horizon-basis.ts'].includes(file.path))
      .map(file => file.path), 'No consumer bypasses the verdict through a helper predicate').toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(1000);
    process.stdout.write(`S4 token census: allowlist=${Object.keys(ALLOWLIST).length}, files=${files.length}\n`);
  });
  it.each([
    'goal.horizon_basis === "steady_attested"',
    'goal["horizon_basis_forged_suffix"]',
    'goal.goal_horizon_months > 0',
    'goal["goal_horizon_months"]',
  ])('rejects bypass token even without an old predicate call: %s', text => {
    expect(offenders([{ path: 'orchestrator-v5/planted-bypass.ts', text }])).toEqual(['orchestrator-v5/planted-bypass.ts']);
  });
});
