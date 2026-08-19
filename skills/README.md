# Skills

Agent integration snippets for critique. Each file shows how to wire the
critique review loop into a specific harness. Copy the one that matches your
setup and adapt as needed.

| File | Harness |
|---|---|
| `omp.md` | Oh My Pi (OMP) skill format |
| `cursor.mdc` | Cursor rules (`.cursor/rules/`) |
| `claude.md` | Anthropic Claude — `CLAUDE.md` or project context |
| `openai.md` | OpenAI — custom GPT instructions or system prompt |

The authoritative loop contract is always `critique instructions`. Run it once
and the output cannot drift from the installed binary.
