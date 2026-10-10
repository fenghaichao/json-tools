#!/usr/bin/env node
'use strict';
/**
 * JSON 工具本地服务：零依赖，node server.js 启动后浏览器访问 http://localhost:3000
 * 参数：--port=3000  --data=<数据目录>
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { AI } = require('./lib/ai');

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3) : null;
}

const PORT = Number(argValue('port') || process.env.PORT || 3000);
const DATA_DIR = path.resolve(argValue('data') || process.env.JSON_DATA || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');

const store = new Store(DATA_DIR);
const ai = new AI(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLong = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        tooLong = true;
        req.destroy();
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      if (tooLong) return;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (_) {
        const err = new Error('请求体不是合法 JSON');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/info' && req.method === 'GET') {
    return sendJson(res, 200, { dataDir: DATA_DIR });
  }

  if (p === '/api/ai/config' && req.method === 'GET') {
    return sendJson(res, 200, ai.masked());
  }
  if (p === '/api/ai/config' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, ai.save(body));
  }
  if (p === '/api/ai/analyze' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.input !== 'string' || !body.input.trim()) {
      return sendJson(res, 400, { error: '缺少待分析内容' });
    }
    return sendJson(res, 200, await ai.analyze(body.input, body.issues));
  }

  if (p === '/api/current' && req.method === 'GET') {
    return sendJson(res, 200, { ws: store.getCurrentWorkspace(), dataDir: DATA_DIR });
  }
  if (p === '/api/current' && req.method === 'POST') {
    const body = await readBody(req);
    if (!store.listWorkspaces().some((w) => w.name === body.ws)) {
      return sendJson(res, 400, { error: '工作区不存在' });
    }
    store.setState({ currentWorkspace: body.ws });
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/workspaces' && req.method === 'GET') {
    return sendJson(res, 200, store.listWorkspaces());
  }
  if (p === '/api/workspaces' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 201, store.createWorkspace(body.name));
  }
  if (p === '/api/workspaces/rename' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, store.renameWorkspace(body.oldName, body.newName));
  }
  if (p === '/api/workspaces/delete' && req.method === 'POST') {
    const body = await readBody(req);
    store.deleteWorkspace(body.name);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/history' && req.method === 'GET') {
    return sendJson(res, 200, store.readHistory(q.get('ws') || '默认'));
  }
  if (p === '/api/history' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.input !== 'string' || body.input.length === 0) {
      return sendJson(res, 400, { error: '缺少 input' });
    }
    if (body.input.length > 4 * 1024 * 1024) {
      return sendJson(res, 400, { error: '内容过大（限 4MB）' });
    }
    return sendJson(res, 201, store.addHistory(q.get('ws') || '默认', body.input));
  }
  if (p === '/api/history/delete' && req.method === 'POST') {
    const body = await readBody(req);
    store.deleteHistory(q.get('ws') || '默认', body.id);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/history/clear' && req.method === 'POST') {
    store.clearHistory(q.get('ws') || '默认');
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: '接口不存在' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    Promise.resolve()
      .then(() => handleApi(req, res, url))
      .catch((err) => sendJson(res, err.status || 500, { error: err.message }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请用 --port=其他端口 指定，或关闭占用程序。`);
  } else {
    console.error('服务启动失败：', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`JSON 工具已启动：http://localhost:${PORT}`);
  console.log(`数据目录：${DATA_DIR}`);
});
