"""造物 Zaowu — 对话即应用。

单文件 FastAPI 后端：注册/登录、项目管理、Agent 流式生成单文件 Web 应用、
版本留存/回滚、公开分享链接。持久化 SQLite，LLM 走 DeepSeek(OpenAI 兼容)。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("ZAOWU_DB", ROOT / "zaowu.db"))
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MODEL = os.environ.get("ZAOWU_MODEL", "deepseek-v4-pro")

app = FastAPI(title="Zaowu")


# ---------- DB ----------
@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
          id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
          pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS tokens(
          token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS projects(
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL, share_slug TEXT UNIQUE,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS versions(
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
          seq INTEGER NOT NULL, instruction TEXT NOT NULL, summary TEXT NOT NULL,
          html TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
          role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS email_codes(
          email TEXT PRIMARY KEY, code TEXT NOT NULL,
          expires_at INTEGER NOT NULL, last_sent INTEGER NOT NULL);
        """)


init_db()


def _hash(pw: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()


def _now() -> int:
    return int(time.time())


def _id() -> str:
    return secrets.token_hex(12)


# ---------- Auth ----------
def current_user(authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "未登录")
    with db() as c:
        row = c.execute(
            "SELECT u.id, u.username FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token=?",
            (token,)).fetchone()
    if not row:
        raise HTTPException(401, "登录已失效")
    return dict(row)


class AuthBody(BaseModel):
    username: str
    password: str
    code: str = ""


# ---------- 邮箱验证码（SMTP 未配置时降级 mock：验证码打日志，便于本地联调） ----------
CODE_TTL = 600  # 10 分钟
SEND_INTERVAL = 60


def _send_code_email(to_email: str, code: str) -> bool:
    host = os.environ.get("MAIL_SMTP_HOST", "")
    user = os.environ.get("MAIL_SMTP_USER", "")
    password = os.environ.get("MAIL_SMTP_PASS", "")
    if not (host and user and password):
        print(f"[mailer:mock] 未配置 SMTP，验证码未真实发送 → {to_email} code={code}", flush=True)
        return True
    import smtplib
    import ssl
    from email.header import Header
    from email.mime.text import MIMEText
    from email.utils import formataddr

    port = int(os.environ.get("MAIL_SMTP_PORT", "465"))
    from_name = os.environ.get("MAIL_FROM_NAME", "造物 Zaowu")
    msg = MIMEText(f"你正在注册造物 Zaowu 账号。\n\n验证码：{code}\n\n"
                   f"10 分钟内有效，请勿泄露给他人。如非本人操作，请忽略本邮件。", "plain", "utf-8")
    msg["Subject"] = Header("【造物 Zaowu】注册验证码", "utf-8")
    msg["From"] = formataddr((str(Header(from_name, "utf-8")), user))
    msg["To"] = to_email
    try:
        ctx = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15, context=ctx) as s:
                s.login(user, password)
                s.sendmail(user, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=15) as s:
                s.starttls(context=ctx)
                s.login(user, password)
                s.sendmail(user, [to_email], msg.as_string())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[mailer] 发送失败 to={to_email}: {e}", flush=True)
        return False


class SendCodeBody(BaseModel):
    email: str


@app.post("/api/send-code")
def send_code(body: SendCodeBody):
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "请输入有效邮箱")
    now = _now()
    with db() as c:
        if c.execute("SELECT 1 FROM users WHERE username=?", (email,)).fetchone():
            raise HTTPException(400, "该邮箱已注册，请直接登录")
        row = c.execute("SELECT last_sent FROM email_codes WHERE email=?", (email,)).fetchone()
        if row and now - row["last_sent"] < SEND_INTERVAL:
            raise HTTPException(429, f"发送太频繁，请 {SEND_INTERVAL - (now - row['last_sent'])} 秒后再试")
        code = f"{secrets.randbelow(1000000):06d}"
        if not _send_code_email(email, code):
            raise HTTPException(500, "验证码发送失败，请稍后再试")
        c.execute("INSERT OR REPLACE INTO email_codes VALUES(?,?,?,?)",
                  (email, code, now + CODE_TTL, now))
    return {"ok": True}


@app.post("/api/register")
def register(body: AuthBody):
    name = body.username.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", name):
        raise HTTPException(400, "请使用有效邮箱注册")
    if len(body.password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    salt = secrets.token_hex(8)
    with db() as c:
        if c.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
            raise HTTPException(400, "用户名已存在")
        row = c.execute("SELECT code, expires_at FROM email_codes WHERE email=?", (name,)).fetchone()
        if not row or row["expires_at"] < _now():
            raise HTTPException(400, "请先获取验证码" if not row else "验证码已过期，请重新获取")
        if body.code.strip() != row["code"]:
            raise HTTPException(400, "验证码错误")
        c.execute("DELETE FROM email_codes WHERE email=?", (name,))
        uid = _id()
        c.execute("INSERT INTO users VALUES(?,?,?,?)",
                  (uid, name, f"{salt}${_hash(body.password, salt)}", _now()))
        token = secrets.token_hex(24)
        c.execute("INSERT INTO tokens VALUES(?,?,?)", (token, uid, _now()))
    return {"token": token, "username": name}


@app.post("/api/login")
def login(body: AuthBody):
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (body.username.strip(),)).fetchone()
        if not row:
            raise HTTPException(400, "用户名或密码错误")
        salt, h = row["pass_hash"].split("$")
        if _hash(body.password, salt) != h:
            raise HTTPException(400, "用户名或密码错误")
        token = secrets.token_hex(24)
        c.execute("INSERT INTO tokens VALUES(?,?,?)", (token, row["id"], _now()))
    return {"token": token, "username": row["username"]}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return user


# ---------- Projects ----------
class ProjectBody(BaseModel):
    name: str


@app.get("/api/projects")
def list_projects(user: dict = Depends(current_user)):
    with db() as c:
        rows = c.execute("""
          SELECT p.id, p.name, p.share_slug, p.updated_at,
                 (SELECT COUNT(*) FROM versions v WHERE v.project_id=p.id) AS version_count
          FROM projects p WHERE p.user_id=? ORDER BY p.updated_at DESC""",
                         (user["id"],)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/projects")
def create_project(body: ProjectBody, user: dict = Depends(current_user)):
    name = body.name.strip() or "未命名应用"
    pid = _id()
    with db() as c:
        c.execute("INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
                  (pid, user["id"], name, _now(), _now()))
    return {"id": pid, "name": name}


def _own_project(c, pid: str, uid: str):
    row = c.execute("SELECT * FROM projects WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "项目不存在")
    return row


@app.get("/api/projects/{pid}")
def get_project(pid: str, user: dict = Depends(current_user)):
    with db() as c:
        p = _own_project(c, pid, user["id"])
        msgs = c.execute("SELECT role,content,created_at FROM messages WHERE project_id=? ORDER BY created_at,id",
                         (pid,)).fetchall()
        vers = c.execute("SELECT id,seq,instruction,summary,created_at FROM versions WHERE project_id=? ORDER BY seq DESC",
                         (pid,)).fetchall()
        latest = c.execute("SELECT html FROM versions WHERE project_id=? ORDER BY seq DESC LIMIT 1",
                           (pid,)).fetchone()
    return {"id": p["id"], "name": p["name"], "share_slug": p["share_slug"],
            "messages": [dict(m) for m in msgs], "versions": [dict(v) for v in vers],
            "html": latest["html"] if latest else ""}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str, user: dict = Depends(current_user)):
    with db() as c:
        _own_project(c, pid, user["id"])
        c.execute("DELETE FROM messages WHERE project_id=?", (pid,))
        c.execute("DELETE FROM versions WHERE project_id=?", (pid,))
        c.execute("DELETE FROM projects WHERE id=?", (pid,))
    return {"ok": True}


@app.get("/api/projects/{pid}/versions/{vid}")
def get_version(pid: str, vid: str, user: dict = Depends(current_user)):
    with db() as c:
        _own_project(c, pid, user["id"])
        v = c.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (vid, pid)).fetchone()
    if not v:
        raise HTTPException(404, "版本不存在")
    return dict(v)


@app.post("/api/projects/{pid}/versions/{vid}/rollback")
def rollback(pid: str, vid: str, user: dict = Depends(current_user)):
    """把历史版本复制为最新版本（不破坏历史）。"""
    with db() as c:
        _own_project(c, pid, user["id"])
        v = c.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (vid, pid)).fetchone()
        if not v:
            raise HTTPException(404, "版本不存在")
        seq = (c.execute("SELECT MAX(seq) AS m FROM versions WHERE project_id=?", (pid,)).fetchone()["m"] or 0) + 1
        c.execute("INSERT INTO versions VALUES(?,?,?,?,?,?,?)",
                  (_id(), pid, seq, f"回滚到 v{v['seq']}", f"回滚到 v{v['seq']}：{v['summary']}", v["html"], _now()))
        c.execute("UPDATE projects SET updated_at=? WHERE id=?", (_now(), pid))
    return {"ok": True, "seq": seq}


# ---------- 分享 ----------
@app.post("/api/projects/{pid}/share")
def share(pid: str, user: dict = Depends(current_user)):
    with db() as c:
        p = _own_project(c, pid, user["id"])
        slug = p["share_slug"]
        if slug:
            c.execute("UPDATE projects SET share_slug=NULL WHERE id=?", (pid,))
            return {"share_slug": None}
        slug = secrets.token_urlsafe(6)
        c.execute("UPDATE projects SET share_slug=? WHERE id=?", (slug, pid))
    return {"share_slug": slug}


@app.get("/s/{slug}")
def shared_app(slug: str):
    with db() as c:
        row = c.execute("""SELECT v.html FROM projects p
          JOIN versions v ON v.project_id=p.id
          WHERE p.share_slug=? ORDER BY v.seq DESC LIMIT 1""", (slug,)).fetchone()
    if not row:
        raise HTTPException(404, "分享不存在或已关闭")
    return HTMLResponse(row["html"])


# ---------- Agent 生成 ----------
SYSTEM_PROMPT = """你是「造物」平台的应用构建 Agent。用户用自然语言描述需求，你产出一个完整可运行的单文件 Web 应用。

硬性规则：
1. 输出格式：先用 1-2 句话说明你做了什么/改了什么（面向用户，中文），然后紧跟一个 ```html 代码块，内含完整的单文件应用。
2. 代码块必须是完整 HTML 文档（<!DOCTYPE html> 开头），所有 CSS/JS 内联，不引用任何外部资源（无 CDN、无外链字体/图片；图标用 emoji 或内联 SVG）。
3. 应用要真实可交互、有设计感：合理配色、间距、响应式；数据需要保存时用 localStorage。
4. 若用户是在修改已有应用（上下文中给了当前代码），必须在当前代码基础上改，保留已有功能，输出修改后的完整文件。
5. 代码块之外不要出现任何代码；说明文字保持简短。"""


class GenBody(BaseModel):
    instruction: str


def _extract_html(text: str) -> tuple[str, str]:
    """返回 (说明文字, html)。html 取最后一个 ```html 围栏内容。"""
    blocks = re.findall(r"```html\s*\n(.*?)```", text, re.S)
    if not blocks:
        blocks = re.findall(r"```\s*\n(<!DOCTYPE.*?)```", text, re.S)
    html = blocks[-1].strip() if blocks else ""
    summary = text.split("```", 1)[0].strip()[:500]
    return summary, html


@app.post("/api/projects/{pid}/generate")
def generate(pid: str, body: GenBody, user: dict = Depends(current_user)):
    """SSE 流式生成：chunk 增量 → done(版本已保存) / error。"""
    instruction = body.instruction.strip()
    if not instruction:
        raise HTTPException(400, "指令为空")
    if not DEEPSEEK_KEY:
        raise HTTPException(500, "服务端未配置 DEEPSEEK_API_KEY")

    with db() as c:
        _own_project(c, pid, user["id"])
        latest = c.execute("SELECT html FROM versions WHERE project_id=? ORDER BY seq DESC LIMIT 1",
                           (pid,)).fetchone()
        history = c.execute(
            "SELECT role,content FROM messages WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 8",
            (pid,)).fetchall()
    current_html = latest["html"] if latest else ""

    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in reversed(history):  # 只带说明性对话，不带旧代码，控制上下文
        msgs.append({"role": m["role"], "content": m["content"][:600]})
    user_content = instruction
    if current_html:
        user_content = f"当前应用代码：\n```html\n{current_html}\n```\n\n修改要求：{instruction}"
    msgs.append({"role": "user", "content": user_content})

    def sse(event: dict) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    def stream():
        full = ""
        try:
            with httpx.stream(
                "POST", f"{DEEPSEEK_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"},
                json={"model": MODEL, "messages": msgs, "stream": True,
                      "max_tokens": 16384, "temperature": 0.6},
                timeout=httpx.Timeout(300, connect=15),
            ) as resp:
                if resp.status_code != 200:
                    resp.read()
                    yield sse({"type": "error", "message": f"模型调用失败 HTTP {resp.status_code}"})
                    return
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    delta = (json.loads(data).get("choices") or [{}])[0].get("delta", {})
                    think = delta.get("reasoning_content") or ""
                    if think:
                        yield sse({"type": "reasoning", "text": think})
                    piece = delta.get("content") or ""
                    if piece:
                        full += piece
                        yield sse({"type": "chunk", "text": piece})
        except Exception as e:  # noqa: BLE001
            yield sse({"type": "error", "message": f"生成中断：{e}"})
            return

        summary, html = _extract_html(full)
        if not html:
            yield sse({"type": "error", "message": "模型未输出有效应用代码，请换个说法重试"})
            return
        with db() as c:
            seq = (c.execute("SELECT MAX(seq) AS m FROM versions WHERE project_id=?",
                             (pid,)).fetchone()["m"] or 0) + 1
            vid = _id()
            c.execute("INSERT INTO versions VALUES(?,?,?,?,?,?,?)",
                      (vid, pid, seq, instruction, summary or f"生成 v{seq}", html, _now()))
            c.execute("INSERT INTO messages VALUES(?,?,?,?,?)",
                      (_id(), pid, "user", instruction, _now()))
            c.execute("INSERT INTO messages VALUES(?,?,?,?,?)",
                      (_id(), pid, "assistant", summary or f"已生成 v{seq}", _now() + 1))
            c.execute("UPDATE projects SET updated_at=? WHERE id=?", (_now(), pid))
        yield sse({"type": "done", "version": {"id": vid, "seq": seq, "summary": summary,
                                               "instruction": instruction}, "html": html})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- SPA 托管 ----------
DIST = ROOT.parent / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
