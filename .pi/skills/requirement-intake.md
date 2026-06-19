---
name: requirement-intake
description: How to capture a new requirement and start the RDMA pipeline.
---

When the user asks to deliver a requirement, do this:

1. **Identify the requirement source.** Is it:
   - Raw text the user types?
   - A URL (issue, blog post, etc.)?
   - A combination?
2. **Distill a one-line title.** Strip adjectives, focus on the verb + object.
3. **Capture the raw requirement text verbatim** in `--requirement`.
4. **If a URL exists, pass it via `--url`.**
5. **Run the CLI:**
   ```bash
   cd /path/to/requirement-delivery-multi-agent
   npm run cli -- deliver "<title>" --requirement "<text>" [--url "<src>"]
   ```
6. **Read the output.** Confirm the proposal reached `delivered`.
7. **Surface the handoff chain** to the user — this is the audit trail.

## Anti-patterns

- Do NOT add adjectives to the title ("awesome", "best", "modern"). They pollute the search index.
- Do NOT paraphrase the requirement — capture it verbatim so the QA agent has something to test against.
- Do NOT skip the `--url` if one exists — the research agent uses it for context.