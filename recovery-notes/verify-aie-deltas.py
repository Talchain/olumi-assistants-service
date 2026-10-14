from pathlib import Path
import json,hashlib
base=Path('recovery-notes'); before=base/'a2e-before/provider'; after=base/'a2e-after/provider'; fixture=Path('src/routes/__tests__/context-contract/fixtures/staging-turn-sha256.json'); hashes=json.loads(fixture.read_text()); report=[]
compact=lambda v: json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()
sha=lambda b: hashlib.sha256(b).hexdigest()
aie=json.loads(Path('/Users/paulslee/olumi-work/recovery/codex/AIE-6136098330.md').read_text().split('```json\n')[1].split('```')[0])
first=json.loads((after/'ordinary-converse/run2/1.sentBody.json').read_text()); orig=json.loads((before/'ordinary-converse/run2/1.sentBody.json').read_text()); newtools={t['name']:t for t in first['tools']}; oldtools={t['name']:t for t in orig['tools']}; deltas=[]
for d in aie:
 parts=d['path'].split('/'); n=newtools[parts[0]]; o=oldtools[parts[0]]
 for part in parts[1:]: n=n[part]; o=o[part]
 assert n==d['after'],d['path']
 nb=n.encode() if isinstance(n,str) else compact(n); ob=o.encode() if isinstance(o,str) else compact(o)
 assert len(nb)==d['after_utf8']
 deltas.append({'path':d['path'],'before_utf8':len(ob),'after_utf8':len(nb),'delta_utf8':len(nb)-len(ob)})
for rel in sorted(p.relative_to(after) for p in after.rglob('*.sentBody.json')):
 a=json.loads((before/rel).read_text()); b=json.loads((after/rel).read_text()); orig_a=compact(a); orig_b=compact(b)
 for d in aie:
  parts=d['path'].split('/'); target=next((t for t in a['tools'] if t['name']==parts[0]),None)
  if target is None: continue
  for part in parts[1:-1]: target=target[part]
  target[parts[-1]]=d['after']
 assert a==b, str(rel)+' changed outside nine AIE fields'
 turn=rel.parts[0]; index=int(rel.name.split('.')[0])-1
 assert hashes[turn][index] in (sha(orig_a),sha(orig_b))
 hashes[turn][index]=sha(orig_b)
 report.append({'request':str(rel),'before_sha256':sha(orig_a),'after_sha256':sha(orig_b),'bytes_delta':len(orig_b)-len(orig_a),'only_changes':'nine exact AIE tool fields' if a['tools'] != orig['tools'] and orig_a != orig_b else 'none' if orig_a==orig_b else 'nine exact AIE tool fields'})
fixture.write_text(json.dumps(hashes,indent=2)+'\n')
(base/'aie-byte-deltas.json').write_text(json.dumps(deltas,indent=2)+'\n')
(base/'request-hash-deltas.json').write_text(json.dumps(report,indent=2)+'\n')
print('Exact AIE replacements verified:',len(deltas),'changed request pins:',sum(r['bytes_delta']!=0 for r in report),'total field delta:',sum(d['delta_utf8'] for d in deltas))
print('tools:',sha(compact(orig['tools'])),'->',sha(compact(first['tools'])))
