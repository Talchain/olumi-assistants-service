import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// DL #2895 P2: explicit file/reason pairs, never broad directory exemptions.
const ALLOWLIST: Readonly<Record<string, string>> = {
  "orchestrator-v5/goal-target/goal-horizon-verdict.ts": "The sole goal-chance horizon verdict and read-time gate; heldGoalDeadline is the one schema-validated calendar deadline accessor for this permission and wording.",
  "orchestrator-v5/goal-target/goal-record.ts": "S5 sole typed goal record reads protected goal fields; no chance permission.",
  "orchestrator-v5/goal-target/horizon-basis.ts": "S5 graph-only proof predicate; verifies door provenance and bound goal meaning.",
  "orchestrator-v5/goal-target/goal-steady-write.ts": "S5 approved door mints the proof and validates in-process write authority; not a consumer chance decision.",
  "orchestrator-v5/goal-target/horizon-basis-provenance.ts": "S5 storage preparation strips caller basis and carries only stored or door-authorised provenance.",
  "orchestrator-v5/goal-target/outbound-graph.ts": "S5 outbound projection strips server-only proof; no chance permission.",
  "orchestrator/route-v2.ts": "S5 legacy route rejects caller-authored basis; no chance permission.",
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
  'orchestrator-v5/build-turn-context.ts',
  'routes/scenario-graph-analysis-read.ts', 'routes/assist.v1.scenario-versions.ts',
  'orchestrator-v5/coaching/structural-challenge-compare.ts',
  'orchestrator-v5/context/analysis-fallback.ts', 'orchestrator-v5/compose.ts',
  'orchestrator-v5/tools/handlers/run-analysis.ts', 'orchestrator-v5/agent-lane/decision-input-ask.ts',
  'orchestrator-v5/agent-lane/reply/compose-reply.ts',
] as const;
const PURE_FILES = [
  'routes/canonical-analysis-view.ts', 'routes/agent-v1-turn.ts',
  'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts',
  'orchestrator-v5/agent-lane/decision-sensitivity.ts', 'orchestrator-v5/agent-lane/goal-certainty-for-agent.ts',
  'orchestrator-v5/agent-lane/goal-chance-withheld.ts', 'orchestrator-v5/goal-target/goal-chance-licence.ts',
  'orchestrator-v5/goal-target/goal-chance-range-agent.ts', 'orchestrator-v5/goal-target/goal-chance-sides.ts',
  'orchestrator-v5/coaching/build-run-delta.ts', 'orchestrator-v5/response-finaliser.ts',
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

// Inspect code references, excluding comments documenting where permission belongs.
function referencesHorizonHelper(source: string): boolean {
  const tree = ts.createSourceFile('census.ts', source, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)
      && ['accumulationTestedAtGoalHorizon', 'horizonSteadyAttested'].includes(node.text)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe('S4: horizon token census', () => {
  it('storage boundaries and producer paths use the sole verdict; pure readers and JSON decoders never re-gate', () => {
    for (const file of PURE_FILES) expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toContain('withReadTimeHorizonGate');
    expect(readFileSync(join(ROOT, 'orchestrator-v5/goal-target/goal-horizon-verdict.ts'), 'utf8')).not.toContain('Symbol(');
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
    expect(referencesHorizonHelper('/** use horizonSteadyAttested(graph) */')).toBe(false);
    expect(referencesHorizonHelper('horizonSteadyAttested(graph)')).toBe(true);
    expect(referencesHorizonHelper('accumulationTestedAtGoalHorizon(graph)')).toBe(true);
    expect(referencesHorizonHelper('import { horizonSteadyAttested as bypass } from "./helper.js"')).toBe(true);
    expect(offenders(files), 'Unallowlisted horizon-token readers').toEqual([]);
    expect(files.filter(file => referencesHorizonHelper(file.text)
      && !['orchestrator-v5/goal-target/goal-horizon-verdict.ts', 'orchestrator-v5/goal-target/horizon-basis.ts',
        'orchestrator-v5/goal-target/goal-steady-write.ts'].includes(file.path))
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
