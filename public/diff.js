'use strict';
/**
 * JSON 差异比对引擎（纯函数，无 DOM 依赖，可在 Node 中单测）。
 * diffJson(left, right) -> {
 *   equal: boolean,
 *   keyDiffs:   [{ path, side: 'left'|'right', value }],        // 键不一致：路径仅一侧存在
 *   valueDiffs: [{ path, left, right, typeChanged: boolean }],  // 数据不一致：同路径值或类型不同
 * }
 * 数组按下标逐位对齐；对象按键名对齐；路径形如 $.a.b[2]。
 */
(function (global) {

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function kindOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function sameLeaf(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  return a === b;
}

function walk(a, b, path, out) {
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      const p = `${path}.${k}`;
      if (!(k in b)) out.keyDiffs.push({ path: p, side: 'left', value: a[k] });
      else walk(a[k], b[k], p, out);
    }
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.keyDiffs.push({ path: `${path}.${k}`, side: 'right', value: b[k] });
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const p = `${path}[${i}]`;
      if (i >= b.length) out.keyDiffs.push({ path: p, side: 'left', value: a[i] });
      else if (i >= a.length) out.keyDiffs.push({ path: p, side: 'right', value: b[i] });
      else walk(a[i], b[i], p, out);
    }
  } else if (!sameLeaf(a, b)) {
    out.valueDiffs.push({ path, left: a, right: b, typeChanged: kindOf(a) !== kindOf(b) });
  }
}

function diffJson(left, right) {
  const out = { keyDiffs: [], valueDiffs: [] };
  walk(left, right, '$', out);
  return { equal: out.keyDiffs.length === 0 && out.valueDiffs.length === 0, ...out };
}

if (typeof module === 'object' && module.exports) module.exports = diffJson;
else global.diffJson = diffJson;

})(typeof window !== 'undefined' ? window : globalThis);
