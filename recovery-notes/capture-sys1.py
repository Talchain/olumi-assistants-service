from pathlib import Path
import subprocess,os
p=Path('src/orchestrator-v5/agent-lane/runtime/agent-tools.ts'); t=Path('tests/unit/sys1-turn-authority.test.ts')
new=p.read_text(); test=t.read_text()
try:
 t.write_text(test.replace('    expect(result).toEqual(', "    dump('requests-seen.json', JSON.stringify(bodies, null, 2));\n    expect(result).toEqual(",1))
 for phase,source in [('before',Path('recovery-notes/agent-tools.before.txt').read_text()),('after',new)]:
  p.write_text(source); evidence=Path('recovery-notes/sys1-'+phase); evidence.mkdir(exist_ok=True)
  with open('/private/tmp/a2e-sys1-'+phase+'.log','w') as log:
   result=subprocess.run(['npx','vitest','run',str(t)],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'SYS1_EVIDENCE':str(evidence.resolve())})
  print(phase,result.returncode,flush=True)
finally:
 p.write_text(new); t.write_text(test)
