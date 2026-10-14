import json, os, shlex, subprocess, sys, time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
evidence=root/'acceptance-evidence/s5-census'
label=sys.argv[1]
argv=sys.argv[2:]
if 'vitest' in argv[0]:
    files=[a for a in argv if a.endswith('.test.ts')]
    assert 1 <= len(files) <= 2, files
    assert '--maxWorkers=1' in argv and '--configLoader=runner' in argv
load_cmd=['node','-e',"const load=require('node:os').loadavg()[0]; console.log(JSON.stringify({load,threshold:25})); process.exit(Number.isFinite(load)&&load<25?0:1)"]
gate=subprocess.run(load_cmd,cwd=root,stdin=subprocess.DEVNULL,capture_output=True,text=True)
record={'label':label,'gate_exit':gate.returncode,'gate_output':gate.stdout.strip(),'command':shlex.join(argv)+' < /dev/null'}
log=evidence/(label+'.log')
with log.open('w') as out:
    out.write('Load gate exit: '+str(gate.returncode)+'\n'+gate.stdout+record['command']+'\n')
    out.flush()
    if gate.returncode:
        record['exit']=None
        out.write('Load gate refused; process not launched.\n')
    else:
        started=time.perf_counter()
        env={**os.environ,'NO_COLOR':'1'}
        if label=='tsc-full': env['NODE_OPTIONS']='--max-old-space-size=8192'
        result=subprocess.run(argv,cwd=root,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.STDOUT,env=env)
        record.update(exit=result.returncode,seconds=time.perf_counter()-started)
with (evidence/'checks.jsonl').open('a') as out: out.write(json.dumps(record)+'\n')
print(json.dumps(record))
lines=log.read_text().splitlines()
print('\n'.join(lines[-35:] if record['exit'] else [line for line in lines if any(s in line for s in ('Test Files','Tests ','Duration','goal-record-census.guard.test.ts >','S5 goal-record census:'))]))
sys.exit(record['exit'] if record['exit'] is not None else gate.returncode)
