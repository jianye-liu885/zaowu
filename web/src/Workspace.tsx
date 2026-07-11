import { useEffect, useRef, useState } from "react";
import { api, generateStream } from "./api";

type Msg = { role: string; content: string };
type Version = { id: string; seq: number; instruction: string; summary: string; created_at?: number };

export function Workspace({ id, autoStart, onBack }: { id: string; autoStart?: string; onBack: () => void }) {
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [html, setHtml] = useState("");
  const [viewSeq, setViewSeq] = useState<number | null>(null); // null=最新
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveReason, setLiveReason] = useState("");
  const [liveNote, setLiveNote] = useState("");
  const [writing, setWriting] = useState(false); // 已进入代码输出阶段
  const [liveCode, setLiveCode] = useState(""); // 正在生成的代码流（预览区实时展示）
  const codeRef = useRef<HTMLPreElement>(null);
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    api.project(id).then((p) => {
      setName(p.name);
      setMessages(p.messages);
      setVersions(p.versions);
      setHtml(p.html);
      setShareSlug(p.share_slug);
      // 首页带过来的指令：项目还是空的就自动开跑（ref 防 StrictMode 双触发）
      if (autoStart && !p.versions.length && !autoStarted.current) {
        autoStarted.current = true;
        void send(autoStart);
      }
    }).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages, busy, liveReason, liveNote, writing]);

  // 代码流自动滚到最新一行
  useEffect(() => {
    if (codeRef.current) codeRef.current.scrollTop = codeRef.current.scrollHeight;
  }, [liveCode]);

  async function send(text?: string) {
    const instruction = (text ?? input).trim();
    if (!instruction || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    setLiveReason("");
    setLiveNote("");
    setWriting(false);
    setLiveCode("");
    setMessages((m) => [...m, { role: "user", content: instruction }]);
    let contentBuf = "";
    let codeStart = -1; // 代码围栏（含语言行）之后的起点
    try {
      await generateStream(id, instruction, (e) => {
        if (e.type === "reasoning") {
          setLiveReason((r) => r + e.text);
        } else if (e.type === "chunk") {
          contentBuf += e.text;
          if (codeStart < 0) {
            // 围栏前是给用户看的说明；命中围栏后其余都是代码流
            const m = /```[a-z]*\n/.exec(contentBuf);
            if (m) {
              codeStart = m.index + m[0].length;
              setWriting(true);
              setLiveNote(contentBuf.slice(0, m.index).trim());
            } else {
              setLiveNote(contentBuf.trim());
            }
          }
          if (codeStart >= 0) setLiveCode(contentBuf.slice(codeStart).replace(/```\s*$/, ""));
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
      setLiveReason("");
      setLiveNote("");
      setWriting(false);
      setLiveCode("");
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
                {liveReason && <div className="live-reason">💭 {liveReason}</div>}
                {liveNote && <div className="live-note">{liveNote}</div>}
                <div className="muted">
                  {writing ? "正在编写应用代码…" : liveReason || liveNote ? "" : "Agent 思考中…"}
                </div>
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
          {busy ? (
            liveCode ? (
              <div className="build-view">
                <div className="build-head">
                  <span className="spinner" />
                  <span>正在编写应用代码</span>
                  <span className="muted">{liveCode.split("\n").length} 行</span>
                </div>
                <pre className="build-code" ref={codeRef}>{liveCode}<span className="build-caret" /></pre>
              </div>
            ) : (
              <div className="skeleton-view">
                <div className="sk-window">
                  <div className="sk-bar" />
                  <div className="sk-row">
                    <div className="sk-box lg" />
                    <div className="sk-col">
                      <div className="sk-box" />
                      <div className="sk-box" />
                      <div className="sk-box sm" />
                    </div>
                  </div>
                </div>
                <div className="muted sk-tip">Agent 正在设计应用结构…</div>
              </div>
            )
          ) : !html ? (
            <div className="preview-empty muted">生成后的应用会在这里实时运行</div>
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
