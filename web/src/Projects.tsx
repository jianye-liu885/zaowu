import { useEffect, useState } from "react";
import { api } from "./api";

type Project = { id: string; name: string; share_slug: string | null; updated_at: number; version_count: number };

const IDEAS = [
  "一个番茄钟，带今日专注统计",
  "记账本：分类、月度汇总、饼图",
  "打字速度测试游戏，排行榜存本地",
  "看板式待办：三列拖拽",
  "五子棋，人机对战",
];

export function Projects({ username, onOpen, onHome, onLogout }:
  { username: string; onOpen: (id: string) => void; onHome: () => void; onLogout: () => void }) {
  const [list, setList] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.projects().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.createProject(name.trim() || "未命名应用");
      onOpen(r.id);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, pname: string) {
    if (!window.confirm(`删除「${pname}」？所有版本一并删除，不可恢复。`)) return;
    await api.deleteProject(id);
    load();
  }

  return (
    <div className="projects-page">
      <header className="topbar">
        <span className="brand" style={{ cursor: "pointer" }} onClick={onHome}><span className="logo sm">造</span> 造物 Zaowu</span>
        <span className="row">
          <button className="btn ghost sm" onClick={onHome}>＋ 从想法开始</button>
          <span className="muted">{username}</span>
          <button className="btn ghost sm" onClick={onLogout}>退出</button>
        </span>
      </header>
      <main className="projects-main">
        <h2>我的应用</h2>
        <div className="new-row">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="给新应用起个名字（可留空）"
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          <button className="btn primary" onClick={() => void create()} disabled={busy}>＋ 新建应用</button>
        </div>
        {list === null ? <div className="muted">加载中…</div> : !list.length ? (
          <div className="empty-card">
            <div className="empty-title">还没有应用，从一个想法开始：</div>
            <div className="idea-list">
              {IDEAS.map((t) => (
                <button key={t} className="idea" onClick={() => { setName(t.split("，")[0].split("：")[0]); void create(); }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid">
            {list.map((p) => (
              <div key={p.id} className="proj-card" onClick={() => onOpen(p.id)}>
                <div className="proj-name">{p.name}</div>
                <div className="muted proj-meta">
                  {p.version_count} 个版本
                  {p.share_slug && <span className="badge">已发布</span>}
                </div>
                <div className="proj-foot">
                  <span className="muted">{new Date(p.updated_at * 1000).toLocaleString()}</span>
                  <button className="btn ghost sm danger"
                    onClick={(e) => { e.stopPropagation(); void remove(p.id, p.name); }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
