<p align="center">
  <img src="https://raw.githubusercontent.com/open-webui/open-webui/main/static/favicon.png" alt="Open WebUI" width="80"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Open WebUI</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://openwebui.com">Open WebUI</a>.
</p>

---

## Overview

Open WebUI is a self-hosted ChatGPT-style interface. Connect it to the 0G Compute Adapter and all 0G models appear as selectable models in the chat UI.

## Prerequisites

- [Open WebUI](https://docs.openwebui.com/getting-started/) installed
- 0G Compute Adapter running (see [Quick Start](../README.md#quick-start))
- Your API key from the adapter startup logs

## Setup

### Option 1: Docker Compose (run both together)

```yaml
services:
  og-proxy:
    build: .
    ports:
      - "8000:8000"
    env_file: .env

  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    ports:
      - "3000:8080"
    environment:
      - OPENAI_API_BASE_URL=http://og-proxy:8000/v1
      - OPENAI_API_KEY=your-0g-api-key
    depends_on:
      - og-proxy
```

```bash
docker compose up -d
```

Open `http://localhost:3000` — all 0G models appear in the model selector.

### Option 2: Connect to Existing Adapter

1. Open Open WebUI at `http://localhost:3000`
2. Go to **Settings** > **Connections**
3. Under **OpenAI API**:

| Setting | Value |
|---|---|
| **API Base URL** | `http://localhost:8000/v1` |
| **API Key** | `sk-0g-your-api-key` |

4. Click **Save** — models appear automatically

## What Works

| Feature | Status |
|---|---|
| Chat with streaming | Supported |
| All 0G models in selector | Supported |
| Image generation (Z-Image) | Supported |
| Audio transcription (Whisper) | Supported |
| Tool calling | Supported |
| Multi-user | Managed by Open WebUI |
| Conversation history | Managed by Open WebUI |

## Recommended Defaults

| Setting | Value |
|---|---|
| **Default chat model** | `zai-org/GLM-5-FP8` |
| **Image generation** | `z-image` |
| **Speech-to-text** | `openai/whisper-large-v3` |

## Troubleshooting

| Issue | Solution |
|---|---|
| No models showing | Verify API Base URL ends with `/v1` |
| "Connection refused" | In Docker, use service name (`og-proxy`) not `localhost` |
| Images not generating | Check Z-Image is available on the adapter dashboard |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
