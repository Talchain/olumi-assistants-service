from pathlib import Path
import subprocess, hashlib, re, sys
base='f4022fb82680a428d87117a439044aa9e75adad2'
change='src/orchestrator-v5/path-b/tools/change-tools.ts'
route='src/routes/agent-v1-turn.ts'
transport='src/orchestrator-v5/agent-lane/runtime/transport-retry.ts'
card='src/orchestrator-v5/path-b/tools/__tests__/goal-level-card.route.test.ts'
unit='src/orchestrator-v5/path-b/tools/__tests__/change-tools.goal-level.test.ts'
capacity='src/orchestrator-v5/agent-lane/__tests__/ai-core-provider-capacity.route.test.ts'
original={p:Path(p).read_text() for p in [change,route,transport]}
summary=[row for row in Path('recovery-notes/L2-mutation-summary.txt').read_text().splitlines() if not row.startswith(('RESTORED', 'L2-mutant-pair-readback:'))] if len(sys.argv)>1 else []
def run(name,spec,pattern=None):
    if len(sys.argv)>1 and name not in sys.argv[1:]: return
    args=['npx','vitest','run',spec]+(['-t',pattern] if pattern else [])
    with Path('recovery-notes/'+name+'.log').open('w') as f:
        result=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=90)
    log=Path('recovery-notes/'+name+'.log').read_text()
    counts=' | '.join(x.strip() for x in log.splitlines() if re.match(r'\s+(Test Files|Tests)\s',x))
    row=f'{name}: exit {result.returncode}; {counts}'
    summary.append(row);print(row,flush=True)
    if result.returncode==0: raise RuntimeError('Expected RED was not killed: '+name)
def restore():
    for p,s in original.items(): Path(p).write_text(s)
try:
    for p in original: Path(p).write_bytes(subprocess.check_output(['git','show',base+':'+p]))
    run('L2-final-rows-on-base-RED',card)
    run('L2-final-capacity-on-base-RED',capacity)
    restore()
    s=original[change]
    old='nodesOf(graph).map((n) => n.id === operand ? { ...n, observed_state: level } : n)'
    assert old in s
    Path(change).write_text(s.replace(old,'nodesOf(graph).map((n) => n)',1))
    run('L2-mutant-pair-write',card,'L2 declared-sum baseline')
    restore()
    Path(change).write_text(s.replace('&& (operand === undefined || isDeepStrictEqual(operandState, held))','',1))
    run('L2-mutant-pair-readback',unit,'L2 sum save')
    restore()
    s=original[route]
    old='if (!released && writesDispatched > 0 && claimAppendSucceeded && turnId !== undefined)'
    assert old in s
    Path(route).write_text(s.replace(old,'if (false && !released && writesDispatched > 0 && claimAppendSucceeded && turnId !== undefined)',1))
    run('L2-mutant-answer-continued',card,'L2 save-outcome|L2 unknown save')
    restore()
    old='              heldProposals: { isHeld: isHeldProposal, seenByThisRequest: new Set<string>() },\n'
    assert old in s
    Path(route).write_text(s.replace(old,'',1))
    run('L2-mutant-holds-continued',card,'L2 save-outcome')
    restore()
    Path(route).write_text(s.replace('let verifiedSave = false;','let verifiedSave = true;',1))
    run('L2-mutant-false-verified-save',card,'L2 unknown save')
    restore()
    s=original[transport]
    Path(transport).write_text(s.replace('const capacity = [e?.code, e?.type].some', 'const capacity = e?.status === 429 || [e?.code, e?.type].some',1))
    run('L2-mutant-429-is-billing',capacity,'L2 recorded contrast')
    restore()
    Path(transport).write_text(s.replace("e?.headers?.get('retry-after')",'undefined').replace("e?.headers?.get('retry-after-ms')",'undefined'))
    run('L2-mutant-retry-timing',capacity,'L2 recorded contrast')
finally:
    restore()
    for p,s in original.items():
        assert Path(p).read_text()==s
    summary.append('RESTORED: all three source files byte-equal to the saved final source.')
    Path('recovery-notes/L2-mutation-summary.txt').write_text('\n'.join(summary)+'\n')
