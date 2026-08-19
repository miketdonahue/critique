# critique — agent integration

Add this to your project's `CLAUDE.md` to give Claude the critique review loop.

---

## critique

Use `critique` when you have generated or edited an HTML file that the user wants
to review visually with point-and-click feedback.

Run `critique instructions` once for the authoritative contract. The essentials:

**When to use:** You produced or edited an `.html` file and the user wants to
review it in the browser.

**The loop:**

1. Open the session (once):
   ```
   critique <file.html>
   ```
   Opens the artifact in the browser. Re-running resumes the same session.

2. Wait for feedback (bounded):
   ```
   critique poll <file.html> --timeout-ms 60000
   ```
   Returns a JSON payload with `prompts[]` — each has `selector`, `text`, `tag`,
   and a `prompt` note. Re-poll on `no feedback within <ms>`; feedback is durable.

3. Handle each item by `tag`:
   - `element` / `text` - change request. Edit the HTML using `selector`/`text`
     to locate the target.
   - `message` - freeform chat. Answer in your reply; edit only if explicitly asked.

4. Reply and wait for the next round:
   ```
   critique poll <file.html> --agent-reply "<what you changed or answered>" --timeout-ms 60000
   ```

5. Repeat 3-4 until the session ends. End it yourself when done:
   ```
   critique end <file.html>
   ```

**Always pass `--timeout-ms` and re-poll.** A naked `critique poll` can wait
~240s and stall the harness. Feedback is durable server-side — nothing is lost
between polls.
