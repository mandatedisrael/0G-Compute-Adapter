<p align="center">
  <img src="https://aider.chat/assets/logo.svg" alt="Aider" width="60"/>
</p>

<h1 align="center">Using 0G Compute Adapter with Aider</h1>

<p align="center">
  Use decentralized AI models from the 0G network as your model provider in <a href="https://aider.chat">Aider</a>.
</p>

---

## Setup

### Option 1: Environment Variables

```bash
export OPENAI_API_BASE=http://localhost:8000/v1
export OPENAI_API_KEY=your-0g-api-key

aider --model openai/zai-org/GLM-5-FP8
```

### Option 2: CLI Flags

```bash
aider \
  --openai-api-base http://localhost:8000/v1 \
  --openai-api-key your-0g-api-key \
  --model openai/zai-org/GLM-5-FP8
```

### Option 3: `.env` File

Create `.env` in your project root:

```bash
OPENAI_API_BASE=http://localhost:8000/v1
OPENAI_API_KEY=your-0g-api-key
```

```bash
aider --model openai/zai-org/GLM-5-FP8
```

### Option 4: Config File

Create `.aider.conf.yml` in your project root:

```yaml
openai-api-base: http://localhost:8000/v1
openai-api-key: your-0g-api-key
model: openai/zai-org/GLM-5-FP8
```

Then just run:

```bash
aider
```

## Model Settings (optional)

Create `.aider.model.settings.yml` for model-specific config:

```yaml
- name: openai/zai-org/GLM-5-FP8
  edit_format: diff
  use_repo_map: true
  streaming: true

- name: openai/deepseek/deepseek-chat-v3-0324
  edit_format: diff
  use_repo_map: true
  streaming: true
```

## Important

Always prefix model names with `openai/` when using Aider with a custom OpenAI-compatible endpoint.

## Recommended Models

| Use Case | Command |
|---|---|
| **Code editing** | `aider --model openai/deepseek/deepseek-chat-v3-0324` |
| **Complex refactoring** | `aider --model openai/zai-org/GLM-5-FP8` |
| **General tasks** | `aider --model openai/openai/gpt-oss-120b` |

## Troubleshooting

| Issue | Solution |
|---|---|
| "Model not found" | Prefix model ID with `openai/` |
| "Connection refused" | Verify adapter is running on the configured port |
| Edit format issues | Try `--edit-format whole` if diff editing doesn't work well |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
