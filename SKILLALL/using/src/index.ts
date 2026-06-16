import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import BrowserManager from "./browser-manager.js";

const server = new McpServer({
  name: "integrated-browser",
  version: "1.0.0"
});

// Tool: browser_lock
server.registerTool(
  "browser_lock",
  {
    description: "锁定浏览器，获取独占操作权。在开始操作页面前必须先调用此工具",
    inputSchema: z.object({}).strict()
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

// Tool: browser_unlock
server.registerTool(
  "browser_unlock",
  {
    description: "解锁浏览器，释放独占操作权。在所有操作完成后必须调用此工具",
    inputSchema: z.object({}).strict()
  },
  async () => {
    BrowserManager.getInstance().unlock();
    return { content: [{ type: "text", text: "浏览器已解锁" }] };
  }
);

// Tool: browser_navigate
server.registerTool(
  "browser_navigate",
  {
    description: "导航到指定的 URL。等价于在浏览器地址栏输入网址并回车",
    inputSchema: z.object({
      url: z.string().describe("要导航到的完整 URL")
    }).strict()
  },
  async (args: { url: string }) => {
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

// Tool: browser_snapshot
server.registerTool(
  "browser_snapshot",
  {
    description: "获取当前页面的文本快照和所有可交互元素的 ref 编号。每次操作前必须调用此工具获取最新 ref",
    inputSchema: z.object({}).strict()
  },
  async () => {
    const page = await BrowserManager.getInstance().getPage();
    
    const bodyText = await page.evaluate(() => document.body.innerText);
    
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
    
    let output = '';
    output += '=== 页面文本 ===\n';
    output += bodyText.substring(0, 8000);
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

// Tool: browser_click
server.registerTool(
  "browser_click",
  {
    description: "点击指定 ref 编号的元素",
    inputSchema: z.object({
      ref: z.number().describe("从 browser_snapshot 返回的元素 ref 编号")
    }).strict()
  },
  async (args: { ref: number }) => {
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

// Tool: browser_type
server.registerTool(
  "browser_type",
  {
    description: "在指定 ref 的输入框或编辑器中输入文本",
    inputSchema: z.object({
      ref: z.number().describe("从 browser_snapshot 返回的元素 ref 编号"),
      text: z.string().describe("要输入的文本内容"),
      clear: z.boolean().optional().describe("是否先清空已有内容，默认 false")
    }).strict()
  },
  async (args: { ref: number; text: string; clear?: boolean }) => {
    const page = await BrowserManager.getInstance().getPage();
    const locator = page.locator(`[data-ref="${args.ref}"]`);
    await locator.scrollIntoViewIfNeeded();
    
    if (args.clear) {
      await locator.click();
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

// Tool: browser_scroll
server.registerTool(
  "browser_scroll",
  {
    description: "滚动页面使指定 ref 的元素进入可视区域",
    inputSchema: z.object({
      ref: z.number().describe("从 browser_snapshot 返回的元素 ref 编号")
    }).strict()
  },
  async (args: { ref: number }) => {
    const page = await BrowserManager.getInstance().getPage();
    const locator = page.locator(`[data-ref="${args.ref}"]`);
    await locator.scrollIntoViewIfNeeded();
    return {
      content: [{ type: "text", text: `已滚动到 ref=${args.ref} 的元素` }]
    };
  }
);

// Tool: browser_evaluate
server.registerTool(
  "browser_evaluate",
  {
    description: "在页面中执行 JavaScript 代码并返回结果",
    inputSchema: z.object({
      script: z.string().describe("要执行的 JavaScript 代码字符串")
    }).strict()
  },
  async (args: { script: string }) => {
    const page = await BrowserManager.getInstance().getPage();
    try {
      const result = await page.evaluate(args.script);
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

// Tool: browser_wait_for
server.registerTool(
  "browser_wait_for",
  {
    description: "等待指定的秒数",
    inputSchema: z.object({
      time: z.number().describe("等待的秒数")
    }).strict()
  },
  async (args: { time: number }) => {
    await new Promise(resolve => setTimeout(resolve, args.time * 1000));
    return {
      content: [{ type: "text", text: `已等待 ${args.time} 秒` }]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
