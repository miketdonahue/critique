import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sessionsDir } from "./config.ts";
import type { Presence, Prompt, Review, SessionState } from "./types.ts";

/** Runtime-only coordination state, never persisted. */
interface Runtime {
  /** SSE writers subscribed to this session's events. */
  clients: Set<(event: string, data: unknown) => void>;
  /** Long-poll waiters woken when feedback arrives or the session ends. */
  waiters: Set<() => void>;
  /** Number of agent polls currently attached. */
  activePolls: number;
  /** Current artifact load token; rotated on every reload. */
  token: string;
}

export function keyForFile(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16);
}

export class Store {
  private sessions = new Map<string, SessionState>();
  private runtimes = new Map<string, Runtime>();

  constructor() {
    mkdirSync(sessionsDir(), { recursive: true });
  }

  private diskPath(key: string): string {
    return join(sessionsDir(), `${key}.json`);
  }

  private runtime(key: string): Runtime {
    let rt = this.runtimes.get(key);
    if (!rt) {
      rt = {
        clients: new Set(),
        waiters: new Set(),
        activePolls: 0,
        token: randomUUID(),
      };
      this.runtimes.set(key, rt);
    }
    return rt;
  }

  get(key: string): SessionState | undefined {
    const live = this.sessions.get(key);
    if (live) return live;
    const path = this.diskPath(key);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionState;
      if (!Array.isArray(parsed.reviews)) parsed.reviews = [];
      this.sessions.set(key, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  private persist(session: SessionState): void {
    session.updatedAt = Date.now();
    this.sessions.set(session.key, session);
    writeFileSync(this.diskPath(session.key), JSON.stringify(session, null, 2));
  }

  /** Create the session for a canonical path, or resume the existing one. */
  upsert(canonicalPath: string): SessionState {
    const key = keyForFile(canonicalPath);
    let session = this.get(key);
    const now = Date.now();
    if (!session) {
      session = {
        key,
        file: canonicalPath,
        title: basename(canonicalPath),
        createdAt: now,
        updatedAt: now,
        revision: 0,
        reviews: [],
        pending: [],
        awaitingReply: false,
        ended: false,
        endedBy: null,
      };
    } else if (session.ended) {
      // Reopening an ended session revives it for another review round.
      session.ended = false;
      session.endedBy = null;
    }
    this.persist(session);
    return session;
  }

  token(key: string): string {
    return this.runtime(key).token;
  }

  presence(key: string): Presence {
    const session = this.get(key);
    if (!session || session.ended) return "ended";
    if (session.awaitingReply) return "working";
    return this.runtime(key).activePolls > 0 ? "listening" : "waiting";
  }

  // ---- events ---------------------------------------------------------------

  subscribe(
    key: string,
    send: (event: string, data: unknown) => void,
  ): () => void {
    const rt = this.runtime(key);
    rt.clients.add(send);
    return () => {
      rt.clients.delete(send);
    };
  }

  broadcast(key: string, event: string, data: unknown): void {
    for (const send of this.runtime(key).clients) send(event, data);
  }

  private broadcastPresence(key: string): void {
    this.broadcast(key, "presence", { state: this.presence(key) });
  }

  // ---- long poll ------------------------------------------------------------

  addPoll(key: string): void {
    this.runtime(key).activePolls += 1;
    this.broadcastPresence(key);
  }

  removePoll(key: string): void {
    const rt = this.runtime(key);
    rt.activePolls = Math.max(0, rt.activePolls - 1);
    this.broadcastPresence(key);
  }

  waitForWake(key: string, signal: AbortSignal): Promise<void> {
    const rt = this.runtime(key);
    const { promise, resolve } = Promise.withResolvers<void>();
    const wake = () => {
      rt.waiters.delete(wake);
      signal.removeEventListener("abort", wake);
      resolve();
    };
    rt.waiters.add(wake);
    signal.addEventListener("abort", wake, { once: true });
    return promise;
  }

  private wakeWaiters(key: string): void {
    const rt = this.runtime(key);
    for (const wake of [...rt.waiters]) wake();
  }

  /** Drain queued feedback for an agent poll; marks its reviews as working. */
  drainPending(key: string): Prompt[] {
    const session = this.get(key);
    if (!session || session.pending.length === 0) return [];
    const prompts = session.pending;
    session.pending = [];
    session.awaitingReply = true;
    // Draining always takes every pending prompt, i.e. every queued review.
    for (const review of session.reviews) {
      if (review.status === "queued") review.status = "working";
    }
    this.persist(session);
    this.broadcast(key, "review-sync", { reviews: session.reviews });
    this.broadcastPresence(key);
    return prompts;
  }

  // ---- mutations ------------------------------------------------------------

  /** Browser submitted a review; queues its comments and wakes any poll. */
  submitPrompts(key: string, prompts: Prompt[]): void {
    const session = this.get(key);
    if (!session || prompts.length === 0) return;
    const review: Review = {
      id: randomUUID(),
      comments: prompts,
      status: "queued",
      reply: null,
      submittedAt: Date.now(),
      addressedAt: null,
    };
    session.reviews.push(review);
    for (const p of prompts) session.pending.push(p);
    this.persist(session);
    this.broadcast(key, "review-sync", { reviews: session.reviews });
    this.wakeWaiters(key);
  }

  /** Agent posted a reply; marks the in-flight reviews addressed. */
  addAgentReply(key: string, text: string): void {
    const session = this.get(key);
    if (!session) return;
    const now = Date.now();
    for (const review of session.reviews) {
      if (review.status === "working") {
        review.status = "addressed";
        review.reply = text;
        review.addressedAt = now;
      }
    }
    session.awaitingReply = false;
    this.persist(session);
    this.broadcast(key, "review-sync", { reviews: session.reviews });
    this.broadcastPresence(key);
  }

  end(key: string, by: "user" | "agent"): void {
    const session = this.get(key);
    if (!session || session.ended) {
      // Still wake pollers so an already-ended session unblocks the agent.
      this.wakeWaiters(key);
      return;
    }
    session.ended = true;
    session.endedBy = by;
    session.awaitingReply = false;
    this.persist(session);
    this.broadcast(key, "presence", { state: "ended" });
    this.wakeWaiters(key);
  }

  /** Bump the artifact revision and rotate the load token after a file change. */
  bumpRevision(key: string): { revision: number; token: string } {
    const session = this.get(key);
    const rt = this.runtime(key);
    rt.token = randomUUID();
    if (session) {
      session.revision += 1;
      this.persist(session);
    }
    this.broadcast(key, "reload", {
      revision: session?.revision ?? 0,
      token: rt.token,
    });
    return { revision: session?.revision ?? 0, token: rt.token };
  }

  reviews(key: string): Review[] {
    return this.get(key)?.reviews ?? [];
  }
}
