import { useState } from "react";
import { api, setToken } from "./api";

export function Login({ onLogin }: { onLogin: (u: { username: string }) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const fn = mode === "login" ? api.login : api.register;
      const r = await fn(username, password);
      setToken(r.token);
      onLogin({ username: r.username });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-row">
          <span className="logo">造</span>
          <div>
            <h1>造物 Zaowu</h1>
            <div className="muted">对话即应用 · Agent 驱动的 Web 应用生成平台</div>
          </div>
        </div>
        <div className="seg">
          <button type="button" className={mode === "login" ? "on" : ""}
            onClick={() => setMode("login")}>登录</button>
          <button type="button" className={mode === "register" ? "on" : ""}
            onClick={() => setMode("register")}>注册</button>
        </div>
        <input value={username} onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名（≥2位）" autoComplete="username" />
        <input value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（≥6位）" type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy || !username.trim() || password.length < 6}>
          {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并进入"}
        </button>
        <div className="muted tip">
          注册后：新建项目 → 用一句话描述你想要的应用 → 实时看它被造出来。
        </div>
      </form>
    </div>
  );
}
