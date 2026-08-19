import { existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { baseUrl, port, serverLogPath, stateDir, VERSION } from "./config.ts";
import { runServer } from "./server.ts";
import { keyForFile } from "./store.ts";
import type { PollResponse, Prompt } from "./types.ts";

const USAGE = `critique v${VERSION} — render HTML, collect point-and-click feedback, deliver it to any agent.

Usage:
  critique <file.html>            Open (or resume) a review session in the browser.
  critique poll <file.html>       Wait for the user's feedback, then print it. Re-run after each turn.
  critique end <file.html>        End the session (agent-initiated).
  critique stop                   Shut down the background server.
  critique server                 Run the server in the foreground.
  critique instructions           Print the agent integration contract (the review loop).

Flags:
  --no-open                       Ensure the session exists without opening a browser window.
  --agent-reply "<text>"          (poll) Post the agent's reply to the browser, then keep polling.
  --timeout-ms <ms>               (poll) Return control after <ms> if no feedback arrives.

Env:
  CRITIQUE_PORT (default 4477), CRITIQUE_HOST, CRITIQUE_STATE_DIR, CRITIQUE_NO_OPEN`;

const AGENT_INSTRUCTIONS = `critique — agent integration contract (authoritative)

Use critique when you have produced or edited an HTML file that a human wants to
review visually and give point-and-click feedback on.

The review loop:

  1. Open the session (once per review):
       critique <file.html>
     Starts a local server if needed and opens the artifact in the browser. The
     user annotates elements/text and queues change requests. Re-running resumes
     the same session.

  2. Wait for feedback (bounded — do NOT block forever):
       critique poll <file.html> --timeout-ms 60000
     Blocks until the user submits a batch, then prints the notes plus a
     machine-readable JSON payload (file, revision, prompts[] — each with a
     selector, text, and note). If it prints "no feedback within <ms>", the user
     is still working: re-run poll (or tell the user you are waiting). Queued
     feedback is durable server-side, so nothing is lost between polls.

  3. Handle each feedback item by its kind:
       - "element" / "text": a change request. Edit <file.html> at the target,
         located via selector/text.
       - "message": freeform chat. Treat it as a question or discussion by
         default - answer it in your reply and do NOT edit the file unless the
         message explicitly asks for a change.

  4. Report back and wait for the next round in one call:
       critique poll <file.html> --agent-reply "<summary of changes and/or answers>" --timeout-ms 60000
     Posts your summary into the browser, then waits for the next batch. The
     summary covers only this batch (the changes made and questions in it); do
     not restate or re-answer items from earlier rounds.

  5. Repeat 3-4 until poll reports the session ended (the user ended it, or you
     ran 'critique end <file.html>'). Then stop polling.

End the session yourself when done:
       critique end <file.html>

Notes:
  - The server auto-starts and runs in the background; state persists across runs.
  - Always pass --timeout-ms in interactive/agentic contexts and re-poll; a
    naked 'critique poll' can wait up to ~240s per call and stall the harness.
  - This text is the source of truth: run 'critique instructions' to reprint it.`;

interface Flags {
  positionals: string[];
  noOpen: boolean;
  agentReply: string | null;
  timeoutMs: number;
}

function parseFlags(argv: string[]): Flags {
  const positionals: string[] = [];
  let noOpen = process.env.CRITIQUE_NO_OPEN === "1";
  let agentReply: string | null = null;
  let timeoutMs = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--no-open") noOpen = true;
    else if (arg === "--agent-reply") agentReply = argv[++i] ?? "";
    else if (arg === "--timeout-ms")
      timeoutMs = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    else positionals.push(arg);
  }
  return { positionals, noOpen, agentReply, timeoutMs };
}

async function serverHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the detached background server if one is not already answering. */
async function ensureServer(): Promise<void> {
  if (await serverHealthy()) return;
  mkdirSync(stateDir(), { recursive: true });
  const log = openSync(serverLogPath(), "a");
  const bun = Bun.which("bun") ?? process.execPath;
  const child = Bun.spawn([bun, import.meta.path, "server"], {
    stdin: "ignore",
    stdout: log,
    stderr: log,
    env: process.env,
  });
  child.unref();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await serverHealthy()) return;
    await Bun.sleep(100);
  }
  throw new Error(`server did not become healthy; see ${serverLogPath()}`);
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref();
  } catch {
    /* headless environment; the URL is printed regardless */
  }
}

function resolveArtifact(pathArg: string | undefined): string {
  if (!pathArg) throw new Error("expected an HTML file path");
  const abs = resolve(pathArg);
  if (!existsSync(abs)) throw new Error(`file not found: ${abs}`);
  return realpathSync(abs);
}

async function cmdOpen(file: string, flags: Flags): Promise<void> {
  await ensureServer();
  const res = await fetch(`${baseUrl()}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  });
  const data = (await res.json()) as { url: string; key: string };
  if (!flags.noOpen) openBrowser(data.url);
  process.stdout.write(
    `Critique session ready: ${data.url}\n` +
      `Give feedback in the browser, then run \`critique poll ${file}\` to receive it.\n`,
  );
}

function renderFeedback(
  res: Extract<PollResponse, { status: "feedback" }>,
): string {
  const lines: string[] = [];
  lines.push(
    `[critique] ${res.prompts.length} feedback item(s) for ${res.file}:`,
  );
  lines.push("");
  res.prompts.forEach((p: Prompt, i) => {
    lines.push(`${i + 1}. ${p.prompt || "(no note)"}`);
    lines.push(
      `   kind: ${p.tag}${p.tag === "message" ? " (chat - answer it; edit only if it asks for a change)" : ""}`,
    );
    if (p.selector) lines.push(`   selector: ${p.selector}`);
    if (p.text) lines.push(`   text: "${p.text}"`);
    lines.push("");
  });
  lines.push("Machine-readable payload:");
  lines.push(
    JSON.stringify(
      { file: res.file, revision: res.revision, prompts: res.prompts },
      null,
      2,
    ),
  );
  lines.push("");
  lines.push(
    'Apply element/text change requests. Message items are chat: answer them and edit only if they ask for a change. Then run `critique poll --agent-reply "<summary>" <file>` to continue.',
  );
  return lines.join("\n");
}

async function cmdPoll(file: string, key: string, flags: Flags): Promise<void> {
  await ensureServer();
  await fetch(`${baseUrl()}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  });
  if (flags.agentReply !== null) {
    await fetch(`${baseUrl()}/api/${key}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: flags.agentReply }),
    });
  }
  process.stderr.write(
    `[critique] waiting for feedback on ${file} (Ctrl-C to stop)...\n`,
  );

  // Long-poll resiliently: Bun's fetch aborts idle connections after ~300s, and
  // proxies may drop them sooner, so a single fetch cannot wait indefinitely.
  // Re-issue on any client-side drop until real feedback, an end, or a caller
  // deadline arrives. Queued feedback is durable server-side, so nothing is lost.
  const deadline = flags.timeoutMs > 0 ? Date.now() + flags.timeoutMs : 0;
  while (true) {
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : 0;
    if (deadline && remaining === 0) {
      process.stdout.write(
        `[critique] no feedback within ${flags.timeoutMs}ms; re-run \`critique poll ${file}\`.\n`,
      );
      return;
    }
    const params = new URLSearchParams({ key });
    // Cap each server wait so a dropped connection is detected and retried.
    const waitMs = deadline ? remaining : 240_000;
    params.set("timeoutMs", String(waitMs));
    let body: PollResponse | null = null;
    try {
      const res = await fetch(`${baseUrl()}/api/poll?${params.toString()}`);
      body = await res.json();
    } catch {
      body = null; // connection dropped; fall through and re-poll
    }
    if (!body) {
      if (!(await serverHealthy())) {
        process.stderr.write(
          `[critique] server unreachable; re-run \`critique poll ${file}\`.\n`,
        );
        return;
      }
      continue;
    }
    if (body.status === "feedback") {
      process.stdout.write(`${renderFeedback(body)}\n`);
      return;
    }
    if (body.status === "ended") {
      process.stdout.write(
        `[critique] session ended (${body.endedBy ?? "unknown"}) for ${body.file}.\n` +
          `Stop polling; deliver any remaining updates in chat.\n`,
      );
      return;
    }
    // status === "timeout": server's wait elapsed. Retry unless a caller
    // deadline was set (handled at the top of the loop).
    if (!deadline) continue;
  }
}

async function cmdEnd(file: string, key: string): Promise<void> {
  if (!(await serverHealthy())) {
    process.stdout.write("[critique] no server running; nothing to end.\n");
    return;
  }
  await fetch(`${baseUrl()}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  });
  await fetch(`${baseUrl()}/api/${key}/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ by: "agent" }),
  });
  process.stdout.write(`[critique] ended session for ${file}.\n`);
}

async function cmdStop(): Promise<void> {
  if (!(await serverHealthy())) {
    process.stdout.write("[critique] no server running.\n");
    return;
  }
  await fetch(`${baseUrl()}/api/shutdown`, { method: "POST" }).catch(() => {});
  process.stdout.write(`[critique] server on port ${port()} stopping.\n`);
}

export async function run(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const [command, ...rest] = flags.positionals;

  if (command === "server") {
    runServer();
    return;
  }
  if (command === "stop") {
    await cmdStop();
    return;
  }
  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (command === "instructions") {
    process.stdout.write(`${AGENT_INSTRUCTIONS}\n`);
    return;
  }

  if (command === "poll") {
    const file = resolveArtifact(rest[0]);
    await cmdPoll(file, keyForFile(file), flags);
    return;
  }
  if (command === "end") {
    const file = resolveArtifact(rest[0]);
    await cmdEnd(file, keyForFile(file));
    return;
  }

  // Bare `critique <file.html>` opens/resumes a session.
  const file = resolveArtifact(command);
  await cmdOpen(file, flags);
}

// When executed directly (e.g. the detached server spawn `bun src/cli.ts server`).
if (import.meta.main) await run(process.argv.slice(2));
