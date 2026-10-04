from pathlib import Path
import json,subprocess,hashlib,base64,posixpath,concurrent.futures,shutil,tarfile,datetime
out=Path(__file__).parent;base=out/'baseline';tree=json.loads((out/'current-tree.json').read_text());files={x['path']:x for x in tree['tree'] if x['type']=='blob'}
head='11e8fe24ff289fbbb68e074bba22c89055e9661a'
roots=[out.parent/'acceleration-1935/current-source',out.parent/'postrestart-contract/current-source',Path('/private/tmp/dl-seam-cee')]
manifest={};external=set();scanned=set()
def digest(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def obtain(path):
 target=base/path;expected=files[path]['sha'];data=None;origin=None
 for source in [target]+[r/path for r in roots]:
  try:
   st=source.stat()
   if st.st_flags&0x40000000:continue
   b=source.read_bytes()
   if digest(b)==expected:data=b;origin=str(source);break
  except FileNotFoundError:continue
 if data is None:
  r=subprocess.run(['gh','api',f'repos/Talchain/olumi-assistants-service/git/blobs/{expected}'],capture_output=True,text=True,timeout=20)
  if r.returncode:raise RuntimeError(path+': '+r.stderr[:200])
  d=json.loads(r.stdout);data=base64.b64decode(d['content']);assert digest(data)==expected;origin='GitHub immutable blob'
 target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 return path,{'path':path,'blob_sha':expected,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'origin':origin}
def resolve(path,spec):
 root=posixpath.normpath(posixpath.join(posixpath.dirname(path),spec))
 candidates=[root]
 if root.endswith(('.js','.mjs','.cjs')):candidates.extend([root.rsplit('.',1)[0]+ext for ext in ['.ts','.tsx','.mts','.cts']])
 candidates.extend([root+'.ts',root+'.tsx',root+'/index.ts'])
 for candidate in candidates:
  if candidate in files:return candidate
 raise RuntimeError('Unresolved actual-source import '+path+' -> '+spec)
queue={'src/orchestrator-v5/agent-lane/tipping-point-coaching.ts','src/orchestrator-v5/boundary/request-extensions.ts','src/orchestrator-v5/agent-lane/approval-chips.ts','src/orchestrator-v5/routing/deterministic-value-update.ts','src/orchestrator-v5/agent-lane/__tests__/tipping-point-coaching.test.ts','src/orchestrator-v5/agent-lane/guidance/reasoning-interventions.json','tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json'}
roundno=0
queue.update({'src/orchestrator-v5/routing/graph-lookup-adapter.ts', 'src/orchestrator-v5/coaching/__tests__/fixtures/paul-run-17d1cd3a-next-move.json'})
while queue:
 roundno+=1;todo=sorted(queue-set(manifest));queue=set()
 if todo:
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
   for path,entry in ex.map(obtain,todo):manifest[path]=entry
 tsfiles=[path for path in manifest if path.endswith(('.ts','.tsx')) and path not in scanned]
 if not tsfiles:break
 proc=subprocess.run(['/Users/paulslee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node',str(out/'list-runtime-imports.cjs')],input=json.dumps([str(base/x) for x in tsfiles]),capture_output=True,text=True,timeout=20);assert proc.returncode==0,proc.stderr
 imports=json.loads(proc.stdout)
 for path in tsfiles:
  for spec in imports[str(base/path)]:
   if spec.startswith('.'):queue.add(resolve(path,spec))
   elif not spec.startswith('node:'):external.add(spec)
  scanned.add(path)
 print('ROUND',roundno,'FILES',len(manifest),'NEXT',len(queue-set(manifest)),flush=True)
 # Import closure only: tests remain two explicitly selected files, with no build/full gate.
 if len(manifest)>400:raise RuntimeError('Focused native-consumer import closure exceeds400 files; investigate before fetching more')
(out/'IMPORT-CLOSURE-MANIFEST.json').write_text(json.dumps({'head':head,'read_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':list(manifest.values()),'external_imports':sorted(external)},indent=2)+'\n')
mods=Path('/Users/paulslee/.codex/worktrees/core-capacity-intervention-20260919/node_modules');nm=base/'node_modules';nm.mkdir(exist_ok=True)
for src in mods.iterdir():
 if src.name.startswith('.') or src.name=='@talchain':continue
 dst=nm/src.name
 if not dst.exists():dst.symlink_to(src,target_is_directory=True)
(nm/'@talchain').mkdir(exist_ok=True)
for src in (mods/'@talchain').iterdir():
 if src.name=='schemas':continue
 dst=nm/'@talchain'/src.name
 if not dst.exists():dst.symlink_to(src,target_is_directory=True)
pin=Path('/private/tmp/dl-seam-cee/vendor/talchain-schemas-0.74.0.tgz');schema=nm/'@talchain/schemas';schema.mkdir(exist_ok=True)
with tarfile.open(pin,'r:gz') as t:
 for member in t.getmembers():
  if not member.isfile():continue
  name=member.name.removeprefix('package/');assert '..' not in Path(name).parts
  dest=schema/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(t.extractfile(member).read())
print('IMPORT_COMPLETE',len(manifest),'EXTERNAL',sorted(external),'VENDORED_PIN',json.loads((schema/'package.json').read_text())['version'])
