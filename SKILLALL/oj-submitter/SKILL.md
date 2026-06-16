---
name: "oj-submitter"
description: "Automates HUSTOJ/SDUSTOJ code submission, result checking, and iterative error fixing via HTTP. Invoke when user asks to submit code to an OJ, check OJ results, fix OJ errors (Wrong Answer, Compile Error, Invalid Word), or batch-submit contest problems."
---

# OJ Submitter - HUSTOJ/SDUSTOJ 自动化提交技能

## 概述

本技能用于自动化 HUSTOJ/SDUSTOJ 在线评测系统的代码提交、结果检查、错误诊断和迭代修复全流程。通过 Python + urllib 直接发送 HTTP 请求，无需浏览器交互。

## 适用场景

- 用户提供了 OJ 地址、PHPSESSID 和竞赛 ID，要求提交代码
- 批量提交竞赛题目并检查结果
- 提交后出现错误（Wrong Answer / Compile Error / Invalid Word），需要诊断并修复
- 需要在提交间保持指定间隔（如 13 秒）的循环提交修复流程

## 核心流程

```
┌──────────────────────────────────────────────────────────────────┐
│  1. 准备阶段                                                      │
│     ├── 确认 BASE_URL, CONTEST_CID, PHPSESSID                    │
│     ├── 读取 cookies.txt 认证信息                                 │
│     └── 确认题目 PID 与 Problem ID 的映射关系                     │
├──────────────────────────────────────────────────────────────────┤
│  2. 提交阶段                                                      │
│     ├── 读取 .cpp 源码文件                                       │
│     ├── POST 到 submit.php（cid, pid, language=1, source）        │
│     └── 每次提交间隔 >= 13 秒                                    │
├──────────────────────────────────────────────────────────────────┤
│  3. 检查阶段                                                      │
│     ├── GET status.php 获取提交记录                              │
│     ├── 解析表格，提取 Result 字段                               │
│     └── 判断: Accepted / Wrong Answer / Compile Error / ...      │
├──────────────────────────────────────────────────────────────────┤
│  4. 诊断阶段（如果有错误）                                        │
│     ├── Invalid Word  → GET iwinfo.php?sid={runid} → 查看禁用词  │
│     ├── Compile Error → GET ceinfo.php?sid={runid} → 查看编译错误│
│     └── Wrong Answer  → 分析题目逻辑，修改代码                   │
├──────────────────────────────────────────────────────────────────┤
│  5. 修复阶段                                                      │
│     ├── 根据错误信息修改代码文件                                  │
│     ├── 重新提交（间隔 >= 13 秒）                                │
│     └── 循环直到 AC                                              │
└──────────────────────────────────────────────────────────────────┘
```

## 关键细节

### 1. Cookie 认证

cookie 文件格式（Netscape HTTP Cookie 格式）：

```
192.168.119.211	FALSE	/	FALSE	0	PHPSESSID	r6mo0g4akd1vh39uheupr9n3h6
```

加载方式：

```python
def load_cookies():
    cookies = {}
    with open(COOKIE_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                parts = line.split('\t')
                if len(parts) >= 7:
                    name, value = parts[5], parts[6]
                    cookies[name] = value
    return cookies
```

### 2. 提交代码

```python
def submit_problem(pid, code_path, cookies):
    with open(code_path, 'r', encoding='utf-8') as f:
        source = f.read()
    
    data = urllib.parse.urlencode({
        'cid': str(CONTEST_CID),
        'pid': str(pid),          # 竞赛内的 PID（0-based）
        'language': '1',          # 1 = C++
        'source': source
    }).encode('utf-8')
    
    req = urllib.request.Request(f"{BASE_URL}/submit.php", data=data)
    req.add_header('Cookie', '; '.join([f"{k}={v}" for k, v in cookies.items()]))
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    req.add_header('Referer', f"{BASE_URL}/submitpage.php?cid={CONTEST_CID}&pid={pid}&langmask=1021")
    
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()
```

### 3. 竞赛 PID 与 Problem ID 的映射

HUSTOJ 中，竞赛内的题目使用 `pid`（0-based: A=0, B=1, ...），但全局状态页面使用 `problem.php?id=XXXX`（数字 ID）。需要通过竞赛页面获取映射：

```python
# 获取竞赛页面
url = f"{BASE_URL}/contest.php?cid={CONTEST_CID}"
# 解析 HTML 获取映射关系
# 例如: Problem E → pid=4 → problem.php?id=1542
```

### 4. 检查提交结果

```python
# 获取状态页面
status_url = f"{BASE_URL}/status.php?user_id={USER_ID}&order=desc&sort=time"
html = # ... 发起请求

# 解析表格行
rows = re.findall(r'<tr[^>]*class="[^"]*(?:row)"[^>]*>(.*?)</tr>', html, re.DOTALL)

for row in rows:
    pid_match = re.search(r'problem\.php\?id=(\d+)', row)
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    result = re.sub(r'<[^>]+>', '', cells[3]).strip()
    # 判断: 'Accepted' in result
```

### 5. 结果类型

| 结果 | 含义 | 处理方式 |
|------|------|----------|
| **Accepted** | 通过 | 完成 |
| **Wrong Answer** | 答案错误 | 检查逻辑，修改代码 |
| **Compile Error** | 编译错误 | 查看 ceinfo.php 诊断 |
| **Invalid Word** | 禁用词 | 查看 iwinfo.php 诊断 |
| **Time Limit Exceed** | 超时 | 优化算法 |
| **Runtime Error** | 运行时错误 | 检查数组越界/空指针 |
| **Presentation Error** | 格式错误 | 检查空格/换行 |

### 6. 错误诊断

**Invalid Word（禁用词）**：
```python
# 获取禁用词详情
url = f"{BASE_URL}/iwinfo.php?sid={runid}"
# → 解析返回的 HTML，查看 "Black Words" 部分
# → 常见禁用词: string, vector, cstring 等
# → 注意：注释中的词也会被检测！
```

**Compile Error（编译错误）**：
```python
# 获取编译错误详情
url = f"{BASE_URL}/ceinfo.php?sid={runid}"
# → 解析返回的 HTML，查看具体编译错误信息
# → 常见问题: 缺少头文件、未声明标识符、语法错误
```

### 7. C++98 兼容性注意事项

在 HUSTOJ 环境下写 C++ 代码时：

- 使用 `#include <iostream>` 和 `using namespace std;`
- 避免使用 `auto`、`nullptr`、`std::move` 等 C++11 特性
- 模板类需要 `sort` + `greater<T>()` 而非 lambda
- 字符串处理需手动实现，不能使用 `std::string`（如果题目禁用）
- 动态数组用 `new[]` / `delete[]`，析构函数中释放

### 8. append.cc 机制

HUSTOJ 的很多题目使用 `append.cc` 机制：
- 系统自动将 `append.cc` 的内容追加到提交代码末尾
- 提交的代码只需要写**类定义和必要的头文件**
- **不要**写自己的 `main()` 函数

### 9. 提交间隔

**必须严格遵守提交间隔 >= 13 秒**，否则可能触发 OJ 的防刷机制：

```python
import time
time.sleep(13)  # 每次提交后等待至少 13 秒
```

## 完整工作流示例

```python
# 1. 准备
cookies = load_cookies()

# 2. 提交
submit_problem(pid=4, code_path="ProblemE.cpp", cookies=cookies)
time.sleep(13)

# 3. 检查
html = get_status_page(cookies)
result = parse_result(html, target_pid=1542)

# 4. 诊断
if "Invalid Word" in result:
    error_info = get_iwinfo(runid, cookies)
    # 根据错误修改代码
elif "Compile Error" in result:
    error_info = get_ceinfo(runid, cookies)
    # 根据错误修改代码
elif "Wrong Answer" in result:
    # 分析逻辑，修改代码

# 5. 修复并重新提交
time.sleep(13)
submit_problem(pid=4, code_path="ProblemE.cpp", cookies=cookies)
# ... 循环直到 AC
```

## 常见错误与修复

### Invalid Word
- **原因**：代码中出现了禁用词（包括注释中）
- **修复**：移除所有禁用词，包括变量名、注释、头文件中的
- **注意**：`#include <cstring>` 中的 `cstring` 也可能被检测

### Compile Error
- **原因**：语法错误、缺少头文件、缺少 using namespace std
- **修复**：添加必要的 `#include` 和 `using namespace std;`

### Wrong Answer
- **原因**：逻辑错误、边界条件未处理
- **修复**：仔细分析题目描述和样例，检查所有边界情况
- **注意**：OJ 通常有多个测试用例，仅通过样例不一定能 AC

## 文件结构

```
OJtext/
├── cookies.txt              # PHPSESSID 认证信息
├── ProblemE.cpp ~ ProblemJ.cpp  # 各题目代码
├── submit_homework7.py      # 批量提交脚本
├── submit_problem_X_fixed.py   # 单题提交+检查脚本
├── save_status.py           # 保存状态页面 HTML
├── get_compile_error.py     # 获取编译错误详情
├── get_invalid_word_error.py   # 获取禁用词详情
├── final_status.py          # 汇总最终结果
└── .trae/skills/oj-submitter/
    └── SKILL.md             # 本技能文件
```