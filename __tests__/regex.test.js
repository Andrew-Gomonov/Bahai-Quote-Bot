const pushDateTimeRe = /\/push\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([\s\S]+)/;
const pushTimeOnlyRe = /\/push\s+(\d{2}:\d{2})\s+([\s\S]+)/;
const pushImmediateRe = /^\/push\s+(?!\d{2}:\d{2}\b)(?!\d{4}-\d{2}-\d{2}\b)([\s\S]+)/;

const weeklyTimeOnlyRe = /\/weekly\s+(\d{2}:\d{2})\s+([\s\S]+)/;
const weeklyFullRe = /\/weekly\s+(\d)\s+(\d{2}:\d{2})\s+([\s\S]+)/;

describe('Push command regexes', () => {
  test('match full date+time', () => {
    const m = '/push 2024-05-11 09:30 Hello world'.match(pushDateTimeRe);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('2024-05-11');
    expect(m[2]).toBe('09:30');
    expect(m[3]).toBe('Hello world');
  });

  test('match time-only', () => {
    const m = '/push 19:00 Evening text'.match(pushTimeOnlyRe);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('19:00');
    expect(m[2]).toBe('Evening text');
  });

  test('match immediate text', () => {
    const m = '/push Urgent broadcast now!'.match(pushImmediateRe);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('Urgent broadcast now!');
  });

  test('immediate regex should not match time-only', () => {
    expect('/push 22:10 later'.match(pushImmediateRe)).toBeNull();
  });
});

describe('Weekly command regexes', () => {
  test('match full weekday+time', () => {
    const m = '/weekly 5 08:00 Weekly text'.match(weeklyFullRe);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('5');
    expect(m[2]).toBe('08:00');
    expect(m[3]).toBe('Weekly text');
  });

  test('match time-only weekly', () => {
    const m = '/weekly 07:15 Morning weekly'.match(weeklyTimeOnlyRe);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('07:15');
    expect(m[2]).toBe('Morning weekly');
  });
}); 