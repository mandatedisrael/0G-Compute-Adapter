<p align="center">
  <img src="https://raw.githubusercontent.com/cline/cline/main/assets/icons/icon.png" alt="Cline" width="60"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Cline</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://github.com/cline/cline">Cline</a>.
</p>

---

## Setup

### Step 1: Open Cline Settings

Click the Cline icon in the VS Code sidebar, then click the **gear icon** (⚙️).

### Step 2: Select Provider

Choose **"OpenAI Compatible"** from the **API Provider** dropdown.

### Step 3: Configure

| Field | Value |
|---|---|
| **Base URL** | `http://localhost:8000/v1` |
| **API Key** | `sk-0g-your-api-key` |
| **Model ID** | `zai-org/GLM-5-FP8` |

That's it. Start typing tasks in the chat.

## Advanced Settings

Cline lets you customize per-model settings after connecting:

| Setting | Recommended Value |
|---|---|
| **Context Window** | `60000` |
| **Max Output Tokens** | `4096` |
| **Supports Images** | Enable for `qwen/qwen3-vl-30b-a3b-instruct` only |
| **Supports Computer Use** | Enable (tool calling supported via adapter) |

## Recommended Models

| Use Case | Model ID |
|---|---|
| **Autonomous coding** | `zai-org/GLM-5-FP8` |
| **Code refactoring** | `deepseek/deepseek-chat-v3-0324` |
| **Large tasks** | `openai/gpt-oss-120b` |
| **Vision tasks** | `qwen/qwen3-vl-30b-a3b-instruct` |

## Troubleshooting

| Issue | Solution |
|---|---|
| "No response from API" | Verify adapter is running and Base URL is correct |
| Tools not working | Use GLM-5 or DeepSeek — best tool calling support via the adapter |
| "Rate limit exceeded" | Default is 60 req/min. Set `OG_RATE_LIMIT` env var for higher limit |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
