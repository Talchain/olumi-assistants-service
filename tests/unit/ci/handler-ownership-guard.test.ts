/** Positive and mutation controls for the CURRENT single writer and the HTTP-only numeric parser exception. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUARD_WALK_TIMEOUT_MS } from '../../../scripts/ci/strip-source-comments.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const handler = readFileSync(join(root, 'src/orchestrator-v5/tools/handlers/run-analysis.ts'), 'utf8');
const guard = readFileSync(join(root, 'scripts/validate-handler-ownership.sh'), 'utf8');
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function check(mutated: string) {
  const temp = mkdtempSync(join(tmpdir(), 'd2544-ownership-'));
  try {
    const file = join(temp, 'run-analysis.ts');
    const script = join(temp, 'guard.sh');
    writeFileSync(file, mutated);
    writeFileSync(script, guard
      .replace(/^REPO_ROOT=.*$/m, `REPO_ROOT=${quote(root)}`)
      .replace(/^HANDLER_FILE=.*$/m, `HANDLER_FILE=${quote(file)}`));
    return spawnSync('bash', [script], { cwd: root, encoding: 'utf8' });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

describe('handler ownership guard: non-vacuous current authority', () => {
  it('accepts the actual handler: composed remove-only permission, projection stamp and HTTP metadata parsing', () => {
    expect(() => execFileSync('bash', ['scripts/validate-handler-ownership.sh'], { cwd: root, encoding: 'utf8' })).not.toThrow();
  }, GUARD_WALK_TIMEOUT_MS);
  it.each([
    ['missing writer', (s: string) => s.replace('constraint_verdict: keptOlumiProvisional', 'obsolete_verdict: keptOlumiProvisional')],
    ['duplicate writer', (s: string) => `${s}\nconst extra = { constraint_verdict: leaderPermission };\n`],
    ['unbound validation', (s: string) => s.replace('RunAnalysisHandlerFactSchema.safeParse(factCandidate)', 'RunAnalysisHandlerFactSchema.safeParse(otherFact)')],
    ['scope bypass', (s: string) => s.replace("snapshot.goalScopeClaimInput.status !== 'clear'", "snapshot.goalScopeClaimInput.status === 'clear'")],
    ['permission rederivation', (s: string) => `${s}\nconst duplicate = projectClaimSafety(constraintVerdict);\n`],
    ['intake bypass', (s: string) => s.replace('applyIntakeToLeaderPermission(\n        projectClaimSafety', 'bypassIntakePermission(\n        projectClaimSafety')],
    ['scientific parse', (s: string) => `${s}\nconst measurement = Number.parseInt(response.probability_of_goal, 10);\n`],
    ['scientific rounding', (s: string) => `${s}\nconst measurement = Math.round(response.probability_of_goal);\n`],
    ['metadata parser repurposed', (s: string) => s.replace('const reason = v2Err?.status_reason;', 'const reason = v2Err?.probability_of_goal;')],
    ['projection pass-through replaced', (s: string) => s.replace('enrichment: stampRunAnalysisProjection(response as Record<string, unknown>)', 'enrichment: stampRunAnalysisProjection(otherResponse as Record<string, unknown>)')],
  ] as const)('rejects %s without weakening the guard', (_name, mutate) => {
    const changed = mutate(handler);
    expect(changed).not.toBe(handler);
    const result = check(changed);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('FAIL:');
  }, GUARD_WALK_TIMEOUT_MS);
});
