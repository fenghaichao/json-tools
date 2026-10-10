'use strict';
/**
 * JSON 规则诊断与修复引擎（纯函数，无 DOM 依赖，可在 Node 中单测）。
 * repairJson(src) -> { ok, fixed, issues: [{line, col, message}] }
 *  - 词法扫描：容错读取 token，同时记录问题
 *  - 语法解析：递归下降，缺什么补什么（冒号/逗号/引号/闭合符/null）
 *  - 输出：JSON.stringify 重新序列化的修复结果
 */
(function (global) {

const CN_QUOTES = { '\u201c': '\u201d', '\u2018': '\u2019' }; // 开引号 -> 闭引号
const WORD_RE = /[A-Za-z_$一-龥]/;
const WORD_CH_RE = /[A-Za-z0-9_$一-龥-]/;
const NUM_START = /[0-9-]/;

function makePosOf(text) {
  let lineStarts = null;
  return function (offset) {
    if (!lineStarts) {
      lineStarts = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
    }
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
  };
}

function repairJson(src) {
  const issues = [];
  const seen = new Set();
  const posOf = makePosOf(src);
  function issue(pos, message) {
    const p = posOf(Math.min(pos, src.length));
    const key = p.line + ':' + p.col + ':' + message;
    if (!seen.has(key)) { seen.add(key); issues.push({ line: p.line, col: p.col, message }); }
  }

  /* ---------------- 词法扫描 ---------------- */
  const tokens = [];
  let i = 0;
  const len = src.length;
  const skipWs = (from) => {
    let j = from;
    while (j < len && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r' || src[j] === ' ' || src[j] === ' ')) j++;
    return j;
  };

  function readString(start, quote, label) {
    // start = 开引号位置；返回 [value, nextIndex]
    let j = start + 1, out = '', closed = false;
    while (j < len) {
      const c = src[j];
      if (c === '\\') {
        const n = src[j + 1];
        if (n === undefined) { j++; continue; }
        if ('"\\/bfnrt'.includes(n) || n === 'u') {
          if (n === 'u') {
            const hex = src.slice(j + 2, j + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); j += 6; continue; }
            issue(j, `无效的 Unicode 转义 \\u${hex.slice(0, 4)}，按字面保留`);
            out += 'u'; j += 2; continue;
          }
          out += { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[n];
          j += 2; continue;
        }
        issue(j, `无效的转义序列 \\${n}，按字面保留`);
        out += n; j += 2; continue;
      }
      if (c === quote) { j++; closed = true; break; }
      if (c === '\n') break; // 未闭合，行尾截断
      out += c; j++;
    }
    if (!closed) issue(start, label + '未闭合，已自动补全引号');
    return [out, j];
  }

  while (i < len) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ' || c === ' ') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      issue(i, '移除行注释 //');
      const j = src.indexOf('\n', i);
      i = j === -1 ? len : j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      issue(i, '移除块注释 /* */');
      const j = src.indexOf('*/', i + 2);
      i = j === -1 ? len : j + 2;
      continue;
    }
    if ('{}[]:,'.includes(c)) { tokens.push({ t: c, pos: i }); i++; continue; }
    if (c === '"') {
      const [v, j] = readString(i, '"', '字符串');
      tokens.push({ t: 'str', v, pos: i });
      i = j; continue;
    }
    if (c === "'") {
      issue(i, "单引号字符串已转为双引号");
      const [v, j] = readString(i, "'", '字符串');
      tokens.push({ t: 'str', v, pos: i });
      i = j; continue;
    }
    if (CN_QUOTES[c]) {
      issue(i, '中文引号已转为英文引号');
      const close = CN_QUOTES[c];
      let j = i + 1, out = '';
      while (j < len && src[j] !== close && src[j] !== ',' && src[j] !== ':' && src[j] !== '\n' && !'}]'.includes(src[j])) { out += src[j]; j++; }
      if (src[j] === close) j++;
      tokens.push({ t: 'str', v: out, pos: i });
      i = j; continue;
    }
    if (NUM_START.test(c) || (c === '+' && /[0-9.]/.test(src[i + 1] || ''))) {
      const m = /^[-+]?(\.?[0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?)/.exec(src.slice(i, i + 40));
      if (m) {
        let raw = m[0];
        if (raw.startsWith('+')) issue(i, '数字不能以 + 开头，已移除');
        if (/_/.test(raw)) issue(i, '数字含下划线分隔符，已移除');
        raw = raw.replace(/^\+/, '').replace(/_/g, '');
        if (/^0[xX]/.test(src.slice(i, i + 2))) {
          const hx = /^0[xX][0-9a-fA-F]+/.exec(src.slice(i))[0];
          issue(i, `十六进制 ${hx} 已转为十进制`);
          tokens.push({ t: 'num', v: parseInt(hx, 16), pos: i });
          i += hx.length; continue;
        }
        if (raw === '-' || raw === '.' || raw === '-.') { issue(i, '不完整的数字，已按 0 处理'); tokens.push({ t: 'num', v: 0, pos: i }); i++; continue; }
        const num = Number(raw.endsWith('.') ? raw + '0' : raw);
        if (!Number.isFinite(num)) { issue(i, `数字 ${raw} 溢出，已替换为 null`); tokens.push({ t: 'null', pos: i }); }
        else tokens.push({ t: 'num', v: num, pos: i });
        i += raw.length; continue;
      }
    }
    if (WORD_RE.test(c)) {
      let j = i;
      while (j < len && WORD_CH_RE.test(src[j])) j++;
      const word = src.slice(i, j);
      const next = skipWs(j);
      const isKey = src[next] === ':';
      if (isKey) {
        issue(i, `键 ${word} 未加引号，已补引号`);
        tokens.push({ t: 'str', v: word, pos: i, key: true });
      } else if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ t: word, pos: i });
      } else if (word === 'True' || word === 'False' || word === 'None') {
        issue(i, `Python 风格 ${word} 已转为 ${word === 'True' ? 'true' : word === 'False' ? 'false' : 'null'}`);
        tokens.push({ t: word === 'True' ? 'true' : word === 'False' ? 'false' : 'null', pos: i });
      } else if (word === 'NaN' || word === 'Infinity' || word === '-Infinity') {
        issue(i, `${word} 不是合法 JSON 值，已替换为 null`);
        tokens.push({ t: 'null', pos: i });
      } else {
        issue(i, `未加引号的 ${word} 已转为字符串`);
        tokens.push({ t: 'str', v: word, pos: i });
      }
      i = j; continue;
    }
    issue(i, `移除非法字符 ${JSON.stringify(c)}`);
    i++;
  }

  /* ---------------- 语法解析（容错递归下降） ---------------- */
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];

  function parseValue(depth) {
    const tok = peek();
    if (!tok) { issue(src.length - 1, '内容被截断，缺失的值以 null 补位'); return null; }
    if (tok.t === '{') return parseObj(depth);
    if (tok.t === '[') return parseArr(depth);
    if (tok.t === '}' || tok.t === ']' || tok.t === ',') {
      issue(tok.pos, '缺少值，已用 null 补位');
      return null;
    }
    if (tok.t === ':') { next(); return parseValue(depth); }
    next();
    if (tok.t === 'str') return tok.v;
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'true') return true;
    if (tok.t === 'false') return false;
    return null; // null token
  }

  function parseObj() {
    const open = next(); // {
    const obj = {};
    for (;;) {
      let tok = peek();
      if (!tok) { issue(open.pos, '对象未闭合，已自动补 }'); break; }
      if (tok.t === '}') { next(); break; }
      if (tok.t === ']') { issue(tok.pos, '多余的 ] 已移除'); next(); continue; }
      if (tok.t === ',') { issue(tok.pos, '移除多余的尾逗号'); next(); continue; }
      // 键
      if (tok.t !== 'str') issue(tok.pos, '键必须是字符串，已自动转换');
      next();
      const key = tok.t === 'str' ? tok.v : String(tok.v ?? tok.t);
      const sep = peek();
      if (!sep || sep.t !== ':') issue(tok.pos, `键 ${key} 后缺少冒号，已补`);
      else next();
      obj[key] = parseValue();
      // 分隔符
      tok = peek();
      if (!tok) { issue(open.pos, '对象未闭合，已自动补 }'); break; }
      if (tok.t === ',') {
        next();
        const t2 = peek();
        if (t2 && (t2.t === '}' || t2.t === ']')) issue(t2.pos, '移除多余的尾逗号');
        continue;
      }
      if (tok.t === '}') { next(); break; }
      if (tok.t === ']') { issue(tok.pos, '对象被 ] 提前闭合，已按 } 处理'); next(); break; }
      issue(tok.pos, '元素之间缺少逗号，已补');
    }
    return obj;
  }

  function parseArr() {
    const open = next(); // [
    const arr = [];
    for (;;) {
      let tok = peek();
      if (!tok) { issue(open.pos, '数组未闭合，已自动补 ]'); break; }
      if (tok.t === ']') { next(); break; }
      if (tok.t === '}') { issue(tok.pos, '数组被 } 提前闭合，已按 ] 处理'); next(); break; }
      if (tok.t === ',') { issue(tok.pos, '移除多余的尾逗号'); next(); continue; }
      arr.push(parseValue());
      tok = peek();
      if (!tok) { issue(open.pos, '数组未闭合，已自动补 ]'); break; }
      if (tok.t === ',') {
        next();
        const t2 = peek();
        if (t2 && (t2.t === '}' || t2.t === ']')) issue(t2.pos, '移除多余的尾逗号');
        continue;
      }
      if (tok.t === ']') { next(); break; }
      issue(tok.pos, '元素之间缺少逗号，已补');
    }
    return arr;
  }

  let value = parseValue();
  // 多个顶层值 → 合并为数组
  const rest = [];
  while (p < tokens.length) {
    const tok = peek();
    if (tok.t === ',' ) { next(); continue; }
    if (tok.t === '}' || tok.t === ']') { issue(tok.pos, '移除多余的闭合符号'); next(); continue; }
    rest.push(parseValue());
  }
  if (rest.length) {
    issue((tokens[p - rest.length] || { pos: 0 }).pos, '检测到多个顶层值，已合并为数组');
    value = [value, ...rest];
  }

  /* ---------------- 结果 ---------------- */
  const fixed = JSON.stringify(value, null, 2);
  let ok = false;
  try { JSON.parse(fixed); ok = true; } catch (_) {}
  return { ok, fixed, issues };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { repairJson };
else global.repairJson = repairJson;

})(typeof window !== 'undefined' ? window : globalThis);
