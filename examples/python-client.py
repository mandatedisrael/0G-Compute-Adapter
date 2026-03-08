"""
0G Proxy — Python Client Example

Uses the standard OpenAI SDK to talk to decentralized AI models
through the 0G Proxy. Zero code changes needed.
"""

from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="your-api-key-here",
)

# ── Basic Chat ────────────────────────────────────────────────────────────────

response = client.chat.completions.create(
    model="zai-org/GLM-5-FP8",
    messages=[{"role": "user", "content": "What is the 0G network?"}],
)
print("Chat:", response.choices[0].message.content)

# ── Streaming ─────────────────────────────────────────────────────────────────

print("\nStreaming: ", end="")
stream = client.chat.completions.create(
    model="zai-org/GLM-5-FP8",
    messages=[{"role": "user", "content": "Count from 1 to 10."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()

# ── Tool Calling ──────────────────────────────────────────────────────────────

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"},
                },
                "required": ["city"],
            },
        },
    }
]

response = client.chat.completions.create(
    model="zai-org/GLM-5-FP8",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=tools,
)

if response.choices[0].message.tool_calls:
    for tc in response.choices[0].message.tool_calls:
        print(f"\nTool call: {tc.function.name}({tc.function.arguments})")

# ── Structured Output ─────────────────────────────────────────────────────────

response = client.chat.completions.create(
    model="zai-org/GLM-5-FP8",
    messages=[{"role": "user", "content": "List 3 programming languages with their year of creation"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "languages",
            "schema": {
                "type": "object",
                "properties": {
                    "languages": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "year": {"type": "integer"},
                            },
                        },
                    }
                },
            },
        },
    },
)
print(f"\nStructured: {response.choices[0].message.content}")

# ── Vision ────────────────────────────────────────────────────────────────────

response = client.chat.completions.create(
    model="qwen/qwen3-vl-30b-a3b-instruct",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What's in this image?"},
                {"type": "image_url", "image_url": {"url": "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png"}},
            ],
        }
    ],
)
print(f"\nVision: {response.choices[0].message.content}")

# ── Image Generation ──────────────────────────────────────────────────────────

response = client.images.generate(
    model="z-image",
    prompt="A futuristic city with flying cars",
    n=1,
    size="1024x1024",
)
print(f"\nImage URL: {response.data[0].url}")
