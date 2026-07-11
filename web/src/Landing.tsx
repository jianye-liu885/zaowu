import { useState } from "react";
import { AuthModal } from "./AuthModal";

const IDEAS = [
  "一个番茄钟，带今日专注统计",
  "记账本：分类、月度汇总、饼图",
  "打字速度测试游戏",
  "看板式待办清单",
  "五子棋，人机对战",
  "倒数日：纪念日提醒",
];

export function Landing({ user, onStart, onProjects, onLogin }: {
  user: { username: string } | null;
  /** 发起构建：已登录时直接调用；未登录时由本组件先走注册再调用 */
  onStart: (instruction: string) => void;
  onProjects: () => void;
  onLogin: (u: { username: string }) => void;
}) {
  const [input, setInput] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState(""); // 注册期间暂存的指令

  function submit(text?: string) {
    const instruction = (text ?? input).trim();
    if (!instruction) return;
    if (!user) {
      setPending(instruction);
      setAuthOpen(true);
      return;
    }
    onStart(instruction);
  }

  return (
    <div className="landing">
      <header className="topbar landing-top">
        <span className="brand"><span className="logo sm">造</span> 造物 Zaowu</span>
        <span className="row">
          {user ? (
            <>
              <button className="btn ghost sm" onClick={onProjects}>我的应用</button>
              <span className="muted">{user.username}</span>
            </>
          ) : (
            <button className="btn ghost sm" onClick={() => { setPending(""); setAuthOpen(true); }}>登录</button>
          )}
        </span>
      </header>

      <main className="landing-hero">
        <h1>输入想法，造出应用。{user ? `开始吧，${user.username.split("@")[0]}。` : ""}</h1>
        <p className="muted landing-sub">描述你想要的 Web 应用，Agent 实时把它造出来——可预览、可修改、可发布分享。</p>
        <div className="hero-composer">
          <textarea value={input} rows={3} autoFocus
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="让 Agent 为你构建一个 Web 应用…" />
          <div className="hero-composer-bar">
            <span className="muted hint">回车发送 · 无需先注册，发送时再登录</span>
            <button className="btn primary" disabled={!input.trim()} onClick={() => submit()}>开始构建 ↑</button>
          </div>
        </div>
        <div className="idea-list hero-ideas">
          {IDEAS.map((t) => (
            <button key={t} className="idea" onClick={() => submit(t)}>{t}</button>
          ))}
        </div>
      </main>

      {authOpen && (
        <AuthModal
          reason={pending ? "注册 / 登录后，马上开始为你构建" : ""}
          onClose={() => setAuthOpen(false)}
          onDone={(u) => {
            setAuthOpen(false);
            onLogin(u);
            if (pending) onStart(pending);
          }}
        />
      )}
    </div>
  );
}
