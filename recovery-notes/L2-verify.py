from pathlib import Path
import subprocess, re, json
paths=[
'src/orchestrator-v5/path-b/tools/__tests__/goal-level-card.route.test.ts',
'src/orchestrator-v5/path-b/tools/__tests__/change-tools.goal-level.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-provider-capacity.route.test.ts',
'src/orchestrator-v5/path-b/tools/__tests__/change-tools.compound.test.ts',
'src/orchestrator-v5/path-b/tools/__tests__/change-tools.goal-target.test.ts',
'src/orchestrator-v5/path-b/tools/__tests__/change-tools.claims.test.ts',
'src/orchestrator-v5/path-b/tools/__tests__/change-tools.door.test.ts',
'src/orchestrator-v5/path-b/tools/__tests__/index.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-correction-card.route.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-auto-run.route.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-consent.route.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-proposal-restart.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-add-option.route.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/ai-core-add-to-model.route.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/transport-retry.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/instructions-breakpoint-refusal.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/run-keeps-reasoning-item.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/public-research-route.test.ts',
'src/orchestrator-v5/agent-lane/__tests__/figure-must-be-written-by-user.test.ts',
]+[str(p) for p in sorted(Path('tests/contract').glob('*guard*.test.ts'))]
results=[]
for spec in paths:
    name=Path(spec).name
    with Path('recovery-notes/L2-final-'+name+'.log').open('w') as f:
        r=subprocess.run(['npx','vitest','run',spec],stdout=f,stderr=subprocess.STDOUT,timeout=120)
    log=Path('recovery-notes/L2-final-'+name+'.log').read_text()
    counts=' | '.join(x.strip() for x in log.splitlines() if re.match(r'\s+(Test Files|Tests)\s',x))
    row={'spec':spec,'exit':r.returncode,'counts':counts}
    results.append(row)
    print(f'{name}: exit {r.returncode}; {counts}',flush=True)
    Path('recovery-notes/L2-verification-results.json').write_text(json.dumps(results,indent=2)+'\n')
