#!/bin/bash
# 0G Proxy — curl Examples
# Replace with your actual values
BASE_URL="http://localhost:8000"
API_KEY="your-api-key-here"
AUTH="Authorization: Bearer $API_KEY"

echo "=== List Models ==="
curl -s "$BASE_URL/v1/models" -H "$AUTH" | python3 -m json.tool

echo -e "\n=== Chat Completion ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "model": "zai-org/GLM-5-FP8",
    "messages": [{"role": "user", "content": "Hello!"}]
  }' | python3 -m json.tool

echo -e "\n=== Streaming ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "model": "zai-org/GLM-5-FP8",
    "messages": [{"role": "user", "content": "Count from 1 to 5."}],
    "stream": true
  }'

echo -e "\n\n=== Tool Calling ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "model": "zai-org/GLM-5-FP8",
    "messages": [{"role": "user", "content": "What is the weather in London?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}
      }
    }]
  }' | python3 -m json.tool

echo -e "\n=== Structured Output (JSON Schema) ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "model": "zai-org/GLM-5-FP8",
    "messages": [{"role": "user", "content": "List 3 colors"}],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "colors",
        "schema": {"type":"object","properties":{"colors":{"type":"array","items":{"type":"string"}}}}
      }
    }
  }' | python3 -m json.tool

echo -e "\n=== Vision ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "model": "qwen/qwen3-vl-30b-a3b-instruct",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Describe this image."},
        {"type": "image_url", "image_url": {"url": "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png"}}
      ]
    }]
  }' | python3 -m json.tool

echo -e "\n=== Image Generation ==="
curl -s "$BASE_URL/v1/images/generations" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "prompt": "A sunset over mountains",
    "n": 1,
    "size": "1024x1024"
  }' | python3 -m json.tool

echo -e "\n=== Audio Transcription ==="
echo "(Requires an audio file)"
echo "curl -s $BASE_URL/v1/audio/transcriptions \\"
echo "  -H '$AUTH' \\"
echo "  -F file=@audio.mp3 -F model=whisper-large-v3"
