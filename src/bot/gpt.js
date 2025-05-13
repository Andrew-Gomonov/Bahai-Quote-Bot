let fetchFn = typeof fetch !== 'undefined' ? fetch : null;
if (!fetchFn) {
  fetchFn = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

async function gptGenerate(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[GPT] OPENAI_API_KEY not set');
    return '(GPT key missing)';
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-nano';
  const maxTokens = process.env.OPENAI_MAX_TOKENS ? Number(process.env.OPENAI_MAX_TOKENS) : 200;

  try {
    const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || '(GPT empty)';
  } catch (e) {
    console.error('[GPT] Error:', e.message || e);
    return '(GPT error)';
  }
}

module.exports = { gptGenerate }; 