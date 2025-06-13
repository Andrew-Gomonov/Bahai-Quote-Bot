class MockTelegramBot {
  constructor(token, options = {}) {
    this.token = token;
    this.options = options;
    this.handlers = new Map();
    this.sentMessages = [];
    this.editedMessages = [];
    this.deletedMessages = [];
    this.callbackQueries = [];
    this._isPolling = false;
    this._webhookUrl = null;
  }

  // Методы для отправки сообщений
  async sendMessage(chatId, text, options = {}) {
    const message = {
      message_id: Math.floor(Math.random() * 10000),
      chat: { id: chatId, type: 'private' },
      text: text,
      date: Math.floor(Date.now() / 1000),
      ...options
    };
    
    this.sentMessages.push(message);
    return Promise.resolve(message);
  }

  async sendPhoto(chatId, photo, options = {}) {
    const message = {
      message_id: Math.floor(Math.random() * 10000),
      chat: { id: chatId, type: 'private' },
      photo: [{ file_id: 'test_photo_id', width: 100, height: 100 }],
      caption: options.caption || '',
      date: Math.floor(Date.now() / 1000),
      ...options
    };
    
    this.sentMessages.push(message);
    return Promise.resolve(message);
  }

  async editMessageText(text, options = {}) {
    const editedMessage = {
      message_id: options.message_id,
      chat: { id: options.chat_id },
      text: text,
      edit_date: Math.floor(Date.now() / 1000)
    };
    
    this.editedMessages.push(editedMessage);
    return Promise.resolve(editedMessage);
  }

  async editMessageReplyMarkup(replyMarkup, options = {}) {
    const editedMessage = {
      message_id: options.message_id,
      chat: { id: options.chat_id },
      reply_markup: replyMarkup,
      edit_date: Math.floor(Date.now() / 1000)
    };
    
    this.editedMessages.push(editedMessage);
    return Promise.resolve(editedMessage);
  }

  async deleteMessage(chatId, messageId) {
    this.deletedMessages.push({ chatId, messageId });
    return Promise.resolve(true);
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    this.callbackQueries.push({ callbackQueryId, ...options });
    return Promise.resolve(true);
  }

  async getChatMember(chatId, userId) {
    return Promise.resolve({
      user: { id: userId, is_bot: false, first_name: 'Test' },
      status: 'member'
    });
  }

  async getMe() {
    return Promise.resolve({
      id: 123456789,
      is_bot: true,
      first_name: 'Test Bot',
      username: 'test_bot'
    });
  }

  // Методы для установки обработчиков
  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(callback);
  }

  onText(regexp, callback) {
    this.on('text', (msg) => {
      const match = msg.text.match(regexp);
      if (match) {
        callback(msg, match);
      }
    });
  }

  // Методы управления ботом
  startPolling(options = {}) {
    this._isPolling = true;
    return Promise.resolve();
  }

  stopPolling() {
    this._isPolling = false;
    return Promise.resolve();
  }

  setWebHook(url, options = {}) {
    this._webhookUrl = url;
    return Promise.resolve(true);
  }

  deleteWebHook() {
    this._webhookUrl = null;
    return Promise.resolve(true);
  }

  isPolling() {
    return this._isPolling;
  }

  // Методы для тестирования
  simulateMessage(chatId, text, options = {}) {
    const message = {
      message_id: Math.floor(Math.random() * 10000),
      from: { id: chatId, is_bot: false, first_name: 'Test User' },
      chat: { id: chatId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: text,
      ...options
    };

    // Вызываем обработчики сообщений
    const textHandlers = this.handlers.get('text') || [];
    textHandlers.forEach(handler => handler(message));

    // Вызываем обработчики для всех сообщений
    const messageHandlers = this.handlers.get('message') || [];
    messageHandlers.forEach(handler => handler(message));

    return message;
  }

  simulateCallbackQuery(callbackQueryId, data, chatId, messageId) {
    const callbackQuery = {
      id: callbackQueryId,
      from: { id: chatId, is_bot: false, first_name: 'Test User' },
      message: {
        message_id: messageId,
        chat: { id: chatId, type: 'private' },
        date: Math.floor(Date.now() / 1000)
      },
      data: data
    };

    const callbackHandlers = this.handlers.get('callback_query') || [];
    callbackHandlers.forEach(handler => handler(callbackQuery));

    return callbackQuery;
  }

  // Методы для проверки в тестах
  getLastSentMessage() {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getAllSentMessages() {
    return [...this.sentMessages];
  }

  getLastEditedMessage() {
    return this.editedMessages[this.editedMessages.length - 1];
  }

  clearHistory() {
    this.sentMessages = [];
    this.editedMessages = [];
    this.deletedMessages = [];
    this.callbackQueries = [];
  }

  // Симуляция ошибок для тестирования
  simulateError(method, error) {
    const originalMethod = this[method];
    this[method] = () => Promise.reject(error);
    
    // Возвращаем функцию для восстановления
    return () => {
      this[method] = originalMethod;
    };
  }
}

module.exports = MockTelegramBot;