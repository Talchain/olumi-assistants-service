from pathlib import Path
import subprocess, json
source=Path('src/orchestrator-v5/path-b/tools/candidate-to-graph.ts')
original=source.read_text()
mutants=[
('rate-rejected', "const rateAgrees = rate?.per != null", "const rateAgrees = false && rate?.per != null"),
('wrong-driver-accepted', "sameUnit(rate.per.join(' '), sourceUnit)", "true"),
('wrong-speaker-accepted', "st.speaker !== 'user'", "false"),
('wrong-directed-subject-accepted', "canonicalLabel(String(st.subject.to_label ?? '')) !== canonicalLabel(l.to)", "false"),
('definition-existence', "const sized: Rec = aEdge === undefined ? e : { ...aEdge, from: e.from, to: e.to };", "const sized: Rec = aEdge === undefined ? e : { ...aEdge, from: e.from, to: e.to };\n    if (sized.provenance?.definitional === true) sized.exists_probability = 0.8;"),
('definition-not-one-for-one', "const sized: Rec = aEdge === undefined ? e : { ...aEdge, from: e.from, to: e.to };", "const sized: Rec = aEdge === undefined ? e : { ...aEdge, from: e.from, to: e.to };\n    if (sized.provenance?.definitional === true) sized.provenance.natural_effect.amount = 2;"),
]
rows=[]
try:
 for name,before,after in mutants:
  assert before in original,name
  source.write_text(original.replace(before,after,1))
  with open(f'recovery-notes/l15c/mutant-{name}.log','w') as log:
   r=subprocess.run(['npx','vitest','run','src/orchestrator-v5/path-b/tools/__tests__/per-unit-addition.test.ts'],stdout=log,stderr=subprocess.STDOUT)
  row={'mutant':name,'exit':r.returncode,'killed':r.returncode!=0}
  rows.append(row);print(json.dumps(row),flush=True)
  source.write_text(original)
finally:
 source.write_text(original)
 Path('recovery-notes/l15c/mutants.json').write_text(json.dumps(rows,indent=2)+'\n')
