# JSON Tools — 本地 JSON 在线解析工具

一个**零依赖**的本地 JSON 工具箱，用 Node.js 自带模块实现。
启动后浏览器访问 `http://localhost:3000` 即可使用，所有数据保存在**本地文件**，不碰任何浏览器存储（无 localStorage / IndexedDB / Cookie）。

- ✍️ 输入即解析（200ms 防抖），实时语法高亮
- 🌳 树视图：可折叠/展开，键值层级一目了然
- 🧰 格式化、压缩、排序（按键升序/降序）、转 XML、显示行号、保留/去除转义、复制、下载、全屏
- 🔀 JSON 比对：输出区"比对"标签粘贴第二份 JSON，差异分 **键不一致**（某路径仅一侧存在）与 **数据不一致**（同路径值/类型不同）两组清单，带完整路径定位
- 🗂 工作区：不同文件夹隔离存放各自的 JSON 与历史
- 🕘 历史记录：自动保存到服务端文件（每工作区最多 100 条，可回滚、删除、清空）
- 🔍 精确错误诊断：坏 JSON 给出**行/列 + 上下文片段**定位，而不是干巴巴一句 SyntaxError
- 🔧 规则引擎自动修复：注释、单引号、中文引号、无引号键、True/False/None、多余尾逗号、缺逗号/冒号/闭合符、截断等 20+ 类常见错误，一键应用修复结果
- 🤖 可选 AI 分析：接入任意 OpenAI 兼容大模型（内置 DeepSeek / 通义 / Kimi / 智谱 / MiniMax / OpenAI / Ollama 预设），让模型解释错误并给出修复后的 JSON；API Key 只存在服务端本地文件，不下发给浏览器

---

## 安装方法

前提：安装 [Node.js](https://nodejs.org/) **18 或以上**（本项目零依赖，无需 `npm install`）。

### 方式一：下载压缩包（最简单）

1. 到 [Releases](https://github.com/fenghaichao/json-tools/releases) 下载 `json-tools-v1.0.0.zip`
2. 解压到任意目录
3. 在该目录执行：

   ```bash
   node server.js
   ```

4. 浏览器打开 <http://localhost:3000>

### 方式二：npm 全局安装

```bash
npm install -g cn-json-tools
json-tools
```

全局命令 `json-tools` 等价于 `node server.js`，同样打开 <http://localhost:3000>。

### 方式三：git clone

```bash
git clone https://github.com/fenghaichao/json-tools.git
cd json-tools
node server.js
```

---

## 启动参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--port=3000` | `3000` | 监听端口（也可用环境变量 `PORT`） |
| `--data=<目录>` | `./data` | 数据目录（也可用环境变量 `JSON_DATA`） |

```bash
# 例：换端口、把数据放到 D 盘
node server.js --port=8080 --data=D:/json-tools-data
```

服务只监听本机，数据不出机器（除非你主动使用 AI 分析，请求才会发往你配置的模型服务商）。

---

## 界面功能速览

| 功能区 | 说明 |
| --- | --- |
| 顶栏 | 工作区切换 / 新建 / 重命名 / 删除；⚙ AI 配置 |
| 左侧输入 | 粘贴 JSON 即时解析；出错时显示诊断面板（逐条行列定位 + 应用修复 + AI 分析） |
| 右侧输出 | 树视图 / 格式化 / 压缩 / XML / 比对 五个标签页 |
| 工具条 | 排序方式、缩进宽度、行号开关、保留/去除转义、折叠、保存、复制、下载、全屏 |
| 底部历史 | 当前工作区的自动历史（1.2s 防抖保存），点击即回填，可删除 |

### 错误诊断与自动修复

粘贴一段常见的手写"JSON"试试：

```text
{ name: '张三', age: 30, tags: [a, b,], /* 注释 */ ok: True }
```

诊断面板会逐行列出问题（无引号键、单引号、中文值、尾逗号、注释、`True` 应为 `true`……），点 **应用修复** 一键得到合法 JSON，误操作可 **撤销**。

### AI 分析（可选）

规则修复搞不定的复杂错误，可点 **AI 分析**：

1. 顶栏 **⚙ AI 配置**，选一个预设（DeepSeek / 通义 / Kimi / 智谱 / MiniMax / OpenAI / Ollama）或填自定义 OpenAI 兼容地址
2. 填入 API Key，点 **测试连接** 验证，保存
3. 回到诊断面板点 **AI 分析**，模型会给出错误解释和修复后的 JSON，可一键应用

> API Key 保存在本地 `data/ai-config.json`，仅由本机服务端使用；页面接口只会回显掩码（`****` + 后 4 位）。不使用 AI 功能则完全离线。

---

## 数据存哪里

全部在服务启动目录的 `data/`（可用 `--data=` 改位置），纯文本 JSON 文件，备份/迁移直接拷目录：

```text
data/
├── state.json                     # 当前工作区
├── ai-config.json                 # AI 配置（含 Key，注意不要外传）
└── workspaces/
    ├── 默认/history.json           # 每个工作区一个文件夹
    └── <工作区名>/history.json
```

## 项目结构

```text
json-tools/
├── server.js          # HTTP 服务 + API 路由（零依赖）
├── lib/
│   ├── store.js       # 工作区/历史的文件存储（原子写入）
│   └── ai.js          # OpenAI 兼容代理（超时控制、回复解析）
└── public/
    ├── index.html     # 单页界面
    ├── style.css      # 样式（含行号、全屏、诊断面板）
    ├── app.js         # 解析/树视图/高亮/历史/AI/比对 前端逻辑
    ├── repair.js      # 容错词法+语法分析的诊断与规则修复引擎
    └── diff.js        # JSON 差异比对引擎（键差异 + 数据差异）
```

服务端 API（供前端调用，也可自行集成）：

```text
GET  /api/info                       服务信息
GET  /api/current                    当前工作区
GET  /api/workspaces                 工作区列表
POST /api/workspaces                 新建工作区
POST /api/workspaces/rename|delete   重命名 / 删除
GET  /api/history?ws=                读取历史
POST /api/history?ws=                写入历史（自动去重）
POST /api/history/delete|clear?ws=   删除单条 / 清空
GET  /api/ai/config                  AI 配置（Key 掩码）
POST /api/ai/config                  保存 AI 配置（"测试连接"也走此接口）
POST /api/ai/analyze                 AI 分析修复
```

## 常见问题

**端口被占用？** `node server.js --port=8080` 换一个端口。

**工作区名有没有限制？** 中文/字母/数字/下划线/中划线/空格，1–32 位，不允许路径符号（防目录穿越）。

**历史记录会占很大空间吗？** 每个工作区最多保留最近 100 条，单条输入超过 4MB 会被服务端拒绝。

**能部署到公网给别人用吗？** 技术上可以，但历史与 AI Key 都存在服务器文件上且无鉴权，公网多用户场景请自行加反向代理认证，或仅作为个人工具使用。

## 许可证

[MIT](LICENSE)
