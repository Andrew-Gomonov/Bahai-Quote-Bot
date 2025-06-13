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
  const apiBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.llm7.io/v1';
  
  // Убираем слэш в конце если есть и добавляем endpoint
  const baseUrl = apiBaseUrl.replace(/\/$/, '');
  const apiUrl = `${baseUrl}/chat/completions`;

  try {
    const res = await fetchFn(apiUrl, {
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
      console.error('[GPT] HTTP Error:', res.status, errText);
      
      // Проверяем на ошибки квоты
      try {
        const errorData = JSON.parse(errText);
        if (errorData.error && errorData.error.code === 'insufficient_quota') {
          console.error('[GPT] Insufficient quota detected');
          return '(insufficient_quota)';
        }
      } catch (parseError) {
        // Если не удается распарсить JSON, продолжаем с обычной ошибкой
      }
      
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || '(GPT empty)';
  } catch (e) {
    console.error('[GPT] Error:', e.message || e);
    
    // Проверяем сообщение ошибки на содержание insufficient_quota
    if (e.message && e.message.includes('insufficient_quota')) {
      return '(insufficient_quota)';
    }
    
    return '(GPT error)';
  }
}

module.exports = { gptGenerate }; 