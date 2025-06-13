const { formatExplanation } = require('../src/bot/aiExplainer');

describe('AI Explainer', () => {
  test('formatExplanation should format explanation correctly', () => {
    const quote = {
      id: 1,
      text: 'This is a test quote about wisdom and life.',
      author: 'Test Author',
      theme: 'Wisdom'
    };
    
    const explanation = 'This quote teaches us about the importance of wisdom in daily life.';
    
    const result = formatExplanation(quote, explanation);
    
    expect(result).toContain('💡 **Объяснение цитаты #1**');
    expect(result).toContain(quote.text);
    expect(result).toContain(explanation);
    expect(result).toContain('✨ _Используйте эту мудрость в своей повседневной жизни!_');
  });

  test('formatExplanation should truncate long quotes', () => {
    const longQuote = {
      id: 2,
      text: 'This is a very long quote that should be truncated because it exceeds the maximum length limit that we set for the display in the explanation format function.',
      author: 'Test Author'
    };
    
    const explanation = 'This is an explanation.';
    
    const result = formatExplanation(longQuote, explanation);
    
    expect(result).toContain('...');
    expect(result.includes(longQuote.text)).toBe(false); // Full text should not be included
  });
}); 