import { useEffect, useState } from "react";
import { FolderKanban, House, LogIn, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api } from "./api";

type Recent = { id: string; name: string };
const COLLAPSED_KEY = "zaowu-side-collapsed";

export function Sidebar({ user, view, refreshKey, onNav, onOpenProject, onLogin, onLogout }: {
  user: { username: string } | null;
  view: "home" | "projects";
  refreshKey: number; // 变化时刷新「最近」列表
  onNav: (v: "home" | "projects") => void;
  onOpenProject: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [recent, setRecent] = useState<Recent[]>([]);

  useEffect(() => {
    if (!user) { setRecent([]); return; }
    api.projects().then((list) => setRecent(list.slice(0, 8))).catch(() => {});
  }, [user, refreshKey]);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });
  };

  return (
    <aside className={`side ${collapsed ? "collapsed" : ""}`}>
      <div className="side-head">
        <span className="logo sm">造</span>
        {!collapsed && <span className="side-title">造物 Zaowu</span>}
        <button className="side-toggle" title={collapsed ? "展开侧边栏" : "收起侧边栏"} onClick={toggle}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="side-nav">
        <a className={`side-link ${view === "home" ? "on" : ""}`} title="首页" onClick={() => onNav("home")}>
          <House size={16} /><span className="label">首页</span>
        </a>
        {user && (
          <a className={`side-link ${view === "projects" ? "on" : ""}`} title="我的应用" onClick={() => onNav("projects")}>
            <FolderKanban size={16} /><span className="label">我的应用</span>
          </a>
        )}

        {!collapsed && user && recent.length > 0 && (
          <>
            <div className="side-group">最近</div>
            {recent.map((p) => (
              <a key={p.id} className="side-link recent" title={p.name} onClick={() => onOpenProject(p.id)}>
                <span className="label ellipsis">{p.name}</span>
              </a>
            ))}
          </>
        )}
      </nav>

      <div className="side-foot">
        {user ? (
          <>
            <span className="avatar" title={user.username}>{user.username[0].toUpperCase()}</span>
            {!collapsed && (
              <>
                <span className="side-user ellipsis">{user.username}</span>
                <button className="side-toggle" title="退出登录" onClick={onLogout}><LogOut size={15} /></button>
              </>
            )}
          </>
        ) : (
          <button className={`btn sm ${collapsed ? "ghost" : ""}`} style={{ width: "100%" }}
            title="登录 / 注册" onClick={onLogin}>
            <LogIn size={14} />{!collapsed && " 登录 / 注册"}
          </button>
        )}
      </div>
    </aside>
  );
}
