// This module only reads/writes the composer anchor. It never sends a chat prompt.
const api = window.__piWebUiHost;
const KEY = '__promptEnhancerWeb';
window[KEY]?.dispose?.();
let busy = false;
let disposed = false;
let panel;
let controller;
let anchor;
let typography;
let undo;
const off = [];

function composer() { return api?.dom?.anchors()?.composer ?? null; }
function editor() { return composer()?.querySelector('textarea') ?? null; }
// The URL hash (#s=<session>) changes whenever the tab switches conversation.
function conversationKey() { return location.hash || location.pathname; }
function sessionId() {
  const m = location.hash.match(/(?:^#|&)s=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function clientId() {
  try { return sessionStorage.getItem('pi-web-client-id') || ''; } catch { return ''; }
}
function make(tag, text) {
  const el = composer().ownerDocument.createElement(tag);
  if (text) el.textContent = text;
  return el;
}
function button(root, label, action) {
  const el = make('button', label);
  el.type = 'button';
  el.className = 'btn';
  el.dataset.promptEnhancerButton = label;
  // Host .btn is a fixed 30x30 icon button; text buttons need their own width and padding.
  el.style.cssText = 'margin:8px 8px 0 0;font:inherit;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:auto;min-width:max-content;height:30px;padding:0 12px;white-space:nowrap;';
  el.addEventListener('click', action);
  root.append(el);
  return el;
}
function closePanel() { panel?.remove(); panel = null; }
/** Every panel gets a close button; pass extra buttons as [label, action] pairs. */
function message(text, { actions = [], closable = true } = {}) {
  closePanel();
  const root = composer();
  if (!root) return null;
  panel = make('div');
  panel.dataset.promptEnhancer = 'panel';
  panel.setAttribute('role', 'status');
  panel.style.cssText = 'padding:10px;margin:4px;border:1px solid var(--border);border-radius:8px;color:var(--text);background:var(--bg-elev,var(--bg));font:var(--prompt-enhancer-font, inherit);';
  const status = make('div', text);
  status.dataset.promptEnhancer = 'status';
  panel.append(status);
  root.append(panel);
  panel.actions = make('div');
  for (const [label, action] of actions) button(panel.actions, label, action);
  if (closable) button(panel.actions, '关闭', closePanel);
  panel.append(panel.actions);
  return panel;
}
function section(root, title, items, kind) {
  const box = make('div');
  box.dataset.promptEnhancer = kind;
  box.style.cssText = 'margin-top:8px;color:var(--text-dim,var(--text));';
  box.append(make('div', title));
  const list = make('ul');
  list.style.cssText = 'margin:4px 0 0;padding-left:18px;';
  for (const item of items) list.append(make('li', item));
  box.append(list);
  root.insertBefore(box, root.actions);
}
function replaceDraft(el, text) {
  const win = el.ownerDocument.defaultView;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, text);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.focus();
  el.setSelectionRange(text.length, text.length);
}
async function confirmReplace(el, original) {
  if (el.value === original) return true;
  return api.dialogs.confirm({ title: '草稿已修改', detail: '替换当前输入框内容？当前草稿会保存为可恢复的原文。' });
}
/** Drops in-flight work, the panel and undo state when the conversation or composer changes. */
function reset() {
  controller?.abort();
  closePanel();
  undo = null;
}
async function enhance() {
  if (busy || disposed) return;
  const el = editor();
  if (!el || el.disabled) return void message('请先连接服务并打开对话输入框。');
  const original = el.value;
  if (!original.trim()) return void message('请先输入需要优化的提示词。');
  const model = api.models?.active?.();
  if (!model) return void message('请先在对话界面选择模型。');
  const conversation = conversationKey();
  busy = true;
  const ctrl = new AbortController();
  controller = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 100000);
  message('正在使用当前模型优化提示词…', { actions: [['取消', () => ctrl.abort()]], closable: false });
  try {
    const base = new URL('.', location.href);
    const response = await fetch(new URL('plugins-api/prompt-enhancer-web/enhance', base), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: original, model, clientId: clientId(), sessionId: sessionId() }), signal: ctrl.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('模型未返回优化结果。');
    if (disposed || ctrl.signal.aborted || conversationKey() !== conversation) return;
    const note = data.contextUsed > 0
      ? `已参考最近 ${data.contextUsed} 条对话。`
      : `未参考对话${data.contextNote ? `：${data.contextNote}` : ''}。`;
    const root = message(`优化完成（${note}）请预览后点击“填回输入框”，不会自动发送。`, {
      actions: [['填回输入框', async () => {
        const target = editor();
        if (!target || target.disabled) return;
        if (conversationKey() !== conversation) return void message('对话已切换，请在当前对话中重新优化。');
        const before = target.value;
        if (!(await confirmReplace(target, original))) return;
        // Recheck after the asynchronous confirmation: never overwrite a newer draft.
        if (editor() !== target || target.value !== before || conversationKey() !== conversation) {
          return void message('草稿或对话发生了变化，请重新优化。');
        }
        undo = { text: before, enhanced: data.text, editor: target, conversation };
        replaceDraft(target, data.text);
        message('已填回输入框。检查后自行发送；可点“恢复原文”撤销。');
      }]]
    });
    if (!root) return;
    const preview = make('pre', data.text);
    preview.dataset.promptEnhancer = 'preview';
    preview.style.cssText = 'margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font:inherit;user-select:text;';
    root.insertBefore(preview, root.actions);
    if (Array.isArray(data.questions) && data.questions.length) {
      section(root, '可能缺少的信息（不会写入提示词，可自行补充到草稿后重新优化）：', data.questions, 'questions');
    }
    if (Array.isArray(data.warnings) && data.warnings.length) {
      section(root, '⚠ 请检查：', data.warnings, 'warnings');
    }
  } catch (error) {
    if (disposed || conversationKey() !== conversation) return;
    message(error.name === 'AbortError' ? '优化已取消或超时，原始草稿已保留。' : `优化失败：${error.message}`);
  } finally {
    clearTimeout(timer);
    busy = false;
    if (controller === ctrl) controller = null;
  }
}
async function restore() {
  const el = editor();
  if (!undo || !el || undo.conversation !== conversationKey()) return void message('没有可恢复的原文。');
  const saved = undo;
  const before = el.value;
  if (saved.editor !== el || before !== saved.enhanced) {
    const confirmed = await api.dialogs.confirm({ title: '恢复原文', detail: '当前草稿与上次优化结果不同。确定用上次保留的原文替换吗？' });
    if (!confirmed || editor() !== el || el.value !== before) return;
  }
  replaceDraft(el, saved.text);
  undo = null;
  message('已恢复优化前的原文。');
}
function keydown(event) {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (key !== 'e' && key !== 'z') return;
  event.preventDefault();
  event.stopPropagation();
  void (key === 'e' ? enhance() : restore());
}
function bind() {
  const next = composer();
  if (next) {
    const reference = next.querySelector('.chip, .btn:not(.composer-plugin-action)');
    if (reference) {
      const font = next.ownerDocument.defaultView.getComputedStyle(reference).font;
      if (font && next.style.getPropertyValue('--prompt-enhancer-font') !== font) {
        next.style.setProperty('--prompt-enhancer-font', font);
      }
    }
  }
  if (anchor === next) return;
  anchor?.removeEventListener('keydown', keydown, true);
  anchor?.style.removeProperty('--prompt-enhancer-font');
  typography?.remove();
  if (anchor) reset();
  anchor = next;
  if (!anchor) return;
  typography = anchor.ownerDocument.createElement('style');
  typography.textContent = `
    [data-pi-anchor="composer"] .composer-plugin-action[data-plugin-slot-id^="prompt-enhancer-web:"] {
      font: var(--prompt-enhancer-font, inherit);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
    }
    [data-prompt-enhancer="panel"] pre { font: inherit; }
    [data-prompt-enhancer="panel"] button { font: inherit; }
  `;
  anchor.append(typography);
  anchor.addEventListener('keydown', keydown, true);
}
function onHashChange() { reset(); }
if (api?.onUiAction) {
  off.push(api.onUiAction('prompt-enhancer-web:enhance', () => { void enhance(); }));
  off.push(api.onUiAction('prompt-enhancer-web:restore', () => { void restore(); }));
  const app = api.dom?.anchors()?.app;
  const observer = new MutationObserver(bind);
  if (app) observer.observe(app, { childList: true, subtree: true });
  bind();
  window.addEventListener('hashchange', onHashChange);
  off.push(() => observer.disconnect(), () => window.removeEventListener('hashchange', onHashChange));
}
function dispose() {
  disposed = true;
  controller?.abort();
  closePanel();
  typography?.remove();
  anchor?.style.removeProperty('--prompt-enhancer-font');
  anchor?.removeEventListener('keydown', keydown, true);
  off.forEach(fn => fn());
  undo = null;
}
window[KEY] = { dispose };
export default { cleanup: dispose };
