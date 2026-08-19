---
name: critique
description: Use when you have generated or edited an HTML file that a human wants to review with point-and-click feedback. Drives the critique review loop — open in the browser, poll for feedback, edit, reply, repeat.
---

# critique review loop

`critique` renders an HTML artifact in the browser, collects the user's
point-and-click feedback, and delivers it back to you through a CLI poll loop.

**The authoritative contract is `critique instructions` — run it; it cannot drift
from the code.** The essentials:

1. `critique <file.html>` — open/resume the review session in the browser.
2. `critique poll <file.html> --timeout-ms 60000` — wait (bounded) for a feedback
   batch; prints notes + a JSON payload (`prompts[]` with `selector`, `text`, note).
   Re-poll on timeout; feedback is durable server-side.
3. Handle each item by kind: `element`/`text` prompts are change requests - edit
   `<file.html>` at the target located via `selector`/`text`. `message` prompts
   are freeform chat: answer them and edit only if the message asks for a change.
4. `critique poll <file.html> --agent-reply "<summary>" --timeout-ms 60000` — post
   your summary and wait for the next batch.
5. Repeat 3–4 until poll reports the session ended; then stop. End it yourself with
   `critique end <file.html>`.

Always pass `--timeout-ms` in agentic contexts and re-poll — never block
indefinitely.
