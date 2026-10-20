from pathlib import Path
import subprocess,json,hashlib
outcome=Path('src/orchestrator-v5/path-b/tools/outcome.ts')
draft=Path('src/orchestrator-v5/path-b/tools/draft-tool.ts')
originals={p:p.read_bytes() for p in [outcome,draft]}
mutants=[
 ('drop-detail',outcome,'    ...outcome[OUTCOME_TRACE],\n',''),
 ('mislabel-detail',draft,'value: { draft_verification: diagnostic }','value: { draft_verification: { check: "wrong_check" } }'),
 ('leak-into-result',draft,"unavailable(reason, 'unknown'), OUTCOME_TRACE", "{ ...unavailable(reason, 'unknown'), diagnostic }, OUTCOME_TRACE"),
 ('alter-result-bytes',draft,'The construction was dispatched, but its save could not be verified.','The construction was dispatched, but its save could not be verified. '),
]
results=[]
try:
 for name,p,old,new in mutants:
  for q,source in originals.items(): q.write_bytes(source)
  src=p.read_text(); assert src.count(old)==1,(name,src.count(old))
  p.write_text(src.replace(old,new))
  log=Path('recovery-notes/L26B-mutant-'+name+'.log')
  with log.open('w') as f:
   proc=subprocess.run(['npx','vitest','run','src/orchestrator-v5/path-b/tools/__tests__/draft-tool.test.ts'],stdout=f,stderr=subprocess.STDOUT,timeout=90)
  lines=log.read_text().splitlines()
  result={'name':name,'exit':proc.returncode,'summary':[x.strip() for x in lines if 'Tests ' in x or 'Test Files ' in x]}
  results.append(result)
  print(json.dumps(result),flush=True)
finally:
 for p,source in originals.items(): p.write_bytes(source)
 Path('recovery-notes/L26B-mutants.json').write_text(json.dumps({'results':results,'restored':all(p.read_bytes()==s for p,s in originals.items()),'sha256':{str(p):hashlib.sha256(s).hexdigest() for p,s in originals.items()}},indent=2)+'\n')
