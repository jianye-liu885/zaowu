import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Login } from "./Login";
import { Projects } from "./Projects";
import { Workspace } from "./Workspace";
import "./styles.css";

export default function App() {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [checking, setChecking] = useState(!!getToken());
  const [projectId, setProjectId] = useState(localStorage.getItem("zaowu-current") || "");

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);

  const openProject = (id: string) => {
    localStorage.setItem("zaowu-current", id);
    setProjectId(id);
  };
  const closeProject = () => {
    localStorage.removeItem("zaowu-current");
    setProjectId("");
  };

  if (checking) return <div className="center-page muted">加载中…</div>;
  if (!user) return <Login onLogin={setUser} />;
  if (projectId) return <Workspace id={projectId} onBack={closeProject} />;
  return (
    <Projects
      username={user.username}
      onOpen={openProject}
      onLogout={() => { setToken(null); setUser(null); closeProject(); }}
    />
  );
}
