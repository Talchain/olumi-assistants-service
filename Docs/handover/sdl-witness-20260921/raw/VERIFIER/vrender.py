import json,os,re,urllib.request
E='/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local'
t=open(E,encoding='latin1').read()
def k(n):
    m=re.search('^'+n+'=(.*)$',t,re.M); return m.group(1).strip().strip('"\'') if m else None
KEY=k('RENDER_API_KEY')
def api(path):
    req=urllib.request.Request('https://api.render.com/v1'+path,headers={'Authorization':'Bearer '+KEY,'Accept':'application/json'})
    return json.load(urllib.request.urlopen(req))
svcs=[];cursor=None
while True:
    p='/services?limit=100'+(('&cursor='+cursor) if cursor else '')
    page=api(p)
    if not page: break
    svcs+= [x['service'] for x in page]
    cursor=page[-1]['cursor']
    if len(page)<100: break
print('total services',len(svcs))
out={}
for s in svcs:
    if not s['name'].startswith('cee'): continue
    vars=[];c=None
    while True:
        p='/services/%s/env-vars?limit=100'%s['id']+(('&cursor='+c) if c else '')
        page=api(p)
        if not page: break
        vars+=[x['envVar'] for x in page]
        c=page[-1]['cursor']
        if len(page)<100: break
    d={v['key']:v.get('value') for v in vars}
    su=d.get('SUPABASE_URL')
    ref=su.replace('https://','').split('.')[0] if su else None
    out[s['name']]={'n_vars':len(vars),'CEE_V5_GRAPH_CAS_RPC':d.get('CEE_V5_GRAPH_CAS_RPC','<ABSENT>'),
        'CEE_MODEL_VERSIONS_ENABLED':d.get('CEE_MODEL_VERSIONS_ENABLED','<ABSENT>'),
        'supabase_ref_sha8': __import__('hashlib').sha256((ref or '').encode()).hexdigest()[:8],
        'has_SUPABASE_URL': su is not None,
        'CONTROL_absent_key': d.get('THIS_KEY_DOES_NOT_EXIST','<ABSENT>')}
print(json.dumps(out,indent=2))
open('evidence/VERIFIER/render-posture.json','w').write(json.dumps(out,indent=2))
