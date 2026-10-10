'use strict';
/**
 * AI 分析：OpenAI 兼容 chat/completions 代理。
 * 配置保存在 data/ai-config.json（服务端文件，密钥不返回前端明文）。
 */
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT = [
  '你是 JSON 修复与诊断专家。用户会给出一段解析失败的文本和一份规则引擎的诊断报告。',
  '请：1) 用中文简要解释根本原因（不超过 200 字）；2) 尽力推断原始意图并给出修复后的合法 JSON。',
  '严格只输出一个 JSON 对象（不要 Markdown 代码块、不要多余文字），格式：',
  '{"explanation": "错误原因说明", "fixedJson": "修复后的完整JSON字符串；确实无法修复则为 null"}',
].join('\n');

class AI {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'ai-config.json');
  }

  load() {
    try {
      const cfg = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { enabled: !!cfg.enabled, preset: cfg.preset || 'custom', baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey || '', model: cfg.model || '' };
    } catch (_) {
      return { enabled: false, preset: 'deepseek', baseUrl: '', apiKey: '', model: '' };
    }
  }

  save(patch) {
    const cur = this.load();
    const next = { ...cur };
    for (const k of ['enabled', 'preset', 'baseUrl', 'apiKey', 'model']) {
      if (patch[k] !== undefined) next[k] = patch[k];
    }
    if (patch.baseUrl !== undefined) {
      if (next.baseUrl && !/^https?:\/\//i.test(next.baseUrl)) {
        const err = new Error('base URL 必须以 http(s):// 开头');
        err.status = 400;
        throw err;
      }
    }
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8');
    return this.masked(next);
  }

  masked(cfg) {
    const c = cfg || this.load();
    const key = c.apiKey || '';
    return {
      enabled: c.enabled,
      preset: c.preset,
      baseUrl: c.baseUrl,
      model: c.model,
      hasKey: !!key,
      keyHint: key ? '****' + key.slice(-4) : '',
    };
  }

  /** 调用 AI 分析。input 为坏 JSON 原文，issues 为规则诊断列表 */
  async analyze(input, issues) {
    const cfg = this.load();
    if (!cfg.enabled) {
      const err = new Error('AI 分析未启用，请先在「AI 配置」中开启');
      err.status = 400;
      throw err;
    }
    if (!cfg.baseUrl || !cfg.model) {
      const err = new Error('AI 配置不完整（需要 base URL 与模型名）');
      err.status = 400;
      throw err;
    }
    if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
      const err = new Error('未配置 API Key（本地 Ollama 可留空）');
      err.status = 400;
      throw err;
    }

    const clipped = input.length > 60000 ? input.slice(0, 60000) + '\n……（已截断）' : input;
    const diagText = (issues || []).slice(0, 30)
      .map((x) => `第${x.line}行第${x.col}列：${x.message}`).join('\n') || '（无）';
    const userMsg = `解析失败的文本：\n"""\n${clipped}\n"""\n\n规则引擎诊断：\n${diagText}`;

    const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
        }),
      });
    } catch (e) {
      const reason = e?.cause?.cause?.message || e?.cause?.message || e.message;
      const err = new Error(e.name === 'AbortError' ? 'AI 服务响应超时（90 秒）' : `无法连接 AI 服务：${reason}`);
      err.status = 502;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`AI 服务返回 ${res.status}：${body.slice(0, 300)}`);
      err.status = 502;
      throw err;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error('AI 服务返回内容为空');
      err.status = 502;
      throw err;
    }
    return this.parseReply(content);
  }

  /** 从模型回复中提取 {explanation, fixedJson}，容忍代码围栏与直接返回 JSON 的情况 */
  parseReply(content) {
    let text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const tryParse = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };

    let obj = tryParse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || (!('fixedJson' in obj) && !('explanation' in obj))) {
      const a = text.indexOf('{');
      const b = text.lastIndexOf('}');
      if (a !== -1 && b > a) obj = tryParse(text.slice(a, b + 1)) || obj;
    }

    let explanation = null, fixedRaw = null;
    if (obj && typeof obj === 'object' && ('fixedJson' in obj || 'explanation' in obj)) {
      explanation = typeof obj.explanation === 'string' ? obj.explanation : null;
      fixedRaw = obj.fixedJson;
    } else {
      // 模型可能直接返回了修复后的 JSON 本体
      fixedRaw = text;
    }
    if (typeof fixedRaw !== 'string' && fixedRaw !== null && fixedRaw !== undefined) {
      fixedRaw = JSON.stringify(fixedRaw);
    }
    let fixed = null;
    if (typeof fixedRaw === 'string' && fixedRaw.trim()) {
      const parsed = tryParse(fixedRaw);
      if (parsed !== null) fixed = JSON.stringify(parsed, null, 2);
    }
    return { explanation: explanation || (fixed ? '模型返回了修复后的 JSON。' : '模型未能给出可解析的修复结果。'), fixedJson: fixed };
  }
}

module.exports = { AI };
