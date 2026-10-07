"""Challenge production fix limbs; restore exact backup bytes after every mutant. No Vitest."""
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import subprocess

root = Path(__file__).resolve().parents[2]
replay = ['node', '--import', 'tsx', 'tools/limit-check-replay/replay.ts']
mutants = [
    ('agreement check off', 'src/orchestrator/context/placeholder-parts.ts',
     " || (unit !== undefined && !sameUnit(unit, u))", ''),
    ('estimate exclusion off', 'src/orchestrator/context/placeholder-parts.ts',
     "if (p === undefined || p.source === 'cee_hypothesis' || p.mean_projected === true\n        || (typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_'))) return false;",
     "if (p === undefined) return false;"),
    ('identity pass-through off in limit reader', 'src/orchestrator-v5/agent-lane/limit-checks.ts',
     'withheldOptionsOrNone(graph, limit?.node_id ?? null, identityEvaluated)',
     'withheldOptionsOrNone(graph, limit?.node_id ?? null)'),
    ('identity pass-through off in saved/Explain carrier', 'src/orchestrator-v5/agent-lane/saved-run-context-facts.ts',
     'limitChecksForAgent(read.raw, read.limit_verdicts, read.identity_evaluated)',
     'limitChecksForAgent(read.raw, read.limit_verdicts)'),
    ('identity pass-through off in runAnalysis carrier', 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts',
     'limitChecksForAgent(read?.raw, read?.limit_verdicts, read?.identity_evaluated)',
     'limitChecksForAgent(read?.raw, read?.limit_verdicts)'),
]

def run():
    return subprocess.run(replay, cwd=root, capture_output=True, text=True, timeout=60)

baseline = run()
assert baseline.returncode == 0, baseline.stderr
print('BASELINE GREEN', flush=True)
with TemporaryDirectory(prefix='lim1-r2-backups-') as directory:
    for i, (name, relative, old, new) in enumerate(mutants):
        source = root / relative
        original = source.read_bytes()
        backup = Path(directory) / f'{i}.backup'
        backup.write_bytes(original)
        assert original.decode().count(old) == 1, (name, 'mutation target must be unique')
        try:
            source.write_text(original.decode().replace(old, new, 1))
            result = run()
            assert result.returncode != 0 and 'AssertionError' in result.stderr, (name, result.stdout, result.stderr)
            cause = result.stderr[result.stderr.index('AssertionError'):].split('    at ')[0].strip()
            print(f'MUTANT RED: {name}\n{cause}', flush=True)
        finally:
            source.write_bytes(backup.read_bytes())
            assert source.read_bytes() == original
            print(f'RESTORED {relative} sha256={hashlib.sha256(original).hexdigest()}', flush=True)
        restored = run()
        assert restored.returncode == 0, restored.stderr
        print('RESTORED GREEN', flush=True)
print('ALL FIVE PRODUCTION MUTANTS RED; ALL BACKUPS RESTORED BYTE-FOR-BYTE', flush=True)
