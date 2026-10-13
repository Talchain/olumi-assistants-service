from pathlib import Path
import subprocess,json,re
p=Path('src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts'); good=p.read_text(); root='src/orchestrator-v5/agent-lane/__tests__/'
mutants=[
 ('current-turn-only',"const sourceText = ctx.user_text ?? turnText;","const sourceText = turnText;",'agent-add-factor-door-seam.test.ts'),
 ('drop-retained-range','const heldRange = prior?.member?.observed_state.range;','const heldRange = undefined;','agent-add-factor-door-seam.test.ts'),
 ('relabel-unknown','if (!ownsIt && ((prior !== undefined','if (false && !ownsIt && ((prior !== undefined','agent-add-factor-door-seam.test.ts'),
 ('agent-reference-override',"typeof asOf === 'string' && typedAsOfDates.includes(asOf)","typeof asOf === 'string'",'time-close-chain.test.ts'),
 ('truncate-card-source','${sourceDetail}','', 'deadline-card-chain.test.ts')]
results=[]
try:
 for name,old,new,spec in mutants:
  assert good.count(old)==1,(name,good.count(old)); p.write_text(good.replace(old,new)); log=Path('recovery-notes/'+name+'.log')
  with log.open('w') as out: r=subprocess.run(['npx','vitest','run',root+spec],stdout=out,stderr=subprocess.STDOUT)
  p.write_text(good)
  summary=re.findall(r'Tests\s+([^\n]+)',log.read_text())[-1]; results.append({'mutant':name,'exit':r.returncode,'counts':summary,'spec':spec})
  print(name,r.returncode,summary,flush=True)
finally:
 p.write_text(good); Path('recovery-notes/mutants.json').write_text(json.dumps(results,indent=2)+'\n')
