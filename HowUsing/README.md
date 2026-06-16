# PTA MCP 使用指南

本项目用 **4 个核心文件** 实现基于浏览器自动化的 PTA（拼题 A）题目答题。

---

## 1. 项目结构

```
ptaText/
├── .trae/
│   └── skills/
│       └── pta-coding/
│           └── SKILL.md           ← AI 操作说明书（必读）
├── integrated-browser-mcp/
│   ├── package.json               ← 依赖声明
│   └── src/
│       ├── index.ts               ← 9 个 MCP 工具的全部实现
│       └── browser-manager.ts     ← Playwright 浏览器管理器
```

### 4 个核心文件说明

| 文件 | 作用 | 你需要理解它吗？ |
|------|------|----------------|
| `package.json` | 声明 `@modelcontextprotocol/sdk` 和 `playwright` 两个关键依赖 | 不用（除非你要加新依赖） |
| `src/index.ts` | 9 个 `browser_*` 工具的 TypeScript 源码 | 不用（AI 调用工具时不需要看这个） |
| `src/browser-manager.ts` | Playwright 浏览器实例的单例管理 | 不用 |
| `SKILL.md` | **重要！** 指导 AI 如何正确操作 PTA（从登录到提交的全部流程） | ✅ 建议浏览，理解操作逻辑 |

---

## 2. 快速开始（3 步跑起来）

### Step 1：安装依赖

进入 `integrated-browser-mcp` 目录，执行：

```bash
cd integrated-browser-mcp
npm install
npx playwright install chromium
npm run build
```

完成后会生成：
- `node_modules/`（依赖库）
- `dist/index.js`（编译后的 MCP 服务器）

### Step 2：在 Trae 中注册 MCP Server

打开 Trae 的 **MCP 配置文件**（通常在 Trae 设置 → MCP Servers 中），添加：

```json
{
  "mcpServers": {
    "integrated_browser": {
      "command": "node",
      "args": [
        "D:\\traeSOLO\\text\\all\\ptaText\\integrated-browser-mcp\\dist\\index.js"
      ]
    }
  }
}
```

保存后重启 Trae，AI 即可获得以下 9 个工具：

- `browser_lock` / `browser_unlock` — 锁定/解锁浏览器
- `browser_navigate` — 打开网址
- `browser_snapshot` — 读取当前页面内容
- `browser_click` — 点击元素
- `browser_type` — 输入文本
- `browser_scroll` — 滚动页面
- `browser_evaluate` — 在页面执行 JavaScript（最灵活的兜底工具）
- `browser_wait_for` — 等待（等弹窗、等页面加载）

### Step 3：告诉 AI "帮我做 PTA 题"

示例输入（直接对 Trae 说）：

```
请用 pta-coding skill 帮我打开并完成这个 PTA 题目：
https://pintia.cn/problem-sets/XXXXXX/exam/problems/type/6?problemSetProblemId=YYYYYYY
```

AI 会自动按 `SKILL.md` 中的操作流程完成：**打开页面 → 判断题目类型 → 写答案 → 提交 → 验证结果**。

---

## 3. 9 个 MCP 工具参考

你不需要主动调用它们（AI 会自己选），这里给出对照关系方便理解：

| 工具 | 接收参数 | 典型使用场景 |
|------|---------|-------------|
| `browser_lock` | 无 | 操作前锁定，避免冲突 |
| `browser_unlock` | 无 | 操作结束后解锁 |
| `browser_navigate` | `{ "url": "..." }` | 打开 PTA 题目页面 |
| `browser_snapshot` | 无 | 读取题目描述、找按钮的 ref 编号 |
| `browser_click` | `{ "ref": 5 }` | 点"提交本题作答"等按钮 |
| `browser_type` | `{ "ref": 12, "text": "...", "clear": true }` | 输入代码或答案 |
| `browser_scroll` | `{ "ref": 8 }` | 把元素滚进视口再点 |
| `browser_evaluate` | `{ "script": "document.cookie = ..." }` | 写 cookie、处理被遮挡的点击、操作复杂 DOM |
| `browser_wait_for` | `{ "time": 3 }` | 提交后等 3 秒让服务器处理 |

---

## 4. 操作流程总览（AI 自动执行，供你理解）

```
browser_lock
  ↓
browser_navigate("题目 URL")
  ↓
browser_snapshot  →  读到题目内容，判断是编程题/选择题/判断题/填空题
  ↓
（按题型分支处理）
  ├── 编程题：browser_evaluate 清空编辑框 → browser_type 输入代码 → browser_click 点提交
  ├── 选择题：browser_evaluate 选中正确选项 → browser_click 点保存
  ├── 判断题：同上
  └── 填空题：browser_evaluate 设置 input.value + 触发 input 事件 → browser_click 点保存
  ↓
browser_wait_for(3 秒)
  ↓
browser_snapshot  →  检查结果（正确 / 编译错误 / 答案错误）
  ↓
browser_unlock
```

---

## 5. 常见问题

### Q1：提示 "找不到 browser_navigate 工具"
A：Trae 的 MCP 配置没生效。检查 Step 2 的 JSON 路径是否正确指向 `dist/index.js`，确保已经执行过 `npm run build`。

### Q2：浏览器打开了但页面空白
A：PTA 部分页面需要登录。如果没有 cookie，可能会跳转到登录页或显示空内容。此时需要用户先手动登录一次 PTA，或通过 `browser_evaluate` 设置 cookie。

### Q3：提交答案后一直"排队中"
A：正常现象。服务器评测需要时间。AI 会自动 `browser_wait_for` + `browser_snapshot` 循环等待结果。

### Q4：代码提交报"编译错误"
A：常见原因是编辑框没清空干净（PTA 用 ProseMirror 富文本编辑器）。AI 会用 `browser_evaluate` 执行 `execCommand('selectAll') + execCommand('delete')` 重新清空后再输入。

### Q5：点击按钮没反应
A：可能被顶部导航栏遮挡。AI 会自动降级为 `browser_evaluate` 通过 JS 直接触发点击，绕过遮挡。

### Q6：需要新功能时要加新文件吗？
A：**不用新文件。** 9 个基础工具已经足够灵活。只要告诉 AI 新的目标（比如"帮我批量做 5 道编程题"），AI 会自己组合现有工具完成。只有当你需要添加一个全新的"原子工具"（如截图、文件上传）时，才需要修改 `src/index.ts`。

---

## 6. 下一步你可以做的

- **直接开始用**：告诉 AI 一个具体的 PTA 题目链接
- **浏览 `SKILL.md`**：了解 AI 内部执行的详细步骤和兜底策略
- **修改 `src/index.ts`**（仅当需要）：比如增加截图功能、支持多标签页 — 但现阶段不需要
