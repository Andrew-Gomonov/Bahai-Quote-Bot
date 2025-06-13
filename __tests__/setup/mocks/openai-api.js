class MockOpenAI {
  constructor() {
    this.requestHistory = [];
    this.mockResponses = new Map();
    this.errorSimulation = null;
  }

  // Мок для chat completions
  async createChatCompletion(params) {
    this.requestHistory.push({
      type: 'chat_completion',
      params,
      timestamp: Date.now()
    });

    // Симуляция ошибок
    if (this.errorSimulation) {
      const error = this.errorSimulation;
      this.errorSimulation = null;
      throw error;
    }

    // Проверяем кастомные ответы
    const customResponse = this.mockResponses.get('chat_completion');
    if (customResponse) {
      return customResponse;
    }

    // Генерируем базовый ответ
    const messages = params.messages || [];
    const lastMessage = messages[messages.length - 1];
    
    let content = 'This is a test AI response.';
    
    // Более реалистичные ответы на основе контекста
    if (lastMessage && lastMessage.content) {
      const input = lastMessage.content.toLowerCase();
      
      if (input.includes('explain') || input.includes('объясни')) {
        content = 'This quote teaches us about the importance of spiritual growth and unity. It reminds us that true happiness comes from serving others and developing our spiritual qualities.';
      } else if (input.includes('quote') || input.includes('цитата')) {
        content = 'The essence of this quote lies in its call for reflection and action. It encourages us to look beyond material concerns and focus on spiritual development.';
      } else if (input.includes('meaning') || input.includes('смысл')) {
        content = 'The deeper meaning here relates to the interconnectedness of all souls and our responsibility to contribute to the betterment of humanity.';
      }
    }

    return {
      id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: params.model || 'gpt-3.5-turbo',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80
      }
    };
  }

  // Мок для embeddings
  async createEmbedding(params) {
    this.requestHistory.push({
      type: 'embedding',
      params,
      timestamp: Date.now()
    });

    if (this.errorSimulation) {
      const error = this.errorSimulation;
      this.errorSimulation = null;
      throw error;
    }

    const customResponse = this.mockResponses.get('embedding');
    if (customResponse) {
      return customResponse;
    }

    // Генерируем случайный вектор эмбеддинга
    const embedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);

    return {
      object: 'list',
      data: [
        {
          object: 'embedding',
          embedding: embedding,
          index: 0
        }
      ],
      model: params.model || 'text-embedding-ada-002',
      usage: {
        prompt_tokens: 10,
        total_tokens: 10
      }
    };
  }

  // Методы для настройки мока в тестах
  setMockResponse(type, response) {
    this.mockResponses.set(type, response);
  }

  simulateError(error) {
    this.errorSimulation = error;
  }

  getRequestHistory() {
    return [...this.requestHistory];
  }

  getLastRequest() {
    return this.requestHistory[this.requestHistory.length - 1];
  }

  clearHistory() {
    this.requestHistory = [];
    this.mockResponses.clear();
    this.errorSimulation = null;
  }

  // Предустановленные сценарии ошибок
  simulateRateLimitError() {
    this.simulateError(new Error('Rate limit exceeded. Please try again later.'));
  }

  simulateAuthError() {
    this.simulateError(new Error('Invalid API key provided.'));
  }

  simulateServerError() {
    this.simulateError(new Error('OpenAI server error. Please try again.'));
  }

  simulateTimeoutError() {
    this.simulateError(new Error('Request timeout. Please try again.'));
  }

  // Утилиты для тестирования
  hasBeenCalled() {
    return this.requestHistory.length > 0;
  }

  getCallCount() {
    return this.requestHistory.length;
  }

  wasCalledWith(type, expectedParams) {
    return this.requestHistory.some(request => {
      if (request.type !== type) return false;
      
      // Простая проверка параметров
      if (expectedParams) {
        return Object.keys(expectedParams).every(key => {
          return JSON.stringify(request.params[key]) === JSON.stringify(expectedParams[key]);
        });
      }
      
      return true;
    });
  }
}

// Фабрика для создания мок-функции fetch
const createMockFetch = (openaiMock) => {
  return async (url, options = {}) => {
    if (url.includes('openai.com/v1/chat/completions')) {
      const body = JSON.parse(options.body || '{}');
      const result = await openaiMock.createChatCompletion(body);
      
      return {
        ok: true,
        status: 200,
        json: async () => result,
        text: async () => JSON.stringify(result)
      };
    }
    
    if (url.includes('openai.com/v1/embeddings')) {
      const body = JSON.parse(options.body || '{}');
      const result = await openaiMock.createEmbedding(body);
      
      return {
        ok: true,
        status: 200,
        json: async () => result,
        text: async () => JSON.stringify(result)
      };
    }

    // Для других URL возвращаем базовый ответ
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}'
    };
  };
};

module.exports = {
  MockOpenAI,
  createMockFetch
};