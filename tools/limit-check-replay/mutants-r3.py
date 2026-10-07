"""Production regression limbs must each turn the replay RED; exact backup restoration, no Vitest."""
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import subprocess

root = Path(__file__).resolve().parents[2]
placeholder = 'src/orchestrator/context/placeholder-parts.ts'
handler = 'src/orchestrator-v5/tools/handlers/run-analysis.ts'
mutants = [
    ('P1 user strength exemption lost', placeholder,
     "return p?.source === 'user_specified'\n    && !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_')) && p.mean_projected !== true;",
     "return p?.source === 'user_specified' && !isRec(p.natural_effect);"),
    ('P1 estimate exclusion lost', placeholder,
     "&& !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_')) && p.mean_projected !== true;", "&& p.mean_projected !== true;"),
    ('P1 projected mean exclusion lost', placeholder,
     "&& !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_')) && p.mean_projected !== true;",
     "&& !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_'));"),
    ('P2 limit declaration alone counts', placeholder,
     "exactIdentityOperandLinks(nodes, edges, identityEvaluations, 'evaluated_only')", 'exactIdentityOperandLinks(nodes, edges, identityEvaluations)'),
    ('P2 target-testability default changed', 'src/orchestrator-v5/admission/identity-evaluations.ts',
     "mode: 'stated_or_evaluated' | 'evaluated_only' = 'stated_or_evaluated'", "mode: 'stated_or_evaluated' | 'evaluated_only' = 'evaluated_only'"),
    ('P2 fold loses evaluation', 'src/orchestrator/context/constraint-feasibility.ts',
     'placeholderMovedOptions(c.node_id, nodes, edges, options, limitUnits, identityEvaluations)', 'placeholderMovedOptions(c.node_id, nodes, edges, options, limitUnits)'),
    ('P2 option walk loses evaluation', placeholder,
     'placeholderPartsFinding(targetId, nodes, edges, [o], limitUnits, identityEvaluations)', 'placeholderPartsFinding(targetId, nodes, edges, [o], limitUnits)'),
    ('P2 runtime score fold loses evaluation', handler,
     '      finalWireOptions,\n      limitIdentityEvaluations,\n    ).placeholderMovedOptionIds;',
     '      finalWireOptions,\n    ).placeholderMovedOptionIds;'),
    ('P2 runtime verdict fold loses evaluation', handler,
     'collectLimitLevelOwners(graphForAnalysis, ratifiedConstraints, finalWireOptions, limitIdentityEvaluations)',
     'collectLimitLevelOwners(graphForAnalysis, ratifiedConstraints, finalWireOptions)'),
    ('P2 certainty edges lost', 'src/orchestrator-v5/agent-lane/goal-certainty.ts',
     'sizedLinkTest(nodes, limitUnitsOf(graph.goal_constraints), edges)', 'sizedLinkTest(nodes, limitUnitsOf(graph.goal_constraints))'),
    ('P2 saved Explain route carrier lost', 'src/routes/agent-v1-turn.ts',
     'identity_evaluated: st.identityEvaluated, limit_verdicts: st.limitVerdicts, constraint_verdict_state: st.constraintVerdictState, leader_limit_risks: st.leaderLimitRisks,',
     'limit_verdicts: st.limitVerdicts, constraint_verdict_state: st.constraintVerdictState, leader_limit_risks: st.leaderLimitRisks,'),
    ('P2 runtime chat carrier lost', 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts',
     'limitChecksForAgent(read?.raw, read?.limit_verdicts, read?.identity_evaluated)', 'limitChecksForAgent(read?.raw, read?.limit_verdicts)'),
    ('R8-2 direct projected mean read lost', placeholder,
     "if (p === undefined || p.source === 'cee_hypothesis' || p.mean_projected === true\n", "if (p === undefined || p.source === 'cee_hypothesis'\n"),
]

def run():
    return subprocess.run(['node', '--import', 'tsx', 'tools/limit-check-replay/replay-r3.ts'], cwd=root, capture_output=True, text=True, timeout=45)

baseline = run()
assert baseline.returncode == 0, baseline.stderr
print('BASELINE GREEN', flush=True)
with TemporaryDirectory(prefix='lim1-r3-backups-') as directory:
    for i, (name, relative, old, new) in enumerate(mutants):
        source = root / relative
        original = source.read_bytes()
        backup = Path(directory) / f'{i}.backup'
        backup.write_bytes(original)
        assert original.decode().count(old) == 1, (name, 'unique mutation target required')
        try:
            source.write_text(original.decode().replace(old, new, 1))
            result = run()
            assert result.returncode != 0 and 'AssertionError' in result.stderr, (name, result.stdout[-2000:], result.stderr)
            cause = result.stderr[result.stderr.index('AssertionError'):].split('    at ')[0].strip()
            print(f'MUTANT RED: {name}\n{cause}', flush=True)
        finally:
            source.write_bytes(backup.read_bytes())
            assert source.read_bytes() == original
            print(f'RESTORED {relative} sha256={hashlib.sha256(original).hexdigest()}', flush=True)
        restored = run()
        assert restored.returncode == 0, restored.stderr
        print('RESTORED GREEN', flush=True)
print(f'ALL {len(mutants)} PRODUCTION MUTANTS RED; ALL BACKUPS RESTORED BYTE-FOR-BYTE', flush=True)
