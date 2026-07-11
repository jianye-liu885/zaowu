const TOKEN_KEY = "zaowu-token";

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
}

async function req(path: string, options: RequestInit = {}) {
  const r = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  register: (username: string, password: string) =>
    req("/api/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    req("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => req("/api/me"),
  projects: () => req("/api/projects"),
  createProject: (name: string) =>
    req("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  project: (id: string) => req(`/api/projects/${id}`),
  deleteProject: (id: string) => req(`/api/projects/${id}`, { method: "DELETE" }),
  version: (pid: string, vid: string) => req(`/api/projects/${pid}/versions/${vid}`),
  rollback: (pid: string, vid: string) =>
    req(`/api/projects/${pid}/versions/${vid}/rollback`, { method: "POST" }),
  share: (pid: string) => req(`/api/projects/${pid}/share`, { method: "POST" }),
};

export type GenEvent =
  | { type: "chunk"; text: string }
  | { type: "done"; version: { id: string; seq: number; summary: string; instruction: string }; html: string }
  | { type: "error"; message: string };

/** SSE over fetch：逐事件回调，直到 done/error。 */
export async function generateStream(
  pid: string, instruction: string, onEvent: (e: GenEvent) => void,
) {
  const r = await fetch(`/api/projects/${pid}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ instruction }),
  });
  if (!r.ok || !r.body) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
    }
  }
}
