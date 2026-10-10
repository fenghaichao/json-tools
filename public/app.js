'use strict';

const $ = (s) => document.querySelector(s);
const el = {
  input: $('#input'), status: $('#status'), stats: $('#stats'),
  tree: $('#treeView'), pretty: $('#prettyView'), mini: $('#miniView'), xml: $('#xmlView'),
  placeholder: $('#placeholder'), indent: $('#indentSelect'), sort: $('#sortSelect'),
  lineNo: $('#lineNoCheck'), outputPane: document.querySelector('.pane-output'),
  wsSelect: $('#wsSelect'), histList: $('#historyList'), histCount: $('#historyCount'),
  histWs: $('#historyWsName'), dataHint: $('#dataHint'), btnExpand: $('#btnExpand'),
  btnSave: $('#btnSave'), btnFull: $('#btnFull'), escape: $('#escapeSelect'),
  diagPanel: $('#diagPanel'), diagList: $('#diagList'), diagCount: $('#diagCount'),
  diagHead: document.querySelector('.diag-head'),
  btnApplyFix: $('#btnApplyFix'), btnAiAnalyze: $('#btnAiAnalyze'),
  aiResult: $('#aiResult'), aiExplain: $('#aiExplain'), btnApplyAi: $('#btnApplyAi'),
  appliedBar: $('#appliedBar'), appliedText: $('#appliedText'), btnUndo: $('#btnUndo'),
  diff: $('#diffView'), diffRight: $('#diffRight'), diffSummary: $('#diffSummary'), diffResult: $('#diffResult'),
};

const state = { ws: '默认', data: undefined, valid: false, lastSaved: undefined, allCollapsed: false,
  repair: null, undoText: null, aiFix: null };

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `请求失败 (${res.status})`);
  return json;
}

/* ---------------- 工具 ---------------- */
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const indentWidth = () => (el.indent.value === 'tab' ? '\t' : Number(el.indent.value));
const byteSize = (s) => new TextEncoder().encode(s).length;
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');
const fmtTime = (iso) => {
  const d = new Date(iso), p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const isObj = (v) => v !== null && typeof v === 'object';

/* ---------------- 语法高亮 ---------------- */
function highlight(jsonStr) {
  const re = /("(?:[^"\\\u0000-\u001F]|\\[\s\S])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(jsonStr))) {
    out += esc(jsonStr.slice(last, m.index));
    if (m[1]) {
      out += `<span class="${m[2] ? 't-key' : 't-str'}">${esc(m[1])}</span>`;
      if (m[2]) out += esc(m[2]);
    } else if (m[3]) out += `<span class="t-bool">${m[3]}</span>`;
    else if (m[4]) out += `<span class="t-null">null</span>`;
    else if (m[5]) out += `<span class="t-num">${m[5]}</span>`;
    last = re.lastIndex;
  }
  return out + esc(jsonStr.slice(last));
}

/* ---------------- 排序（仅对象键，数组保持顺序） ---------------- */
function sortDeep(v, dir) {
  if (Array.isArray(v)) return v.map((x) => sortDeep(x, dir));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => dir * (a < b ? -1 : a > b ? 1 : 0));
    const o = {};
    keys.forEach((k) => { o[k] = sortDeep(v[k], dir); });
    return o;
  }
  return v;
}

/* ---------------- 去除一层转义（仅影响显示） ---------------- */
function unescapeDeep(v) {
  if (Array.isArray(v)) return v.map(unescapeDeep);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = unescapeDeep(v[k]); });
    return o;
  }
  return typeof v === 'string' ? v.replace(/\\(["\\/])/g, '$1') : v;
}

function getViewData() {
  if (!state.valid) return undefined;
  let vd = state.data;
  const mode = el.sort.value;
  if (mode !== 'off') vd = sortDeep(vd, mode === 'asc' ? 1 : -1);
  if (el.escape.value === 'un') vd = unescapeDeep(vd);
  return vd;
}

/* ---------------- JSON 转 XML ---------------- */
function jsonToXml(data) {
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeTag = (k) => {
    let t = String(k).replace(/[^\w.\-:一-龥]/g, '_');
    if (!/^[A-Za-z_:一-龥]/.test(t)) t = '_' + t;
    return t || '_empty';
  };
  const lines = [];
  function emitFields(obj, depth) {
    Object.keys(obj).forEach((k) => emit(safeTag(k), obj[k], depth));
  }
  function emit(tag, val, depth) {
    const pad = '  '.repeat(depth);
    if (val === null || val === undefined) {
      lines.push(`${pad}<${tag}/>`);
    } else if (Array.isArray(val)) {
      if (!val.length) lines.push(`${pad}<${tag}/>`);
      val.forEach((item) => {
        if (Array.isArray(item)) emit(tag, item, depth);
        else if (isObj(item)) {
          lines.push(`${pad}<${tag}>`);
          emitFields(item, depth + 1);
          lines.push(`${pad}</${tag}>`);
        } else lines.push(`${pad}<${tag}>${escText(item)}</${tag}>`);
      });
    } else if (isObj(val)) {
      const ks = Object.keys(val);
      if (!ks.length) { lines.push(`${pad}<${tag}/>`); return; }
      lines.push(`${pad}<${tag}>`);
      emitFields(val, depth + 1);
      lines.push(`${pad}</${tag}>`);
    } else {
      lines.push(`${pad}<${tag}>${escText(val)}</${tag}>`);
    }
  }
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  if (isObj(data) && !Array.isArray(data)) {
    emitFields(data, 0);
  } else {
    emit('root', data, 0);
  }
  return lines.join('\n');
}

function hlXml(xmlStr) {
  return esc(xmlStr)
    .replace(/(&lt;\/?)([\w:.\-]+)/g, '$1<span class="x-tag">$2</span>')
    .replace(/(&gt;)((?:(?!&lt;)[\s\S])*)(&lt;)/g, (all, a, txt, b) => txt.trim() ? `${a}<span class="x-txt">${txt}</span>${b}` : all);
}
/* ---------------- 统计 ---------------- */
function computeStats(data) {
  let keys = 0, nodes = 0, objects = 0, arrays = 0, depthMax = 0;
  (function walk(v, d) {
    nodes++;
    depthMax = Math.max(depthMax, d);
    if (Array.isArray(v)) { arrays++; v.forEach((x) => walk(x, d + 1)); }
    else if (v !== null && typeof v === 'object') {
      objects++;
      const ks = Object.keys(v); keys += ks.length;
      ks.forEach((k) => walk(v[k], d + 1));
    }
  })(data, 0);
  return { keys, nodes, objects, arrays, depthMax };
}

/* ---------------- 错误定位 ---------------- */
function guessPosFromMessage(raw, message) {
  if (/Unexpected end of JSON input/.test(message)) return raw.length;
  // 新版 V8：..."<context>" is not valid JSON，context 以 ... 开头且引号被转义
  const m = message.match(/"((?:\\.|[^"\\])*)" is not valid JSON/);
  if (!m) return null;
  let ctx = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (ctx.startsWith('...')) ctx = ctx.slice(3);
  if (!ctx) return null;
  let idx = raw.indexOf(ctx);
  if (idx === -1 && ctx.length > 8) idx = raw.indexOf(ctx.slice(-8));
  if (idx === -1) return null;
  return idx + ctx.length;
}

function locateError(raw, e) {
  const message = e.message;
  let pos = null;
  const m = message.match(/at position (\d+)/);
  if (m) pos = Number(m[1]);
  else if (e.cause && e.cause.location) pos = e.cause.location.startOffset;
  else pos = guessPosFromMessage(raw, message);
  if (pos == null || !Number.isFinite(pos)) return message;
  pos = Math.min(pos, raw.length);
  let line = 1, col = 1;
  for (let i = 0; i < pos; i++) {
    if (raw[i] === '\n') { line++; col = 1; } else col++;
  }
  const snippet = raw.slice(0, pos).split('\n').pop() || '';
  return `${message}\n位置：第 ${line} 行 第 ${col} 列（offset ${pos}） near: ${snippet.slice(-30) || '(行首)'}`;
}

/* ---------------- 树形视图 ---------------- */
function buildTree(data) {
  const root = document.createElement('ul');
  root.className = 'tree';
  root.appendChild(renderNode(null, data));
  return root;
}

function renderNode(key, value) {
  const li = document.createElement('li');
  const row = document.createElement('div');
  row.className = 'node-row';
  li.appendChild(row);

  if (key !== null) {
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = key;
    row.appendChild(k);
  }

  if (!isObj(value)) {
    const v = document.createElement('span');
    const t = value === null ? 'null' : Array.isArray(value) ? 'arr' : typeof value;
    v.className = { string: 'str', number: 'num', boolean: 'bool' }[t] || 'null';
    v.textContent = typeof value === 'string' ? `"${value}"` : String(value);
    row.appendChild(v);
    return li;
  }

  const arr = Array.isArray(value);
  const entries = arr ? value.map((x, i) => [i, x]) : Object.entries(value);

  const caret = document.createElement('button');
  caret.className = 'caret';
  caret.textContent = '▾';
  row.insertBefore(caret, row.firstChild);

  const summary = document.createElement('span');
  summary.className = 'meta summary';
  summary.textContent = arr ? `[${entries.length} 项]` : `{${entries.length} 键}`;
  row.appendChild(summary);

  const childUl = document.createElement('ul');
  entries.forEach(([k, v]) => childUl.appendChild(renderNode(arr ? null : String(k), v)));
  li.appendChild(childUl);

  caret.addEventListener('click', () => {
    const collapsed = li.classList.toggle('collapsed');
    caret.textContent = collapsed ? '▸' : '▾';
  });
  return li;
}

/* ---------------- 解析主流程 ---------------- */
let parseTimer, saveTimer;

function onInput() {
  state.undoText = null;
  state.aiFix = null;
  state.aiShown = false;
  clearTimeout(parseTimer);
  clearTimeout(saveTimer);
  parseTimer = setTimeout(parseNow, 200);
  saveTimer = setTimeout(saveToHistory, 1200);
}

function parseNow() {
  const raw = el.input.value;
  if (!raw.trim()) {
    state.data = undefined; state.valid = false; state.repair = null;
    el.status.textContent = '等待输入'; el.status.className = 'status';
    el.stats.textContent = '';
    el.tree.innerHTML = ''; el.pretty.innerHTML = ''; el.mini.textContent = ''; el.xml.innerHTML = '';
    el.placeholder.style.display = '';
    renderDiag();
    renderDiff();
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    state.valid = false;
    el.status.textContent = '✗ ' + locateError(raw, e);
    el.status.className = 'status err';
    el.stats.textContent = '';
    try {
      state.repair = repairJson(raw);
    } catch (err) {
      console.warn('规则引擎异常：', err);
      state.repair = null;
    }
    renderDiag();
    renderDiff();
    return;
  }
  state.data = data; state.valid = true;
  state.repair = null;
  renderDiag();
  el.status.textContent = '✓ 合法的 JSON';
  el.status.className = 'status ok';
  el.placeholder.style.display = 'none';

  const vd = getViewData();
  state.viewData = vd;
  const ind = indentWidth();
  const pretty = JSON.stringify(vd, null, ind);
  el.pretty.innerHTML = pretty
    .split('\n')
    .map((line) => `<div class="pl">${highlight(line) || ' '}</div>`)
    .join('');
  el.mini.textContent = JSON.stringify(vd);
  el.xml.innerHTML = hlXml(jsonToXml(vd));
  el.tree.innerHTML = '';
  el.tree.appendChild(buildTree(vd));
  state.allCollapsed = false;
  el.btnExpand.textContent = '折叠';

  const s = computeStats(data);
  el.stats.textContent =
    `字符 ${raw.length.toLocaleString()} · 体积 ${fmtSize(byteSize(raw))} · 节点 ${s.nodes} · 键 ${s.keys} · 对象 ${s.objects} · 数组 ${s.arrays} · 最大深度 ${s.depthMax}`;
  renderDiff();
}

/* ---------------- JSON 比对 ---------------- */
const DIFF_CAP = 500;
let diffTimer;

function escH(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtVal(v) {
  let s;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = 'undefined';
  if (s.length > 160) s = s.slice(0, 160) + '…';
  return s;
}

function diffSection(title, items, rowFn) {
  if (!items.length) return '';
  const shown = items.slice(0, DIFF_CAP);
  const more = items.length > shown.length
    ? `<div class="diff-more">差异过多，仅展示前 ${DIFF_CAP} 条（共 ${items.length} 条）</div>` : '';
  return `<div class="diff-group"><div class="diff-group-title">${title}（${items.length}）</div>${shown.map(rowFn).join('')}${more}</div>`;
}

function renderDiff() {
  if (!el.diff.classList.contains('active')) return;
  const rightRaw = el.diffRight.value;
  if (!rightRaw.trim()) {
    el.diffSummary.textContent = '等待右侧输入';
    el.diffResult.innerHTML = '';
    return;
  }
  if (!state.valid) {
    el.diffSummary.textContent = '⚠ 左侧主输入当前不是合法 JSON，请先修正左侧';
    el.diffResult.innerHTML = '';
    return;
  }
  let right;
  try {
    right = JSON.parse(rightRaw);
  } catch (e) {
    el.diffSummary.textContent = '✗ 右侧 JSON 解析失败：' + (e.message || '格式错误');
    el.diffResult.innerHTML = '';
    return;
  }
  const d = diffJson(state.data, right);
  if (d.equal) {
    el.diffSummary.innerHTML = '<span class="diff-ok">✓ 两份 JSON 完全一致</span>';
    el.diffResult.innerHTML = '';
    return;
  }
  el.diffSummary.textContent =
    `共 ${d.keyDiffs.length + d.valueDiffs.length} 处差异 · 键不一致 ${d.keyDiffs.length} · 数据不一致 ${d.valueDiffs.length}`;
  el.diffResult.innerHTML =
    diffSection('键不一致', d.keyDiffs, (x) =>
      `<div class="diff-row"><span class="diff-side ${x.side}">${x.side === 'left' ? '仅左侧有' : '仅右侧有'}</span>` +
      `<code class="diff-path">${escH(x.path)}</code><span class="diff-val">${escH(fmtVal(x.value))}</span></div>`) +
    diffSection('数据不一致', d.valueDiffs, (x) =>
      `<div class="diff-row"><span class="diff-side changed">值不同</span><code class="diff-path">${escH(x.path)}</code>` +
      `<span class="diff-old">${escH(fmtVal(x.left))}</span><span class="diff-arrow">→</span>` +
      `<span class="diff-new">${escH(fmtVal(x.right))}</span>${x.typeChanged ? '<span class="diff-type">类型也不同</span>' : ''}</div>`);
}

/* ---------------- 诊断面板 / 修复 / AI ---------------- */
function renderDiag() {
  const issues = state.repair ? state.repair.issues : [];
  const hasUndo = state.undoText !== null;

  el.diagHead.classList.toggle('hidden', issues.length === 0);
  el.diagList.classList.toggle('hidden', issues.length === 0);
  el.diagCount.textContent = issues.length ? `（${issues.length} 条）` : '';
  el.diagList.innerHTML = '';
  issues.slice(0, 30).forEach((x) => {
    const li = document.createElement('li');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = `第 ${x.line} 行 第 ${x.col} 列`;
    const msg = document.createElement('span');
    msg.textContent = x.message;
    li.append(pos, msg);
    el.diagList.appendChild(li);
  });
  if (issues.length > 30) {
    const li = document.createElement('li');
    li.textContent = `……其余 ${issues.length - 30} 条省略`;
    el.diagList.appendChild(li);
  }
  el.btnApplyFix.disabled = !(state.repair && state.repair.ok);
  el.btnApplyFix.classList.toggle('hidden', issues.length === 0);

  el.appliedBar.classList.toggle('hidden', !hasUndo);
  el.aiResult.classList.toggle('hidden', !state.aiShown);

  const anyVisible = issues.length > 0 || hasUndo || state.aiShown;
  el.diagPanel.classList.toggle('hidden', !anyVisible);
}

function applyText(text, label) {
  state.undoText = el.input.value;
  el.input.value = text;
  state.aiShown = false;
  state.aiFix = null;
  parseNow();
  if (state.valid) el.appliedText.textContent = label;
  renderDiag();
}

async function aiAnalyze() {
  const btn = el.btnAiAnalyze;
  btn.disabled = true;
  btn.textContent = '⏳ AI 分析中…';
  state.aiShown = true;
  el.aiResult.classList.remove('hidden');
  el.aiExplain.textContent = '正在请求 AI 服务，请稍候（最长 90 秒）……';
  el.btnApplyAi.classList.add('hidden');
  try {
    const r = await api('/api/ai/analyze', {
      method: 'POST',
      body: { input: el.input.value, issues: state.repair ? state.repair.issues : [] },
    });
    state.aiFix = r.fixedJson;
    el.aiExplain.textContent = r.explanation;
    if (r.fixedJson) {
      el.btnApplyAi.classList.remove('hidden');
    }
  } catch (e) {
    el.aiExplain.textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 AI 分析';
    renderDiag();
  }
}

/* ---------------- AI 配置弹窗 ---------------- */
const AI_PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  tongyi: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  minimax: { baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-M3' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  custom: { baseUrl: '', model: '' },
};
const aiEl = {
  modal: $('#aiModal'), enabled: $('#aiEnabled'), preset: $('#aiPreset'),
  baseUrl: $('#aiBaseUrl'), model: $('#aiModel'), apiKey: $('#aiApiKey'),
  keyHint: $('#aiKeyHint'), save: $('#btnAiSave'), test: $('#btnAiTest'), result: $('#aiTestResult'),
};

async function openAiModal() {
  try {
    const cfg = await api('/api/ai/config');
    aiEl.enabled.checked = cfg.enabled;
    aiEl.preset.value = cfg.preset || 'custom';
    aiEl.baseUrl.value = cfg.baseUrl;
    aiEl.model.value = cfg.model;
    aiEl.apiKey.value = '';
    aiEl.apiKey.placeholder = cfg.hasKey ? `已保存（${cfg.keyHint}），留空则不修改` : 'sk-……';
    aiEl.keyHint.textContent = cfg.hasKey ? `当前已配置密钥 ${cfg.keyHint}` : '尚未配置密钥';
    aiEl.result.textContent = '';
  } catch (e) {
    alert('读取 AI 配置失败：' + e.message);
    return;
  }
  aiEl.modal.classList.remove('hidden');
}

function collectAiForm() {
  const body = {
    enabled: aiEl.enabled.checked,
    preset: aiEl.preset.value,
    baseUrl: aiEl.baseUrl.value.trim(),
    model: aiEl.model.value.trim(),
  };
  if (aiEl.apiKey.value.trim()) body.apiKey = aiEl.apiKey.value.trim();
  return body;
}

async function saveAiConfig() {
  try {
    const cfg = await api('/api/ai/config', { method: 'POST', body: collectAiForm() });
    aiEl.apiKey.value = '';
    aiEl.apiKey.placeholder = cfg.hasKey ? `已保存（${cfg.keyHint}），留空则不修改` : 'sk-……';
    aiEl.keyHint.textContent = cfg.hasKey ? `当前已配置密钥 ${cfg.keyHint}` : '尚未配置密钥';
    aiEl.result.textContent = '✓ 已保存';
    aiEl.result.className = 'ai-test-result ok';
  } catch (e) {
    aiEl.result.textContent = '✗ ' + e.message;
    aiEl.result.className = 'ai-test-result err';
  }
}

async function testAi() {
  aiEl.result.textContent = '测试中…';
  aiEl.result.className = 'ai-test-result';
  try {
    await api('/api/ai/config', { method: 'POST', body: collectAiForm() });
    const r = await api('/api/ai/analyze', {
      method: 'POST',
      body: { input: '{test: 1,}', issues: [{ line: 1, col: 2, message: '键未加引号' }] },
    });
    aiEl.result.textContent = r.fixedJson ? '✓ 连接成功，模型可正常返回' : '✓ 连接成功，但模型未返回可解析结果';
    aiEl.result.className = 'ai-test-result ok';
  } catch (e) {
    aiEl.result.textContent = '✗ ' + e.message;
    aiEl.result.className = 'ai-test-result err';
  }
}

/* ---------------- 历史记录（服务端文件存储） ---------------- */
let historyData = [];

async function saveToHistory(force = false) {
  if (!state.valid) return;
  const raw = el.input.value;
  if (!raw.trim() || (!force && raw === state.lastSaved)) return;
  try {
    await api(`/api/history?ws=${encodeURIComponent(state.ws)}`, { method: 'POST', body: { input: raw } });
    state.lastSaved = raw;
    await Promise.all([loadHistory(), loadWorkspaces()]);
  } catch (e) { console.warn('保存历史失败：', e.message); }
}

async function loadHistory() {
  historyData = await api(`/api/history?ws=${encodeURIComponent(state.ws)}`);
  renderHistory();
}

function renderHistory() {
  el.histCount.textContent = `(${historyData.length})`;
  el.histWs.textContent = `工作区：${state.ws}`;
  el.histList.innerHTML = '';
  if (!historyData.length) {
    const empty = document.createElement('div');
    empty.className = 'hist-empty';
    empty.textContent = '暂无历史记录';
    el.histList.appendChild(empty);
    return;
  }
  historyData.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'hist-item';
    row.title = '点击载入到输入框';

    const time = document.createElement('span');
    time.className = 'hist-time';
    time.textContent = fmtTime(item.createdAt);

    const preview = document.createElement('span');
    preview.className = 'hist-preview';
    preview.textContent = item.input.replace(/\s+/g, ' ').slice(0, 90);

    const size = document.createElement('span');
    size.className = 'hist-size';
    size.textContent = fmtSize(byteSize(item.input));

    const del = document.createElement('button');
    del.className = 'hist-del';
    del.textContent = '✕';
    del.title = '删除此条记录';
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await api(`/api/history/delete?ws=${encodeURIComponent(state.ws)}`, { method: 'POST', body: { id: item.id } });
      if (state.lastSaved === item.input) state.lastSaved = undefined;
      await loadHistory();
    });

    row.append(time, preview, size, del);
    row.addEventListener('click', () => {
      el.input.value = item.input;
      state.lastSaved = item.input; // 从历史载入不产生重复记录
      parseNow();
    });
    el.histList.appendChild(row);
  });
}

/* ---------------- 工作区 ---------------- */
async function loadWorkspaces() {
  const list = await api('/api/workspaces');
  el.wsSelect.innerHTML = '';
  list.forEach((w) => {
    const opt = document.createElement('option');
    opt.value = w.name;
    opt.textContent = `${w.name} (${w.historyCount})`;
    if (w.name === state.ws) opt.selected = true;
    el.wsSelect.appendChild(opt);
  });
  if (!list.some((w) => w.name === state.ws) && list[0]) state.ws = list[0].name;
  el.wsSelect.value = state.ws;
}

async function loadLatestIntoInput() {
  if (historyData.length) {
    el.input.value = historyData[0].input;
    state.lastSaved = historyData[0].input;
    parseNow();
  }
}

async function switchWs(name) {
  state.ws = name;
  state.lastSaved = undefined;
  await api('/api/current', { method: 'POST', body: { ws: name } });
  await Promise.all([loadWorkspaces(), loadHistory()]);
  await loadLatestIntoInput();
}

async function wsNew() {
  const name = prompt('新工作区名称（中文/字母/数字，1-32 字符）：');
  if (!name) return;
  try {
    await api('/api/workspaces', { method: 'POST', body: { name } });
    await switchWs(name.trim());
  } catch (e) { alert(e.message); }
}

async function wsRename() {
  const name = prompt(`将工作区「${state.ws}」重命名为：`, state.ws);
  if (!name || name.trim() === state.ws) return;
  try {
    await api('/api/workspaces/rename', { method: 'POST', body: { oldName: state.ws, newName: name.trim() } });
    await switchWs(name.trim());
  } catch (e) { alert(e.message); }
}

async function wsDelete() {
  if (!confirm(`确定删除工作区「${state.ws}」？其全部历史记录文件将被移除。`)) return;
  try {
    await api('/api/workspaces/delete', { method: 'POST', body: { name: state.ws } });
    const cur = await api('/api/current');
    await switchWs(cur.ws);
  } catch (e) { alert(e.message); }
}

/* ---------------- 输出操作 ---------------- */
function currentText() {
  if (!state.valid) return '';
  if (el.xml.classList.contains('active')) return jsonToXml(getViewData());
  if (el.mini.classList.contains('active')) return JSON.stringify(getViewData());
  return JSON.stringify(getViewData(), null, indentWidth());
}

async function copyResult() {
  const text = currentText();
  if (!text) return alert('没有可复制的结果');
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const btn = $('#btnCopy');
  btn.textContent = '已复制';
  setTimeout(() => (btn.textContent = '复制'), 1200);
}

function downloadResult() {
  const text = currentText();
  if (!text) return alert('没有可下载的结果');
  let name = 'formatted.json';
  if (el.xml.classList.contains('active')) name = 'converted.xml';
  else if (el.mini.classList.contains('active')) name = 'minified.json';
  const blob = new Blob([text], { type: name.endsWith('.xml') ? 'application/xml' : 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toggleCollapseAll() {
  state.allCollapsed = !state.allCollapsed;
  el.tree.querySelectorAll('li').forEach((li) => {
    const caret = li.querySelector(':scope > .node-row > .caret');
    if (!caret) return;
    li.classList.toggle('collapsed', state.allCollapsed);
    caret.textContent = state.allCollapsed ? '▸' : '▾';
  });
  el.btnExpand.textContent = state.allCollapsed ? '展开' : '折叠';
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (el.outputPane.classList.contains('maxed')) {
    el.outputPane.classList.remove('maxed');
    el.btnFull.textContent = '⛶ 全屏';
    return;
  }
  el.outputPane.requestFullscreen().catch(() => {
    // 浏览器禁用全屏 API 时退化为覆盖式最大化
    el.outputPane.classList.add('maxed');
    el.btnFull.textContent = '⛶ 退出';
  });
}

/* ---------------- 示例 ---------------- */
const SAMPLE = JSON.stringify({
  name: 'JSON 在线解析工具',
  version: '1.0.0',
  features: ['格式化', '语法高亮', '树形视图', '压缩', '历史记录', '工作区'],
  local: true,
  port: 3000,
  nested: { note: '粘贴任意 JSON 即可自动解析', tags: { type: 'demo', ok: true }, missing: null },
}, null, 2);

/* ---------------- 事件绑定 ---------------- */
function bind() {
  el.input.addEventListener('input', onInput);
  el.indent.addEventListener('change', parseNow);
  el.sort.addEventListener('change', parseNow);
  el.escape.addEventListener('change', parseNow);
  el.lineNo.addEventListener('change', () => el.pretty.classList.toggle('numbered', el.lineNo.checked));
  el.btnSave.addEventListener('click', async () => {
    if (!state.valid) return alert('当前内容不是合法 JSON，无法保存');
    await saveToHistory(true);
    el.btnSave.textContent = '已保存';
    setTimeout(() => (el.btnSave.textContent = '保存'), 1200);
  });
  el.btnFull.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    el.btnFull.textContent = document.fullscreenElement ? '⛶ 退出' : '⛶ 全屏';
  });
  $('#btnClear').addEventListener('click', () => { el.input.value = ''; state.lastSaved = undefined; parseNow(); el.input.focus(); });
  $('#btnSample').addEventListener('click', () => { el.input.value = SAMPLE; parseNow(); saveToHistory(); });
  el.btnApplyFix.addEventListener('click', () => {
    if (state.repair && state.repair.ok) {
      applyText(state.repair.fixed, `✓ 已按 ${state.repair.issues.length} 条规则自动修复`);
    }
  });
  el.btnUndo.addEventListener('click', () => {
    if (state.undoText !== null) {
      const text = state.undoText;
      state.undoText = null;
      el.input.value = text;
      parseNow();
    }
  });
  el.btnAiAnalyze.addEventListener('click', aiAnalyze);
  el.btnApplyAi.addEventListener('click', () => {
    if (state.aiFix) applyText(state.aiFix, '✓ 已应用 AI 修复结果');
  });
  $('#btnAiCfg').addEventListener('click', openAiModal);
  $('#btnAiClose').addEventListener('click', () => aiEl.modal.classList.add('hidden'));
  aiEl.modal.addEventListener('click', (ev) => { if (ev.target === aiEl.modal) aiEl.modal.classList.add('hidden'); });
  aiEl.preset.addEventListener('change', () => {
    const p = AI_PRESETS[aiEl.preset.value];
    if (p && (p.baseUrl || p.model)) { aiEl.baseUrl.value = p.baseUrl; aiEl.model.value = p.model; }
  });
  aiEl.save.addEventListener('click', saveAiConfig);
  aiEl.test.addEventListener('click', testAi);
  $('#btnCopy').addEventListener('click', copyResult);
  $('#btnDownload').addEventListener('click', downloadResult);
  el.btnExpand.addEventListener('click', toggleCollapseAll);
  $('#tabs').addEventListener('click', (ev) => {
    const tab = ev.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    ['tree', 'pretty', 'mini', 'xml', 'diff'].forEach((v) => el[v].classList.toggle('active', v === tab.dataset.view));
    if (tab.dataset.view === 'diff') el.placeholder.style.display = 'none';
    else el.placeholder.style.display = state.valid ? 'none' : '';
    renderDiff();
  });
  el.wsSelect.addEventListener('change', () => switchWs(el.wsSelect.value));
  el.diffRight.addEventListener('input', () => {
    clearTimeout(diffTimer);
    diffTimer = setTimeout(renderDiff, 200);
  });
  $('#btnWsNew').addEventListener('click', wsNew);
  $('#btnWsRename').addEventListener('click', wsRename);
  $('#btnWsDelete').addEventListener('click', wsDelete);
  $('#btnHistoryClear').addEventListener('click', async () => {
    if (!confirm(`清空工作区「${state.ws}」的全部历史记录？`)) return;
    await api(`/api/history/clear?ws=${encodeURIComponent(state.ws)}`, { method: 'POST' });
    state.lastSaved = undefined;
    await Promise.all([loadHistory(), loadWorkspaces()]);
  });
  $('#btnHistoryToggle').addEventListener('click', (ev) => {
    const sec = $('#historySection');
    sec.classList.toggle('collapsed');
    ev.target.textContent = sec.classList.contains('collapsed') ? '▸' : '▾';
  });
}

/* ---------------- 启动 ---------------- */
(async function init() {
  bind();
  try {
    const cur = await api('/api/current');
    state.ws = cur.ws;
    el.dataHint.textContent = `数据目录：${cur.dataDir}`;
    el.dataHint.title = cur.dataDir;
    await Promise.all([loadWorkspaces(), loadHistory()]);
    // 打开时自动载入最近一条历史（服务端文件记忆，不用浏览器存储）
    await loadLatestIntoInput();
  } catch (e) {
    el.status.textContent = '✗ 无法连接本地服务：' + e.message;
    el.status.className = 'status err';
  }
})();
