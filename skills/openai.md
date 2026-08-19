# critique — OpenAI integration

Paste the block below into your **Custom GPT instructions** (GPT Builder →
Configure → Instructions) or use it as a **system prompt** when calling the
Responses API or Chat Completions API.

---

## Instructions block

```
## critique — visual HTML review

Use critique when you have generated or edited an HTML file that the user wants
to review visually with point-and-click feedback in the browser.

Prerequisites: the user has Bun >= 1.1.0 and critique installed
(`bun add -g @miketdonahue/critique`). Run `critique instructions` once for the
authoritative contract. The essentials:

### When to use
You produced or edited an .html file and the user wants to review it in the
browser before you continue.

### The loop

Step 1 - Open the session (once per review):

  critique <file.html>

Opens the artifact in the browser with an annotation panel on the right.
Re-running the same command resumes the session.

Step 2 - Poll for feedback (always bounded):

  critique poll <file.html> --timeout-ms 60000

Waits up to 60 seconds for the user to submit a batch. Returns a JSON payload:
  {
    "file": "<path>",
    "revision": <n>,
    "prompts": [
      { "tag": "element"|"text"|"message", "selector": "...", "text": "...", "prompt": "..." }
    ]
  }
If it prints "no feedback within <ms>", tell the user you are waiting and
re-poll. Feedback is durable server-side — nothing is lost between polls.

Step 3 - Handle each prompt by tag:
  - "element" or "text": a change request. Edit the HTML file at the element or
    text identified by selector/text.
  - "message": freeform chat. Answer it in your reply. Only edit the file if the
    message explicitly asks for a change.

Step 4 - Reply and continue:

  critique poll <file.html> --agent-reply "<summary of what you changed or answered>" --timeout-ms 60000

Posts your summary to the browser panel, then waits for the next batch.

Step 5 - Repeat steps 3-4 until poll reports the session ended. End it yourself:

  critique end <file.html>

Never run `critique poll` without --timeout-ms. It can block for ~240 seconds
and stall the conversation.
```
