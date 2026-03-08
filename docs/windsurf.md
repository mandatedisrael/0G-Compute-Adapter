<p align="center">
  <img src="https://raw.githubusercontent.com/Exafunction/codeium.vim/main/windsurf.png" alt="Windsurf" width="60"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Windsurf</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://windsurf.com">Windsurf</a>.
</p>

---

## Setup

### Step 1: Open Settings

Click the gear icon in the bottom-left corner, or press `Cmd + ,` (macOS) / `Ctrl + ,` (Windows/Linux).

### Step 2: Configure AI Provider

Search for **"ai provider"** or **"openai"** in settings, then configure:

| Setting | Value |
|---|---|
| **Provider** | `OpenAI Compatible` |
| **API Key** | `sk-0g-your-api-key` |
| **Base URL** | `http://localhost:8000/v1` |
| **Model** | `zai-org/GLM-5-FP8` |

### Step 3: Save and Use

Click **Save**. The 0G models are now available in Windsurf's Cascade agent and all AI features.

## Recommended Models

| Use Case | Model |
|---|---|
| **Cascade (agentic)** | `zai-org/GLM-5-FP8` |
| **Code generation** | `deepseek/deepseek-chat-v3-0324` |
| **General purpose** | `openai/gpt-oss-120b` |

## Troubleshooting

| Issue | Solution |
|---|---|
| "Connection refused" | Verify adapter is running on the configured port |
| Models not showing | Ensure Base URL ends with `/v1` |
| Slow responses | Normal for first request — 0G provider connection is being established |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
