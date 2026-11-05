import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { SYSTEM, buildContext, buildPrompt, parseOutput, keyTokens, LIMITS, readContext } from './index.mjs';

function setup(complete, { snapshot, settings = {} } = {}) {
  let handler;
  const seen = { clientIds: [] };
  plugin.activate({
    route(method, path, fn) { assert.equal(method, 'POST'); assert.equal(path, '/enhance'); handler = fn; },
    llm: { complete },
    getSettings: () => settings,
    getActiveConversation(opts) { seen.clientIds.push(opts?.clientId); return typeof snapshot === 'function' ? snapshot(opts) : snapshot; },
  });
  const call = async body => {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ body }, response);
    return response;
  };
  return Object.assign(call, { seen });
}
const ok = text => async () => ({ ok: true, text });

test('rejects empty, oversized and missing-model requests without calling LLM', async () => {
  const call = setup(() => { throw new Error('must not call'); });
  for (const body of [{ text: '', model: 'm/x' }, { text: 'x'.repeat(8001), model: 'm/x' }, { text: 'hello' }]) {
    assert.equal((await call(body)).code, 400);
  }
});

test('sends the selected model, new rules and JSON draft; returns parsed text', async () => {
  let request;
  const call = setup(async req => { request = req; return { ok: true, text: '<prompt>\n改写后的提示词\n</prompt>' }; });
  const result = await call({ text: '修复登录', model: 'provider/model' });
  assert.equal(result.code, 200);
  assert.equal(result.data.text, '改写后的提示词');
  assert.deepEqual(result.data.questions, []);
  assert.equal(result.data.contextUsed, 0);
  assert.equal(request.model, 'provider/model');
  assert.equal(request.system, SYSTEM);
  assert.match(SYSTEM, /不回答、不执行/);
  assert.match(SYSTEM, /禁止在提示词中出现：问题清单/);
  assert.equal(JSON.parse(request.prompt).draft, '修复登录');
});

test('uses context only for the exact tab, and only user/assistant text', async () => {
  let request;
  const snapshot = {
    clientId: 'tab-1',
    messages: [
      { role: 'user', content: '安装 omp-web' },
      { role: 'assistant', content: [{ type: 'text', text: '已安装。' }, { type: 'toolCall', name: 'bash' }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'SECRET TOOL OUTPUT' }] },
      { role: 'user', content: '这个按钮显示有问题' },
    ],
  };
  const call = setup(async req => { request = req; return { ok: true, text: 'x' }; }, { snapshot });
  const res = await call({ text: '修一下它', model: 'm/x', clientId: 'tab-1' });
  const ctx = JSON.parse(request.prompt).recentConversation;
  assert.equal(res.data.contextUsed, 3);
  assert.deepEqual(ctx.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(ctx[1].text, '已安装。');
  assert.ok(!request.prompt.includes('SECRET TOOL OUTPUT'));
  assert.deepEqual(call.seen.clientIds, ['tab-1']);
});

test('ignores fallback snapshots from another tab, missing ids and disabled setting', async () => {
  const prompts = [];
  const complete = async req => { prompts.push(JSON.parse(req.prompt)); return { ok: true, text: 'x' }; };
  const other = { clientId: 'tab-2', messages: [{ role: 'user', content: '别的标签页' }] };
  await setup(complete, { snapshot: other })({ text: 'a', model: 'm/x', clientId: 'tab-1' });
  await setup(complete, { snapshot: other })({ text: 'a', model: 'm/x' });
  const disabled = setup(complete, { snapshot: { ...other, clientId: 'tab-1' }, settings: { useContext: false } });
  await disabled({ text: 'a', model: 'm/x', clientId: 'tab-1' });
  assert.ok(prompts.every(p => p.recentConversation.length === 0));
  assert.deepEqual(disabled.seen.clientIds, []);
  const off = await disabled({ text: 'a', model: 'm/x', clientId: 'tab-1' });
  assert.match(off.data.contextNote, /关闭/);
});

test('adopted tab (old internal id) still gets context when the page session id matches', async () => {
  const snapshot = { clientId: 'old-tab-id', sessionId: 'sess-1', messages: [{ role: 'user', content: '安装 omp-web' }] };
  const call = setup(async () => ({ ok: true, text: 'x' }), { snapshot });
  const hit = await call({ text: '卸载它', model: 'm/x', clientId: 'new-tab-id', sessionId: 'sess-1' });
  assert.equal(hit.data.contextUsed, 1);
  assert.equal(hit.data.contextNote, '');
  const miss = await call({ text: '卸载它', model: 'm/x', clientId: 'new-tab-id', sessionId: 'sess-2' });
  assert.equal(miss.data.contextUsed, 0);
  assert.match(miss.data.contextNote, /不一致/);
});

test('readContext reports why context was not used', () => {
  const host = snap => ({ getActiveConversation: () => snap });
  assert.equal(readContext({}, { clientId: 't' }).reason, 'unsupported');
  assert.equal(readContext(host(null), {}).reason, 'no-id');
  assert.equal(readContext(host(null), { clientId: 't' }).reason, 'not-found');
  assert.equal(readContext(host({ clientId: 't', messages: [] }), { clientId: 't' }).reason, 'empty');
  assert.equal(readContext({ getActiveConversation() { throw new Error('x'); } }, { clientId: 't' }).reason, 'error');
  assert.equal(readContext(host({ clientId: 't', messages: [{ role: 'user', content: 'hi' }] }), { clientId: 't' }).reason, 'ok');
});

test('context is bounded and dropped before the draft when over the host limit', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `消息${i} ` + 'x'.repeat(2000) }));
  const ctx = buildContext(many);
  assert.ok(ctx.length <= LIMITS.contextMessages);
  assert.ok(ctx.reduce((n, m) => n + m.text.length, 0) <= LIMITS.contextChars);
  assert.match(ctx.at(-1).text, /消息19/);
  const built = buildPrompt('y'.repeat(7000), ctx);
  assert.ok(built.prompt.length <= LIMITS.prompt);
  assert.ok(built.contextUsed < ctx.length);
  assert.equal(buildPrompt('y'.repeat(9000), []), null);
});

test('parseOutput strips headings, fences, quotes and separates questions', () => {
  assert.equal(parseOutput('**优化后的提示词：**\n\n修复登录按钮', '修复登录').text, '修复登录按钮');
  assert.equal(parseOutput('```\n修复登录\n```', '修复登录').text, '修复登录');
  assert.equal(parseOutput('“修复登录”', '修复').text, '修复登录');
  const r = parseOutput('<prompt>\n写一篇介绍\n</prompt>\n<questions>\n- 面向谁？\n- 多少字？\n</questions>', '写介绍');
  assert.equal(r.text, '写一篇介绍');
  assert.deepEqual(r.questions, ['面向谁？', '多少字？']);
});

test('checkOutput warns on ask-back, placeholders, lost tokens and big expansion', () => {
  const draft = '检查 src/auth/login.ts 和 @skill:debug';
  assert.deepEqual(keyTokens(draft).sort(), ['@skill:debug', 'src/auth/login.ts'].sort());
  const w = parseOutput('开始前请确认以下信息：[待补充]\n' + '检查登录'.repeat(60), draft).warnings.join('\n');
  assert.match(w, /反问/);
  assert.match(w, /占位符/);
  assert.match(w, /src\/auth\/login\.ts/);
  assert.match(w, /明显长于/);
  assert.deepEqual(parseOutput('检查 src/auth/login.ts 的登录逻辑，使用 @skill:debug', draft).warnings, []);
  const long = '检查 src/auth/login.ts @skill:debug ' + '登录'.repeat(200);
  assert.match(parseOutput(long, draft).warnings.join(), /明显长于/);
  assert.deepEqual(parseOutput(long, draft, { contextUsed: 2 }).warnings, []);
});

test('rejects failed model output and bounds concurrency', async () => {
  let failed = true;
  const call = setup(async () => failed ? { ok: false, error: 'down' } : { ok: true, text: 'r' });
  assert.equal((await call({ text: 'h', model: 'm/x' })).code, 502);
  failed = false;
  assert.equal((await call({ text: 'h', model: 'm/x' })).code, 200);
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = setup(async () => { await gate; return { ok: true, text: 'r' }; });
  const a = slow({ text: '1', model: 'm/x' });
  const b = slow({ text: '2', model: 'm/x' });
  assert.equal((await slow({ text: '3', model: 'm/x' })).code, 429);
  release();
  await Promise.all([a, b]);
  assert.equal((await slow({ text: '4', model: 'm/x' })).code, 200);
});
