import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { host, port, linkHost, VERSION } from "./config.ts";
import { Store } from "./store.ts";
import { injectSdk } from "./inject.ts";
import type { Prompt, PollResponse, StatePayload } from "./types.ts";

const DIST = resolve(import.meta.dir, "../dist");
const CHROME_DIR = join(DIST, "chrome");
const SDK_FILE = join(DIST, "sdk", "sdk.js");
const MODE_TOGGLE_HOTKEY = "i";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "::1", "localhost", linkHost()]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Reject requests with an unexpected Host header (DNS-rebinding guard). */
function hostAllowed(req: Request): boolean {
  if (process.env.CRITIQUE_ALLOWED_HOSTS?.trim() === "*") return true;
  const header = req.headers.get("host") ?? "";
  const name = header.replace(/:\d+$/, "").toLowerCase();
  const extra = (process.env.CRITIQUE_ALLOWED_HOSTS ?? "").split(/\s+/).filter(Boolean);
  return name === "" || ALLOWED_HOSTS.has(name) || extra.includes(name);
}

export class Server {
  private store = new Store();
  private watchers = new Map<string, FSWatcher>();
  private debounce = new Map<string, Timer>();

  /** Watch the artifact file so browser sessions live-reload on save. */
  private ensureWatch(key: string, file: string): void {
    if (this.watchers.has(key) || !existsSync(file)) return;
    const watcher = watch(file, () => {
      clearTimeout(this.debounce.get(key));
      this.debounce.set(
        key,
        setTimeout(() => {
          if (existsSync(file)) this.store.bumpRevision(key);
        }, 150),
      );
    });
    this.watchers.set(key, watcher);
  }

  private async serveArtifact(key: string, subpath: string, url: URL): Promise<Response> {
    const session = this.store.get(key);
    if (!session || !existsSync(session.file)) return new Response("artifact not found", { status: 404 });
    this.ensureWatch(key, session.file);

    // index.html (or the bare artifact route) -> inject the SDK loader.
    if (subpath === "" || subpath === "index.html") {
      const html = await readFile(session.file, "utf8");
      const token = url.searchParams.get("token") ?? this.store.token(key);
      const injected = injectSdk(html, key, session.revision, token);
      return new Response(injected, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Sibling asset: resolve strictly within the artifact directory.
    const baseDir = realpathSync(dirname(session.file));
    const target = resolve(baseDir, decodeURIComponent(subpath));
    const rel = relative(baseDir, target);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
      return new Response("forbidden", { status: 403 });
    }
    if (!existsSync(target)) return new Response("not found", { status: 404 });
    return new Response(Bun.file(target));
  }

  private async serveChrome(): Promise<Response> {
    const index = join(CHROME_DIR, "index.html");
    if (!existsSync(index)) {
      return new Response("Chrome UI not built. Run `bun run build`.", { status: 500 });
    }
    return new Response(Bun.file(index), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  private async serveChromeAsset(path: string): Promise<Response> {
    const target = resolve(CHROME_DIR, "." + path);
    if (!target.startsWith(CHROME_DIR) || !existsSync(target)) {
      return new Response("not found", { status: 404 });
    }
    return new Response(Bun.file(target));
  }

  private statePayload(key: string): StatePayload | null {
    const session = this.store.get(key);
    if (!session) return null;
    return {
      key,
      file: session.file,
      title: session.title,
      reviews: session.reviews,
      revision: session.revision,
      presence: this.store.presence(key),
      ended: session.ended,
      endedBy: session.endedBy,
      token: this.store.token(key),
      modeToggleHotkeyKey: MODE_TOGGLE_HOTKEY,
    };
  }

  private serveEvents(key: string, req: Request): Response {
    const store = this.store;
    let unsubscribe = () => {};
    let heartbeat: Timer;
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            /* controller closed */
          }
        };
        send("presence", { state: store.presence(key) });
        send("review-sync", { reviews: store.reviews(key) });
        unsubscribe = store.subscribe(key, send);
        heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15000);
        req.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel() {
        clearInterval(heartbeat);
        unsubscribe();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  private async handlePoll(key: string, url: URL, req: Request): Promise<Response> {
    if (!this.store.get(key)) return json({ status: "no-session" }, 404);
    const timeoutRaw = url.searchParams.get("timeoutMs");
    const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 0;
    this.store.addPoll(key);
    try {
      const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
      while (true) {
        const session = this.store.get(key);
        if (!session) return json({ status: "no-session" }, 404);
        if (session.ended) {
          const body: PollResponse = { status: "ended", endedBy: session.endedBy, file: session.file };
          return json(body);
        }
        const pending = this.store.drainPending(key);
        if (pending.length > 0) {
          const body: PollResponse = {
            status: "feedback",
            prompts: pending,
            file: session.file,
            revision: session.revision,
          };
          return json(body);
        }
        if (req.signal.aborted) return json({ status: "timeout" });
        const remaining = deadline ? deadline - Date.now() : 0;
        if (deadline && remaining <= 0) return json({ status: "timeout" } satisfies PollResponse);
        await this.waitOnce(key, req.signal, remaining);
      }
    } finally {
      this.store.removePoll(key);
    }
  }

  /** Wake on feedback/end/abort, or after `timeoutMs` (0 = wait indefinitely). */
  private async waitOnce(key: string, signal: AbortSignal, timeoutMs: number): Promise<void> {
    const wake = this.store.waitForWake(key, signal);
    if (timeoutMs <= 0) {
      await wake;
      return;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    const timer = setTimeout(resolve, timeoutMs);
    await Promise.race([wake, promise]);
    clearTimeout(timer);
  }

  private async readJson(req: Request): Promise<Record<string, unknown>> {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async route(req: Request): Promise<Response> {
    if (!hostAllowed(req)) return new Response("forbidden host", { status: 403 });
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true, version: VERSION, port: port() });
    if (path === "/api/shutdown" && req.method === "POST") {
      setTimeout(() => process.exit(0), 50);
      return json({ status: "stopping" });
    }
    if (path === "/sdk.js") {
      if (!existsSync(SDK_FILE)) return new Response("SDK not built. Run `bun run build`.", { status: 500 });
      return new Response(Bun.file(SDK_FILE), { headers: { "content-type": "text/javascript; charset=utf-8" } });
    }

    // Ensure/resume a session for a file path.
    if (path === "/api/session" && req.method === "POST") {
      const body = await this.readJson(req);
      const file = typeof body.file === "string" ? body.file : "";
      if (!file || !existsSync(file)) return json({ error: "file not found" }, 400);
      const canonical = realpathSync(file);
      const session = this.store.upsert(canonical);
      this.ensureWatch(session.key, canonical);
      return json({ key: session.key, file: canonical, url: `http://${linkHost()}:${port()}/session/${session.key}` });
    }

    // Artifact document + sibling assets.
    if (path.startsWith("/artifact/")) {
      const rest = path.slice("/artifact/".length);
      const slash = rest.indexOf("/");
      const key = slash === -1 ? rest : rest.slice(0, slash);
      const subpath = slash === -1 ? "" : rest.slice(slash + 1);
      return this.serveArtifact(key, subpath, url);
    }

    // Per-session API.
    const api = path.match(/^\/api\/([^/]+)\/(.+)$/);
    if (api) {
      const key = api[1]!;
      const action = api[2]!;
      if (action === "state" && req.method === "GET") {
        const payload = this.statePayload(key);
        return payload ? json(payload) : json({ error: "no-session" }, 404);
      }
      if (action === "prompts" && req.method === "POST") {
        const body = await this.readJson(req);
        const prompts = Array.isArray(body.prompts) ? (body.prompts as Prompt[]) : [];
        if (prompts.length > 0) this.store.submitPrompts(key, prompts);
        if (body.endSession === true) this.store.end(key, "user");
        return json({ status: "sent" });
      }
      if (action === "reply" && req.method === "POST") {
        const body = await this.readJson(req);
        const text = typeof body.text === "string" ? body.text : "";
        if (text) this.store.addAgentReply(key, text);
        return json({ status: "ok" });
      }
      if (action === "end" && req.method === "POST") {
        const body = await this.readJson(req);
        const by = body.by === "agent" ? "agent" : "user";
        this.store.end(key, by);
        return json({ status: "ended" });
      }
    }

    if (path === "/api/poll" && req.method === "GET") {
      const key = url.searchParams.get("key") ?? "";
      return this.handlePoll(key, url, req);
    }

    if (path.startsWith("/events/")) {
      return this.serveEvents(path.slice("/events/".length), req);
    }

    // Chrome SPA + its static assets.
    if (path === "/" || path.startsWith("/session/")) return this.serveChrome();
    return this.serveChromeAsset(path);
  }

  listen(): void {
    const self = this;
    Bun.serve({
      port: port(),
      hostname: host(),
      idleTimeout: 0,
      async fetch(req) {
        try {
          return await self.route(req);
        } catch (err) {
          console.error("[critique] request error", err);
          return json({ error: "internal", detail: String(err) }, 500);
        }
      },
    });
    console.error(`[critique] server listening on http://${linkHost()}:${port()}`);
  }
}

export function runServer(): void {
  new Server().listen();
}
