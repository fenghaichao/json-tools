'use strict';
/**
 * 文本级双栏对齐引擎（纯函数，可在 Node 单测）——供 BC 风格"双栏比对"使用。
 *
 * alignLines(a: string[], b: string[]) -> {
 *   rows:   [{ type: 'eq'|'chg'|'del'|'ins', lno, l, rno, r }],  // 双栏行序列，缺失侧为 null
 *   blocks: [{ row, l0, l1, r0, r1 }],  // 每处差异块：首行下标 + 在 a/b 中的 0 基半开行区间（纯新增/删除一侧区间为空=插入点）
 *   count:  number,        // 差异块数
 * }
 * 算法：裁剪公共首/尾行 -> 中段 LCS；中段过大(>2500*2500)退化为整块配对替换（BC 快速模式）。
 *
 * tokensDiff(a: string, b: string) -> { l: [{s,text}], r: [{s,text}] }
 * 行内词级差异，s: 'eq'|'ne'；token 过多(>800)时整行标 ne。
 */
(function (global) {

const LCS_CELL_LIMIT = 6_250_000;

function zipBlock(dels, ins, rows) {
  const zipped = Math.min(dels.length, ins.length);
  for (let k = 0; k < zipped; k++) rows.push({ type: 'chg', a: dels[k].line, ai: dels[k].i, b: ins[k].line, bi: ins[k].i });
  for (let k = zipped; k < dels.length; k++) rows.push({ type: 'del', a: dels[k].line, ai: dels[k].i });
  for (let k = zipped; k < ins.length; k++) rows.push({ type: 'ins', b: ins[k].line, bi: ins[k].i });
}

function lcsGapOps(am, bm) {
  // 返回中段对齐后的原始行配对（i,j 为 am/bm 下标；null 表示单侧）
  if (!am.length || !bm.length || am.length * bm.length > LCS_CELL_LIMIT) {
    const rows = [];
    const dels = am.map((line, i) => ({ line, i }));
    const ins = bm.map((line, i) => ({ line, i }));
    zipBlock(dels, ins, rows);
    return rows;
  }
  const n = am.length; const m = bm.length; const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = am[i] === bm[j]
        ? dp[(i + 1) * W + j + 1] + 1
        : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const rows = [];
  let i = 0; let j = 0;
  let dels = []; let ins = [];
  const flush = () => { if (dels.length || ins.length) { zipBlock(dels, ins, rows); dels = []; ins = []; } };
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      flush();
      rows.push({ type: 'eq', a: am[i], ai: i, b: bm[j], bi: j });
      i++; j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
      dels.push({ line: am[i], i }); i++;
    } else {
      ins.push({ line: bm[j], i: j }); j++;
    }
  }
  while (i < n) { dels.push({ line: am[i], i }); i++; }
  while (j < m) { ins.push({ line: bm[j], i: j }); j++; }
  flush();
  return rows;
}

function alignLines(a, b) {
  const n = a.length; const m = b.length;
  let p = 0;
  while (p < n && p < m && a[p] === b[p]) p++;
  let s = 0;
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;

  const raw = [];
  for (let k = 0; k < p; k++) raw.push({ type: 'eq', a: a[k], ai: k, b: b[k], bi: k });
  const mid = lcsGapOps(a.slice(p, n - s), b.slice(p, m - s));
  for (const r of mid) {
    raw.push(r.ai !== undefined && r.bi !== undefined
      ? { ...r, ai: r.ai + p, bi: r.bi + p }
      : (r.ai !== undefined ? { ...r, ai: r.ai + p } : { ...r, bi: r.bi + p }));
  }
  for (let k = 0; k < s; k++) raw.push({ type: 'eq', a: a[n - s + k], ai: n - s + k, b: b[m - s + k], bi: m - s + k });

  const rows = []; const blockStarts = [];
  for (const r of raw) {
    if (r.type !== 'eq' && (rows.length === 0 || rows[rows.length - 1].type === 'eq')) blockStarts.push(rows.length);
    rows.push({
      type: r.type,
      lno: r.ai !== undefined ? r.ai + 1 : null,
      l: r.ai !== undefined ? r.a : null,
      rno: r.bi !== undefined ? r.bi + 1 : null,
      r: r.bi !== undefined ? r.b : null,
    });
  }
  const countAt = (upto, key) => { let c = 0; for (let k = 0; k < upto; k++) if (rows[k][key] !== null) c++; return c; };
  const blocks = blockStarts.map((s) => {
    let e = s;
    while (e < rows.length && rows[e].type !== 'eq') e++;
    return { row: s, l0: countAt(s, 'lno'), l1: countAt(e, 'lno'), r0: countAt(s, 'rno'), r1: countAt(e, 'rno') };
  });
  return { rows, blocks, count: blocks.length };
}

const TOKEN_RE = /"[^"]*"|[{}\[\]:,]|\d+(?:\.\d+)?|[A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5-]*|\s+|./g;
const tokenize = (t) => t.match(TOKEN_RE) || [];

function tokensDiff(a, b) {
  const ta = tokenize(a); const tb = tokenize(b);
  if (ta.length > 800 || tb.length > 800) {
    return { l: [{ s: 'ne', text: a }], r: [{ s: 'ne', text: b }] };
  }
  const n = ta.length; const m = tb.length; const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = ta[i] === tb[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const l = []; const r = [];
  let i = 0; let j = 0;
  const push = (arr, seg, s) => {
    if (arr.length && arr[arr.length - 1].s === s && s !== undefined) arr[arr.length - 1].text += seg;
    else arr.push({ s, text: seg });
  };
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { push(l, ta[i], 'eq'); push(r, tb[j], 'eq'); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push(l, ta[i], 'ne'); i++; }
    else { push(r, tb[j], 'ne'); j++; }
  }
  while (i < n) { push(l, ta[i], 'ne'); i++; }
  while (j < m) { push(r, tb[j], 'ne'); j++; }
  return { l, r };
}

const api = { alignLines, tokensDiff };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.diffText = api;

})(typeof window !== 'undefined' ? window : globalThis);
