import { build } from './src/server.js';

process.env.LLM_PROVIDER = 'fixtures';
process.env.NODE_ENV = 'test';
delete process.env.ASSIST_API_KEY;
delete process.env.ASSIST_API_KEYS;

const app = await build();
await app.ready();

const res = await app.inject({
  method: 'POST',
  url: '/assist/draft-graph/stream',
  headers: { 'content-type': 'application/json' },
  payload: { brief: 'Create a simple todo app' }
});

console.log('Status:', res.statusCode);
console.log('Body:', res.body);

await app.close();
