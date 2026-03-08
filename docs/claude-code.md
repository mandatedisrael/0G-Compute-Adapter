<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://claude.ai/images/claude-ai-logo-white.svg"/>
    <img src="https://upload.wikimedia.org/wikipedia/commons/8/8a/Claude_AI_logo.svg" alt="Claude Code" width="60"/>
  </picture>
</p>

<h1 align="center">Using 0G Compute Adapter with Claude Code</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> — no extra proxy needed.
</p>

---

## Overview

The 0G Compute Adapter has a **built-in Anthropic Messages API** (`/v1/messages`) that speaks Claude Code's native protocol. No translation proxy required — just point Claude Code directly at the adapter.

## Setup

### Option 1: Environment Variables (quickest)

```bash
export ANTHROPIC_BASE_URL=http://localhost:8000
export ANTHROPIC_API_KEY=your-0g-api-key

claude
```

### Option 2: Settings File

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8000",
    "ANTHROPIC_API_KEY": "your-0g-api-key"
  }
}
```

Then just run:

```bash
claude
```

### Option 3: Per-Project

Add to your project's `.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8000",
    "ANTHROPIC_API_KEY": "your-0g-api-key"
  }
}
```

### Option 4: Inline

```bash
ANTHROPIC_BASE_URL=http://localhost:8000 ANTHROPIC_API_KEY=your-0g-api-key claude
```

## How It Works

The adapter automatically maps Claude model names to 0G models:

| Claude Code sends | 0G model used |
|---|---|
| `sonnet`, `claude-sonnet-4-6` | `zai-org/GLM-5-FP8` |
| `opus`, `claude-opus-4-6` | `zai-org/GLM-5-FP8` |
| `haiku`, `claude-haiku-4-5-*` | `deepseek/deepseek-chat-v3-0324` |

You can also use 0G model names directly:

```bash
claude --model zai-org/GLM-5-FP8
```

## What Works

| Feature | Status |
|---|---|
| Chat with streaming | Supported |
| Tool calling (agentic) | Supported |
| Multi-turn conversations | Supported |
| `x-api-key` auth | Supported |
| System prompts | Supported |
| Vision (images) | Supported (auto-routes to Qwen3-VL) |

## Remote Server

If the adapter runs on a remote server:

```bash
export ANTHROPIC_BASE_URL=https://your-server.com
export ANTHROPIC_API_KEY=your-0g-api-key

claude
```

## Troubleshooting

| Issue | Solution |
|---|---|
| "Connection refused" | Make sure the adapter is running and `ANTHROPIC_BASE_URL` is correct |
| "Invalid API key" | Use the API key from the adapter's startup logs |
| Slow first response | Normal — first request establishes 0G provider connection |
| Tools not working | GLM-5 has the best tool calling support through the adapter |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
