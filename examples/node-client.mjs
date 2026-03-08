/**
 * 0G Proxy — Node.js Client Example
 *
 * Uses the standard OpenAI SDK to talk to decentralized AI models
 * through the 0G Proxy. Zero code changes needed.
 *
 * npm install openai
 */

import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'your-api-key-here',
});

// ── Basic Chat ──
const chat = await client.chat.completions.create({
  model: 'zai-org/GLM-5-FP8',
  messages: [{ role: 'user', content: 'What is the 0G network?' }],
});
console.log('Chat:', chat.choices[0].message.content);

// ── Streaming ──
process.stdout.write('\nStreaming: ');
const stream = await client.chat.completions.create({
  model: 'zai-org/GLM-5-FP8',
  messages: [{ role: 'user', content: 'Count from 1 to 10.' }],
  stream: true,
});
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
console.log();

// ── Tool Calling ──
const toolResponse = await client.chat.completions.create({
  model: 'zai-org/GLM-5-FP8',
  messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  }],
});

const toolCalls = toolResponse.choices[0].message.tool_calls;
if (toolCalls) {
  for (const tc of toolCalls) {
    console.log(`\nTool call: ${tc.function.name}(${tc.function.arguments})`);
  }
}

// ── Image Generation ──
const image = await client.images.generate({
  model: 'z-image',
  prompt: 'A futuristic city with flying cars',
  n: 1,
  size: '1024x1024',
});
console.log(`\nImage URL: ${image.data[0].url}`);
