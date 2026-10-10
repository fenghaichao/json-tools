'use strict';
/**
 * 文件存储：每个工作区是 dataDir/workspaces/<name>/ 文件夹，
 * 历史记录保存在该文件夹下的 history.json 中。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_HISTORY = 100;
// 工作区名：中文/字母/数字/下划线/连字符/空格，首字符非空格，最长 32
const NAME_RE = /^[一-龥\w][一-龥\w\- ]{0,31}$/;

function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
    const err = new Error('工作区名称不合法（仅限中文/字母/数字/_/-/空格，1-32 字符）');
    err.status = 400;
    throw err;
  }
  return name.trim();
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.workspacesDir = path.join(dataDir, 'workspaces');
    fs.mkdirSync(this.workspacesDir, { recursive: true });
    if (this.listWorkspaces().length === 0) {
      this.createWorkspace('默认');
    }
  }

  getState() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dataDir, 'state.json'), 'utf8'));
    } catch (_) {
      return {};
    }
  }

  setState(patch) {
    const next = { ...this.getState(), ...patch };
    fs.writeFileSync(path.join(this.dataDir, 'state.json'), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  getCurrentWorkspace() {
    const cur = this.getState().currentWorkspace;
    const all = this.listWorkspaces();
    if (cur && all.some((w) => w.name === cur)) return cur;
    return all[0] ? all[0].name : '默认';
  }

  wsDir(name) {
    return path.join(this.workspacesDir, assertName(name));
  }

  listWorkspaces() {
    return fs
      .readdirSync(this.workspacesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        let count = 0;
        try {
          count = this.readHistory(d.name).length;
        } catch (_) {}
        return { name: d.name, historyCount: count };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  createWorkspace(name) {
    name = assertName(name);
    const dir = path.join(this.workspacesDir, name);
    if (fs.existsSync(dir)) {
      const err = new Error('工作区已存在');
      err.status = 409;
      throw err;
    }
    fs.mkdirSync(dir, { recursive: true });
    this.writeHistoryRaw(dir, []);
    return { name, historyCount: 0 };
  }

  renameWorkspace(oldName, newName) {
    oldName = assertName(oldName);
    newName = assertName(newName);
    const from = path.join(this.workspacesDir, oldName);
    const to = path.join(this.workspacesDir, newName);
    if (!fs.existsSync(from)) {
      const err = new Error('工作区不存在');
      err.status = 404;
      throw err;
    }
    if (fs.existsSync(to)) {
      const err = new Error('目标名称已存在');
      err.status = 409;
      throw err;
    }
    fs.renameSync(from, to);
    return { name: newName };
  }

  deleteWorkspace(name) {
    name = assertName(name);
    const dir = path.join(this.workspacesDir, name);
    if (!fs.existsSync(dir)) {
      const err = new Error('工作区不存在');
      err.status = 404;
      throw err;
    }
    const all = this.listWorkspaces();
    if (all.length <= 1) {
      const err = new Error('至少保留一个工作区');
      err.status = 400;
      throw err;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  readHistoryRaw(dir) {
    const file = path.join(dir, 'history.json');
    if (!fs.existsSync(file)) return [];
    try {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  writeHistoryRaw(dir, arr) {
    const file = path.join(dir, 'history.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  readHistory(name) {
    return this.readHistoryRaw(this.wsDir(name));
  }

  addHistory(name, input) {
    const dir = this.wsDir(name);
    const list = this.readHistoryRaw(dir);
    if (list.length > 0 && list[0].input === input) {
      return list[0]; // 与上一条相同则去重
    }
    const entry = {
      id: crypto.randomUUID(),
      input,
      createdAt: new Date().toISOString(),
    };
    list.unshift(entry);
    if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
    this.writeHistoryRaw(dir, list);
    return entry;
  }

  deleteHistory(name, id) {
    const dir = this.wsDir(name);
    const list = this.readHistoryRaw(dir);
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }
    this.writeHistoryRaw(dir, next);
  }

  clearHistory(name) {
    this.writeHistoryRaw(this.wsDir(name), []);
  }
}

module.exports = { Store };
