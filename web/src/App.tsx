import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Landing } from "./Landing";
import { Projects } from "./Projects";
import { Workspace } from "./Workspace";
import "./styles.css";

type View = { type: "landing" } | { type: "projects" } | { type: "ws"; id: string; autoStart?: string };

export default function App() {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [view, setView] = useState<View>(() => {
    const cur = localStorage.getItem("zaowu-current");
    return cur ? { type: "ws", id: cur } : { type: "landing" };
  });

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(() => {
      setToken(null);
      setView({ type: "landing" });
    });
  }, []);

  const openProject = (id: string, autoStart?: string) => {
    localStorage.setItem("zaowu-current", id);
    setView({ type: "ws", id, autoStart });
  };
  const goHome = () => {
    localStorage.removeItem("zaowu-current");
    setView({ type: "landing" });
  };

  /** 首页发起构建：建项目（名字取指令前几字）→ 进工作台自动开跑 */
  async function startBuild(instruction: string) {
    const name = instruction.replace(/\s+/g, " ").slice(0, 16) || "未命名应用";
    const r = await api.createProject(name);
    openProject(r.id, instruction);
  }

  if (view.type === "ws") {
    // 未拿到用户信息但有 token 时也可先进入（Workspace 自己会因 401 报错回退）
    if (!getToken()) { setView({ type: "landing" }); return null; }
    return <Workspace id={view.id} autoStart={view.autoStart} onBack={() => {
      localStorage.removeItem("zaowu-current");
      setView(user ? { type: "projects" } : { type: "landing" });
    }} />;
  }

  if (view.type === "projects" && user) {
    return (
      <Projects
        username={user.username}
        onOpen={(id) => openProject(id)}
        onHome={goHome}
        onLogout={() => { setToken(null); setUser(null); goHome(); }}
      />
    );
  }

  return (
    <Landing
      user={user}
      onStart={(ins) => void startBuild(ins)}
      onProjects={() => setView({ type: "projects" })}
      onLogin={setUser}
    />
  );
}
