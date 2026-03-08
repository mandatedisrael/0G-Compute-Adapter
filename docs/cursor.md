<p align="center">
  <img src="https://cursor.com/apple-touch-icon.png" alt="Cursor" width="60"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Cursor</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://cursor.com">Cursor</a>.
</p>

---

## Setup

### Step 1: Open Settings

`Cursor Settings` > `Models`

Or press `Cmd + ,` (macOS) / `Ctrl + ,` (Windows/Linux) and navigate to **Models**.

### Step 2: Configure OpenAI API

| Setting | Value |
|---|---|
| **OpenAI API Key** | `sk-0g-your-api-key` |
| **Override OpenAI Base URL** | `http://localhost:8000/v1` |

> Toggle on **"Override OpenAI Base URL"** — it's off by default.

> If your adapter is on a remote server, use that server's address instead of `localhost`.

### Step 3: Add Model Names

Click **"+ Add Model"** and add the 0G models you want to use:

```
zai-org/GLM-5-FP8
deepseek/deepseek-chat-v3-0324
openai/gpt-oss-120b
qwen/qwen3-vl-30b-a3b-instruct
```

### Step 4: Use

Open any Cursor chat (`Cmd+L`) or inline edit (`Cmd+K`), then select a 0G model from the model dropdown.

## Recommended Models

| Use Case | Model |
|---|---|
| **Chat / Q&A** | `zai-org/GLM-5-FP8` |
| **Code generation** | `deepseek/deepseek-chat-v3-0324` |
| **Tab completion** | `deepseek/deepseek-chat-v3-0324` |
| **General purpose** | `openai/gpt-oss-120b` |

## Important Notes

- Cursor routes requests for **your custom models only** through the override base URL. Built-in Cursor models (like `gpt-4o`) continue to use Cursor's own backend.
- Streaming is fully supported — responses appear in real-time.
- If the API key field is empty, Cursor won't send requests. Any non-empty value works.

## Troubleshooting

| Issue | Solution |
|---|---|
| "Connection refused" | Make sure the adapter is running on the configured port |
| "401 Unauthorized" | Verify API key matches the one from adapter startup logs |
| Model not in dropdown | Make sure you added the model name in Step 3 |
| Built-in models broken | Known Cursor bug — custom base URL can affect built-in models. Use separate model names. |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
