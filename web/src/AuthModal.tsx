import { useState } from "react";
import { api, setToken } from "./api";

export function AuthModal({ reason, onDone, onClose }: {
  reason?: string;
  onDone: (u: { username: string }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 6;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setError("");
    setBusy(true);
    try {
      const fn = mode === "register" ? api.register : api.login;
      const r = await fn(email.trim(), password);
      setToken(r.token);
      onDone({ username: r.username });
    } catch (err) {
      const msg = (err as Error).message;
      // 已注册的邮箱直接引导去登录
      if (mode === "register" && msg.includes("已存在")) {
        setMode("login");
        setError("该邮箱已注册，请直接登录");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="auth-card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="brand-row">
          <span className="logo">造</span>
          <div>
            <h1>{mode === "register" ? "用邮箱注册" : "登录"}</h1>
            {reason && <div className="muted" style={{ fontSize: 12.5 }}>{reason}</div>}
          </div>
        </div>
        <div className="seg">
          <button type="button" className={mode === "register" ? "on" : ""}
            onClick={() => { setMode("register"); setError(""); }}>邮箱注册</button>
          <button type="button" className={mode === "login" ? "on" : ""}
            onClick={() => { setMode("login"); setError(""); }}>已有账号</button>
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱" type="email" autoComplete="email" autoFocus />
        <input value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（≥6位）" type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy || !valid}>
          {busy ? "请稍候…" : mode === "register" ? "注册并开始构建" : "登录"}
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>取消</button>
      </form>
    </div>
  );
}
