import { useRef, useState, useEffect } from "react";
import { api, getToken, setToken } from "./api";
import { AuthModal } from "./AuthModal";
import { Landing } from "./Landing";
import { Projects } from "./Projects";
import { Sidebar } from "./Sidebar";
import { Workspace } from "./Workspace";
import "./styles.css";

type View = { type: "home" } | { type: "projects" } | { type: "ws"; id: string; autoStart?: string };

export default function App() {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [view, setView] = useState<View>(() => {
    const cur = localStorage.getItem("zaowu-current");
    return cur ? { type: "ws", id: cur } : { type: "home" };
  });
  const [authOpen, setAuthOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // 侧边栏「最近」刷新信号
  const pendingRef = useRef(""); // 注册期间暂存的构建指令

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(() => {
      setToken(null);
      setView({ type: "home" });
    });
  }, []);

  const openProject = (id: string, autoStart?: string) => {
    localStorage.setItem("zaowu-current", id);
    setView({ type: "ws", id, autoStart });
  };

  /** 建项目（名字取指令前几字）→ 进工作台自动开跑 */
  async function startBuild(instruction: string) {
    const name = instruction.replace(/\s+/g, " ").slice(0, 16) || "未命名应用";
    const r = await api.createProject(name);
    setRefreshKey((k) => k + 1);
    openProject(r.id, instruction);
  }

  const openAuth = (pending = "") => {
    pendingRef.current = pending;
    setAuthOpen(true);
  };

  if (view.type === "ws" && getToken()) {
    return (
      <Workspace id={view.id} autoStart={view.autoStart} onBack={() => {
        localStorage.removeItem("zaowu-current");
        setRefreshKey((k) => k + 1);
        setView(user ? { type: "projects" } : { type: "home" });
      }} />
    );
  }

  const navView = view.type === "projects" ? "projects" : "home";
  return (
    <div className="shell">
      <Sidebar
        user={user}
        view={navView}
        refreshKey={refreshKey}
        onNav={(v) => setView({ type: v })}
        onOpenProject={(id) => openProject(id)}
        onLogin={() => openAuth()}
        onLogout={() => { setToken(null); setUser(null); setView({ type: "home" }); }}
      />
      <main className="shell-main">
        {navView === "projects" && user ? (
          <Projects onOpen={(id) => openProject(id)} onHome={() => setView({ type: "home" })} />
        ) : (
          <Landing user={user} onStart={(ins) => user ? void startBuild(ins) : openAuth(ins)} />
        )}
      </main>
      {authOpen && (
        <AuthModal
          reason={pendingRef.current ? "注册 / 登录后，马上开始为你构建" : ""}
          onClose={() => setAuthOpen(false)}
          onDone={(u) => {
            setAuthOpen(false);
            setUser(u);
            setRefreshKey((k) => k + 1);
            const pending = pendingRef.current;
            pendingRef.current = "";
            if (pending) void startBuild(pending);
          }}
        />
      )}
    </div>
  );
}
