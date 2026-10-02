import { test } from 'node:test';
import assert from 'node:assert/strict';
const { NativeContextStore, NativeContextTrialError, nativeContextTrialEnabled } = await import(
  new URL('../../src/orchestrator-v5/agent-lane/runtime/native-context-trial.ts', import.meta.url));
const binding = { userId: 'user-a', scenarioId: 'scenario-a', sessionId: 'session-a' };
const fresh = async () => false;
const state = n => ({ role: 'developer', content: `CURRENT MODEL STATE: revision ${n}` });
const user = content => ({ role: 'user', content });
const answer = content => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] });
const request = input => ({ instructions: 'fixed instructions', input, tools: [{ name: 'test_tool' }], max_output_tokens: 100 });
const response = (id, output = [answer('OK')]) => ({ id, status: 'completed', output });
async function first(store, id = 'resp_first', text = 'OK') {
  const t = await store.begin(binding, fresh);
  const input = [state(1), user('first')];
  const r = await t.call(request(input), async () => response(id, [answer(text)]));
  t.capture([...input, ...r.output]); t.finish('first', text, true); t.close();
}

test('default is OFF; opt-in cannot enable production', () => {
  assert.equal(nativeContextTrialEnabled({}), false);
  assert.equal(nativeContextTrialEnabled({ OPENAI_NATIVE_CONTEXT_TRIAL: 'true' }), false);
  assert.equal(nativeContextTrialEnabled({ OPENAI_NATIVE_CONTEXT_TRIAL: 'isolated', OLUMI_ENV: 'staging' }), true);
  assert.throws(() => nativeContextTrialEnabled({ OPENAI_NATIVE_CONTEXT_TRIAL: 'isolated', OLUMI_ENV: 'prod' }));
});
test('first request has no prior ID and keeps instructions/tools unchanged', async () => {
  const t = await new NativeContextStore().begin(binding, fresh);
  let sent; const input = [state(1), user('hello')];
  const r = await t.call(request(input), async q => { sent=q; return response('resp_first'); });
  assert.equal(sent.previous_response_id, undefined); assert.equal(sent.store, true);
  assert.deepEqual(sent.input, input); assert.equal(sent.instructions, 'fixed instructions'); assert.equal(sent.tools[0].name, 'test_tool');
  t.capture([...input,...r.output]); t.finish('hello','OK',true); t.close();
});
test('browser-style fresh request reuses head without sending old transcript', async () => {
  const store = new NativeContextStore(); await first(store);
  const t = await store.begin(binding, async () => { throw Error('must not reseed'); });
  let sent; const input=[state(2),user('next')];
  const r=await t.call(request(input),async q=>{sent=q;return response('resp_second');});
  assert.equal(sent.previous_response_id,'resp_first'); assert.deepEqual(sent.input,input);
  t.capture([...input,...r.output]);t.finish('next','OK',true);t.close();
});
test('multiple tool hops send only new results, with original call IDs', async () => {
  const store=new NativeContextStore(); const t=await store.begin(binding,fresh);
  const input=[state(1),user('propose')];
  const outputs=[{type:'reasoning',id:'rs_1'},{type:'function_call',call_id:'call_a',name:'test_tool',arguments:'{}'},{type:'function_call',call_id:'call_b',name:'test_tool',arguments:'{}'}];
  await t.call(request(input),async()=>response('resp_tools',outputs));
  const results=[{type:'function_call_output',call_id:'call_a',output:'{"ok":true}'},{type:'function_call_output',call_id:'call_b',output:'{"ok":true}'}];
  input.push(...outputs,...results); let sent;
  const r=await t.call(request(input),async q=>{sent=q;return response('resp_answer');});
  assert.equal(sent.previous_response_id,'resp_tools');assert.deepEqual(sent.input,results);
  t.capture([...input,...r.output]);t.finish('propose','OK',true);t.close();
});
test('composed reply carries pending output once, then the final visible reply',async()=>{
  const store=new NativeContextStore();const t=await store.begin(binding,fresh);
  const input=[state(1),user('propose')];
  const outputs=[{type:'function_call',call_id:'call_one',name:'test_tool',arguments:'{}'}];
  await t.call(request(input),async()=>response('resp_proposal',outputs));
  const result={type:'function_call_output',call_id:'call_one',output:'{"proposal":"p1"}'};
  t.capture([...input,...outputs,result,answer('intermediate draft')]);t.finish('propose','Final approval card',true);t.close();
  const t2=await store.begin(binding,fresh);let sent;const input2=[state(2),user('no')];
  const r=await t2.call(request(input2),async q=>{sent=q;return response('resp_next');});
  assert.equal(sent.previous_response_id,'resp_proposal');
  assert.equal(sent.input.filter(x=>x.type==='function_call_output').length,1);
  assert.equal(sent.input[0].call_id,'call_one');assert.equal(JSON.stringify(sent).includes('intermediate draft'),false);
  assert.equal(sent.input[1].content,'Final approval card');
  t2.capture([...input2,...r.output]);t2.finish('no','OK',true);t2.close();
  const t3=await store.begin(binding,fresh);let sent3;const input3=[state(3),user('another')];
  const r3=await t3.call(request(input3),async q=>{sent3=q;return response('resp_third');});
  assert.deepEqual(sent3.input,input3);t3.capture([...input3,...r3.output]);t3.finish('another','OK',true);t3.close();
});
test('host-first synthetic call/result pair is forwarded exactly once',async()=>{
  const t=await new NativeContextStore().begin(binding,fresh);
  const input=[state(1),user('brief'),{type:'function_call',call_id:'host_first',name:'test_tool',arguments:'{}'},
    {type:'function_call_output',call_id:'host_first',output:'{"ok":true}'}];
  let sent;const r=await t.call(request(input),async q=>{sent=q;return response('resp_host');});
  assert.deepEqual(sent.input,input);t.capture([...input,...r.output]);t.finish('brief','OK',true);t.close();
});
test('zero-call approval and independent interpretation join the next conversation once',async()=>{
  const store=new NativeContextStore();await first(store);
  for(const [q,a] of [['Approve','Recorded'],['Explain','Your current result']]){
    const t=await store.begin(binding,fresh);t.startWork();t.finish(q,a,true);t.close();
  }
  const t=await store.begin(binding,fresh);let sent;const input=[state(4),user('why?')];
  const r=await t.call(request(input),async q=>{sent=q;return response('resp_after_fast');});
  assert.equal(sent.previous_response_id,'resp_first');
  assert.deepEqual(sent.input.slice(0,4),[user('Approve'),{role:'assistant',content:'Recorded'},user('Explain'),{role:'assistant',content:'Your current result'}]);
  t.capture([...input,...r.output]);t.finish('why?','OK',true);t.close();
});
test('prewarm cannot change the chain head or consume pending history',async()=>{
  const store=new NativeContextStore();await first(store);const t=await store.begin(binding,fresh);
  let warm;await t.call({...request([user('warm')]),purpose:'prewarm'},async q=>{warm=q;return response('resp_warm');});
  assert.equal(warm.store,false);let sent;const input=[state(2),user('real')];
  const r=await t.call(request(input),async q=>{sent=q;return response('resp_real');});
  assert.equal(sent.previous_response_id,'resp_first');t.capture([...input,...r.output]);t.finish('real','OK',true);t.close();
});
test('withheld draft is superseded by a receipt and safe assistant text',async()=>{
  const store=new NativeContextStore();const t=await store.begin(binding,fresh);const input=[state(1),user('winner?')];
  const r=await t.call(request(input),async()=>response('resp_draft',[answer('Unlicensed winner')]));
  t.capture([...input,...r.output]);t.finish('winner?','No current comparison is available.',true);t.close();
  const t2=await store.begin(binding,fresh);let sent;const input2=[state(2),user('explain')];
  const r2=await t2.call(request(input2),async q=>{sent=q;return response('resp_safe');});
  assert.equal(sent.input[0].role,'developer');assert.match(sent.input[0].content,/HOST DISPLAY RECEIPT/);
  assert.equal(sent.input[1].role,'assistant');assert.equal(sent.input[1].content,'No current comparison is available.');
  assert.equal(JSON.stringify(sent.input).includes('Unlicensed winner'),false);
  t2.capture([...input2,...r2.output]);t2.finish('explain','OK',true);t2.close();
});
test('latest canonical snapshot is sent even though old ones exist upstream',async()=>{
  const store=new NativeContextStore();await first(store);const t=await store.begin(binding,fresh);let sent;const input=[state('new-withheld'),user('recheck')];
  const r=await t.call(request(input),async q=>{sent=q;return response('resp_new');});
  assert.deepEqual(sent.input[0],state('new-withheld'));t.capture([...input,...r.output]);t.finish('recheck','OK',true);t.close();
});
test('failed provider call does not commit a head and visibly invalidates the chain',async()=>{
  const store=new NativeContextStore();await first(store);const t=await store.begin(binding,fresh);
  await assert.rejects(t.call(request([state(2),user('x')]),async()=>{throw Error('network');}));t.close();
  await assert.rejects(store.begin(binding,fresh),e=>e.code==='NATIVE_CONTEXT_RESET_REQUIRED');
});
for(const [name,r] of [ ['missing ID',{status:'completed',output:[answer('x')]}],['incomplete',{...response('resp_partial'),status:'incomplete'}],['empty',response('resp_empty',[])],['compaction only',response('resp_compact',[{type:'compaction'}])]]){
  test(`${name} response never becomes a usable head`,async()=>{
    const store=new NativeContextStore();const t=await store.begin(binding,fresh);
    await assert.rejects(t.call(request([state(1),user('x')]),async()=>r),NativeContextTrialError);t.close();
    await assert.rejects(store.begin(binding,fresh),NativeContextTrialError);
  });
}
test('failed durable persistence invalidates even a completed provider response',async()=>{
  const store=new NativeContextStore();const t=await store.begin(binding,fresh);const input=[state(1),user('x')];
  const r=await t.call(request(input),async()=>response('resp_uncommitted'));t.capture([...input,...r.output]);t.finish('x','OK',false);
  assert.equal(t.diagnostic().continuity,'reset_required');t.close();await assert.rejects(store.begin(binding,fresh));
});
test('an exact replay that starts no work leaves the chain untouched',async()=>{
  const store=new NativeContextStore();await first(store);const retry=await store.begin(binding,fresh);retry.close();
  const t=await store.begin(binding,fresh);let sent;const input=[state(2),user('after retry')];
  const r=await t.call(request(input),async q=>{sent=q;return response('resp_after_retry');});
  assert.equal(sent.previous_response_id,'resp_first');assert.deepEqual(sent.input,input);t.capture([...input,...r.output]);t.finish('after retry','OK',true);t.close();
});
test('overlapping tabs for the same subject/scenario are refused before work',async()=>{
  const store=new NativeContextStore();const t=await store.begin(binding,fresh);
  await assert.rejects(store.begin({...binding,sessionId:'other-tab'},fresh),e=>e.code==='NATIVE_CONTEXT_BUSY');t.close();
});
test('subject/scenario bindings never share response IDs',async()=>{
  const store=new NativeContextStore();await first(store);
  for(const b of [{...binding,userId:'user-b'},{...binding,scenarioId:'scenario-b'}]){
    const t=await store.begin(b,fresh);let sent;const input=[state(1),user('new')];
    const r=await t.call(request(input),async q=>{sent=q;return response('resp_separate');});
    assert.equal(sent.previous_response_id,undefined);t.capture([...input,...r.output]);t.finish('new','OK',true);t.close();
  }
});
test('restart cannot silently import an existing conversation',async()=>{
  await assert.rejects(new NativeContextStore().begin(binding,async()=>true),e=>e.code==='NATIVE_CONTEXT_RESET_REQUIRED');
});
test('expiry requires an explicit new test scenario',async()=>{
  let clock=0;const store=new NativeContextStore({ttlMs:10},()=>clock);await first(store);clock=11;
  await assert.rejects(store.begin(binding,fresh),e=>e.code==='NATIVE_CONTEXT_RESET_REQUIRED');
});
test('session and turn limits refuse rather than silently truncate',async()=>{
  const store=new NativeContextStore({maxSessions:1,maxTurns:1});await first(store);
  await assert.rejects(store.begin(binding,fresh),e=>e.code==='NATIVE_CONTEXT_RESET_REQUIRED');
  await assert.rejects(store.begin({...binding,scenarioId:'another'},fresh),e=>e.code==='NATIVE_CONTEXT_CAPACITY');
});
test('store-read failure releases its lock and makes no conversation',async()=>{
  const store=new NativeContextStore();await assert.rejects(store.begin(binding,async()=>{throw Error('database');}));
  const t=await store.begin(binding,fresh);t.close();
});
test('caller-supplied response ID is ignored by the bound transport',async()=>{
  const t=await new NativeContextStore().begin(binding,fresh);let sent;const input=[state(1),user('x')];
  const r=await t.call({...request(input),previous_response_id:'resp_wrong'},async q=>{sent=q;return response('resp_right');});
  assert.equal(sent.previous_response_id,undefined);t.capture([...input,...r.output]);t.finish('x','OK',true);t.close();
});
test('diagnostics disclose limits but no provider ID',async()=>{
  const t=await new NativeContextStore().begin(binding,fresh);assert.equal(t.diagnostic().compaction,false);
  assert.equal(JSON.stringify(t.diagnostic()).includes('resp_'),false);t.close();
});
test('22 separate turns retain an unbroken server-side response chain',async()=>{
  const store=new NativeContextStore();let previous;
  for(let i=1;i<=22;i++){
    const t=await store.begin(binding,fresh);let sent;const input=[state(i),user(`turn ${i}`)];
    const r=await t.call(request(input),async q=>{sent=q;return response(`resp_${i}`);});
    assert.equal(sent.previous_response_id,previous);assert.deepEqual(sent.input,input);
    t.capture([...input,...r.output]);t.finish(`turn ${i}`,'OK',true);t.close();previous=`resp_${i}`;
  }
});
