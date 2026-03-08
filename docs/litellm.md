<p align="center">
  <img src="https://raw.githubusercontent.com/BerriAI/litellm/main/docs/my-website/static/img/logo.svg" alt="LiteLLM" width="80"/>
</p>

<h1 align="center">Using 0G Compute Adapter with LiteLLM</h1>

<p align="center">
  Add 0G decentralized models as a provider in <a href="https://litellm.ai">LiteLLM</a>.
</p>

---

## Overview

LiteLLM is a unified proxy for 100+ LLM providers. Add the 0G Compute Adapter as a provider to include decentralized models alongside OpenAI, Anthropic, and others.

## Prerequisites

- [LiteLLM](https://docs.litellm.ai/docs/) installed (`pip install litellm`)
- 0G Compute Adapter running (see [Quick Start](../README.md#quick-start))

## Setup

### Python SDK

```python
import litellm

response = litellm.completion(
    model="openai/zai-org/GLM-5-FP8",
    messages=[{"role": "user", "content": "Hello from 0G!"}],
    api_base="http://localhost:8000/v1",
    api_key="your-0g-api-key",
)
print(response.choices[0].message.content)
```

### LiteLLM Proxy Config

Add to `litellm_config.yaml`:

```yaml
model_list:
  - model_name: glm-5
    litellm_params:
      model: openai/zai-org/GLM-5-FP8
      api_base: http://localhost:8000/v1
      api_key: your-0g-api-key

  - model_name: deepseek-v3
    litellm_params:
      model: openai/deepseek/deepseek-chat-v3-0324
      api_base: http://localhost:8000/v1
      api_key: your-0g-api-key

  - model_name: gpt-oss-120b
    litellm_params:
      model: openai/openai/gpt-oss-120b
      api_base: http://localhost:8000/v1
      api_key: your-0g-api-key

  - model_name: qwen3-vl
    litellm_params:
      model: openai/qwen/qwen3-vl-30b-a3b-instruct
      api_base: http://localhost:8000/v1
      api_key: your-0g-api-key
```

```bash
litellm --config litellm_config.yaml
```

### Load Balancing with Fallback

Use 0G as a fallback when your primary provider is down:

```yaml
model_list:
  - model_name: smart-model
    litellm_params:
      model: gpt-4o
      api_key: sk-openai-key

  - model_name: smart-model
    litellm_params:
      model: openai/zai-org/GLM-5-FP8
      api_base: http://localhost:8000/v1
      api_key: your-0g-api-key

router_settings:
  routing_strategy: latency-based-routing
  num_retries: 2
```

## Troubleshooting

| Issue | Solution |
|---|---|
| "Model not found" | Prefix with `openai/` in LiteLLM config |
| Routing not working | Verify `api_base` ends with `/v1` |
| Streaming timeout | Set `stream_timeout` higher — 0G models may need more time |

---

<p align="center">
  <a href="../README.md">Back to README</a>
</p>
