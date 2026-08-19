# Agent instructions

This project uses **critique** to collect human, point-and-click feedback on HTML
artifacts and route it back to a coding agent. When you generate or edit an HTML
file the user wants to review, drive the critique loop below.

> The authoritative, always-current contract is printed by `critique instructions`.
> Run it if anything here is unclear — the CLI output cannot drift from the code.

## When to use it

You produced or changed an `.html` file the user wants to review visually.

## The loop

1. **Open** (once per review): `critique <file.html>` — starts the local server if
   needed and opens the artifact in the browser; the user annotates elements/text
   and queues change requests. Re-running resumes the same session.
2. **Wait (bounded)**: `critique poll <file.html> --timeout-ms 60000` — blocks
   until the user submits a batch, then prints the notes and a machine-readable
   JSON payload (`file`, `revision`, `prompts[]` — each with `selector`, `text`,
   and a note). On `no feedback within <ms>`, re-poll (or tell the user you are
   waiting). Queued feedback is durable server-side, so nothing is lost between
   polls.
3. **Handle** each item by kind: `element`/`text` prompts are change requests -
   edit the HTML at the target located via `selector`/`text`. `message` prompts
   are freeform chat: answer them in your reply and edit only if the message
   explicitly asks for a change.
4. **Reply + wait**: `critique poll <file.html> --agent-reply "<summary of changes and/or answers>" --timeout-ms 60000`
   — posts your summary to the browser and waits for the next batch.
5. **Repeat** 3–4 until poll reports the session ended, then stop.

End it yourself with `critique end <file.html>`.

## Interactive agents: never block indefinitely

Always pass `--timeout-ms` and re-poll. A naked `critique poll` can wait ~240s per
call, which stalls interactive harnesses. The bounded pattern returns control and
loses nothing — feedback is durable server-side.
