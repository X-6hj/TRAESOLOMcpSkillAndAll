---
name: "pta-coding"
description: "Automates PTA (pintia.cn) problem solving for all question types: programming, multiple choice, true/false, and fill-in-the-blank. Use when the user asks to solve/submit PTA problems, complete PTA exam questions, or fix PTA code submissions. Handles login, navigation, answer input, submission, result checking, and error fixing."
---

# PTA 题目自动完成

本 skill 用于自动化完成 PTA（pintia.cn）平台上**所有题型**（编程题、选择题、判断题、填空题），涵盖从登录到提交、从查结果到改错、从单题到批量完成的全流程。

---

## 目录

1. [适用场景与前置条件](#适用场景与前置条件)
2. [浏览器操作规范](#浏览器操作规范)
3. [附录 A：MCP 工具创建指南（当 integrated_browser 不可用时）](#附录-amcp-工具创建指南)
4. [阶段一：登录与导航（4 步）](#阶段一登录与导航)
5. [阶段二：判断题目类型（1 步）](#阶段二判断题目类型)
6. [阶段三：编程题（9 步 + 4 个结果分支）](#阶段三编程题)
7. [阶段四：选择题 & 判断题（4 步）](#阶段四选择题--判断题)
8. [阶段五：填空题（4 步）](#阶段五填空题)
9. [阶段六：批量完成所有题目](#阶段六批量完成所有题目)
10. [完整执行示例](#完整执行示例)
11. [常见问题与解决方案（7 问）](#常见问题与解决方案)
12. [关键原则总结（10 条）](#关键原则总结)

---

## 适用场景与前置条件

### 适用场景

- 用户要求登录 PTA 并完成指定题目集的题目
- 用户要求提交代码/答案并验证正确性
- 用户要求根据评测结果修改答案直到满分通过
- 用户只给了题目集名称、没有给 ID，需要你去 PTA 仪表盘页面查找

### 前置条件

- `integrated_browser` MCP 工具集可用（**如不可用，参见 [附录 A：MCP 工具创建指南](#附录-amcp-工具创建指南)**，按指导自行创建）
- 用户提供有效 PTA cookie（至少包含 `JSESSIONID` 和 `PTASession`；如有 `_bl_uid`、`_ga` 也一并设置）

---

## 浏览器操作规范

所有 PTA 操作均通过 `integrated_browser` MCP 工具完成。

### 锁-操作-解锁 模式

```
browser_lock  →  执行一系列操作  →  browser_unlock
```

**为什么这样设计**：PTA 操作是串行的，必须先做完一步再做下一步。锁定浏览器可以确保操作期间没有外部干扰（如用户手动点击），也能确保每次 snapshot 拿到的页面状态与上一次操作衔接一致。

**操作结束后务必解锁**：否则浏览器会一直处于锁定状态，其他操作无法进行。

### 工具清单

| 工具 | 用途 | 关键参数 | 使用频率 |
|------|------|----------|----------|
| `browser_lock` | 锁定浏览器，开始操作 | 无 | **每次操作序列开始** |
| `browser_unlock` | 解锁浏览器，结束操作 | 无 | **每次操作序列结束** |
| `browser_navigate` | 导航到指定 URL，等价于在地址栏输入网址回车 | `url`（完整 URL） | 切换页面时 |
| `browser_snapshot` | 获取页面当前状态的文本快照，列出所有可交互元素的 ref 编号 | 无 | **几乎每步前都要调用** |
| `browser_click` | 用鼠标点击 ref 对应的元素 | `ref`（从 snapshot 获取的数字编号） | 点击按钮、链接、选项 |
| `browser_type` | 在输入框/编辑器中输入文本，可先清空再输入 | `ref`, `text`, `clear: true` | 输入代码、填写答案 |
| `browser_scroll` | 滚动页面使指定 ref 的元素进入可视区域 | `ref`, `scrollIntoView: true` | 编辑框不在屏幕内时 |
| `browser_evaluate` | 在页面中执行 JavaScript 并返回结果 | `script`（完整 JS 代码字符串） | 读取数据、复杂 DOM 操作 |
| `browser_wait_for` | 等待指定秒数 | `time`（秒，通常是 2~8） | 提交后等服务器响应、弹窗出现 |

### 操作节奏原则

1. **snapshot 是眼睛**：每次操作前先 snapshot，拿到最新的 ref。页面变化（导航、弹窗出现/消失、题型切换）后之前的 ref 会失效，再用就会报错 `Element not found`
2. **操作后要等待**：点击提交/保存按钮后，服务器需要时间处理，用 `browser_wait_for` 等 3~8 秒后再 snapshot 看结果
3. **弹窗优先处理**：提交结果弹窗是模态的，必须先关闭（点"确认"）才能操作弹窗后面的页面元素
4. **同一 Browser View**：lock 后不要导航到与 PTA 无关的页面，所有操作都在同一个锁周期内完成
5. **snapshot 文本很长**：snapshot 会返回页面所有可见文本和可交互元素。读 snapshot 时重点关注：按钮文字、题目描述、选项文本、弹窗内容
6. **点击被拦截的兜底方案**：当 `browser_click` 报 `Click target intercepted`（目标被遮挡）时，说明目标元素上方有其他 DOM 层级（如顶部导航栏浮层、模态遮罩等）。此时应使用 `browser_evaluate` 直接通过 JS 执行点击，绕过遮挡。具体做法见下方"点击拦截兜底脚本"

### 点击拦截兜底脚本

当 `browser_click` 因目标被拦截而失败时，使用 `browser_evaluate` 通过内容匹配来点击元素：

**按文本匹配选中 radio / label**：

```js
// 遍历所有 radio 的父元素或 label，匹配文本后点击
var radios = document.querySelectorAll('input[type="radio"]');
for (var i = 0; i < radios.length; i++) {
    var parent = radios[i].parentElement;
    var txt = (parent ? (parent.innerText || parent.textContent || '') : '').trim();
    if (txt.indexOf('目标选项的关键文本') >= 0) {
        radios[i].click();
        return 'CLICKED at index: ' + i;
    }
}
return 'NOT FOUND';
```

**按文本匹配直接点击按钮**：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || btns[i].textContent || '').trim();
    if (txt === '目标按钮文字' || txt.indexOf('目标按钮文字') >= 0) {
        btns[i].click();
        return 'CLICKED: ' + txt;
    }
}
```

**要点**：
- `indexOf` 用于部分匹配，可匹配到 `"A. 3, 1, 5, 6, 13, 11"` 这类带选项编号的长文本
- 返回的 index 信息有助于确认是否点中了正确的元素
- 如果 `parentElement` 内文本不够精确，可以扩大选择器范围（如 `radios[i].closest('.option-item')`）

### 信息提取最佳实践

`browser_snapshot` 返回的文本量可能很大（几百行）。阅读时的优先级：

1. **先看按钮**：找"提交本题作答"、"保存"、"确认"、"刷新"、"下一题"等关键按钮及其 ref
2. **再看弹窗**：有弹窗时优先处理弹窗内容（状态、分数、错误信息）
3. **再看题目**：弹窗关闭后再看题目描述和选项
4. **忽略导航栏等无关内容**

---

## 附录 A：MCP 工具创建指南

> 当 `integrated_browser` MCP 工具集不可用时，需要自行创建。本节详细说明每个工具的设计思路和创建方法。

### A.1 整体设计思路

#### 为什么需要这些 MCP 工具

PTA 是一个传统的服务端渲染 + 前端 SPA 混合的 Web 应用。要自动化操作 PTA，需要：

1. **浏览器实例**：一个真实的浏览器环境来加载页面、执行 JS、处理 Cookie
2. **页面操控能力**：导航、点击、输入、滚动等用户行为模拟
3. **信息提取能力**：读取页面内容、执行 JS 获取 DOM 数据
4. **并发控制**：锁机制确保操作串行，防止状态冲突

#### 技术选型建议

| 层面 | 推荐方案 | 理由 |
|------|----------|------|
| **语言** | TypeScript | 静态类型、MCP SDK 支持好、AI 生成代码质量高 |
| **浏览器引擎** | Playwright | 相比 Puppeteer 支持更多浏览器、API 更现代、自动等待机制更好 |
| **传输协议** | Streamable HTTP | 远程部署方便，无状态设计更易维护 |
| **MCP 框架** | `@modelcontextprotocol/sdk` | 官方 TypeScript SDK |

#### 创建步骤总览

```
1. 用 mcp-builder skill 了解 MCP 创建规范
   ↓
2. 初始化 TypeScript 项目 + 安装依赖
   ↓
3. 创建浏览器管理模块（启动/关闭 Playwright 浏览器）
   ↓
4. 逐个实现 9 个工具（每个工具 = 一个 registerTool 调用）
   ↓
5. 编译 + 测试 + 部署
```

---

### A.2 核心组件：浏览器管理器

在实现各个工具之前，需要先创建一个**浏览器管理器**，负责 Playwright 浏览器实例的生命周期。

#### 创建思路

```
设计问题：多个工具之间如何共享同一个浏览器实例？
解决方案：单例模式 + 懒加载 —— 第一个工具调用时启动浏览器，后续工具复用同一实例。

设计问题：浏览器实例何时关闭？
解决方案：提供一个专门的 close 方法，由调用方在完成后主动关闭。
```

#### 核心代码骨架

```typescript
// browser-manager.ts
import { chromium, Browser, BrowserContext, Page } from 'playwright';

class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private locked: boolean = false;

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: false });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 }
      });
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  isLocked(): boolean { return this.locked; }
  lock(): void { this.locked = true; }
  unlock(): void { this.locked = false; }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}
```

---

### A.3 逐个工具设计

下面是 9 个工具的逐一设计，每个工具包含：**设计问题 → 解决方案 → 创建思路 → 核心代码**。

---

#### 工具 1：`browser_lock` — 锁定浏览器

| 项目 | 内容 |
|------|------|
| **设计问题** | 多个操作可能同时操作同一个浏览器页面，如何防止冲突？ |
| **解决方案** | 互斥锁（Mutex）——操作前 lock，操作后 unlock。同一时间只有一个持有者能操作浏览器 |
| **创建思路** | 在 BrowserManager 中维护一个 `locked` 布尔标记。lock 时检查：如果已锁定，返回错误提示"浏览器已被锁定，请先解锁"；如果未锁定，设 locked=true 并返回成功。unlock 时设 locked=false |

```typescript
server.registerTool(
  "browser_lock",
  {
    description: "锁定浏览器，获取独占操作权。在开始操作页面前必须先调用此工具",
    inputSchema: { type: "object", properties: {} }
  },
  async () => {
    const mgr = BrowserManager.getInstance();
    if (mgr.isLocked()) {
      return {
        content: [{ type: "text", text: "浏览器已被锁定，请先调用 browser_unlock 解锁" }],
        isError: true
      };
    }
    mgr.lock();
    return { content: [{ type: "text", text: "浏览器已锁定，可以开始操作" }] };
  }
);
```

---

#### 工具 2：`browser_unlock` — 解锁浏览器

| 项目 | 内容 |
|------|------|
| **设计问题** | 操作完成后如何释放控制权？ |
| **解决方案** | 与 lock 配对使用，设置 locked=false 释放锁 |
| **创建思路** | 直接设置 locked 标记为 false。不需要检查当前是否锁定（幂等操作，多次 unlock 不会出错） |

```typescript
server.registerTool(
  "browser_unlock",
  {
    description: "解锁浏览器，释放独占操作权。在所有操作完成后必须调用此工具",
    inputSchema: { type: "object", properties: {} }
  },
  async () => {
    BrowserManager.getInstance().unlock();
    return { content: [{ type: "text", text: "浏览器已解锁" }] };
  }
);
```

---

#### 工具 3：`browser_navigate` — 导航到 URL

| 项目 | 内容 |
|------|------|
| **设计问题** | 如何让浏览器加载一个指定 URL？ |
| **解决方案** | 调用 Playwright 的 `page.goto(url)`，等价于在地址栏输入网址回车 |
| **创建思路** | 拿到 Page 实例 → 调用 `page.goto(url, { waitUntil: 'networkidle' })` → 等待网络空闲（所有请求完成）→ 返回当前 URL 和页面标题。`waitUntil: 'networkidle'` 确保页面完全加载后再返回，避免后续操作在页面未就绪时执行 |

```typescript
server.registerTool(
  "browser_navigate",
  {
    description: "导航到指定的 URL。等价于在浏览器地址栏输入网址并回车",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要导航到的完整 URL，如 https://pintia.cn/problem-sets/dashboard" }
      },
      required: ["url"]
    }
  },
  async (args) => {
    const page = await BrowserManager.getInstance().getPage();
    await page.goto(args.url, { waitUntil: 'networkidle', timeout: 30000 });
    const title = await page.title();
    return {
      content: [{
        type: "text",
        text: `已导航到: ${page.url()}\n页面标题: ${title}`
      }]
    };
  }
);
```

**关键设计决策**：

- `waitUntil: 'networkidle'`：等待所有网络请求完成（而非仅 DOM 加载），确保 PTA 的异步数据（题目列表、用户信息）也已加载
- `timeout: 30000`：30 秒超时，PTA 在国内网络下可能较慢

---

#### 工具 4：`browser_snapshot` — 获取页面快照

| 项目 | 内容 |
|------|------|
| **设计问题** | 如何让 AI 看到当前页面的完整内容和可交互元素？ |
| **解决方案** | 用 Playwright 的 accessibility snapshot 功能，生成页面文本 + 可交互元素的 ref 映射 |
| **创建思路** | 这是最核心的工具。需要同时返回两样东西：(1) 页面所有可见文本（让 AI 理解页面内容），(2) 每个可交互元素（按钮、输入框、链接等）的 ref 编号（让 AI 能精确点击）。Playwright 的 `page.accessibility.snapshot()` 可以生成包含角色和名称的树结构，但需要自己遍历并分配 ref 编号 |

```typescript
server.registerTool(
  "browser_snapshot",
  {
    description: "获取当前页面的文本快照和所有可交互元素的 ref 编号。每次操作前必须调用此工具获取最新 ref",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  async () => {
    const page = await BrowserManager.getInstance().getPage();
    
    // 获取页面完整文本
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    // 获取可交互元素并分配 ref
    const elements = await page.evaluate(() => {
      const interactive = document.querySelectorAll(
        'button, a, input, textarea, select, [role="button"], [role="link"], ' +
        '[role="radio"], [role="checkbox"], [role="textbox"], [contenteditable="true"], ' +
        '[contenteditable="plaintext-only"], label, [tabindex]:not([tabindex="-1"])'
      );
      const refs: Array<{
        ref: number;
        tag: string;
        text: string;
        type: string;
        ariaLabel: string;
        placeholder: string;
      }> = [];
      interactive.forEach((el, i) => {
        const htmlEl = el as HTMLElement;
        // 给元素打上 data-ref 属性，后续 click/type 用
        htmlEl.setAttribute('data-ref', String(i));
        refs.push({
          ref: i,
          tag: htmlEl.tagName.toLowerCase(),
          text: (htmlEl.innerText || htmlEl.textContent || '').trim().substring(0, 100),
          type: htmlEl.getAttribute('type') || '',
          ariaLabel: htmlEl.getAttribute('aria-label') || '',
          placeholder: htmlEl.getAttribute('placeholder') || ''
        });
      });
      return refs;
    });
    
    // 构建输出
    let output = '';
    output += '=== 页面文本 ===\n';
    output += bodyText.substring(0, 8000);  // 限制长度
    output += '\n\n=== 可交互元素 (ref) ===\n';
    for (const el of elements) {
      output += `[ref=${el.ref}] <${el.tag}>`;
      if (el.type) output += ` type="${el.type}"`;
      if (el.placeholder) output += ` placeholder="${el.placeholder}"`;
      if (el.text) output += ` "${el.text}"`;
      output += '\n';
    }
    
    return { content: [{ type: "text", text: output }] };
  }
);
```

**关键设计决策**：

| 决策点 | 选择 | 为什么 |
|--------|------|--------|
| 用什么方式获取页面内容 | `document.body.innerText` | 获取所有可见文本，忽略 HTML 标签，最接近人眼看到的页面 |
| 可交互元素选择器 | 覆盖 button、a、input、textarea、select、contentEditable、radio 等 | PTA 使用了多种元素类型，需要全覆盖 |
| ref 编号方式 | 在 DOM 元素上打 `data-ref` 属性 | 后续 click/type 工具可以通过 `[data-ref="N"]` 选择器精准定位 |
| 文本长度限制 | 8000 字符 | 防止返回内容过长超过上下文窗口，同时也足够覆盖大部分页面 |

---

#### 工具 5：`browser_click` — 点击元素

| 项目 | 内容 |
|------|------|
| **设计问题** | 如何精准点击页面上某个元素（按钮、链接、选项等）？ |
| **解决方案** | 通过 snapshot 分配的 ref 编号，用 `[data-ref="N"]` 选择器定位元素，然后 Playwright 点击 |
| **创建思路** | 先从 snapshot 中获取 ref → 通过 `[data-ref="N"]` 找到元素 → 先 `scrollIntoView` 确保可见 → 再 `click`。如果找不到元素，返回明确的错误信息 |

```typescript
server.registerTool(
  "browser_click",
  {
    description: "点击指定 ref 编号的元素。ref 编号来自 browser_snapshot 返回的可交互元素列表",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "number", description: "从 browser_snapshot 返回的元素 ref 编号" }
      },
      required: ["ref"]
    }
  },
  async (args) => {
    const page = await BrowserManager.getInstance().getPage();
    try {
      const locator = page.locator(`[data-ref="${args.ref}"]`);
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: 5000 });
      return {
        content: [{
          type: "text",
          text: `已点击 ref=${args.ref} 的元素`
        }]
      };
    } catch (e: any) {
      return {
        content: [{
          type: "text",
          text: `点击失败: ${e.message}。请重新调用 browser_snapshot 获取最新 ref`
        }],
        isError: true
      };
    }
  }
);
```

**关键设计决策**：

| 决策点 | 选择 | 为什么 |
|--------|------|--------|
| 点击前自动滚动 | `scrollIntoViewIfNeeded()` | 如果元素不在屏幕内，Playwright 的 click 会失败，需要先滚动 |
| 点击超时 | 5 秒 | 给元素足够的渲染和动画时间 |
| 错误提示引导 | 提示"请重新 snapshot" | 最常见的失败原因是 ref 过期，直接告诉用户正确的恢复步骤 |

---

#### 工具 6：`browser_type` — 输入文本

| 项目 | 内容 |
|------|------|
| **设计问题** | 如何向输入框/编辑器中输入文本？ |
| **解决方案** | 通过 `data-ref` 定位元素，先可选的清空，再逐字符输入 |
| **创建思路** | 定位元素 → 如果 `clear=true`，先清空（click + selectAll + fill）→ 然后用 `page.keyboard.insertText(text)` 输入。注意：对于 contentEditable DIV，不能用 `fill()`，需要先 focus 再 `insertText` |

```typescript
server.registerTool(
  "browser_type",
  {
    description: "在指定 ref 的输入框或编辑器中输入文本。可先清空再输入",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "number", description: "从 browser_snapshot 返回的元素 ref 编号" },
        text: { type: "string", description: "要输入的文本内容" },
        clear: { type: "boolean", description: "是否先清空已有内容，默认 false" }
      },
      required: ["ref", "text"]
    }
  },
  async (args) => {
    const page = await BrowserManager.getInstance().getPage();
    const locator = page.locator(`[data-ref="${args.ref}"]`);
    await locator.scrollIntoViewIfNeeded();
    
    if (args.clear) {
      await locator.click();
      // 全选并删除
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
    }
    
    await locator.click();
    await page.keyboard.insertText(args.text);
    
    return {
      content: [{
        type: "text",
        text: `已向 ref=${args.ref} 输入 ${args.text.length} 个字符`
      }]
    };
  }
);
```

**关键设计决策**：

| 决策点 | 选择 | 为什么 |
|--------|------|--------|
| 输入方式 | `keyboard.insertText()` | 不是 `fill()`——`fill()` 直接设置 value，不触发 React/Vue 的事件监听，会导致框架不感知变化 |
| 清空方式 | `Ctrl+A` + `Delete` | 模拟用户的真实全选删除操作，能触发编辑器的事件 |
| 为什么不用 `fill()` | 不兼容 contentEditable | PTA 的代码编辑器是 contentEditable DIV，`fill()` 只对 input/textarea 有效 |

---

#### 工具 7：`browser_scroll` — 滚动页面

| 项目 | 内容 |
|------|------|
| **设计问题** | 当目标元素在页面底部不在屏幕内时，如何让它可见？ |
| **解决方案** | 用 Playwright 的 `scrollIntoViewIfNeeded` 自动滚动 |
| **创建思路** | 定位元素 → 滚动到可见 → 返回成功。这是一个简单但必要的辅助工具 |

```typescript
server.registerTool(
  "browser_scroll",
  {
    description: "滚动页面使指定 ref 的元素进入可视区域",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "number", description: "从 browser_snapshot 返回的元素 ref 编号" },
        scrollIntoView: { type: "boolean", description: "是否滚动到元素可见，默认 true" }
      },
      required: ["ref"]
    }
  },
  async (args) => {
    const page = await BrowserManager.getInstance().getPage();
    const locator = page.locator(`[data-ref="${args.ref}"]`);
    await locator.scrollIntoViewIfNeeded();
    return {
      content: [{ type: "text", text: `已滚动到 ref=${args.ref} 的元素` }]
    };
  }
);
```

---

#### 工具 8：`browser_evaluate` — 执行 JavaScript

| 项目 | 内容 |
|------|------|
| **设计问题** | snapshot 和 click 无法覆盖所有场景。如何执行更复杂的操作（如读取特定 DOM 数据、操作 contentEditable 编辑器、触发事件等）？ |
| **解决方案** | 提供一个通用的 JS 执行工具，在浏览器上下文中执行任意 JavaScript 并返回结果 |
| **创建思路** | 这是最灵活的工具。调用 `page.evaluate(script)` 执行 JS，返回结果序列化为 JSON 字符串。需要处理循环引用、DOM 元素等不可序列化的对象 |

```typescript
server.registerTool(
  "browser_evaluate",
  {
    description: "在页面中执行 JavaScript 代码并返回结果。用于读取 DOM 数据、操作 contentEditable 编辑器、触发事件等复杂场景",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "要执行的 JavaScript 代码字符串" }
      },
      required: ["script"]
    }
  },
  async (args) => {
    const page = await BrowserManager.getInstance().getPage();
    try {
      const result = await page.evaluate(args.script);
      // 序列化结果
      let output: string;
      if (result === undefined) {
        output = 'undefined';
      } else if (result === null) {
        output = 'null';
      } else if (typeof result === 'string') {
        output = result;
      } else {
        output = JSON.stringify(result, null, 2);
      }
      return {
        content: [{ type: "text", text: output.substring(0, 10000) }]
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `JS 执行错误: ${e.message}` }],
        isError: true
      };
    }
  }
);
```

**关键设计决策**：

| 决策点 | 选择 | 为什么 |
|--------|------|--------|
| 返回序列化 | JSON.stringify | 确保返回的结果是纯文本，可以被 AI 理解 |
| 结果长度限制 | 10000 字符 | 防止返回过大的 DOM 数据撑爆上下文 |
| 错误处理 | 返回 `isError: true` | 让 AI 知道 JS 执行失败了，可以调整脚本重试 |
| 为什么不可或缺 | 覆盖 contentEditable 操作、事件触发、DOM 数据提取 | 前 7 个工具只能做标准交互，evaluate 是兜底的万能工具 |

---

#### 工具 9：`browser_wait_for` — 等待

| 项目 | 内容 |
|------|------|
| **设计问题** | 提交代码后服务器需要时间处理，弹窗需要时间渲染，如何等待？ |
| **解决方案** | 提供定时等待工具，让 AI 控制等待时长 |
| **创建思路** | 最简单的工具——调用 `setTimeout` 的 Promise 包装。但也可以扩展支持等待特定条件（如等待某个元素出现） |

```typescript
server.registerTool(
  "browser_wait_for",
  {
    description: "等待指定的秒数。通常在提交操作后使用，等待服务器响应",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "number", description: "等待的秒数，通常 2~8 秒" }
      },
      required: ["time"]
    }
  },
  async (args) => {
    await new Promise(resolve => setTimeout(resolve, args.time * 1000));
    return {
      content: [{ type: "text", text: `已等待 ${args.time} 秒` }]
    };
  }
);
```

**扩展思路**：可以增加 `waitForSelector` 参数，支持等待特定 CSS 选择器出现后再返回，比纯 time 等待更智能。例如等待弹窗出现：

```typescript
// 扩展版 wait_for 思路
if (args.selector) {
  await page.waitForSelector(args.selector, { timeout: args.time * 1000 });
}
```

---

### A.4 完整项目结构

```
integrated-browser-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP 服务入口，注册所有工具
│   ├── browser-manager.ts    # 浏览器管理器（单例）
│   └── tools/
│       ├── lock.ts            # browser_lock
│       ├── unlock.ts          # browser_unlock
│       ├── navigate.ts        # browser_navigate
│       ├── snapshot.ts        # browser_snapshot（最复杂）
│       ├── click.ts           # browser_click
│       ├── type.ts            # browser_type
│       ├── scroll.ts          # browser_scroll
│       ├── evaluate.ts        # browser_evaluate
│       └── wait_for.ts        # browser_wait_for
├── .gitignore
└── README.md
```

**package.json 核心依赖**：

```json
{
  "name": "integrated-browser-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "playwright": "^1.45.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0"
  }
}
```

**index.ts 入口骨架**：

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "integrated-browser",
  version: "1.0.0"
});

// 注册 9 个工具
registerLockTool(server);
registerUnlockTool(server);
registerNavigateTool(server);
registerSnapshotTool(server);
registerClickTool(server);
registerTypeTool(server);
registerScrollTool(server);
registerEvaluateTool(server);
registerWaitForTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

---

### A.5 创建和使用流程

#### 当发现 integrated_browser 不可用时

1. **检查**：先确认是否真的没有。可以尝试调用 `browser_lock` 看是否返回工具不存在
2. **创建**：按照 A.2~A.4 的指导创建 MCP 服务
3. **编译**：`npm run build`
4. **配置**：在 TRAE 的 MCP 配置中添加该服务
5. **验证**：调用 `browser_lock` 看是否返回"浏览器已锁定"

#### 快速创建命令

如果环境支持，可以用以下命令快速初始化：

```bash
mkdir integrated-browser-mcp && cd integrated-browser-mcp
npm init -y
npm install @modelcontextprotocol/sdk playwright
npm install -D typescript @types/node
npx tsc --init
# 然后按照 A.4 的项目结构创建各个源文件
```

---

## 阶段一：登录与导航

> 目标：从零开始，登录 PTA 并打开目标题目集的第一道题

### Step 1.1：锁定浏览器

| 项目 | 内容 |
|------|------|
| **工具** | `browser_lock` |
| **操作目的** | 获取浏览器独占控制权，确保操作序列的原子性 |
| **操作思路** | 直接调用，无需参数。这是所有 PTA 操作的第一步 |
| **预期结果** | 工具返回成功，浏览器进入锁定状态 |
| **异常处理** | 如果返回"浏览器已被锁定"，说明上次操作没解锁。先调用 `browser_unlock` 再重新 `browser_lock` |

### Step 1.2：导航到 PTA 域名下并设置 Cookie

| 项目 | 内容 |
|------|------|
| **工具** | `browser_navigate` → `browser_evaluate` → `browser_navigate` |
| **操作目的** | 在 PTA 域名下写入 cookie 实现登录 |

**操作思路（分 3 小步）**：

**1.2a** — `browser_navigate`，URL = `https://pintia.cn/problem-sets/dashboard`

- **为什么先导航再设 cookie**：浏览器安全策略要求 cookie 只能在目标域名下设置。必须先让浏览器处于 `pintia.cn` 域名，才能写入该域名的 cookie
- **预期结果**：页面加载，因为是未登录状态，可能会跳转到登录页或显示空白。这不重要，我们只需要域名对上即可

**1.2b** — `browser_evaluate`，执行以下 JS 逐条写入 cookie：

```js
document.cookie = "_bl_uid=xxx; domain=.pintia.cn; path=/";
document.cookie = "_ga=xxx; domain=.pintia.cn; path=/";
document.cookie = "JSESSIONID=xxx; domain=.pintia.cn; path=/";
document.cookie = "PTASession=xxx; domain=.pintia.cn; path=/";
```

- **注意**：`domain=.pintia.cn` 前面的点不能省，表示通配所有子域名
- **注意**：把 `xxx` 替换为用户提供的实际 cookie 值
- **预期结果**：evaluate 返回成功，无报错

**1.2c** — `browser_navigate`，URL = `https://pintia.cn/problem-sets/dashboard`

- **为什么再导航一次**：cookie 写入后需要重新加载页面，浏览器才会在请求中携带这些 cookie 发给服务器
- **预期结果**：页面显示 PTA 仪表盘，右上角显示用户头像或用户名，说明登录成功

**异常处理**：
- 如果仪表盘页面仍然显示登录按钮或跳转到登录页 → cookie 可能已过期，告知用户需要提供新的 cookie
- 如果页面报 500 错误 → PTA 服务器问题，稍后重试

### Step 1.3：定位目标题目集并进入

> **高效技巧**：如果用户提供了完整的题目页面 URL（如 `https://pintia.cn/problem-sets/2065272941123833856/exam/problems/type/5`），可以直接 `browser_navigate` 到该 URL，跳过 Step 1.3 的仪表盘查找和 Step 1.4 的题型筛选，大幅节省时间。**考试页面**的 `/exam/problems/type/N` 路径会将同一题型的所有题目列在一页上，这对批量完成选择题和判断题尤为高效。

用户可能提供两种信息：
- **情况 A**：用户提供了题目集 ID（如 `problemset-id=123456`）
- **情况 B**：用户只说了题目集名称（如"chap7 图论-作业"），没给 ID

#### 情况 A：用户给了题目集 ID

| 项目 | 内容 |
|------|------|
| **工具** | `browser_navigate` → `browser_snapshot` |
| **操作目的** | 直接导航到题目集页面，验证题目集是否正确 |

**1.3a** — `browser_navigate`，URL = `https://pintia.cn/problem-sets/<problemset-id>/exam/problems`

- 把 `<problemset-id>` 替换为实际的题目集 ID 数字
- **为什么用 `/exam/problems` 而不是其他路径**：这是 PTA 题目集的直接入口，会显示所有题型的列表

**1.3b** — `browser_snapshot`，检查页面是否加载成功

- **看什么**：页面标题是否包含用户提到的题目集名称；左侧是否有题型标签（编程题、选择题、判断题、填空题等）
- **预期结果**：看到完整的题目列表和各种题型标签

**异常处理**：
- 如果看到"题目集不存在" → ID 错误，回到仪表盘页面查找正确 ID
- 如果看到"已截止"或"未开始" → 题目集有时间限制，告知用户

#### 情况 B：用户只给了题目集名称

| 项目 | 内容 |
|------|------|
| **工具** | `browser_navigate` → `browser_snapshot` → `browser_click` → `browser_snapshot` |
| **操作目的** | 从仪表盘找到目标题目集并进入 |

**1.3a** — `browser_navigate`，URL = `https://pintia.cn/problem-sets/dashboard`

**1.3b** — `browser_snapshot`

- **看什么**：仪表盘页面列出了用户的所有题目集。在 snapshot 文本中搜索用户提供的题目集名称关键词
- **找到后**：记录该题目集对应的 ref 编号（通常是一个可点击的链接或卡片）

**1.3c** — `browser_click`，ref = 上一步找到的题目集 ref

**1.3d** — `browser_wait_for`，time = 2

**1.3e** — `browser_snapshot`

- **验证**：已进入目标题目集页面，看到题型标签和题目列表
- **如果没有自动进入题目列表**：可能需要再点击页面中的"题目"或"开始答题"等入口按钮

**异常处理**：
- 如果仪表盘题目集太多找不到 → 用 `browser_evaluate` 搜索页面文本：

```js
var text = document.body.innerText;
text.substring(text.indexOf('chap7') - 50, text.indexOf('chap7') + 200);
```

- 如果用户给的名称在仪表盘中完全找不到 → 告知用户该题目集不存在，请用户确认名称

### Step 1.4：点击题型标签进入第一道题

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` → `browser_click` → `browser_wait_for` → `browser_snapshot` |
| **操作目的** | 筛选出目标题型，点击第一道题进入作答页面 |

**1.4a** — `browser_snapshot`

- **看什么**：左侧的题型标签列表（如"编程题 (2)"、"选择题 (5)"等）。找到用户要求完成的题型标签，记下其 ref

**1.4b** — `browser_click`，ref = 题型标签的 ref

- 点击后页面会筛选，只显示该题型的题目列表

**1.4c** — `browser_wait_for`，time = 2

**1.4d** — `browser_snapshot`

- **看什么**：已筛选的题目列表，找到第一道题（通常是"7-1"或"题目 1"等），记下其 ref

**1.4e** — `browser_click`，ref = 第一道题的 ref

**1.4f** — `browser_wait_for`，time = 2

**1.4g** — `browser_snapshot`

- **现在**：页面显示的是题目作答界面。接下来进入阶段二判断题型

---

## 阶段二：判断题目类型

> 目标：确定当前页面是哪种题型，以便选择对应的处理流程

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` |
| **操作目的** | 从页面快照中识别题型特征，决定后续操作流程 |
| **操作思路** | 仔细阅读 snapshot 文本，按下面的对照表判断 |

### 题型判断对照表

| 题目类型 | snapshot 中可见的特征 | 关键按钮文字 | 后续操作 |
|----------|----------------------|-------------|----------|
| **编程题** | 有大段代码文本（含 `#include`、`int main`、`class` 等关键词），有一个较大的代码编辑区域 | "提交本题作答" | → 阶段三 |
| **选择题** | 有 3~4 个选项，每个选项前有圆形 radio 按钮或字母编号（A/B/C/D），有选项文本描述 | "保存" | → 阶段四 |
| **判断题** | 只有 2 个选项（通常是"T/F"、"正确/错误"、"True/False"），有 radio 按钮 | "保存" | → 阶段四 |
| **填空题** | 有 1 个或多个 `<input>` 或 `<textarea>` 空白输入框，框内为空或显示"请输入答案" | "保存" | → 阶段五 |

### 判断技巧

- 如果 snapshot 中有 `#include` 或 `int main` 或 `class Solution` → **编程题**
- 如果 snapshot 中有多个 radio button 且每个旁边有一段文字选项 → **选择题**
- 如果 snapshot 中只有 2 个 radio button，文字是"对/错"或"T/F" → **判断题**
- 如果 snapshot 中有空白的输入框（`textbox`）散布在题目的文字中间 → **填空题**
- **编程题和填空/选择题的关键区别**：编程题有"提交本题作答"按钮，其他题型是"保存"按钮

---

## 阶段三：编程题

> 目标：理解题意 → 编写代码 → 清空编辑器 → 输入代码 → 验证完整性 → 提交 → 查看结果 → 根据结果分支处理 → 直到满分

### 整体流程决策树

```
阅读题目 (Step 1)
    ↓
编写代码（在你脑中/用工具写好）
    ↓
清空编辑器 (Step 2)  ←──────────────────────┐
    ↓                                        │
输入代码 (Step 3)                             │
    ↓                                        │
验证代码完整 (Step 4)                         │
    ↓                                        │
提交 (Step 5)                                │
    ↓                                        │
等弹窗 (Step 6)                              │
    ↓                                        │
读结果 (Step 7)                              │
    ↓                                        │
判断结果 (Step 8)                             │
    ├── 排队中 → 点刷新 → 等待 → 再读结果 ────┘（回到 Step 7）
    ├── 编译错误 → 读错误 → 关闭弹窗 → 修复代码 → 回到 Step 2
    ├── 答案错误/部分正确 → 读详情 → 关闭弹窗 → 改逻辑 → 回到 Step 2
    └── 答案正确(满分) → 关闭弹窗 → 本题完成 → 进入下一题 (Step 9)
```

---

### Step 3.1：阅读并理解题目

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` |
| **操作目的** | 从页面快照中完整提取题目信息，确保理解需求 |
| **操作思路** | 阅读 snapshot 返回的文本，重点关注以下部分 |

**需要从 snapshot 中提取的内容**：

1. **题目描述**：问题的文字描述，通常在"题目描述"或"问题描述"标题下
2. **输入格式**：输入数据的格式说明
3. **输出格式**：输出数据的格式说明（注意空格、换行、大小写等细节）
4. **输入样例**：示例输入数据
5. **输出样例**：示例输出数据
6. **数据范围/约束**：如 N 的取值范围、时间限制、内存限制等（影响算法选择）
7. **函数接口**：如果是函数题（如 LeetCode 风格），注意给定的函数签名

**异常处理**：
- 如果 snapshot 中题目文本被截断（内容太长超过返回限制）→ 用 `browser_scroll` 滚动页面，再 snapshot 获取下半部分
- 如果题目中有图片/公式无法从 snapshot 文本中理解 → 可以先用现有信息尝试，如果提交错误再仔细看

**写代码时的注意事项**：
- 输入输出格式必须与题目要求完全一致（包括空格和换行）
- 优先考虑边界情况（空输入、最大值、最小值）
- 选择合适的数据结构和算法以通过所有测试点

---

### Step 3.2：定位并彻底清空代码编辑框（最关键的一步！）

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` → `browser_scroll` → `browser_evaluate` |
| **操作目的** | 找到代码编辑框，将其中的旧代码/模板代码彻底删除干净 |
| **为什么关键** | 这是整个流程中**最容易出错**的一步。清不干净会导致新旧代码混合，必定编译错误 |

**3.2a** — `browser_snapshot`

- **看什么**：找到代码编辑区域的 ref。通常是页面中央最大的那个区域，里面有 `#include` 等代码模板
- 记下这个 ref，后面 `browser_scroll` 和 `browser_type` 会用到

**3.2b** — `browser_scroll`，ref = 编辑框 ref，scrollIntoView = true

- **为什么**：确保编辑框在可视区域内，后续 focus 和 click 才能生效
- 如果编辑框已经在屏幕内可跳过

**3.2c** — `browser_evaluate`，执行清空脚本

- **为什么必须用 evaluate 而不是 browser_type 的 clear**：PTA 的代码编辑器是基于 ProseMirror（一个富文本编辑框架）构建的 contentEditable DIV。`browser_type` 的 `clear` 参数只能清空简单的 `<input>` 和 `<textarea>`，对 contentEditable DIV 的清空不彻底——它会留下不可见的 HTML 节点残留，导致新代码写在旧代码后面，生成类似 `}#include <stdio.h>...` 的混合代码

```js
// === 完整清空脚本 ===
var divs = document.querySelectorAll('div');
var codeEl = null;

// 方法1：通过 contentEditable 属性查找
for (var i = 0; i < divs.length; i++) {
    var ce = divs[i].contentEditable;
    if (ce === 'true' || ce === 'plaintext-only') {
        var t = (divs[i].innerText || '').trim();
        if (t.length > 50) { codeEl = divs[i]; break; }
    }
}

// 方法2（备选）：通过内容特征查找（包含常见代码关键词）
if (!codeEl) {
    for (var i = 0; i < divs.length; i++) {
        var t = (divs[i].innerText || '').trim();
        if (t.length > 50 && t.length < 5000 && 
            (t.indexOf('int') >= 0 || t.indexOf('#include') >= 0 || t.indexOf('class') >= 0)) {
            codeEl = divs[i];
            break;
        }
    }
}

// 方法3（兜底）：找包含代码元素最多的 div
if (!codeEl) {
    var maxLen = 0;
    for (var i = 0; i < divs.length; i++) {
        var t = (divs[i].innerText || '').trim();
        if (t.length > maxLen && t.length < 10000) {
            maxLen = t.length;
            codeEl = divs[i];
        }
    }
}

// 执行清空
if (codeEl) {
    codeEl.scrollIntoView();
    codeEl.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    'CLEAR_OK';  // 返回成功标识
} else {
    'CLEAR_FAIL: NO_EDITOR_FOUND';  // 返回失败标识
}
```

**预期结果**：evaluate 返回 `"CLEAR_OK"`，代码编辑框变为空白

**异常处理**：
- 返回 `"CLEAR_FAIL: NO_EDITOR_FOUND"` → 三种方法都没找到编辑框。尝试扩大搜索范围，检查是否有 `<pre>`、`<code>` 等标签，或者用 `browser_snapshot` 再仔细看页面结构
- 返回空或其他错误 → 可能是 `execCommand` 被浏览器禁用，尝试用 `codeEl.innerHTML = ''` 作为备选

---

### Step 3.3：输入代码

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot`（重获 ref）→ `browser_type`（推荐）或 `browser_evaluate`（备选） |
| **操作目的** | 将写好的代码输入到编辑框中 |

**3.3a** — `browser_snapshot`

- **为什么**：清空编辑框后页面可能重新渲染，ref 可能变化。重新 snapshot 获取编辑框的最新 ref

**3.3b** — 选择输入方式：

**主方案：`browser_type`**（推荐）

| 参数 | 值 |
|------|-----|
| `ref` | 从 3.3a 的 snapshot 中获取的编辑框 ref |
| `text` | 完整的代码文本 |
| `clear` | `true`（二次保险，虽然已经手动清空过了） |

- **为什么推荐 browser_type**：它能模拟真实的逐字输入过程，触发 ProseMirror 的所有内部事件（input、composition、keydown 等），编辑器能完整感知文本变化
- **注意**：代码中如果有特殊字符（如 `\n` 换行、`\t` 制表符），browser_type 应该能正确处理。如果出现转义问题，换用备选方案

**备选方案：`browser_evaluate`**

```js
// 通过 execCommand 插入文本
var codeEl = document.activeElement;
if (!codeEl || codeEl.contentEditable !== 'true') {
    // 重新找编辑框
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
        if (divs[i].contentEditable === 'true' || divs[i].contentEditable === 'plaintext-only') {
            codeEl = divs[i];
            break;
        }
    }
}
codeEl.focus();
var code = `在这里粘贴完整代码`;
document.execCommand('insertText', false, code);
```

- **注意**：模板字符串中的反引号需要转义。如果代码本身包含反引号，用字符串拼接替代模板字符串

**异常处理**：
- `browser_type` 报错 "Element not found" → ref 失效，重新 snapshot 获取
- `browser_type` 输入后编辑框内容不对（截断、乱码）→ 改用 `browser_evaluate` + `execCommand('insertText')`
- 两种方法都失败 → 检查代码长度是否超过 PTA 限制（通常 64KB），如果超了需要精简代码

---

### Step 3.4：验证代码输入完整性

| 项目 | 内容 |
|------|------|
| **工具** | `browser_evaluate` |
| **操作目的** | 确认编辑框中的代码和预期的完全一致，没有截断或混合 |

```js
// 检查代码首尾
var divs = document.querySelectorAll('div');
var found = null;
for (var i = 0; i < divs.length; i++) {
    var t = (divs[i].innerText || '').trim();
    if (t.length > 100 && t.length < 50000) {
        found = divs[i];
        break;
    }
}
if (found) {
    var text = found.innerText;
    var lines = text.split('\n');
    var result = {
        total_len: text.length,
        total_lines: lines.length,
        first_3: lines.slice(0, 3).join('\n'),
        last_5: lines.slice(-5).join('\n')
    };
    JSON.stringify(result);
} else {
    'VERIFY_FAIL';
}
```

**操作思路**：
1. 检查 `first_3`（代码头部）——是否与你写的代码开头一致
2. 检查 `last_5`（代码尾部）——**特别注意**：尾部后 5 行不应该出现第二个 `#include`、第二个 `int main` 等重复内容
3. 检查 `total_len`——和你写的代码总长度是否接近（允许少量差异，如换行符处理差异）

**判断标准**：
- 如果尾部出现重复的 `#include`、`using namespace`、`int main` → **新旧代码混合，清空失败！** 回到 Step 3.2 重新清空
- 如果代码明显短了很多 → 输入被截断，回到 Step 3.3 重新输入
- 如果完全一致 → 继续下一步

---

### Step 3.5：提交代码

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` → `browser_click` |
| **操作目的** | 点击"提交本题作答"按钮，将代码发送给 PTA 服务器评测 |

**3.5a** — `browser_snapshot`

- **看什么**：找到"提交本题作答"按钮的 ref。也可能叫"提交"、"Submit"
- **注意**：按钮可能在页面底部，snapshot 中可能排在靠后的位置

**3.5b** — `browser_click`，ref = 上一步找到的按钮 ref

- **备选**：如果找不到按钮 ref（如在页面很底部被截断），用 evaluate 直接点击：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || btns[i].textContent || '').trim();
    if (txt.indexOf('提交') >= 0 && txt.indexOf('作答') >= 0) {
        btns[i].click();
        break;
    }
}
```

**异常处理**：
- 按钮是灰色的（disabled）→ 可能代码编辑框为空或未检测到变化。回到 Step 3.3 重新输入
- 点击后无反应 → 等 3 秒后 snapshot 看页面是否变化
- 弹出"请先输入代码"之类的提示 → 编辑框确实为空，确认清空后是否真的输入了代码

---

### Step 3.6：等待评测弹窗出现

| 项目 | 内容 |
|------|------|
| **工具** | `browser_wait_for` |
| **操作目的** | 给 PTA 服务器足够的处理时间，等待弹窗渲染 |

- `browser_wait_for`，time = 5
- **为什么是 5 秒**：提交后服务器需要：接收代码 → 编译 → 运行测试用例 → 返回结果。简单题可能 2 秒出结果，复杂题或服务器繁忙时可能需要 5~8 秒
- 如果 5 秒后弹窗还没出现，再多等 3 秒

---

### Step 3.7：从弹窗中读取评测结果

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` → `browser_evaluate` |
| **操作目的** | 提取弹窗中的关键评测信息：提交状态、得分、错误详情 |

**3.7a** — `browser_snapshot`

- **看什么**：弹窗的完整内容。重点关注：
  - **状态**："排队中" / "编译错误" / "答案正确" / "答案错误" / "部分正确" / "等待评测"
  - **分数**："0 / 10"、"5 / 10"、"10 / 10" 等
  - **编译器输出**（编译错误时有）：具体的错误行号和描述
  - **评测详情**（答案错误时有）：每个测试点的通过/失败状态和提示信息

**3.7b** — 如果 snapshot 中弹窗信息不够详细，补充 `browser_evaluate` 提取：

```js
var allDivs = document.querySelectorAll('div');
var results = {};

// 找提交结果弹窗
for (var i = 0; i < allDivs.length; i++) {
    var txt = (allDivs[i].innerText || '').trim();
    
    // 状态
    if (txt.indexOf('提交结果') === 0 || txt.indexOf('状态') === 0) {
        results.status_section = allDivs[i].innerText;
    }
    
    // 编译器输出（编译错误时）
    if (txt.indexOf('编译器输出') >= 0 || txt.indexOf('编译输出') >= 0) {
        results.compile_output = allDivs[i].innerText;
    }
    
    // 评测详情（答案错误时）
    if (txt.indexOf('评测详情') >= 0 || txt.indexOf('测试点') >= 0) {
        results.test_details = allDivs[i].innerText;
    }
}

// 也检查一下 pre 和 code 标签
var pres = document.querySelectorAll('pre, code');
for (var j = 0; j < pres.length; j++) {
    var pt = (pres[j].innerText || '').trim();
    if (pt.indexOf('error') >= 0 || pt.indexOf('Error') >= 0) {
        results.error_output = pt;
    }
}

JSON.stringify(results);
```

**预期结果**：拿到一个包含状态、分数、错误信息（如有）的结果对象

---

### Step 3.8：根据结果分支处理

> 这是整个流程的**决策核心**。根据弹窗内容走 4 个分支之一

#### 分支 A：排队中 / 等待评测

**识别特征**：弹窗显示"排队中，前方还有 N 个提交"、"等待评测"、"评判中"

| 步骤 | 工具 | 操作 | 思路 |
|------|------|------|------|
| A1 | `browser_snapshot` | 找"刷新"按钮的 ref | 弹窗中通常有一个"刷新"按钮 |
| A2 | `browser_click` | 点击"刷新"按钮 | 触发重新查询评测结果 |
| A3 | `browser_wait_for` | time = 3 | 等服务器返回新状态 |
| A4 | `browser_snapshot` | 重新读弹窗内容 | 看状态是否变化 |

**备选 JS**（如果找不到刷新按钮 ref）：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || '').trim();
    if (txt === '刷新') { btns[i].click(); break; }
}
```

**循环逻辑**：
```
A1 → A2 → A3 → A4 → 如果还是"排队中"，回到 A1
                 → 如果出结果了，跳到 Step 3.7 重新判断状态类型
```

- **最多循环 5 次**（约 25 秒）。如果 5 次后还在排队，告知用户稍等，然后继续尝试
- **每轮之间间隔逐渐延长**：第 1 轮等 3 秒，第 2 轮等 5 秒，第 3~5 轮等 8 秒

---

#### 分支 B：编译错误（Compile Error）

**识别特征**：弹窗显示"状态：编译错误"，"分数：0 / N"

| 步骤 | 工具 | 操作 | 思路 |
|------|------|------|------|
| B1 | `browser_evaluate` | 提取编译器输出 | 获取具体错误行号和描述 |
| B2 | （分析） | 根据错误信息判断原因 | 见下方"编译错误常见原因" |
| B3 | `browser_snapshot` | 找"确认"按钮 ref | 准备关闭弹窗 |
| B4 | `browser_click` | 点击"确认"按钮 | 关闭弹窗 |
| B5 | `browser_wait_for` | time = 2 | 等弹窗消失 |
| B6 | — | **回到 Step 3.2** | 重新清空编辑器、重新输入修正后的代码 |

**编译错误常见原因及处理**：

| 错误特征 | 原因 | 处理方法 |
|----------|------|----------|
| 代码末尾出现 `}#include`、重复的 `int main` | **新旧代码混合**（最常见！） | 回到 Step 3.2，确保 `execCommand('selectAll')` + `execCommand('delete')` 执行成功，确认编辑框完全清空后再输入 |
| 特定行号报语法错误 | 代码本身有 bug | 根据错误行号定位代码位置，修正语法错误 |
| `undefined reference to` | 链接错误，调用了不存在的函数 | 检查函数名拼写、是否正确 `#include` 了头文件 |
| `error: 'xxx' was not declared` | 变量/函数未声明 | 检查拼写、作用域、头文件 |
| 代码被截断、末尾不完整 | 输入时被截断 | 回到 Step 3.3，用 `browser_evaluate` 的 `execCommand('insertText')` 方式重新输入 |

**关闭弹窗的 JS 备选**：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || '').trim();
    if (txt === '确认') { btns[i].click(); break; }
}
```

---

#### 分支 C：答案错误 / 部分正确（Wrong Answer / Partial Correct）

**识别特征**：弹窗显示"状态：答案错误"或"部分正确"，分数小于满分

| 步骤 | 工具 | 操作 | 思路 |
|------|------|------|------|
| C1 | `browser_evaluate` | 提取测试点详情 | 查看哪些测试点未通过 |
| C2 | （分析） | 根据未通过的测试点反馈修改代码 | 见下方"答案错误常见原因" |
| C3 | `browser_snapshot` | 找"确认"按钮 ref | 准备关闭弹窗 |
| C4 | `browser_click` | 点击"确认" | 关闭弹窗 |
| C5 | `browser_wait_for` | time = 2 | 等弹窗消失 |
| C6 | — | **回到 Step 3.2** | 清空后输入修改后的代码，重新提交 |

**答案错误常见原因及处理**：

| 测试点反馈 | 可能原因 | 处理方法 |
|-----------|----------|----------|
| "答案错误"（无具体提示） | 算法逻辑有误 | 重新审视算法逻辑，对照输入输出样例排查 |
| "运行超时" | 算法复杂度太高 | 优化算法（如用动态规划替代暴力枚举、用并查集替代 DFS 判环） |
| "内存超限" | 使用了过多内存 | 优化数据结构、及时释放无用内存 |
| "段错误"/"运行时错误" | 数组越界、空指针、栈溢出 | 检查数组大小是否足够、指针是否判空、递归深度 |
| "格式错误" | 输出多了/少了空格、多了/少了换行 | 严格按照题目输出格式要求调整 |
| "答案错误"（某几个测试点） | 边界情况没处理 | 检查 N=0、N=1、最大值、负数、空输入等边界 |

**提取测试点详情的 JS**：

```js
// 找弹窗中所有包含测试点信息的表格或 div
var all = document.querySelectorAll('tr, td, th, div[class*="test"], div[class*="result"]');
var details = [];
for (var i = 0; i < all.length; i++) {
    var txt = (all[i].innerText || '').trim();
    if (txt.length > 0 && txt.length < 200) {
        details.push(txt);
    }
}
JSON.stringify(details);
```

---

#### 分支 D：答案正确（Accepted / 满分）

**识别特征**：弹窗显示"状态：答案正确"，"分数：N / N"（N = 满分）

| 步骤 | 工具 | 操作 | 思路 |
|------|------|------|------|
| D1 | `browser_snapshot` | 找"确认"按钮 ref | 准备关闭弹窗 |
| D2 | `browser_click` | 点击"确认" | 关闭结果弹窗 |
| D3 | `browser_wait_for` | time = 2 | 等弹窗消失 |
| D4 | — | **本题完成** | 继续 Step 3.9 进入下一题 |

**关闭弹窗的 JS 备选**：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || '').trim();
    if (txt === '确认') { btns[i].click(); break; }
}
```

**确认弹窗已关闭的方法**：
- 关闭后 snapshot 中不再出现"提交结果"、"状态"、"分数"等弹窗内容
- 如果 snapshot 中还有弹窗内容 → 弹窗没关成功，再点一次"确认"

---

### Step 3.9：进入下一道题

| 项目 | 内容 |
|------|------|
| **前置条件** | 弹窗已关闭（必须！） |
| **工具** | `browser_snapshot` → `browser_click` |

**3.9a** — `browser_snapshot`

- **看什么**：找"下一题"按钮的 ref。通常在页面顶部或底部的导航区域
- 也可能是一个箭头图标按钮（`>` 或 `→`）

**3.9b** — `browser_click`，ref = "下一题"按钮 ref

**3.9c** — `browser_wait_for`，time = 2

**3.9d** — `browser_snapshot`

- **验证**：页面已切换到下一道题，标题或题号已变化

**备选 JS**：

```js
// 找"下一题"按钮
var btns = document.querySelectorAll('button, a');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || btns[i].textContent || '').trim();
    if (txt === '下一题' || txt.indexOf('下一题') >= 0 || txt === '>' || txt === 'Next') {
        btns[i].click();
        break;
    }
}
```

**特殊情况**：
- 如果已经到了最后一题，没有"下一题"按钮 → 所有题目完成，结束
- 如果点"下一题"后题型变了（如从编程题变选择题）→ 回到**阶段二**重新判断题型，走对应流程

---

## 阶段四：选择题 & 判断题

> 目标：阅读题目和选项 → 推理正确答案 → 选中选项 → 保存 → 验证结果

### 选择题与判断题的关系

判断题本质上是只有 2 个选项的选择题。流程完全一致，唯一区别是选项数量（判断题只有 T/F 或 正确/错误 两个选项）。下面以选择题为例描述流程，判断题同理。

### 两种页面模式：单题模式 vs 考试批量模式

PTA 的选题/判题有两种不同的页面展示形式，**进入阶段四前必须先通过 snapshot 确认当前是哪种模式**：

| 特征 | 单题模式 | 考试批量模式 |
|------|----------|-------------|
| **URL 特征** | `/problems/` 路径，URL 中带有题目序号 | `/exam/problems/type/` 路径 |
| **页面结构** | 页面上只有 **1 道题** 的题目和选项 | 页面上有 **该题型全部题目**（如 12 道判断题、13 道选择题），每题有独立的题目区块和选项 |
| **按钮** | 每题一个"保存"按钮 | 页面底部有一个统一的"保存"按钮，一次性保存所有题目 |
| **导航方式** | 完成一题后点击"下一题"进入下一题 | 无需翻页，所有题目都在同一页 |
| **操作策略** | 逐题操作：读题 → 选答案 → 保存 → 下一题 | **批量操作**：一次性分析所有题目 → 逐个选中各题答案 → 一次保存全部 |

**考试批量模式的优势**：所有题目在同一页，可以先 snapshot 一次性获取全部题目信息，批量分析作答后再统一保存，效率远高于逐题翻页。本次实际操作中即使用此模式高效完成了 12 道判断题和 13 道选择题。

### 考试批量模式专用流程

```
snapshot 获取全部题目 (一次性看到所有题目和选项)
    ↓
逐题分析，逐个选中各题的正确答案
    ├── 优先用 browser_click 通过 ref 点击
    └── 点击被拦截时用 browser_evaluate 按文本匹配点击（兜底）
    ↓
验证所有题目均已正确选中（browser_evaluate 检查 checked 状态）
    ↓
点击一次"保存"按钮，保存全部答案
    ↓
等待 3 秒 → snapshot 检查保存结果
    ↓
如果有弹窗 → 读结果 → 关闭弹窗
```

### 单题模式流程（原有）

```
阅读题目和选项 (Step 1)
    ↓
选中正确选项 (Step 2)
    ↓
保存答案 (Step 3)
    ↓
检查结果 (Step 4)
    ├── 正确 → 关闭弹窗 → 进入下一题
    └── 错误 → 重新分析 → 修改选项 → 再保存
```

---

### Step 4.1：阅读题目和选项

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` |
| **操作目的** | 获取完整的题目描述和所有选项文本 |
| **操作思路** | 在 snapshot 中找出题目和选项区域 |

**从 snapshot 中提取**：
1. **题干**：题目的问题描述
2. **所有选项**：通常标注为 A、B、C、D（或 1、2、3、4），每个选项后面有文字描述
3. **如果是判断题**：选项是"T"和"F"，或"正确"和"错误"

**答题策略**：
- 根据题干描述推理出正确选项
- 如果不确定，可以用 `WebSearch` 搜索题目内容
- 如果是知识类选择题（如概念定义），可能需要查找教材/文档

**异常处理**：
- 题目文字被截断 → `browser_scroll` 滚动，再 snapshot
- 选项文本太长导致混淆 → 重点关注每个选项的核心区别点

---

### Step 4.2：选中正确选项

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot`（获取 radio/label 的 ref）→ `browser_click`（推荐）或 `browser_evaluate`（备选） |
| **操作目的** | 点击正确选项对应的 radio 按钮或 label |

**主方案：`browser_click`（通过 snapshot ref）**

1. `browser_snapshot`
2. 在 snapshot 中找到正确选项对应的 radio button 或 label 的 ref
3. `browser_click`，ref = 找到的 ref

**备选方案：`browser_evaluate`**

```js
// 方法1：遍历所有 label，匹配文本后点击
var labels = document.querySelectorAll('label');
for (var i = 0; i < labels.length; i++) {
    var txt = (labels[i].innerText || labels[i].textContent || '').trim();
    if (txt.indexOf('正确答案的关键词') >= 0) {
        labels[i].click();
        'CLICKED: ' + txt.substring(0, 50);
        break;
    }
}

// 方法2：如果 label 不包含文本，直接点对应 radio
var radios = document.querySelectorAll('input[type="radio"]');
for (var j = 0; j < radios.length; j++) {
    var label = radios[j].parentElement;
    var txt = (label ? (label.innerText || label.textContent || '') : '').trim();
    if (txt.indexOf('正确答案的关键词') >= 0) {
        radios[j].click();
        'CLICKED radio: ' + txt.substring(0, 50);
        break;
    }
}
```

**为什么可能需要点 label 而不是 radio**：有些 PTA 页面的 radio button 本身被 CSS 隐藏（`opacity: 0` 或 `display: none`），点击事件绑定在外层 `<label>` 上。如果点 radio 没反应，尝试点包裹它的 label

**验证选中成功**：
- 再执行一次 `browser_evaluate`：

```js
var radios = document.querySelectorAll('input[type="radio"]');
var checked = [];
for (var i = 0; i < radios.length; i++) {
    checked.push({
        index: i,
        checked: radios[i].checked,
        value: radios[i].value
    });
}
JSON.stringify(checked);
```

- 确认 `checked: true` 的那一项是你的目标选项

---

### Step 4.3：保存答案前验证（考试批量模式必备！）

> **仅适用于考试批量模式**：由于考试批量模式需要一次性正确回答全部题目，在点击"保存"前验证所有题目的选项状态可以减少反复保存的次数。

| 项目 | 内容 |
|------|------|
| **工具** | `browser_evaluate` |
| **操作目的** | 确认页面上每一道题的 radio 都已正确选中，避免保存后发现漏选或选错 |

```js
// 遍历所有 radio，按题目分组检查选中状态
var radios = document.querySelectorAll('input[type="radio"]');
var results = [];
var currentQuestion = '';
for (var i = 0; i < radios.length; i++) {
    var parent = radios[i].parentElement;
    var txt = (parent ? (parent.innerText || parent.textContent || '').trim() : '');
    
    // 只输出被选中的 radio
    if (radios[i].checked) {
        results.push({
            radio_index: i,
            selected_text: txt.substring(0, 80)
        });
    }
}
// 输出总 radio 数和已选中数
'Total radios: ' + radios.length + ', Checked: ' + results.length + '\n' + 
 results.map(function(r) { return '[' + r.radio_index + '] ' + r.selected_text; }).join('\n');
```

**操作思路**：
1. 执行上述脚本，得到已选中的 radio 列表
2. 核对已选中的数量和题目总数是否一致（考试批量模式每题通常 2~4 个 radio，判断题每题 2 个，单选题每题 4 个，可据此反推所选题目数）
3. 逐题核对选中的选项内容是否与预期答案一致
4. 如果发现漏选或错选，回到 Step 4.2 修正后再验证

**预期结果**：已选中的选项数量 = 题目数量，且每个选中项的文本与你分析的正确答案匹配

---

### Step 4.4：保存答案

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` → `browser_click` 或 `browser_evaluate` |
| **操作目的** | 将选中的答案提交保存 |

**4.3a** — `browser_snapshot`

- **看什么**：找"保存"按钮的 ref。部分 PTA 页面可能叫"提交"、"保存答案"

**4.3b** — `browser_click`，ref = 保存按钮 ref

**4.3c** — `browser_wait_for`，time = 3

**备选 JS**：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || btns[i].textContent || '').trim();
    if (txt === '保存' || txt.indexOf('保存') >= 0 || txt === '提交') {
        btns[i].click();
        break;
    }
}
```

---

### Step 4.5：检查保存结果

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` |
| **操作目的** | 查看保存后的页面反馈 |

**看什么**：

- **如果出现弹窗**：查看弹窗内容
  - 显示"正确"、"满分" → 点击"确认"关闭 → 本题完成，进入下一题
  - 显示"错误"、"不得分" → 点击"确认"关闭 → 回到 Step 4.1 重新分析，选择其他选项
- **如果没有弹窗**：看页面中是否有正确/错误的文字提示
  - 页面显示"答案已保存" → 保存成功，进入下一题
  - 页面没有任何变化 → 可能页面自动保存，等 2 秒后进入下一题

**判断题的特殊处理**：
- 判断题只有两个选项，如果第一次选错了，第二次直接选另一个即可

---

## 阶段五：填空题

> 目标：阅读题目确定答案 → 逐空填入答案 → 保存 → 验证结果

### 整体流程

```
阅读题目和空的上下文 (Step 1)
    ↓
确定每个空的答案 (Step 1)
    ↓
填入所有空 (Step 2)
    ↓
保存答案 (Step 3)
    ↓
检查结果 (Step 4)
    ├── 正确/满分 → 关闭弹窗 → 进入下一题
    └── 错误 → 重新分析 → 修改答案 → 再保存
```

---

### Step 5.1：阅读题目并确定每个空的答案

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` |
| **操作目的** | 理解题目上下文，确定每个空应填什么 |
| **操作思路** | 在 snapshot 中定位题目描述和所有空白位置 |

**从 snapshot 中提取**：
1. **题干描述**：完整阅读题目说明
2. **每个空的上下文**：空前面和后面的文字，用于判断答案
3. **空的个数**：页面中有几个输入框

**常见填空题类型及答题策略**：

| 类型 | 特征 | 答题策略 |
|------|------|----------|
| 代码填空 | 上下文是代码片段，空在代码中间 | 根据代码逻辑推断缺失的表达式、变量名或语句 |
| 知识填空 | 上下文是概念描述 | 根据专业知识补全术语或定义 |
| 计算填空 | 题目有计算需求 | 进行计算后填入结果数字 |
| 多空关联 | 多个空之间有逻辑关联 | 综合考虑所有空，保持逻辑一致性 |

---

### Step 5.2：填入答案（关键：必须触发框架事件！）

| 项目 | 内容 |
|------|------|
| **工具** | `browser_scroll` → `browser_evaluate` |
| **操作目的** | 将每个空的答案填入对应的输入框，并确保页面框架感知到变化 |

**为什么必须用 evaluate + dispatchEvent**：
PTA 页面使用 React/Vue 等现代前端框架。这些框架通过事件监听来维护组件内部状态。直接用 `input.value = 'xxx'` 修改 DOM 属性，框架的虚拟 DOM 不会感知到变化。保存时框架认为值没变，导致答案丢失。
**正确做法**：设置 value 后立即 `dispatchEvent(new Event('input'))` 和 `dispatchEvent(new Event('change'))`，手动触发框架的事件监听器。

**Step 5.2 完整操作**：

**5.2a** — `browser_snapshot`，找到所有输入框的 ref

**5.2b** — 如果输入框不在屏幕内，`browser_scroll`，scrollIntoView = true

**5.2c** — `browser_evaluate`，执行填入脚本：

```js
// 找到所有填空的输入框
var inputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
var results = [];

for (var i = 0; i < inputs.length; i++) {
    var inp = inputs[i];
    inp.focus();
    
    // 根据空的位置填入对应答案
    var answer = '';
    if (i === 0) {
        answer = '第一个空的答案';
    } else if (i === 1) {
        answer = '第二个空的答案';
    } else if (i === 2) {
        answer = '第三个空的答案';
    }
    // 以此类推，根据实际空的数量填写
    
    inp.value = answer;
    
    // 关键！触发框架事件
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    
    results.push({
        index: i,
        value: inp.value,
        placeholder: inp.placeholder || ''
    });
}

JSON.stringify(results);
```

**重要注意事项**：

1. **答案顺序**：input 的遍历顺序是从上到下、从左到右的 DOM 顺序，确保填的答案和空的位置对应
2. **答案格式**：严格按照题目要求的格式填写（如保留几位小数、是否加引号、空格等）
3. **逐个 focus**：每个 input 填入前先 focus，确保事件触发正确

**异常处理**：
- 如果 input 找不到 → 可能是其他元素（如 contentEditable span），扩大选择器范围
- 填入后返回的 value 为空 → input 可能是只读的，或者有其他限制，检查 input 属性

---

### Step 5.3：保存答案

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` → `browser_click` 或 `browser_evaluate` |
| **操作目的** | 将填入的答案提交保存 |

**5.3a** — `browser_snapshot`

- **看什么**：找"保存"按钮的 ref

**5.3b** — `browser_click`，ref = 保存按钮 ref

**5.3c** — `browser_wait_for`，time = 3

**备选 JS**：

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = (btns[i].innerText || btns[i].textContent || '').trim();
    if (txt === '保存' || txt.indexOf('保存') >= 0) {
        btns[i].click();
        break;
    }
}
```

---

### Step 5.4：检查保存结果

| 项目 | 内容 |
|------|------|
| **工具** | `browser_snapshot` |
| **操作目的** | 查看保存后的反馈 |

**看什么**：

- **弹窗显示"答案正确"/"满分"** → 点击"确认"关闭 → 本题完成，进入下一题
- **弹窗显示"答案错误"/"部分正确"** → 点击"确认"关闭 → 回到 Step 5.1 重新分析
- **没有弹窗但页面有正确/错误提示** → 根据提示判断
- **页面没有任何反馈** → 答案可能已自动保存但不评分。进入下一题

---

## 阶段六：批量完成所有题目

> 目标：遍历题目集中的每一道题，自动完成并提交

### 主循环

```
锁定浏览器 (browser_lock)
  ↓
进入题目集第一道题 (阶段一)
  ↓
┌─────────────────────────────────┐
│  循环：对每一道题                  │
│                                  │
│  1. 判断题型 (阶段二)             │
│     ↓                           │
│  2. 走对应流程：                  │
│     ├── 编程题 → 阶段三           │
│     ├── 选择题/判断题 → 阶段四     │
│     └── 填空题 → 阶段五           │
│     ↓                           │
│  3. 确认弹窗已关闭                │
│     ↓                           │
│  4. 点击"下一题"                  │
│     ↓                           │
│  5. 如果是最后一题 → 退出循环      │
│     ↓                           │
│  6. 回到步骤 1                   │
└─────────────────────────────────┘
  ↓
解锁浏览器 (browser_unlock)
```

### 循环中的注意事项

1. **每道题之间要 snapshot**：切换题目后页面重新渲染，必须 snapshot 获取新的题型信息和 ref
2. **题型可能混合**：题目集中可能有编程题、选择题、填空题混合排列。每切换一道题都要重新走阶段二判断
3. **保持锁状态**：整个批量过程中不要 unlock，全部做完再 unlock
4. **进度追踪**：做完一道后输出"第 X 题完成，共 N 题，还剩 M 题"之类的进度信息
5. **遇到反复失败的题**：如果同一题反复修改 3 次仍未通过，记录该题信息并继续下一题，最后统一告知用户哪些题未完成

---

## 完整执行示例

下面是一个完整的执行流程示例，展示每一步具体调用什么工具、预期看到什么。

### 场景：用户说"帮我完成 chap7 图论-作业 里的编程题"

```
1. browser_lock
   预期：成功锁定

2. browser_navigate("https://pintia.cn/problem-sets/dashboard")
   预期：页面加载（可能是登录页）

3. browser_evaluate(设置 cookie)
   预期：返回成功

4. browser_navigate("https://pintia.cn/problem-sets/dashboard")
   预期：仪表盘加载，看到用户信息和题目集列表

5. browser_snapshot
   预期：看到题目集列表，找到"chap7 图论-作业"的入口 ref

6. browser_click(ref=题目集入口)
   browser_wait_for(2)
   browser_snapshot
   预期：进入题目集页面，看到"编程题 (2)"、"选择题 (3)"等标签

7. browser_click(ref="编程题"标签)
   browser_wait_for(2)
   browser_snapshot
   预期：看到编程题列表（7-1、7-2）

8. browser_click(ref="7-1"题目)
   browser_wait_for(2)
   browser_snapshot
   预期：进入 7-1 的作答页面

9. 【阶段二】判断题型 → 编程题（看到代码编辑区和"提交本题作答"按钮）

10.【阶段三】写代码 → 清空编辑框 → 输入代码 → 验证 → 提交
   browser_evaluate(清空脚本) → "CLEAR_OK"
   browser_snapshot → browser_type(代码)
   browser_evaluate(验证脚本) → 首尾匹配
   browser_snapshot → browser_click("提交本题作答")
   browser_wait_for(5)

11.【看结果】browser_snapshot
   情况1：排队中 → browser_click("刷新") → browser_wait_for(3) → browser_snapshot → 重复
   情况2：编译错误 → browser_evaluate(读错误) → 分析 → browser_click("确认") → 回到步骤10
   情况3：答案正确 → browser_click("确认") → 本题完成

12.【下一题】browser_snapshot → browser_click("下一题") → browser_wait_for(2)
   预期：进入 7-2 作答页面

13.【阶段二】判断题型 → 编程题
   重复步骤 10-11

14.【全部完成】
   browser_unlock
   输出："两题全部通过，得分：10/10 和 10/10"
```

---

## 常见问题与解决方案

### Q1：编程题编译错误——新旧代码混合（最常见！）

**现象**：提交后弹窗显示"编译错误"，编译器输出显示代码末尾出现 `}#include <stdio.h>` 或重复的 `int main` 等内容

**根因**：`browser_type` 的 `clear: true` 参数对 contentEditable DIV 清空不彻底。它在 ProseMirror 编辑器中只清空了可见文本，但底层 HTML 结构节点残留

**正确做法**：
1. 每次输入代码前，先用 `browser_evaluate` 执行 `execCommand('selectAll')` + `execCommand('delete')` 彻底清空
2. 执行后验证编辑框为空（再 evaluate 检查 innerText 长度是否为 0）
3. 确认清空后再用 `browser_type` 输入新代码
4. 输入后再验证代码首尾，确保尾部没有重复内容

### Q2：选择题点选项没反应

**现象**：用 `browser_click` 点了选项的 ref，但选项没有被选中，radio button 状态未变化

**根因**：不同 PTA 页面有不同的 DOM 结构：
- 有些页面 radio 被 CSS 隐藏，点击事件绑在 `<label>` 上
- 有些页面选项是纯 `<div>` + click 事件，没有 radio
- 有些页面选项被多个嵌套元素包裹，需要点正确的层级

**正确做法**：
1. 先用 `browser_evaluate` 查看页面中所有 radio 和 label 的结构
2. 优先尝试点击 `<label>` 而不是 `<input>`
3. 如果还是不行，用 evaluate 直接设置 `radio.checked = true` 并触发 change 事件：

```js
var radio = document.querySelector('input[type="radio"][value="正确选项的值"]');
if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('click', { bubbles: true }));
}
```

### Q3：填空题 value 设置了但保存后答案为空

**现象**：`browser_evaluate` 设置了 `input.value = '答案'`，但保存后刷新页面发现答案丢失

**根因**：React/Vue 等框架通过事件监听维护内部状态（虚拟 DOM），直接修改 DOM 属性不触发框架的 setState / reactivity 更新

**正确做法**：
设置 value 后必须执行：
```js
inp.value = '答案';
inp.dispatchEvent(new Event('input', { bubbles: true }));
inp.dispatchEvent(new Event('change', { bubbles: true }));
```
`bubbles: true` 确保事件能冒泡到框架的事件代理层。

### Q4：提交后弹窗未关闭就操作下一题

**现象**：点击"下一题"后发现页面没有变化，或者 snapshot 中仍能看到弹窗内容

**正确做法**：
1. **读结果 → 点"确认" → 等 2 秒 → snapshot 确认弹窗已消失 → 再点"下一题"**
2. 验证弹窗消失的方法：snapshot 中不应再出现"提交结果"、"状态"、"分数"等弹窗关键词

### Q5：刷新后仍是"排队中"

**现象**：点击"刷新"按钮多次后弹窗仍显示"排队中"或"等待评测"

**根因**：PTA 评测队列繁忙（通常是期末考试或作业截止前的高峰期）

**正确做法**：
1. 每次点击刷新后 `browser_wait_for`（第 1 次等 3 秒，第 2~3 次等 5 秒，之后等 8 秒）
2. 最多尝试 5 次刷新（总计约 30 秒）
3. 如果 5 次后仍在排队，告知用户"评测队列繁忙，稍后继续"，然后暂停等待 30 秒后重试

### Q6：snapshot 后用旧 ref 点击报错 "Element not found"

**现象**：用之前 snapshot 拿到的 ref 调用 `browser_click`，报错找不到元素

**根因**：页面发生了任何变化（导航到新页面、弹窗出现/消失、题型切换、内容刷新），元素被重新渲染，旧 ref 失效

**正确做法**：
1. **每次操作前都重新 snapshot**——这是最重要的规则
2. 特别是以下操作后必须重新 snapshot：
   - `browser_navigate` 之后
   - `browser_click`（导航类按钮）之后
   - 弹窗关闭之后
   - `browser_type`（可能触发表单重新渲染）之后

### Q7：题目描述中含有图片或公式，snapshot 中看不到

**现象**：snapshot 的文本中题目描述不完整，缺少关键信息

**根因**：snapshot 只能获取文本内容，图片、Canvas、SVG 公式无法以文本形式呈现

**正确做法**：
1. 尝试从题目周围的文字上下文中推断
2. 如果图片是关键信息且无法推断 → 告知用户"题目中有图片，请提供文字描述"
3. 如果是不影响理解的辅助图示 → 忽略，继续作答

### Q8：点击 radio 选项时被遮挡（Click target intercepted）

**现象**：`browser_click` 报错 `Click target intercepted`，提示"Click would hit a different element"（如顶部导航栏 `JXH答题中` 浮层覆盖了目标选项）

**根因**：PTA 页面顶部有固定定位（`position: fixed`）的导航栏或状态栏，当目标 radio 滚动到页面顶部附近时，被这些浮层遮挡

**正确做法**：
1. **首选方案**：使用 `browser_evaluate` 通过文本匹配找到目标 radio 并直接点击，绕过遮挡：

```js
var radios = document.querySelectorAll('input[type="radio"]');
for (var i = 0; i < radios.length; i++) {
    var parent = radios[i].parentElement;
    var txt = (parent ? (parent.innerText || parent.textContent || '') : '').trim();
    if (txt.indexOf('目标选项的关键文本') >= 0) {
        radios[i].click();
        return 'CLICKED at index: ' + i;
    }
}
return 'NOT FOUND';
```

2. **备选方案**：先 `browser_scroll` 将目标 ref 滚动到页面可视区域的下半部分（远离顶部导航栏），再重试 `browser_click`
3. **注意**：`indexOf` 匹配时使用选项文本的**核心特征词**（如选项值 `3, 1, 6, 13, 11, 5`），不要用太短的通用词（如只匹配 `A.`），避免误点

---

## 关键原则总结

1. **lock → 操作 → unlock**：每次 PTA 操作都要在这个三段式框架内进行
2. **先 snapshot 再操作**：眼睛要先看到最新的页面状态，手才能准确操作
3. **编程题编辑框是 contentEditable DIV**：不是 textarea，清空用 `execCommand('selectAll')` + `execCommand('delete')`，不要依赖 `browser_type` 的 `clear`
4. **提交后必须看弹窗结果**：弹窗内容才是真实的评测反馈，不能提交完就走
5. **排队中点刷新**：循环点击刷新 + 等待，直到出结果（最多 5 次）
6. **编译错误 → 完整替换代码**：不要局部修改，必须彻底清空后重新输入全部代码
7. **答案正确 → 先点确认关弹窗 → 再操作下一题**：弹窗不关 = 页面被阻塞
8. **填空/选择/判断非满分 → 重新分析**：修改选项或答案后重新保存提交
9. **完成一道再下一道**：不要跨题操作，弹窗未关不要点下一题
10. **React/Vue 页面改值后要 dispatchEvent**：直接改 DOM value 框架感知不到，必须触发 input 和 change 事件
11. **考试页面优先直达**：如果用户提供了 `/exam/problems/type/N` 格式的 URL，直接导航过去即可，不需要从仪表盘逐级进入
12. **考试批量模式一页全答**：考试页面同一题型的所有题目在同一页上，先全部答完再统一保存，不要逐题保存
13. **点击被拦截用 evaluate 兜底**：`browser_click` 报 `Click target intercepted` 时，用 `browser_evaluate` 按文本匹配直接点击元素，绕过 DOM 遮挡