import json, subprocess, sys
from pathlib import Path
root = Path('/private/tmp/accel-er-event-cee')
base = root / 'acceptance-evidence/event-branch'
draft = 'src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts'
reader = 'src/orchestrator-v5/routing/stated-event-risk.ts'
apart = 'src/orchestrator-v5/agent-lane/keep-options-apart.ts'
mutants = [
 ('A-risk-only-user-disabled', draft, "claims.length === 1 ? claims[0]!.user", "claims.length === 1 ? (conversion ? claims[0]!.user : undefined)"),
 ('A-refused-figure-gate-disabled', draft, "const olumi = !quoted && !incoming.has(key(r.label))", "const olumi = !incoming.has(key(r.label))"),
 ('A-drafted-value-only', draft, "const quoted = !user ? claims[0]?.span : undefined;", "const quoted = !user && claims[0]?.span.includes(`${conversion?.value ?? r.occurrence?.p_low_pct}%`) ? claims[0]?.span : undefined;"),
 ('A-read-one-skips-clause', reader, "const clauseText = text.slice(clause.start, clause.end);", "const clauseText = text.slice(clause.start, clause.end);\n    if (readStatedEventRiskWithBindingSpan(clauseText) !== undefined) continue;"),
 ('A-ambiguous-event-applied', draft, "localMatches.length === 1 && stated && namesEvent(stated.binding_span)", "localMatches.length >= 1 && stated && namesEvent(stated.binding_span)"),
 ('A-unitless-figures-ignored', reader, "      // A horizon's", "      if (!/%|percent\\b/i.test(match[0])) continue;\n      // A horizon's"),
 ('B-rename-before-classifying', apart, "candidate.factors.filter(f => !isDraftLikelihoodFactorLabel(f.label)).forEach((f) => plan(f.label, 'factor'));", "candidate.factors.forEach((f) => plan(f.label, 'factor'));"),
 ('B-suffix-only', draft, "const LIKELIHOOD_WORD = /\\b(?:probability|likelihood|chance|odds)\\b/i;", "const LIKELIHOOD_WORD = /\\s+(?:probability|likelihood|chance)\\s*$/i;"),
 ('B-factor-retained', draft, "factors: input.factors.filter(f => !removed.has(key(f.label))), links:", "factors: input.factors, links:"),
 ('B-removal-undisclosed', draft, "  }, loss };", "  }, loss: loss.filter(l => !l.field_path.startsWith('factors[')) };"),
 ('A-comma-context-refusal-off', draft, "localMatches.length === 0 && namesEvent(clause_text)", "false && localMatches.length === 0 && namesEvent(clause_text)"),
 ('A-same-fragment-figures-collapsed', reader, "  return spans;", "  return [...new Map(spans.map(s => [s.span, s])).values()];"),
 ('A-orphan-factor-predicate-off', draft, "if (claims.length > 0 && (matches.length !== 1", "if (false && claims.length > 0 && (matches.length !== 1"),
 ('A-leading-decimal-boundary-off', reader, "&& (i === 0 || /[\\d \\t+\\-−]/.test(text[i - 1] ?? ''));", "&& /\\d/.test(text[i - 1] ?? '');"),
 ('A-signed-figures-ignored', reader, ")[+\\-−]?(?:", ")(?:"),
 ('A-duplicate-factor-predicate-off', draft, "probability.has(matches[0]!.i) && claims.length > 0", "probability.has(matches[0]!.i) && false && claims.length > 0"),
]
results=json.loads((base/'fix2-ab-mutants.json').read_text()) if len(sys.argv)>1 else []
mutants=mutants[int(sys.argv[1]):] if len(sys.argv)>1 else mutants
for name, rel, old, new in mutants:
    source=root/rel
    original=source.read_text()
    assert original.count(old)==1, (name,original.count(old))
    source.write_text(original.replace(old,new))
    log=base/f'fix2-ab-mutant-{name}.log'
    try:
        cmd='node -e "process.exit(require(\'os\').loadavg()[0] < 25 ? 0 : 1)" && node_modules/.bin/vitest run src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-admission.test.ts src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-claim-scope.test.ts --maxWorkers=1 --no-file-parallelism --configLoader=runner < /dev/null'
        with log.open('w') as out:
            result=subprocess.run(cmd,cwd=root,shell=True,stdout=out,stderr=subprocess.STDOUT)
        content=log.read_text()
        killed=result.returncode!=0 and 'AssertionError:' in content
        row={'mutant':name,'source':rel,'exit_code':result.returncode,'killed':killed,'log':log.name}
        results.append(row)
        print(json.dumps(row),flush=True)
    finally:
        source.write_text(original)
    (base/'fix2-ab-mutants.json').write_text(json.dumps(results,indent=2)+'\n')
    assert killed, name
