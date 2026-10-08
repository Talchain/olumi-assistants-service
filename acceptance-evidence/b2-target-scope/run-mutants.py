#!/usr/bin/env python3
"""One reversible mutant per changed behavior, with the required gated single-worker test command."""
from pathlib import Path
import hashlib, json, shlex, subprocess

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'acceptance-evidence/b2-target-scope'
P = 'src/orchestrator-v5/goal-target/target-testability-per-option.ts'
R = 'src/orchestrator-v5/tools/handlers/run-analysis.ts'
I = 'src/orchestrator-v5/admission/identity-evaluations.ts'
S = 'src/orchestrator-v5/goal-target/scope-target-not-testable.ts'
A = 'src/orchestrator-v5/agent-lane/goal-chance-withheld.ts'
B2 = 'src/orchestrator-v5/goal-target/__tests__/b2-target-scope.test.ts'
S6 = 'src/orchestrator-v5/goal-target/__tests__/s-e-goals-s6.test.ts'
mutants = [
 ('M01-scoping-off', R, "const ids = candidates.filter(id => scopedFailuresFor(verdict.failures, paths.get(id) ?? [], labelOf).length > 0);", "const ids = candidates;", B2, 'B2: three Starter'),
 ('M02-class1-option-only', P, 'products.some(c => c.factor_ids.some(a => feed.has(a)', 'false && products.some(c => c.factor_ids.some(a => feed.has(a)', B2, 'class 1:'),
 ('M03-derived-baseline-off', P, 'const baselineOperands = goalBaselineFromIdentityInputs(', 'const baselineOperands = false && goalBaselineFromIdentityInputs(', B2, 'class 2:'),
 ('M04-goal-level-option-scoped', P, "if (f.case !== 'c') return [f];", "if (f.case !== 'c') return [];", B2, 'missing goal baseline'),
 ('M05-linkless-dropped', P, 'if (failingLinks.length === 0) return [f];', 'if (failingLinks.length === 0) return [];', B2, 'linkless P5'),
 ('M06-clean-option-waits', P, 'if (failures.length === 0) continue;', "if (failures.length === 0) { Object.defineProperty(out, id, { enumerable: true, value: { message: 'Not shown. It needs nothing more of its own.' } }); continue; }", B2, 'without an earlier withhold'),
 ('M07-final-warning-scope-off', S, 'remaining = remaining.filter(id => scopedFailuresFor(verdict.failures, pathsByOption.get(id) ?? [], labelOf).length > 0);', '// mutant: retain all original warning options', S6, 'R2 s4b'),
 ('M08-derived-borrows-attestation', I, 'evaluatedIdentityCarriers(nodes, [e]).has(goalId)', 'evaluatedIdentityCarriers(nodes, identityEvaluations).has(goalId)', B2, 'cannot borrow'),
 ('M09-producer-speech-unscoped', R, "const speech = ids.length < scored.length && verdict.failures.every(f => f.case === 'c')", "const speech = false && ids.length < scored.length && verdict.failures.every(f => f.case === 'c')", B2, 'Agent target-only note'),
 ('M10-agent-scope-off', A, 'const partial = targetAndPaths && scoped && scoredIds.some(id => !scopedIds.includes(id));', 'const partial = false && targetAndPaths && scoped && scoredIds.some(id => !scopedIds.includes(id));', B2, 'Agent target-only note'),
 ('M11-malformed-grants-shares', A, 'goalFiguresLeaderWithheldWarning({ enrichment: { inference_warnings: warnings } }) !== undefined', "warnings.some(w => Array.isArray(w.withheld_claims) && w.withheld_claims.includes('win_share'))", B2, 'legacy partial warning'),
 ('M12-malformed-claims-kept-outcome', A, "!warnings.every(w => Array.isArray(w.withheld_claims) && !w.withheld_claims.includes('outcome'))", "warnings.some(w => Array.isArray(w.withheld_claims) && w.withheld_claims.includes('outcome'))", B2, 'legacy partial warning'),
 ('M13-off-goal-product-affects-options', P, ' && reachFrom(n.id).has(selectedGoal)', '', B2, 'class 1 is transitive'),
 ('M14-other-goal-marker-applies', I, 'if (w.field !== undefined) return w.field === `nodes[${String(goalId)}].nonlinear_identity`;', 'if (w.field !== undefined) return true;', B2, "another goal's derived warning"),
]
results = []
for name, source, before, after, spec, selection in mutants:
    path = ROOT / source
    original = path.read_bytes()
    text = original.decode()
    if text.count(before) != 1:
        raise RuntimeError(f'{name}: exact replacement count {text.count(before)}')
    command = 'node -e "process.exit(require(\'os\').loadavg()[0] < 25 ? 0 : 1)" && node_modules/.bin/vitest run ' + shlex.quote(spec) + ' -t ' + shlex.quote(selection) + ' --maxWorkers=1 --no-file-parallelism --configLoader=runner < /dev/null'
    try:
        path.write_text(text.replace(before, after))
        run = subprocess.run(['/bin/zsh', '-c', command], cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        (EVIDENCE / (name + '.log')).write_text(run.stdout)
    finally:
        path.write_bytes(original)
    restored = hashlib.sha256(path.read_bytes()).hexdigest() == hashlib.sha256(original).hexdigest()
    killed = run.returncode != 0 and ('AssertionError' in run.stdout or 'TypeError' in run.stdout) and ' FAIL ' in run.stdout
    row = {'mutant':name, 'source':source, 'test':spec, 'selection':selection, 'exit':run.returncode, 'killed':killed, 'restored':restored, 'command':command,
           'summary':[line for line in run.stdout.splitlines() if 'Test Files' in line or 'Tests ' in line or line.startswith(' FAIL ')]}
    results.append(row)
    (EVIDENCE / 'mutation-summary.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(row), flush=True)
    if not killed or not restored:
        raise RuntimeError(f'{name}: mutant survived or runner failed; see log')
