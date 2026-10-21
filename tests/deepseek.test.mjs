import test from 'node:test';
import assert from 'node:assert/strict';
import { deepseek } from '../worker/deepseek.js';
const response=content=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
function setup(t){const logs=[];t.mock.method(console,'warn',s=>logs.push(JSON.parse(s)));t.mock.method(console,'error',s=>logs.push(JSON.parse(s)));return logs;}
const run=options=>deepseek({DEEPSEEK_API_KEY:'PRIVATE_TEST_KEY',DEEPSEEK_MODEL:'deepseek-flash'},{messages:[{role:'user',content:'PRIVATE_TEST_MESSAGE'}],parse:content=>content,...options});
test('transient HTTP failure retries once with the same correlation ID and bounded chat settings',async t=>{
  const logs=setup(t);let calls=0,body;
  t.mock.method(globalThis,'fetch',async(url,options)=>{body=JSON.parse(options.body);assert.equal(url,'https://api.deepseek.com/chat/completions');return ++calls===1?new Response('',{status:502}):response('ok');});
  const result=await run({requestId:'send-test'});assert.equal(result.value,'ok');assert.equal(calls,2);assert.equal(body.thinking.type,'disabled');assert.equal(body.max_tokens,2048);assert.equal(logs[0].upstreamStatus,502);assert.equal(logs[0].retry,true);assert.equal(logs[0].requestId,result.requestId);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_TEST_KEY|PRIVATE_TEST_MESSAGE/);
});
test('empty, invalid JSON and truncated provider replies recover before facts are written',async t=>{
  const logs=setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?response(''):response('{"reply":"hello"}'));
  const result=await run({json:true,parse:JSON.parse});assert.equal(result.value.reply,'hello');assert.equal(logs[0].phase,'content');
  calls=0;t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response('<html>bad gateway</html>'):response('ok'));
  assert.equal((await run()).value,'ok');assert.equal(logs.at(-1).phase,'body');
  calls=0;t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'partial'}}]})):response('complete'));
  assert.equal((await run()).value,'complete');
});
test('non-retryable credential/configuration failures report exact codes and timeouts stay bounded',async t=>{
  setup(t);
  for(const [status,code]of [[400,'AI_REQUEST_REJECTED'],[401,'AI_CREDENTIAL_INVALID'],[402,'AI_BALANCE_REQUIRED'],[403,'AI_PROVIDER_FORBIDDEN']]){
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status});});
    await assert.rejects(run(),e=>e.message===code&&Boolean(e.requestId));assert.equal(calls,1);
  }
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new DOMException('timeout','TimeoutError');});
  await assert.rejects(run(),e=>e.message==='AI_TIMEOUT');assert.equal(calls,2);
});

test('production whitespace JSON replies switch formats and validate the fallback instead of repeating JSON mode',async t=>{
  const logs=setup(t);t.mock.method(console,'info',s=>logs.push(JSON.parse(s)));const bodies=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{bodies.push(JSON.parse(options.body));return bodies.length===1?response(' \n\t'.repeat(13)):response('{"reply":"已记录","updates":{"elevator":{"value":true,"evidence":"有电梯"},"occupancy":{"value":"自住","evidence":"目前自住"}}}');});
  const result=await run({mode:'sell',json:true,messages:[{role:'system',content:'Return JSON with reply and updates.'},{role:'user',content:'有电梯，目前自住'}],parse:JSON.parse});
  assert.equal(result.value.updates.elevator.value,true);assert.equal(result.value.updates.occupancy.value,'自住');
  assert.equal(bodies[0].response_format.type,'json_object');assert.equal(bodies[1].response_format,undefined);
  assert.match(bodies[1].messages[0].content,/one JSON object/);assert.equal(bodies[1].messages.at(-1).content,'有电梯，目前自住');
  assert.equal(logs[0].responseInfo.trimmedLength,0);assert.equal(logs[0].responseInfo.finishReason,'stop');assert.equal(logs.at(-1).event,'advisor_ai_recovered');
  assert.doesNotMatch(JSON.stringify(logs),/有电梯|目前自住|PRIVATE_TEST_KEY/);
});

test('ordinary-text fallback cannot pass malformed structured data to saving',async t=>{
  setup(t);const bodies=[];let parsed=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{bodies.push(JSON.parse(options.body));return response(bodies.length===1?'   ':'this is not JSON');});
  await assert.rejects(run({json:true,parse:value=>{parsed++;return JSON.parse(value)}}),e=>e.message==='AI_EMPTY_RESPONSE');
  assert.equal(parsed,1);assert.equal(bodies.length,2);assert.equal(bodies[1].response_format,undefined);
});
