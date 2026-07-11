import { useEffect, useRef, useState } from "react";
import { api, generateStream } from "./api";

type Msg = { role: string; content: string };
type Version = { id: string; seq: number; instruction: string; summary: string; created_at?: number };

export function Workspace({ id, onBack }: { id: string; onBack: () => void }) {
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [html, setHtml] = useState("");
  const [viewSeq, setViewSeq] = useState<number | null>(null); // null=最新
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveLen, setLiveLen] = useState(0);
  const [liveNote, setLiveNote] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.project(id).then((p) => {
      setName(p.name);
      setMessages(p.messages);
      setVersions(p.versions);
      setHtml(p.html);
      setShareSlug(p.share_slug);
    }).catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages, busy, liveLen]);

  async function send() {
    const instruction = input.trim();
    if (!instruction || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    setLiveLen(0);
    setLiveNote("");
    setMessages((m) => [...m, { role: "user", content: instruction }]);
    let noteBuf = "";
    let inCode = false;
    try {
      await generateStream(id, instruction, (e) => {
        if (e.type === "chunk") {
          // 代码围栏前的说明文字实时显示；进入代码块后只累计字数
          if (!inCode) {
            noteBuf += e.text;
            const fence = noteBuf.indexOf("```");
            if (fence >= 0) { inCode = true; setLiveNote(noteBuf.slice(0, fence).trim()); }
            else setLiveNote(noteBuf.trim());
          }
          setLiveLen((n) => n + e.text.length);
        } else if (e.type === "done") {
          setHtml(e.html);
          setViewSeq(null);
          setMessages((m) => [...m, { role: "assistant", content: e.version.summary || `已生成 v${e.version.seq}` }]);
          setVersions((v) => [{ ...e.version }, ...v]);
        } else if (e.type === "error") {
          setError(e.message);
        }
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLiveLen(0);
      setLiveNote("");
    }
  }

  async function viewVersion(v: Version) {
    const full = await api.version(id, v.id);
    setHtml(full.html);
    setViewSeq(v.seq === versions[0]?.seq ? null : v.seq);
  }

  async function rollback(v: Version) {
    await api.rollback(id, v.id);
    const p = await api.project(id);
    setVersions(p.versions);
    setHtml(p.html);
    setViewSeq(null);
  }

  async function toggleShare() {
    const r = await api.share(id);
    setShareSlug(r.share_slug);
    if (r.share_slug) {
      const url = `${location.origin}/s/${r.share_slug}`;
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  }

  const shareUrl = shareSlug ? `${location.origin}/s/${shareSlug}` : "";

  return (
    <div className="ws">
      <header className="topbar">
        <span className="row">
          <button className="btn ghost sm" onClick={onBack}>← 我的应用</button>
          <strong>{name}</strong>
          {viewSeq !== null && <span className="badge warn">正在查看 v{viewSeq}（非最新）</span>}
        </span>
        <span className="row">
          {versions.length > 0 && (
            <select className="ver-select" value={viewSeq ?? "latest"}
              onChange={(e) => {
                const v = versions.find((x) => String(x.seq) === e.target.value) || versions[0];
                void viewVersion(v);
              }}>
              <option value="latest">最新 v{versions[0]?.seq}</option>
              {versions.slice(1).map((v) => (
                <option key={v.id} value={v.seq}>v{v.seq} · {v.instruction.slice(0, 18)}</option>
              ))}
            </select>
          )}
          {viewSeq !== null && (
            <button className="btn sm" onClick={() => {
              const v = versions.find((x) => x.seq === viewSeq);
              if (v) void rollback(v);
            }}>回滚到 v{viewSeq}</button>
          )}
          <button className="btn sm" onClick={() => setShowCode(!showCode)}>
            {showCode ? "预览" : "代码"}
          </button>
          <button className={`btn sm ${shareSlug ? "" : "primary"}`}
            disabled={!versions.length} onClick={() => void toggleShare()}>
            {shareSlug ? "取消发布" : "发布分享"}
          </button>
        </span>
      </header>

      {shareSlug && (
        <div className="share-bar">
          已发布（链接已复制）：<a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
        </div>
      )}

      <div className="ws-body">
        <aside className="chat-pane">
          <div className="chat-list" ref={chatRef}>
            {!messages.length && !busy && (
              <div className="guide">
                <b>描述你想要的应用</b>
                <p>比如：「做一个番茄钟，25分钟倒计时，完成后记录到今日统计」。生成后可以继续对话修改：「把主题换成深色」「加一个周视图」。</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>{m.content}</div>
            ))}
            {busy && (
              <div className="live">
                <span className="spinner" />
                {liveNote && <div className="live-note">{liveNote}</div>}
                <div className="muted">{liveLen > 0 ? `正在生成应用…（已输出 ${liveLen} 字）` : "Agent 思考中…"}</div>
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </div>
          <div className="composer">
            <textarea value={input} rows={3}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              placeholder={versions.length ? "继续修改：描述你想调整的地方…" : "描述你想要的应用，回车发送…"} />
            <button className="btn primary send" disabled={busy || !input.trim()} onClick={() => void send()}>
              {busy ? "生成中…" : versions.length ? "修改" : "生成"}
            </button>
          </div>
        </aside>

        <main className="preview-pane">
          {!html ? (
            <div className="preview-empty muted">
              {busy ? "应用正在生成，完成后自动预览…" : "生成后的应用会在这里实时运行"}
            </div>
          ) : showCode ? (
            <pre className="code-view">{html}</pre>
          ) : (
            <iframe title="preview" className="preview-frame" sandbox="allow-scripts allow-modals allow-forms"
              srcDoc={html} />
          )}
        </main>
      </div>
    </div>
  );
}
