# iso-route — Cursor notes

Cursor does not expose a file-based way to pin which model it uses, so iso-route can't emit a settings file here the way it does for Claude Code, Codex, or OpenCode. Use this file as the team-shared record of *which models you should pick from the Cursor chat selector* to stay consistent with the rest of your harness.

## Default

- **anthropic / claude-sonnet-4-6**

## Roles

Cursor has no role/subagent system, so these are advisory — switch the model picker before invoking the chat for that kind of work.

| Role | Provider | Model | Reasoning |
| ---- | -------- | ----- | --------- |
| `fast` | anthropic | `claude-haiku-4-5` | — |
| `quality` | anthropic | `claude-opus-4-7` | high |
| `minimal` | anthropic | `claude-haiku-4-5` | — |
