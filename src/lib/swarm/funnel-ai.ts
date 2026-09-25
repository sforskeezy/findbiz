export function funnelModelConfigured() {
  return !!(process.env.DASHSCOPE_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim());
}

/** Calls the same Qwen / Groq models used elsewhere in Swarm and returns the first JSON value in the reply. */
export async function askFunnelModel<T>(system: string, user: string, maxTokens = 650, timeoutMs = 16_000): Promise<T | null> {
  const providers = [
    {key:process.env.DASHSCOPE_API_KEY?.trim(),base:process.env.DASHSCOPE_BASE_URL?.trim()||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',model:process.env.QWEN_MODEL?.trim()||'qwen3.5-flash',qwen:true},
    {key:process.env.GROQ_API_KEY?.trim(),base:process.env.LIVE_BASE_URL?.trim()||process.env.RADAR_BRIEF_BASE_URL?.trim()||'https://api.groq.com/openai/v1',model:process.env.LIVE_MODEL?.trim()||'openai/gpt-oss-120b',qwen:false},
  ].filter(provider => provider.key);
  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.base.replace(/\/$/,'')}/chat/completions`, {
        method:'POST',headers:{Authorization:`Bearer ${provider.key}`,'Content-Type':'application/json'},
        body:JSON.stringify({model:provider.model,stream:false,temperature:0,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:user}],...(provider.qwen?{enable_thinking:false}:{})}),
        signal:AbortSignal.timeout(timeoutMs),cache:'no-store',
      });
      if (!response.ok) continue;
      const data = await response.json() as {choices?:Array<{message?:{content?:string}}>};
      const output = data.choices?.[0]?.message?.content?.trim() ?? '';
      const json = output.match(/[[{][\s\S]*[\]}]/)?.[0];
      if (!json) continue;
      return JSON.parse(json) as T;
    } catch { /* Fall through to the next provider; callers always have a rule-based path. */ }
  }
  return null;
}
