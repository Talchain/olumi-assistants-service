"""Disable only class 3, require its behavioral row to fail, and restore the source."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
evidence = Path(__file__).resolve().parent
source = root / 'src/orchestrator-v5/goal-target/target-testability-per-option.ts'
original = source.read_bytes()
before = "const carrier = product ?? (accumulation?.operation === 'accumulation' ? accumulation : null);"
assert original.decode().count(before) == 1
try:
    source.write_text(original.decode().replace(before, 'const carrier = product;'))
    result = subprocess.run([sys.executable, str(evidence / 'run-checks-fix2.py'), 'FIX2-MUTANT-class3-off',
                             'src/orchestrator-v5/goal-target/__tests__/b2-target-scope.test.ts', '--select', 'class 3'],
                            cwd=root, stdin=subprocess.DEVNULL)
finally:
    source.write_bytes(original)
log = (evidence / 'FIX2-MUTANT-class3-off.log').read_text()
restored = source.read_bytes() == original
killed = result.returncode == 1 and 'AssertionError' in log and "expected [ 'x', 'y' ] to deeply equal [ 'y' ]" in log
record = {'mutant': 'class3-off', 'test_exit': result.returncode, 'killed': killed, 'restored': restored,
          'source_sha256': hashlib.sha256(original).hexdigest()}
(evidence / 'FIX2-mutation-summary.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
sys.exit(0 if killed and restored else 1)
