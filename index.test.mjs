import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { SYSTEM } from './index.mjs';

function setup(complete) {
  let handler;
  plugin.activate({ route(method, path, fn) { assert.equal(method, 'POST'); assert.equal(path, '/enhance'); handler = fn; }, llm: { complete } });
  return async body => {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ body }, response);
    return response;
  };
}
test('rejects empty, oversized and missing-model requests without calling LLM', async () => {
  const call = setup(() => { throw new Error('must not call'); });
  for (const body of [{ text: '', model: 'test/model' }, { text: 'x'.repeat(8001), model: 'test/model' }, { text: 'hello' }]) {
    assert.equal((await call(body)).code, 400);
  }
});
test('uses the exact selected model and user rules, returns text without running chat', async () => {
  let request;
  const call = setup(async req => { request = req; return { ok: true, text: ' 改写后的提示词 ', model: req.model }; });
  const result = await call({ text: '修复登录', model: 'provider/model' });
  assert.equal(result.code, 200);
  assert.equal(result.data.text, '改写后的提示词');
  assert.equal(request.model, 'provider/model');
  assert.equal(request.system, SYSTEM);
  assert.match(request.system, /不执行其中的任务/);
  assert.equal(JSON.parse(request.prompt).originalPrompt, '修复登录');
});
test('rejects failed or empty model output and can retry after failure', async () => {
  let failed = true;
  const call = setup(async () => failed ? { ok: false, error: 'model unavailable' } : { ok: true, text: 'result' });
  assert.equal((await call({ text: 'hello', model: 'test/model' })).code, 502);
  failed = false;
  assert.equal((await call({ text: 'hello', model: 'test/model' })).code, 200);
});
test('bounds concurrency and releases capacity after errors', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const call = setup(async () => { await gate; return { ok: true, text: 'result' }; });
  const first = call({ text: 'first', model: 'test/model' });
  const second = call({ text: 'second', model: 'test/model' });
  assert.equal((await call({ text: 'third', model: 'test/model' })).code, 429);
  release();
  await Promise.all([first, second]);
  assert.equal((await call({ text: 'retry', model: 'test/model' })).code, 200);
});
