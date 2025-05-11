const request = require('supertest');
const app = require('../src/admin');

describe('Admin panel routes', () => {
  let agent;

  beforeEach(() => {
    agent = request.agent(app);
  });

  test('Login page returns 200', async () => {
    const res = await agent.get('/login');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Вход в панель управления/);
  });

  test('Login with correct credentials redirects to dashboard', async () => {
    const res = await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'admin' });
    expect(res.statusCode).toBe(302);
    expect(res.header.location).toBe('/');
  });

  test('Login with incorrect credentials shows error', async () => {
    const res = await agent
      .post('/login')
      .type('form')
      .send({ username: 'wrong', password: 'wrong' });
    expect(res.statusCode).toBe(302);
    expect(res.header.location).toBe('/login');
  });

  test('Dashboard requires authentication', async () => {
    const res = await agent.get('/');
    expect(res.statusCode).toBe(302);
    expect(res.header.location).toBe('/login');
  });

  test('Authenticated user can access dashboard', async () => {
    await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'admin' });
    
    const res = await agent.get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Статистика/);
  });

  test('Logout redirects to login page', async () => {
    await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'admin' });
    
    const res = await agent.get('/logout');
    expect(res.statusCode).toBe(302);
    expect(res.header.location).toBe('/login');
  });

  test('/quotes returns 200 and contains Цитаты', async () => {
    await agent.post('/login')
      .type('form')
      .send({ username: 'admin', password: 'admin' });
    const res = await agent.get('/quotes');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Цитаты/);
  });

  test('/broadcasts returns 200', async () => {
    await agent.post('/login')
      .type('form')
      .send({ username: 'admin', password: 'admin' });
    const res = await agent.get('/broadcasts');
    expect(res.statusCode).toBe(200);
  });

  test('/bot returns 200 and shows status', async () => {
    await agent.post('/login')
      .type('form')
      .send({ username: 'admin', password: 'admin' });
    const res = await agent.get('/bot');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Управление ботом/);
  });
}); 