# critique

Visual HTML review for AI coding agents. Open an artifact in the browser,
annotate it with point-and-click feedback, and have your agent receive and act
on it through a simple CLI loop.

## Requirements

[Bun](https://bun.sh) ≥ 1.1.0 — critique uses Bun's runtime APIs and does not
support Node.

## Install

```sh
bun add -g @miketdonahue/critique
```

Or run without installing:

```sh
bunx @miketdonahue/critique <file.html>
```

## Usage

**1. Open a file for review:**

```sh
critique report.html
```

A browser tab opens with your artifact on the left and a review panel on the
right. Re-running the same command resumes the session.

**2. Annotate in the browser:**

- Toggle **Request change** mode from the settings menu (or `⌘I` / `Ctrl+I`).
- **Click any element** or **select text** to attach a note — describe what
  should change and submit. It queues under **Pending changes**.
- Use the **chat box** for freeform questions or changes not tied to a specific
  element.
- When ready, click **Request changes** to send the batch to your agent.

**3. Point your agent at the loop:**

```sh
critique instructions    # prints the full agent integration contract
```

Or reference the bundled `AGENTS.md` — most harnesses (Cursor, aider, Zed)
pick it up automatically. See `skills/` for harness-specific snippets
(OMP, Cursor, Claude, OpenAI).

**4. Iterate** until the review is done, then end the session from the settings
menu or:

```sh
critique end report.html
```

## CLI reference

```
critique <file.html>            Open (or resume) a review session.
critique poll <file.html>       Wait for a feedback batch, then print it.
critique end <file.html>        End the session.
critique stop                   Shut down the background server.
critique instructions           Print the agent integration contract.
```

Key flags:

```
--timeout-ms <ms>      (poll) Return after <ms> if no feedback arrives. Always set this.
--agent-reply "<text>" (poll) Post the agent's reply before waiting for the next batch.
--no-open              Start or resume a session without opening the browser.
```

## Environment

```
CRITIQUE_PORT        Port the local server listens on (default: 4477).
CRITIQUE_HOST        Interface to bind (default: loopback).
CRITIQUE_STATE_DIR   Where session state is stored (default: ~/.critique).
CRITIQUE_NO_OPEN     Set to 1 to never auto-open a browser.
```

## Development

```sh
bun install
bun run build       # build the browser UI and injected SDK
bun run check       # typecheck + lint
bun run dev <file>  # run the CLI from source
```

## License

MIT
