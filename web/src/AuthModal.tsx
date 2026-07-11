import { useEffect, useRef, useState } from "react";
import { api, setToken } from "./api";

export function AuthModal({ reason, onDone, onClose }: {
  reason?: string;
  onDone: (u: { username: string }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<number>(0);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const emailOk = /\S+@\S+\.\S+/.test(email);
  const valid = emailOk && password.length >= 6 && (mode === "login" || code.trim().length === 6);

  async function sendCode() {
    if (!emailOk || cooldown > 0) return;
    setError("");
    try {
      await api.sendCode(email.trim());
      setInfo("验证码已发送到邮箱，10 分钟内有效");
      setCooldown(60);
      timer.current = window.setInterval(() => {
        setCooldown((n) => {
          if (n <= 1) { window.clearInterval(timer.current); return 0; }
          return n - 1;
        });
      }, 1000);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("已注册")) {
        setMode("login");
        setError("该邮箱已注册，请直接登录");
      } else {
        setError(msg);
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setError("");
    setBusy(true);
    try {
      const r = mode === "register"
        ? await api.register(email.trim(), password, code.trim())
        : await api.login(email.trim(), password);
      setToken(r.token);
      onDone({ username: r.username });
    } catch (err) {
      const msg = (err as Error).message;
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
        {mode === "register" && (
          <div className="code-row">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6 位验证码" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
            <button type="button" className="btn" disabled={!emailOk || cooldown > 0}
              onClick={() => void sendCode()}>
              {cooldown > 0 ? `${cooldown}s 后重发` : "发送验证码"}
            </button>
          </div>
        )}
        <input value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "设置密码（≥6位）" : "密码"} type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {info && !error && <div className="muted" style={{ fontSize: 12.5 }}>{info}</div>}
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy || !valid}>
          {busy ? "请稍候…" : mode === "register" ? "注册并开始构建" : "登录"}
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>取消</button>
      </form>
    </div>
  );
}
