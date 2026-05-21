# iso-route — Pi notes

Pi reads `.pi/settings.json` for the default provider/model and model cycling. It does not have native role-specific subagent binding, so role entries below are advisory for manual model switching or extension/package workflows.

## Default

- **anthropic / claude-sonnet-4-6**

## Roles

| Role | Provider | Model | Thinking | Fallback |
| ---- | -------- | ----- | -------- | -------- |
| `fast` | anthropic | `claude-haiku-4-5` | - | - |
| `quality` | anthropic | `claude-opus-4-7` | high | - |
| `minimal` | anthropic | `claude-haiku-4-5` | - | - |
