// Usage (real model, spends quota):
//   node --import <pi-web-ui>/dist/server/resolve-global-sdk.js eval/run.mjs --model provider/id [--old path/to/old-index.mjs] [--only c01,w02]
// Runs every case through the plugin route with a mock host whose llm.complete is pi-web-ui's
// isolated completion. Writes eval/results/latest.json and prints a summary table.
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cases from './cases.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]);
  return acc;
}, []));
if (!args.model) throw new Error('--model provider/id is required');
const here = dirname(fileURLToPath(import.meta.url));
const hostRoot = args.host || '/opt/homebrew/lib/node_modules/pi-web-ui';
const { completeWithIsolatedSession } = await import(join(hostRoot, 'dist/server/plugin-llm.js'));
const env = { cwd: homedir(), agentDir: join(homedir(), '.pi/agent') };

const ASK_BACK = /开始前请(先)?确认|请先确认|请先向我询问|如有(疑问|不清楚)[^。\n]*询问|需要补充的关键(问题|信息)/;
const PLACEHOLDER = /\[(待补充|待填|TODO|TBD|请填写)[^\]]*\]|【(待补充|待填)[^】]*】/i;
const PREAMBLE = /^\s*(好的|当然|没问题|以下是|下面是|\*\*|#|优化后|改写后|sure|here)/i;

export function score(c, text) {
  const fails = [];
  if (PREAMBLE.test(text)) fails.push('前缀');
  if (ASK_BACK.test(text)) fails.push('反问');
  if (PLACEHOLDER.test(text)) fails.push('占位符');
  for (const k of c.keep ?? []) if (!text.includes(k)) fails.push(`丢失「${k}」`);
  if (c.resolve && !c.resolve.some(r => text.includes(r))) fails.push('未理解上文');
  for (const re of c.forbid ?? []) if (re.test(text)) fails.push('越界');
  const ratio = text.length / Math.max(c.draft.length, 1);
  if (c.maxRatio && ratio > c.maxRatio) fails.push(`过长×${ratio.toFixed(1)}`);
  return { pass: fails.length === 0, fails, ratio: Number(ratio.toFixed(2)) };
}

async function loadRoute(file) {
  const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  let handler;
  let snapshot = null;
  mod.default.activate({
    route: (_m, _p, fn) => { handler = fn; },
    getSettings: () => ({}),
    getActiveConversation: () => snapshot,
    llm: { complete: req => completeWithIsolatedSession(env, req) },
  });
  return async c => {
    snapshot = c.context ? { clientId: 'eval', messages: c.context } : null;
    const res = { code: 200, status(x) { this.code = x; return this; }, json(d) { this.data = d; return this; } };
    await handler({ body: { text: c.draft, model: args.model, clientId: 'eval' } }, res);
    if (res.code !== 200) throw new Error(res.data?.error || `HTTP ${res.code}`);
    return res.data;
  };
}

const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const selected = cases.filter(c => !only || only.has(c.id));
const versions = [['new', join(here, '..', 'index.mjs')]];
if (typeof args.old === 'string') versions.unshift(['old', args.old]);

const results = [];
for (const [name, file] of versions) {
  const run = await loadRoute(file);
  // Two at a time: stays under the host's concurrency limit for isolated completions.
  for (let i = 0; i < selected.length; i += 2) {
    await Promise.all(selected.slice(i, i + 2).map(async c => {
      try {
        const data = await run(c);
        results.push({ version: name, id: c.id, kind: c.kind, note: c.note, draft: c.draft, text: data.text,
          questions: data.questions ?? [], warnings: data.warnings ?? [], contextUsed: data.contextUsed ?? 0, ...score(c, data.text) });
      } catch (error) {
        results.push({ version: name, id: c.id, kind: c.kind, note: c.note, draft: c.draft, error: error.message, pass: false, fails: ['调用失败'] });
      }
      process.stderr.write(`${name} ${c.id} done\n`);
    }));
  }
}
results.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'latest.json'), JSON.stringify({ model: args.model, at: new Date().toISOString(), results }, null, 2));
for (const [name] of versions) {
  const rows = results.filter(r => r.version === name);
  console.log(`${name}: ${rows.filter(r => r.pass).length}/${rows.length} passed`);
}
for (const r of results) console.log(`${r.id} ${r.version.padEnd(3)} ${r.pass ? 'PASS' : 'FAIL'} ${(r.fails ?? []).join(' ')}`);
process.exit(0);
