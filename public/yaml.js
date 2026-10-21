'use strict';
/**
 * YAML 子集引擎（纯函数，可在 Node 单测）——零依赖，与 repair.js/difftext.js 同风格。
 *
 * parseYaml(text) -> JS 值；失败抛 YamlError { message, line, col }（line 为 1 基）。
 * stringifyYaml(value, indent) -> YAML 文本（块风格，可被 parseYaml 无损读回）。
 *
 * 支持的子集（覆盖日常配置写法，且兼容 JSON——JSON 是 YAML 的子集，含多行美化 JSON）：
 *   映射 key: value / 嵌套块 / 序列 - item / 序列内联映射 - k: v（含 k 下序列）
 *   单引号、双引号（\n \t \uXXXX 等转义）、行注释 #
 *   块标量 | |- |+ > >- >+（缩进剥离与 chomping）
 *   流式写法 {a: 1, b: [1, 2]}（可跨行）、空值 null/~、整数/十六进制 0x/八进制 0o/浮点/布尔
 * 明确不支持并给出中文报错：锚点与别名 & *、tag !!、多文档 ---、制表符缩进、多行裸字符串折叠。
 * 取舍：yes/no/on/off 一律按字符串（与 YAML 1.2 core 一致，避免误转）；前导零数字按字符串（保护电话号/邮编）。
 */
(function (global) {

class YamlError extends Error {
  constructor(message, line, col) {
    super(message);
    this.name = 'YamlError';
    this.line = line || 1;
    this.col = col || 1;
  }
}

/* ---------------- 预处理 ---------------- */

// 去掉行尾注释（引号内的 # 不算；# 需位于行首或空白后）
function stripComment(s) {
  let out = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      out += c;
      if (q === '"' && c === '\\') { out += s[++i] ?? ''; continue; }
      if (c === q) { if (q === "'" && s[i + 1] === "'") { out += s[++i]; continue; } q = null; }
      continue;
    }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) break;
    out += c;
  }
  return out;
}

function preprocess(text) {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  return rawLines.map((raw, idx) => {
    const no = idx + 1;
    const trimmedEnd = raw.replace(/\s+$/, '');
    const wsLead = /^\s*/.exec(trimmedEnd)[0];
    if (wsLead.includes('\t')) {
      throw new YamlError('不允许使用制表符缩进', no, wsLead.length);
    }
    const indent = wsLead.length;
    const content = stripComment(trimmedEnd.slice(indent)).replace(/\s+$/, '');
    return { no, raw, indent, content, blank: content === '' };
  });
}

/* ---------------- 标量 ---------------- */

const BOOL_WORDS = new Set(['true', 'True', 'TRUE', 'false', 'False', 'FALSE']);

function inferScalar(s) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (BOOL_WORDS.has(s)) return s === 'true' || s === 'True' || s === 'TRUE';
  if (/^[-+]?\d+$/.test(s)) {
    if (/^[-+]?0\d/.test(s)) return s; // 前导零按字符串，保护电话号/邮编
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  if (/^0x[0-9a-fA-F]+$/.test(s)) return Number(s);
  if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
  if (/^[-+]?\d*\.\d+([eE][-+]?\d+)?$/.test(s) || /^[-+]?\d+\.\d*([eE][-+]?\d+)$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  if (/^[-+]?\d+[eE][-+]?\d+$/.test(s)) return Number(s);
  return s;
}

function unquote(s, line, col) {
  const q = s[0];
  if (q === "'") {
    if (s.length < 2 || s.at(-1) !== "'") throw new YamlError('单引号未闭合', line, col);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (q === '"') {
    if (s.length < 2 || s.at(-1) !== '"') throw new YamlError('双引号未闭合', line, col);
    let out = '';
    const body = s.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== '\\') { out += c; continue; }
      const e = body[++i];
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0', b: '\b', f: '\f' };
      if (e === 'u') { out += String.fromCharCode(parseInt(body.substr(i + 1, 4), 16)); i += 4; }
      else if (e === 'x') { out += String.fromCharCode(parseInt(body.substr(i + 1, 2), 16)); i += 2; }
      else if (e in map) out += map[e];
      else throw new YamlError(`未知转义 \\${e}`, line, col);
    }
    return out;
  }
  return null; // 非引号标量
}

/* ---------------- 流式值（{} [] 与内联标量，可跨行） ---------------- */

// 从 start 行内容起，若括号未配平则向下拼续行（跳过空行）；consumed 为额外吃掉的行数
function gatherFlow(lines, i, first) {
  let text = first;
  let used = 0;
  const balanced = (t) => {
    let depth = 0, q = null;
    for (let k = 0; k < t.length; k++) {
      const c = t[k];
      if (q) {
        if (q === '"' && c === '\\') { k++; continue; }
        if (c === q) { if (q === "'" && t[k + 1] === "'") { k++; continue; } q = null; }
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '{' || c === '[') depth++;
      if (c === '}' || c === ']') depth--;
    }
    return depth <= 0 && !q;
  };
  while (!balanced(text)) {
    let j = i + used;
    while (j < lines.length && lines[j].blank) j++;
    if (j >= lines.length) break;
    text += ' ' + lines[j].content;
    used = j - i + 1;
  }
  return { text, consumed: used };
}

function parseFlow(s, lineNo, colBase) {
  let pos = 0;
  function ws() { while (pos < s.length && /\s/.test(s[pos])) pos++; }
  function parseNode() {
    ws();
    const c = s[pos];
    if (c === '{' || c === '[') return parseCollection();
    return parseScalar();
  }
  function parseCollection() {
    const open = s[pos];
    const isMap = open === '{';
    const close = isMap ? '}' : ']';
    pos++;
    const value = isMap ? {} : [];
    ws();
    if (s[pos] === close) { pos++; return value; }
    for (;;) {
      ws();
      if (isMap) {
        const key = parseKeyToken();
        ws();
        if (s[pos] !== ':') throw new YamlError('流式映射缺少 ":"', lineNo, pos + 1);
        pos++;
        ws();
        value[key] = (s[pos] === ',' || s[pos] === close) ? null : parseNode();
      } else {
        value.push(parseNode());
      }
      ws();
      if (s[pos] === ',') { pos++; continue; }
      if (s[pos] === close) { pos++; break; }
      throw new YamlError(`流式结构缺少 "${close}"`, lineNo, pos + 1);
    }
    return value;
  }
  function readQuoted() {
    const q = s[pos];
    let out = '';
    pos++;
    while (pos < s.length) {
      const c = s[pos];
      if (q === "'" && c === "'" && s[pos + 1] === "'") { out += "'"; pos += 2; continue; }
      if (q === '"' && c === '\\') { out += c + (s[pos + 1] ?? ''); pos += 2; continue; }
      if (c === q) { pos++; return unquote(q + out + q, lineNo, pos) ?? out; }
      out += c;
      pos++;
    }
    throw new YamlError('引号未闭合', lineNo, pos);
  }
  function parseKeyToken() {
    ws();
    const c = s[pos];
    if (c === '"' || c === "'") return readQuoted();
    let out = '';
    while (pos < s.length && !':,}]'.includes(s[pos])) out += s[pos++];
    out = out.replace(/\s+$/, '');
    if (!out) throw new YamlError('流式结构出现空键', lineNo, pos + 1);
    return out;
  }
  function parseScalar() {
    if (s[pos] === '"' || s[pos] === "'") return readQuoted();
    let out = '';
    while (pos < s.length && !',}]'.includes(s[pos])) out += s[pos++];
    out = out.replace(/\s+$/, '');
    if (/:\s|\:$/.test(out)) throw new YamlError('流式结构中裸 ":" 需将键值放入 {} 中', lineNo, pos);
    return inferScalar(out);
  }
  const v = parseNode();
  ws();
  if (pos < s.length) throw new YamlError('流式结构后有多余内容', lineNo, pos + 1);
  return v;
}

/* ---------------- 块结构 ---------------- */

// 找 "key:" 分隔点：冒号后须跟空格或行尾，且不在引号/括号内。返回 -1 表示不是映射行
function findKeySep(content) {
  let q = null, depth = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) { if (q === "'" && content[i + 1] === "'") { i++; continue; } q = null; }
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '{' || c === '[') { depth++; continue; }
    if (c === '}' || c === ']') { depth--; continue; }
    if (depth === 0 && c === '#' && /\s/.test(content[i - 1] ?? ' ')) break;
    if (c === ':' && depth === 0 && (i + 1 === content.length || content[i + 1] === ' ')) return i;
  }
  return -1;
}

class BlockParser {
  constructor(lines) { this.L = lines; this.i = 0; }

  skipBlank() { while (this.i < this.L.length && this.L[this.i].blank) this.i++; }

  peek() { this.skipBlank(); return this.L[this.i] ?? null; }

  parseDocument() {
    let line = this.peek();
    if (!line) return null;
    if (line.content === '---') { this.i++; line = this.peek(); }
    if (!line) return null;
    if (/^---|^%\S/.test(line.content)) throw new YamlError('不支持多文档或指令行（--- / %TAG）', line.no, 1);
    const value = this.parseNode(line.indent);
    const rest = this.peek();
    if (rest && rest.content !== '...') {
      if (rest.content === '---') throw new YamlError('不支持多文档（检测到第二个 "---"）', rest.no, 1);
      throw new YamlError('文档结束后有多余内容', rest.no, rest.indent + 1);
    }
    return value;
  }

  parseNode(ind) {
    const line = this.peek();
    if (!line || line.indent < ind) return null;
    if (line.content === '-' || line.content.startsWith('- ')) return this.parseSeq(line.indent);
    if (findKeySep(line.content) >= 0) return this.parseMap(line.indent);
    if (line.content === '...') return null;
    this.i++;
    return this.parseInlineValue(line.content, line);
  }

  parseMap(ind) {
    const map = {};
    for (;;) {
      const line = this.peek();
      if (!line) break;
      if (line.indent !== ind) {
        if (line.indent > ind && findKeySep(line.content) >= 0) {
          throw new YamlError('缩进不符合上下文（键的缩进跳级了）', line.no, line.indent + 1);
        }
        break;
      }
      if (line.content === '---' || line.content === '...') break;
      const sep = findKeySep(line.content);
      if (sep < 0) throw new YamlError(`无法解析的行（期望 "键:" 或 "- 项"）：${line.content.slice(0, 30)}`, line.no, line.indent + 1);
      this.i++;
      const keyRaw = line.content.slice(0, sep).trim();
      map[this.toKey(keyRaw, line)] = this.parseEntryValue(line.content.slice(sep + 1).trim(), line, ind);
    }
    return map;
  }

  toKey(keyRaw, line) {
    const q = unquote(keyRaw, line.no, line.indent + 1);
    if (q !== null) return q;
    if (/^\s*$/.test(keyRaw)) throw new YamlError('键为空', line.no, line.indent + 1);
    return keyRaw; // 键一律按字符串
  }

  // 冒号后的剩余文本 -> 值（空则看下一块；块标量头；流式/标量）
  parseEntryValue(rest, line, ownInd) {
    if (rest === '') {
      const next = this.peek();
      if (next && next.indent > ownInd) return this.parseNode(next.indent);
      if (next && next.indent === ownInd && (next.content === '-' || next.content.startsWith('- '))) {
        return this.parseSeq(ownInd); // key 下与 key 同缩进的序列
      }
      return null;
    }
    const bm = /^([|>])([-+]?)(\d*)$/.exec(rest);
    if (bm) return this.parseBlockScalar(bm[1], bm[2], bm[3], line, ownInd);
    return this.parseInlineValue(rest, line);
  }

  parseInlineValue(rest, line) {
    if (/^&\S+/.test(rest) || /^\*\S+$/.test(rest)) throw new YamlError('不支持锚点/别名（& 与 *）', line.no, line.indent + 1);
    if (/^!/.test(rest)) throw new YamlError('不支持 tag（! 类型标记）', line.no, line.indent + 1);
    if (rest[0] === '{' || rest[0] === '[') {
      const { text, consumed } = gatherFlow(this.L, this.i, rest);
      this.i += consumed;
      return parseFlow(text, line.no, line.indent + 1);
    }
    const q = unquote(rest, line.no, line.indent + 1);
    if (q !== null) return q;
    if (/^---/.test(rest) || /^\.\.\./.test(rest)) throw new YamlError('不支持多文档（--- / ...）', line.no, line.indent + 1);
    return inferScalar(rest);
  }

  parseSeq(ind) {
    const arr = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== ind) break;
      if (!(line.content === '-' || line.content.startsWith('- '))) break;
      const rest = line.content === '-' ? '' : line.content.slice(2).trimStart();
      const col = line.indent + (line.content.length - rest.length);
      if (rest === '') {
        this.i++;
        const next = this.peek();
        arr.push(next && next.indent > ind ? this.parseNode(next.indent) : null);
        continue;
      }
      if (findKeySep(rest) >= 0 && !/^[{|["'].*[}|"']$/.test(rest)) {
        // "- key: v" 序列内联映射：把当前行改写为普通映射行（列 = 内容列），交 parseMap 顺带吃后续同列行
        line.indent = col;
        line.content = rest;
        arr.push(this.parseMap(col));
        continue;
      }
      this.i++;
      arr.push(this.parseInlineValue(rest, line));
    }
    return arr;
  }

  parseBlockScalar(style, chomp, explicitIndent, headerLine) {
    const base = headerLine.indent;
    const collected = [];
    let blockIndent = explicitIndent ? base + Number(explicitIndent) : null;
    while (this.i < this.L.length) {
      const l = this.L[this.i];
      const isEmpty = l.raw.trim() === '';
      if (isEmpty) { collected.push(''); this.i++; continue; }
      const ind = /^ */.exec(l.raw)[0].length;
      if (ind <= base) break;
      if (blockIndent === null) blockIndent = ind;
      if (ind < blockIndent) throw new YamlError('块标量缩进不一致', l.no, ind + 1);
      collected.push(l.raw.slice(blockIndent));
      this.i++;
    }
    let end = collected.length;
    while (end > 0 && collected[end - 1] === '') end--;
    const bodyLines = collected.slice(0, end);
    const trailingBlanks = collected.length - end;
    let body;
    if (style === '|') {
      body = bodyLines.join('\n');
    } else {
      body = '';
      for (let k = 0; k < bodyLines.length; k++) {
        if (k === 0) body = bodyLines[k];
        else if (bodyLines[k] === '') body += '\n'; // 空行：一个换行（连续空行各算一个）
        else if (bodyLines[k - 1] === '') body += bodyLines[k]; // 空行后接内容不再补换行
        else body += ' ' + bodyLines[k];
      }
    }
    if (chomp === '+') body = bodyLines.length ? body + '\n'.repeat(1 + trailingBlanks) : '';
    else if (chomp === '-') { /* strip：无尾换行 */ }
    else body = bodyLines.length ? body + '\n' : ''; // clip
    return body;
  }
}

function parseYaml(text) {
  if (typeof text !== 'string') throw new YamlError('输入必须是文本');
  return new BlockParser(preprocess(text)).parseDocument();
}

/* ---------------- 序列化 JS 值 -> YAML ---------------- */

const RESERVED_WORDS = new Set(['null', 'Null', 'NULL', '~', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE']);

function needsQuote(s) {
  if (s === '' || /^\s|\s$/.test(s)) return true;
  if (/[\t\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return true;
  if (RESERVED_WORDS.has(s)) return true;
  if (/^[-+]?\d/.test(s)) return true; // 会被推断为数字（含前导零、+7、1e5）
  if (/^[-?:,.[\]{}#&*!|>%@`]/.test(s)) return true; // 指示符开头（"-" 后接空格或单独，保守起见 - 开头全引）
  if (s.includes(': ') || s.endsWith(':') || s.includes(' #')) return true;
  if (/^-[^\s]/.test(s) && /:/.test(s)) return true;
  return false;
}

function quoteString(s) {
  if (!/[\n\r"\\\u0000-\u001f]/.test(s) && !s.includes("'")) return `'${s.replace(/'/g, "''")}'`;
  return JSON.stringify(s);
}

function scalarToYaml(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : (Number.isNaN(v) ? '.nan' : (v > 0 ? '.inf' : '-.inf'));
  if (typeof v === 'string') return needsQuote(v) ? quoteString(v) : v;
  return quoteString(String(v));
}

function keyToYaml(k) {
  return needsQuote(k) || k.includes(':') ? quoteString(k) : k;
}

function stringifyYaml(value, indentSize = 2) {
  const pad = (n) => ' '.repeat(n);

  function isPlain(v) { return v === null || typeof v !== 'object'; }

  function emitContainer(v, ind, lines) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== null && typeof item === 'object') {
          const sub = [];
          emitContainer(item, ind + 2, sub);
          sub[0] = pad(ind) + '- ' + sub[0].slice(ind + 2);
          for (let k = 1; k < sub.length; k++) sub[k] = pad(ind) + '  ' + sub[k].slice(ind + 2);
          lines.push(...sub);
        } else {
          lines.push(pad(ind) + '- ' + scalarToYaml(item));
        }
      }
      return;
    }
    const keys = Object.keys(v);
    for (const k of keys) {
      const child = v[k];
      if (isPlain(child)) {
        lines.push(pad(ind) + keyToYaml(k) + ': ' + inlineScalarOrEmpty(child));
      } else if (Array.isArray(child)) {
        if (!child.length) { lines.push(pad(ind) + keyToYaml(k) + ': []'); continue; }
        lines.push(pad(ind) + keyToYaml(k) + ':');
        emitContainer(child, ind, lines); // 序列与 key 同缩进（常见风格，解析端支持）
      } else {
        if (!Object.keys(child).length) { lines.push(pad(ind) + keyToYaml(k) + ': {}'); continue; }
        lines.push(pad(ind) + keyToYaml(k) + ':');
        emitContainer(child, ind + indentSize, lines);
      }
    }
  }

  function inlineScalarOrEmpty(child) {
    const s = scalarToYaml(child);
    if (typeof child === 'string' && child.includes('\n') && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(child)) {
      return s; // 含换行的字符串仍走引号形式（块标量在 map 单行拼接场景不适用）
    }
    return s;
  }

  if (isPlain(value)) return scalarToYaml(value) + '\n';
  const lines = [];
  if (Array.isArray(value)) {
    if (!value.length) return '[]\n';
    emitContainer(value, 0, lines);
  } else {
    if (!Object.keys(value).length) return '{}\n';
    emitContainer(value, 0, lines);
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

const api = { parseYaml, stringifyYaml, YamlError };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.yamlKit = api;

})(typeof window !== 'undefined' ? window : globalThis);
