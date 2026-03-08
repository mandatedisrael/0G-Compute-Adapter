<p align="center">
  <img src="https://raw.githubusercontent.com/continuedev/continue/main/extensions/vscode/media/icon.png" alt="Continue" width="60"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Continue</h1>

<p align="center">
  Use decentralized AI models from the 0G network in <a href="https://continue.dev">Continue</a> for VS Code and JetBrains.
</p>

---

## Setup

### Step 1: Open Config

Press `Cmd + Shift + P` / `Ctrl + Shift + P`, type **"Continue: Open Config File"**.

Or edit `~/.continue/config.json` directly.

### Step 2: Add 0G Models

```json
{
  "models": [
    {
      "title": "GLM-5 (0G Network)",
      "provider": "openai",
      "model": "zai-org/GLM-5-FP8",
      "apiBase": "http://localhost:8000/v1",
      "apiKey": "your-0g-api-key"
    },
    {
      "title": "DeepSeek V3 (0G Network)",
      "provider": "openai",
      "model": "deepseek/deepseek-chat-v3-0324",
      "apiBase": "http://localhost:8000/v1",
      "apiKey": "your-0g-api-key"
    },
    {
      "title": "Qwen3 VL (0G Network)",
      "provider": "openai",
      "model": "qwen/qwen3-vl-30b-a3b-instruct",
      "apiBase": "http://localhost:8000/v1",
      "apiKey": "your-0g-api-key"
    }
  ],
  "tabAutocompleteModel": {
    "title": "DeepSeek V3 (0G)",
    "provider": "openai",
    "model": "deepseek/deepseek-chat-v3-0324",
    "apiBase": "http://localhost:8000/v1",
    "apiKey": "your-0g-api-key"
  }
}
```

### Step 3: Select Model

Click the model selector in the Continue panel and choose a 0G model.

## What Works

| Feature | Status |
|---|---|
| Chat | Supported (streaming) |
| Inline edit (`Cmd+I`) | Supported |
| Tab autocomplete | Supported via `tabAutocompleteModel` |
| Context (`@codebase`, `@file`) | Supported |
| Tool calling | Supported via adapter emulation |

## Troubleshooting

| Issue | Solution |
|---|---|
| Model not showing | Restart VS Code after editing config.json |
| "Connection refused" | Verify adapter is running on the configured port |
| Config location | `~/.continue/config.json` on all platforms |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
