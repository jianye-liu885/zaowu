# 造物 Zaowu · 对话即应用

Agent 驱动的 Web 应用生成平台：用一句话描述需求，AI 实时生成一个完整可运行的
Web 应用并在浏览器里直接预览；可以继续对话迭代修改，每次生成留存版本，随时回滚；
一键发布成公开链接分享给任何人。

**在线体验**：https://zaowu.wenloom.com

## 功能

- **对话生成应用**：自然语言 → 完整单文件 Web 应用（HTML/CSS/JS 内联，无外部依赖）
- **流式直播**：生成过程 SSE 逐字推送，说明文字实时显示
- **沙箱实时预览**：生成的应用在 sandboxed iframe 中真实运行（可交互，非截图）
- **对话式迭代**：在当前代码基础上修改，保留已有功能
- **版本管理**：每次生成自动存版本，可查看任意历史版本、一键回滚
- **发布分享**：生成公开短链 `/s/{slug}`，任何人可直接使用该应用；可随时取消
- **多项目 + 账号体系**：邮箱验证码注册/登录（SMTP 未配置时自动降级 mock，验证码打日志便于本地联调），项目和版本全部持久化
- **免登录墙**：进站即可输入想法，发送时才引导注册，注册完成后任务自动开跑

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | FastAPI（单文件 `backend/app.py`） | REST + SSE 流式 |
| 持久化 | SQLite | 用户/项目/版本/消息四张表 |
| LLM | DeepSeek（OpenAI 兼容） | 流式输出，16K max_tokens |
| 前端 | React 18 + Vite + TS | 无 UI 库，手写样式 |
| 部署 | 阿里云 ECS + nginx + systemd + Let's Encrypt | |

## 本地运行

```bash
# 后端
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DEEPSEEK_API_KEY=sk-xxx .venv/bin/python -m uvicorn app:app --port 8002

# 前端（开发模式，/api 代理到 8002）
cd web && npm install && npm run dev

# 或构建后由后端直接托管
cd web && npm run build   # 然后直接访问 http://127.0.0.1:8002
```

## 架构要点

- **生成契约**：system prompt 要求模型输出「1-2 句变更说明 + ```html 完整单文件」，
  后端用围栏解析；解析失败返回明确错误而不是存脏数据。
- **迭代修改**：每轮把当前最新版本代码 + 修改指令发给模型，历史对话只带说明文字
  不带旧代码，控制上下文长度。
- **安全**：预览 iframe 使用 `sandbox="allow-scripts allow-modals allow-forms"`，
  生成的应用无法访问宿主页面；密码 PBKDF2(20万轮) 加盐存储。
