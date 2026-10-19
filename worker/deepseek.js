// Shared transport: retry only before any chat/profile writes, and never log prompts or credentials.
const endpoint = 'https://api.deepseek.com/chat/completions';
const fail = (code, requestId, status = 503) => Object.assign(Error(code), { status, requestId });
function jsonShape(content) {
  if(typeof content!=='string')return {valid:false,reason:'NOT_TEXT'};
  const text=content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i,'$1');
  try {
    const value=JSON.parse(text), type=value===null?'null':Array.isArray(value)?'array':typeof value;
    return {valid:true,type,keys:type==='object'?Object.keys(value).slice(0,20).map(k=>['reply','updates','intent','deferred','resumed','newProperty'].includes(k)?k:'[other]'):[],
      replyType:typeof value?.reply,replyLength:typeof value?.reply==='string'?value.reply.trim().length:null,
      updatesType:value?.updates===null?'null':Array.isArray(value?.updates)?'array':typeof value?.updates};
  } catch {return {valid:false,reason:'JSON_SYNTAX',envelope:text.startsWith('{')?'object':text.startsWith('[')?'array':text.startsWith('```')?'fence':'other'};}
}
export async function deepseek(env, { messages, mode = 'buy', requestId, json = false, parse }) {
  requestId = typeof requestId === 'string' && /^[\w-]{1,80}$/.test(requestId) ? requestId : crypto.randomUUID();
  let last, jsonMode = json;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now(); let upstreamStatus = null, phase = 'connect', retryable = true, responseInfo;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', signal: AbortSignal.timeout(25000),
        headers: { 'content-type':'application/json', authorization:`Bearer ${env.DEEPSEEK_API_KEY.trim()}` },
        body: JSON.stringify({ model:env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash', messages:json && !jsonMode
          ? [{...messages[0],content:messages[0].content+'\nReturn only one JSON object matching the requested schema. Start with { and end with }. Do not return whitespace or markdown.'},...messages.slice(1)] : messages,
          thinking:{type:'disabled'}, max_tokens:json ? 4096 : 2048,
          ...(jsonMode ? { response_format:{type:'json_object'} } : {}), temperature:json ? 0.2 : 0.4 }),
      });
      upstreamStatus = response.status;
      if (!response.ok) {
        retryable = [408,429,500,502,503,504].includes(response.status);
        const code = ({401:'AI_CREDENTIAL_INVALID',402:'AI_BALANCE_REQUIRED',403:'AI_PROVIDER_FORBIDDEN',400:'AI_REQUEST_REJECTED',429:'AI_UPSTREAM_RATE_LIMIT'})[response.status] || 'AI_UNAVAILABLE';
        response.body?.cancel().catch(()=>{});
        throw fail(code, requestId);
      }
      phase = 'body';
      const result = await response.json();
      phase = 'content';
      const choice = result?.choices?.[0], content = choice?.message?.content;
      // Only shape/length metadata: never include provider text, prompts or credentials.
      responseInfo = { keys:Object.keys(result || {}).slice(0,20), choices:Array.isArray(result?.choices)?result.choices.length:null,
        finishReason:typeof choice?.finish_reason==='string'?choice.finish_reason.slice(0,40):null,
        contentType:content===null?'null':typeof content, contentLength:typeof content==='string'?content.length:null,
        trimmedLength:typeof content==='string'?content.trim().length:null,
        reasoningLength:typeof choice?.message?.reasoning_content==='string'?choice.message.reasoning_content.length:null,
        promptTokens:result?.usage?.prompt_tokens, completionTokens:result?.usage?.completion_tokens,
        ...(json?{json:jsonShape(content)}:{}) };
      if (typeof content !== 'string' || !content.trim() || result.choices[0].finish_reason === 'length') throw fail('AI_EMPTY_RESPONSE',requestId,502);
      phase = 'format';
      const value = parse(content.trim());
      if(json && !jsonMode)console.info(JSON.stringify({event:'advisor_ai_recovered',requestId,mode,attempt,format:'validated_json_text',elapsedMs:Date.now()-started}));
      return { value, requestId };
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      last = error?.requestId ? error : fail(timedOut ? 'AI_TIMEOUT' : phase === 'connect' ? 'AI_UNAVAILABLE' : 'AI_EMPTY_RESPONSE', requestId, phase === 'connect' || timedOut ? 503 : 502);
      const retry = retryable && attempt < 2;
      const entry = JSON.stringify({ event:'advisor_ai_failure',requestId,mode,attempt,phase,upstreamStatus,format:jsonMode?'json_object':'text',code:last.message,retry,elapsedMs:Date.now()-started,...(responseInfo?{responseInfo}:{}) });
      if(retry)console.warn(entry);else console.error(entry);
      if(!retry)throw last;
      // JSON mode can terminate with only whitespace. Repeating it unchanged does not recover.
      // The fallback still passes the same strict parser/evidence validation before any writes.
      if(json && ['content','format'].includes(phase))jsonMode=false;
    }
    // A bounded retry handles transient upstream failures without duplicating local writes.
  }
  throw last;
}
