from pathlib import Path
import subprocess
source=Path('src/orchestrator-v5/path-b/tools/draft-tool.ts')
original=source.read_text()
start=original.index('  if (receipt == null ||')
end=original.index("return unavailable('not_verified', 'unknown');",start)
condition=original[start:end]
mutants={
 'false-unknown': original[:start]+condition.replace('if (receipt == null ||','if (true || receipt == null ||',1)+original[end:],
 'graph-exists-only': original[:start]+'  if (!isSavedRead(after)) '+original[end:],
}
try:
 for name,mutated in mutants.items():
  source.write_text(mutated)
  with Path(f'recovery-notes/L26-mutant-{name}.log').open('w') as out:
   result=subprocess.run(['pnpm','exec','vitest','run','src/orchestrator-v5/path-b/tools/__tests__/draft-save-truth.route.test.ts'],stdout=out,stderr=subprocess.STDOUT)
  print(name, 'KILLED' if result.returncode else 'SURVIVED',result.returncode,flush=True)
finally:
 source.write_text(original)
