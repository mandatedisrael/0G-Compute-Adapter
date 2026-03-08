<p align="center">
  <img src="https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/src/assets/icons/icon.png" alt="Roo Code" width="60"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Roo Code</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://roocode.com">Roo Code</a>.
</p>

---

## Setup

### Step 1: Open Settings

Click the Roo Code icon in the VS Code sidebar, then open the **settings panel**.

### Step 2: Select Provider

Choose **"OpenAI Compatible"** from the **API Provider** dropdown.

### Step 3: Configure

| Field | Value |
|---|---|
| **Base URL** | `http://localhost:8000/v1` |
| **API Key** | `sk-0g-your-api-key` |
| **Model ID** | `zai-org/GLM-5-FP8` |

## Recommended Models

| Use Case | Model ID |
|---|---|
| **Agentic coding** | `zai-org/GLM-5-FP8` |
| **Code tasks** | `deepseek/deepseek-chat-v3-0324` |
| **General purpose** | `openai/gpt-oss-120b` |

## Important Note

Roo Code requires models that support **OpenAI-compatible tool calling**. The 0G Compute Adapter provides tool calling emulation for all models, so this works out of the box with GLM-5 and DeepSeek V3.

## Troubleshooting

| Issue | Solution |
|---|---|
| Tool calling errors | Use GLM-5 — most reliable tool calling through the adapter |
| "Connection refused" | Verify adapter is running and Base URL is correct |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
