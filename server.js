/**
 * 0G OpenAI-Compatible Proxy — Minimal Single Container
 *
 * Drop-in OpenAI replacement powered by 0G Compute Network.
 * Supports: tool calling, structured output, streaming.
 *
 * Usage:
 *   OG_PRIVATE_KEY=0x... node server.js
 *   curl http://localhost:8000/v1/chat/completions ...
 */

import express from 'express';
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import { randomUUID } from 'crypto';
import { appendFileSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Persistent Logger ────────────────────────────────────────────────────────

const LOG_DIR = process.env.OG_LOG_DIR || './logs';
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function log(level, category, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    cat: category,
    msg: message,
    ...meta,
  };
  const line = JSON.stringify(entry) + '\n';

  // Write to file (one file per day)
  const day = entry.ts.slice(0, 10);
  try { appendFileSync(join(LOG_DIR, `${day}.jsonl`), line); } catch {}

  // Also print to stdout
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${category}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
}

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8000;
const RPC_URL = process.env.OG_RPC_URL || 'https://evmrpc.0g.ai';
const PRIVATE_KEY = process.env.OG_PRIVATE_KEY;
const ADMIN_KEY = process.env.OG_ADMIN_KEY || randomUUID();

// API keys: load from persistent file, env, or auto-generate
const API_KEYS_FILE = join(LOG_DIR, 'api-keys.json');
const API_KEYS = new Map(); // key -> { name, created, lastUsed, requests }

function loadApiKeys() {
  // Load from persistent file first
  try {
    if (existsSync(API_KEYS_FILE)) {
      const saved = JSON.parse(readFileSync(API_KEYS_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(saved)) API_KEYS.set(k, v);
    }
  } catch {}
  // Add env keys if not already present
  const envKeys = (process.env.OG_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  for (const k of envKeys) {
    if (!API_KEYS.has(k)) API_KEYS.set(k, { name: 'env', created: new Date().toISOString(), lastUsed: null, requests: 0 });
  }
  // Auto-generate if none
  if (API_KEYS.size === 0) {
    const autoKey = `sk-0g-${randomUUID().replace(/-/g, '')}`;
    API_KEYS.set(autoKey, { name: 'default', created: new Date().toISOString(), lastUsed: null, requests: 0 });
  }
}
function saveApiKeys() {
  try { writeFileSync(API_KEYS_FILE, JSON.stringify(Object.fromEntries(API_KEYS), null, 2)); } catch {}
}
loadApiKeys();

// Rate limiting per API key
const RATE_LIMIT = parseInt(process.env.OG_RATE_LIMIT) || 60; // requests per minute
const rateBuckets = new Map(); // key -> { count, resetAt }

if (!PRIVATE_KEY) {
  console.error('OG_PRIVATE_KEY is required');
  process.exit(1);
}

// ── 0G Broker ────────────────────────────────────────────────────────────────

class OGBroker {
  constructor() {
    this.broker = null;
    this.models = new Map();          // modelName -> { provider, endpoint, ogModel, type }
    this.acknowledged = new Set();
  }

  async initialize() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    this.broker = await createZGComputeNetworkBroker(wallet);
    console.log(`Wallet: ${wallet.address}`);
  }

  async discoverModels() {
    const services = await this.broker.inference.listService();
    this.models.clear();

    for (const svc of services) {
      const [providerAddr, serviceType, endpoint, , , , modelName] = svc;
      // Skip if we already have this model (first provider wins)
      const shortName = modelName.split('/').pop().toLowerCase();
      if (!this.models.has(shortName)) {
        this.models.set(shortName, {
          provider: providerAddr,
          endpoint,
          ogModel: modelName,
          type: serviceType,
        });
      }
      // Also store full model name
      if (!this.models.has(modelName)) {
        this.models.set(modelName, {
          provider: providerAddr,
          endpoint,
          ogModel: modelName,
          type: serviceType,
        });
      }
    }

    console.log(`Discovered ${this.models.size} models:`);
    const seen = new Set();
    for (const [name, info] of this.models) {
      if (!seen.has(info.provider)) {
        seen.add(info.provider);
        console.log(`  ${name} (${info.type}) -> ${info.provider.slice(0, 10)}...`);
      }
    }
  }

  async acknowledge(providerAddr) {
    if (this.acknowledged.has(providerAddr)) return;
    try {
      await this.broker.inference.acknowledgeProviderSigner(providerAddr);
      this.acknowledged.add(providerAddr);
    } catch (err) {
      // Already acknowledged or insufficient balance for this provider
      if (err.message?.includes('already') || err.message?.includes('Acknowledged')) {
        this.acknowledged.add(providerAddr);
      } else {
        console.error(`Acknowledge ${providerAddr.slice(0, 10)}... failed:`, err.message);
        throw err;
      }
    }
  }

  async getAuth(providerAddr, content) {
    await this.acknowledge(providerAddr);
    const { endpoint, model } = await this.broker.inference.getServiceMetadata(providerAddr);
    const headers = await this.broker.inference.getRequestHeaders(providerAddr, content);
    return { headers, endpoint, model };
  }

  async settleResponse(providerAddr, chatId, usage) {
    try {
      const usageStr = usage ? JSON.stringify(usage) : undefined;
      await this.broker.inference.processResponse(providerAddr, chatId, usageStr);
    } catch (err) {
      log('warn', 'settle', `processResponse failed for ${providerAddr.slice(0, 10)}...`, { error: err.message });
    }
  }

  resolve(modelName) {
    return this.models.get(modelName) || this.models.get(modelName.toLowerCase());
  }
}

// ── Tool Calling ─────────────────────────────────────────────────────────────

function buildToolPrompt(tools, modelName = '') {
  const defs = tools
    .filter(t => t.type === 'function')
    .map(t => JSON.stringify({
      name: t.function.name,
      description: t.function.description || '',
      parameters: t.function.parameters || {},
    }, null, 2))
    .join('\n');

  const model = modelName.toLowerCase();

  // GLM-5 / GLM models: use their native <tool_call> JSON format (most reliable for them)
  if (model.includes('glm')) {
    return `You have access to tools. When you need to call a tool, respond with ONLY a tool call block — NO other text before or after.

Format for calling tools:
<tool_call>
{"name": "function_name", "arguments": {"key": "value"}}
</tool_call>

For multiple tools, use separate blocks:
<tool_call>
{"name": "func1", "arguments": {"key": "value"}}
</tool_call>
<tool_call>
{"name": "func2", "arguments": {"key": "value"}}
</tool_call>

CRITICAL RULES:
- Output ONLY the <tool_call> blocks when calling tools — NO text, NO explanation, NO thinking
- The content inside <tool_call> MUST be valid JSON with "name" and "arguments" keys
- Do NOT use any other format (no <arg_key>, no YAML, no function() syntax)
- Either call tools OR respond with plain text — NEVER mix both
- After receiving tool results, you may call more tools or give a final text answer

Available tools:
${defs}`;
  }

  // DeepSeek / Qwen / others: use ```tool_calls format
  return `You have access to tools. When you need to call a tool, respond with ONLY this JSON block — NO other text, NO explanation:

\`\`\`tool_calls
[{"name": "function_name", "arguments": {"key": "value"}}]
\`\`\`

For multiple tools: [{"name":"f1","arguments":{...}},{"name":"f2","arguments":{...}}]

CRITICAL RULES:
- NEVER mix tool calls with regular text. Either call tools OR respond with text.
- After receiving tool results, you may call more tools or give a final text answer.
- Do NOT use <tool_call> tags or any other format. ONLY use \`\`\`tool_calls\`\`\`.

Available tools:
${defs}`;
}

function parseToolCalls(content) {
  if (!content) return null;

  // Strip </think> tags (model sometimes outputs thinking before tool calls)
  const cleaned = content.replace(/<\/think>/g, '');

  // 1. ```tool_calls ... ``` (may appear after text/thinking)
  const tcBlock = cleaned.match(/```tool_calls\s*\n?([\s\S]*?)```/);
  if (tcBlock) {
    try {
      let calls = JSON.parse(tcBlock[1].trim());
      if (!Array.isArray(calls)) calls = [calls];
      if (calls.length && calls.every(c => c.name)) return calls;
    } catch {}
  }

  // 2. <tool_call> tags — handle ALL variants
  const tags = [...cleaned.matchAll(/<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|<tool_call>|$)/g)];
  if (tags.length) {
    const calls = [];
    for (const tag of tags) {
      const parsed = parseOneToolCall(tag[1].trim());
      if (parsed) calls.push(parsed);
    }
    if (calls.length) return calls;
  }

  // 3. Embedded JSON array [{"name":...}] anywhere in content (handles garbled prefixes)
  const arrMatch = cleaned.match(/\[\s*\{\s*"name"\s*:/);
  if (arrMatch) {
    const start = arrMatch.index;
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === '[') depth++;
      else if (cleaned[i] === ']') { depth--; if (depth === 0) {
        try {
          const calls = JSON.parse(cleaned.slice(start, i + 1));
          if (Array.isArray(calls) && calls.every(c => c.name)) return calls;
        } catch {} break;
      }}
    }
  }

  // 4. Single {"name":..., "arguments":...}
  const objMatch = cleaned.match(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/);
  if (objMatch) {
    const start = objMatch.index;
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') { depth--; if (depth === 0) {
        try { return [JSON.parse(cleaned.slice(start, i + 1))]; } catch {} break;
      }}
    }
  }

  // 5. Bare function call syntax: func_name({"key": "val"})
  const bareCalls = [...cleaned.matchAll(/(?:^|\n)\s*(\w+)\s*\(\s*(\{[\s\S]*?\})\s*\)/g)];
  if (bareCalls.length) {
    const calls = [];
    for (const bc of bareCalls) {
      try { calls.push({ name: bc[1], arguments: JSON.parse(bc[2]) }); } catch {
        try { calls.push({ name: bc[1], arguments: JSON.parse(bc[2].replace(/'/g, '"')) }); } catch {}
      }
    }
    if (calls.length) return calls;
  }

  return null;
}

// Parse a single <tool_call> body into {name, arguments}
function parseOneToolCall(tc) {
  if (!tc) return null;

  // Direct JSON: {"name": "fn", "arguments": {...}}
  try { const c = JSON.parse(tc); if (c.name) return c; } catch {}

  // function_name\n{JSON args}
  const lines = tc.split('\n');
  if (lines.length >= 2) {
    const fn = lines[0].trim().replace(/[\[\]{}]/g, '');
    if (/^\w+$/.test(fn)) {
      try { return { name: fn, arguments: JSON.parse(lines.slice(1).join('\n')) }; } catch {}
    }
  }

  // function_name({"key": "val"}) — function call syntax
  const funcCall = tc.match(/^(\w+)\s*\(\s*(\{[\s\S]*\})\s*\)/);
  if (funcCall) {
    try { return { name: funcCall[1], arguments: JSON.parse(funcCall[2]) }; } catch {}
    try { return { name: funcCall[1], arguments: JSON.parse(funcCall[2].replace(/'/g, '"')) }; } catch {}
  }

  // Extract function name
  const fnMatch = tc.match(/^(\w+)/);
  if (!fnMatch) return null;
  const fnName = fnMatch[1];
  const rest = tc.slice(fnMatch[0].length).trim();

  // No args — bare function: <tool_call>get_device_info</tool_call>
  if (!rest || rest === '</arg_value>' || rest === ')') {
    return { name: fnName, arguments: {} };
  }

  // Inline JSON after function name: execute_bash {"command": "ls"}</tool_call>
  // Also handles: func_name({"key": "val"}) or func_name({"key": "val"}</tool_call> (missing closing paren)
  // Strip trailing tags and parens, then try JSON parse
  let restClean = rest.replace(/<\/(?:arg_value|tool_call)>$/g, '').trim();
  // Strip surrounding parens: ({"key": "val"}) or ({"key": "val"}
  if (restClean.startsWith('(')) restClean = restClean.slice(1).replace(/\)\s*$/, '').trim();
  if (restClean.startsWith('{')) {
    try { return { name: fnName, arguments: JSON.parse(restClean) }; } catch {}
    // Try fixing common JSON issues
    try { return { name: fnName, arguments: JSON.parse(restClean.replace(/'/g, '"')) }; } catch {}
    // Try extracting key-value pairs from malformed JSON (model uses wrong escaping)
    // e.g. {"file_path": "/tmp/foo.py", "content": "print(\"hello\")\n"}
    // where inner quotes break JSON parsing
    const kvExtract = {};
    const kvRegex = /"(\w+)"\s*:\s*/g;
    let match;
    const keys = [];
    while ((match = kvRegex.exec(restClean)) !== null) {
      keys.push({ key: match[1], valueStart: match.index + match[0].length });
    }
    if (keys.length >= 1) {
      for (let i = 0; i < keys.length; i++) {
        const start = keys[i].valueStart;
        const end = i < keys.length - 1 ? keys[i + 1].valueStart - keys[i + 1].key.length - 5 : restClean.length;
        let val = restClean.slice(start, end).trim();
        // Strip leading quote, trailing quote/comma/brace
        val = val.replace(/^"/, '').replace(/[",}\s]+$/, '');
        kvExtract[keys[i].key] = val;
      }
      if (Object.keys(kvExtract).length >= 1) return { name: fnName, arguments: kvExtract };
    }
  }

  // ":@" separator: <arg_key>action":@"snapshot"</arg_value>
  const atPairs = [...rest.matchAll(/<arg_key>\s*(\w+)"?\s*:\s*@\s*"([^"]*)"?\s*<\/arg_value>/g)];
  if (atPairs.length) {
    const args = {};
    for (const p of atPairs) args[p[1].trim()] = p[2].trim();
    return { name: fnName, arguments: args };
  }

  // Broken <arg_key> with JSON-like content: <arg_key>file_path": "/tmp/foo.py", "content": "code..."</arg_value>
  // The model dumps a JSON object's inner content into <arg_key>...<\/arg_value>
  const brokenArgContent = rest.match(/<arg_key>\s*([\s\S]+?)\s*<\/arg_value>/);
  if (brokenArgContent) {
    let raw = brokenArgContent[1].trim();
    // Try wrapping as JSON and parsing (escape newlines first)
    let rawTrimmed = raw.replace(/<\/arg_value>$/, '').replace(/<\/tool_call>$/, '').trim();
    // Wrap as JSON object if it doesn't already end with }
    let jsonStr = rawTrimmed.endsWith('}') ? '{"' + rawTrimmed : '{"' + rawTrimmed + '}';
    jsonStr = jsonStr.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
    try { return { name: fnName, arguments: JSON.parse(jsonStr) }; } catch {}

    // Smart key-value splitting: find "key": boundaries and split there
    // Matches patterns like: key1": "val1", "key2": "val2..."
    const keyBoundaries = [];
    const keyRe = /(\w+)"\s*:\s*"/g;
    let km;
    while ((km = keyRe.exec(raw)) !== null) keyBoundaries.push({ key: km[1], pos: km.index, valStart: km.index + km[0].length });
    if (keyBoundaries.length >= 2) {
      const args = {};
      for (let i = 0; i < keyBoundaries.length; i++) {
        const key = keyBoundaries[i].key;
        const valStart = keyBoundaries[i].valStart;
        let valEnd;
        if (i < keyBoundaries.length - 1) {
          // Value ends at `", "nextKey"` — find the `", "` before the next key
          valEnd = keyBoundaries[i + 1].pos;
          // Walk back past `", "` separator
          let sep = raw.lastIndexOf('", "', valEnd);
          if (sep >= valStart) valEnd = sep;
          else valEnd = raw.lastIndexOf(', "', valEnd);
        } else {
          valEnd = raw.length;
        }
        let val = raw.slice(valStart, valEnd).trim().replace(/^"/, '').replace(/["}\s,]+$/, '');
        args[key] = val;
      }
      return { name: fnName, arguments: args };
    }

    // Single key-value: key": value</arg_value>
    if (keyBoundaries.length === 1) {
      let val = raw.slice(keyBoundaries[0].valStart).trim().replace(/["}\s]+$/, '');
      // Try to parse as number/boolean
      if (val === 'true') return { name: fnName, arguments: { [keyBoundaries[0].key]: true } };
      if (val === 'false') return { name: fnName, arguments: { [keyBoundaries[0].key]: false } };
      if (/^\d+$/.test(val)) return { name: fnName, arguments: { [keyBoundaries[0].key]: parseInt(val) } };
      return { name: fnName, arguments: { [keyBoundaries[0].key]: val } };
    }
  }

  // Missing <arg_value> tag: <arg_key>key</arg_key>value</arg_value>
  const missingValTag = [...rest.matchAll(/<arg_key>\s*(\w+)\s*<\/arg_key>\s*([^<]+?)(?:<\/arg_value>|<arg_key>|<\/tool_call>|$)/g)];
  if (missingValTag.length) {
    const args = {};
    for (const p of missingValTag) args[p[1].trim()] = p[2].trim();
    return { name: fnName, arguments: args };
  }

  // Hybrid format: key</arg_key><arg_value>value (bare key name before </arg_key>)
  // e.g., path</arg_key><arg_value>/Users/badboy17g/Documents
  const hybridPairs = [...rest.matchAll(/(\w+)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)(?:<\/arg_value>|<\/tool_call>|<arg_key>|$)/g)];
  if (hybridPairs.length) {
    const args = {};
    for (const p of hybridPairs) args[p[1].trim()] = p[2].trim();
    return { name: fnName, arguments: args };
  }
  // Single hybrid: just one key</arg_key><arg_value>value
  const singleHybrid = rest.match(/^(\w+)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)(?:<\/|$)/);
  if (singleHybrid) {
    return { name: fnName, arguments: { [singleHybrid[1].trim()]: singleHybrid[2].trim() } };
  }

  // YAML-style args: key: value\nkey2: value2
  // e.g., <tool_call>execute_bash\ncommand: mkdir -p ~/Documents\n</arg_value>
  const yamlLines = rest.replace(/<\/arg_value>$/, '').trim().split('\n');
  const yamlArgs = {};
  let yamlFound = false;
  let currentKey = null;
  for (const line of yamlLines) {
    const kvMatch = line.match(/^(\w+)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      yamlArgs[currentKey] = kvMatch[2].trim();
      yamlFound = true;
    } else if (currentKey) {
      // Continuation of previous value (multiline)
      yamlArgs[currentKey] += '\n' + line;
    }
  }
  if (yamlFound) return { name: fnName, arguments: yamlArgs };

  // CLI-style args: key="value" key2=value2
  // e.g., <tool_call>list_directory path="/Users/..." show_hidden=true</arg_value>
  const cliPairs = [...rest.replace(/<\/arg_value>$/, '').matchAll(/(\w+)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|(\S+))/g)];
  if (cliPairs.length) {
    const args = {};
    for (const p of cliPairs) {
      const val = p[2] ?? p[3] ?? p[4] ?? '';
      args[p[1]] = val === 'true' ? true : val === 'false' ? false : val;
    }
    return { name: fnName, arguments: args };
  }

  // Proper <arg_key>key</arg_key><arg_value>value</arg_value> format
  const properArgPairs = [...rest.matchAll(/<arg_key>\s*(\w+)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g)];
  if (properArgPairs.length) {
    const args = {};
    for (const p of properArgPairs) args[p[1].trim()] = p[2].trim();
    return { name: fnName, arguments: args };
  }

  // <arg_key> format (broken): <arg_key>key": "value</arg_value>
  const argKeyPairs = [...rest.matchAll(/<arg_key>\s*([^"<]+)"\s*:\s*"([\s\S]*?)<\/arg_value>/g)];
  if (argKeyPairs.length) {
    const args = {};
    for (const p of argKeyPairs) args[p[1].trim()] = p[2].trim().replace(/"$/, '');
    return { name: fnName, arguments: args };
  }

  // Broken <arg_key> with partial JSON: <arg_key>query": "Singapore news..."}
  const brokenArgKey = rest.match(/<arg_key>\s*([\s\S]+)$/);
  if (brokenArgKey) {
    let raw = brokenArgKey[1].trim().replace(/<\/arg_value>$/, '').replace(/\)\s*$/, '');
    if (!raw.startsWith('{')) raw = '{"' + raw;
    if (!raw.endsWith('}')) raw = raw + '}';
    raw = raw.replace(/'/g, '"');
    try { return { name: fnName, arguments: JSON.parse(raw) }; } catch {}
    // Extract key-value pairs manually
    const kvPairs = [...raw.matchAll(/"?(\w+)"?\s*[:=]\s*(?:"([^"]*?)"|(\d+)|(\w+))/g)];
    if (kvPairs.length) {
      const args = {};
      for (const kv of kvPairs) args[kv[1]] = kv[2] ?? kv[3] ?? kv[4] ?? '';
      return { name: fnName, arguments: args };
    }
  }

  // Garbled content with embedded JSON array: tool_callsѡȡ[{"name":...}]
  const embeddedArr = rest.match(/\[\s*\{\s*"name"\s*:/);
  if (embeddedArr) {
    const start = embeddedArr.index;
    let depth = 0;
    for (let i = start; i < rest.length; i++) {
      if (rest[i] === '[') depth++;
      else if (rest[i] === ']') { depth--; if (depth === 0) {
        try {
          const calls = JSON.parse(rest.slice(start, i + 1));
          if (Array.isArray(calls) && calls[0]?.name) return calls[0]; // return first
        } catch {} break;
      }}
    }
  }

  return null;
}

// ── Structured Output ────────────────────────────────────────────────────────

function extractJson(text) {
  try { return JSON.parse(text); } catch {}

  // ```json ... ```
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch {} }

  // First { ... } or [ ... ]
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = text.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) { depth--; if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch {} break;
      }}
    }
  }
  return null;
}

// ── Usage Tracker ────────────────────────────────────────────────────────────

// ── Model Pricing (0G tokens per 1M tokens) ──
const MODEL_PRICING = {
  'zai-org/GLM-5-FP8':                    { input: 1.0,  output: 3.2  },
  'deepseek/deepseek-chat-v3-0324':        { input: 0.5,  output: 1.5  },
  'openai/gpt-oss-120b':                   { input: 0.8,  output: 2.4  },
  'qwen/qwen3-vl-30b-a3b-instruct':       { input: 0.5,  output: 1.5  },
  'z-image':                               { per_image: 0.02 },
  'openai/whisper-large-v3':               { per_minute: 0.01 },
};

function calcCost(model, usage) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  if (pricing.per_image) return pricing.per_image;
  if (pricing.per_minute) return pricing.per_minute * ((usage.duration_seconds || 30) / 60);
  const inCost = ((usage.prompt_tokens || 0) / 1_000_000) * pricing.input;
  const outCost = ((usage.completion_tokens || 0) / 1_000_000) * pricing.output;
  return inCost + outCost;
}

class UsageTracker {
  constructor() {
    this.requests = [];    // recent request log (last 500)
    this.totals = {};      // per-model totals
    this.hourly = [];      // last 24h hourly buckets: [{ hour, requests, tokens, cost, errors }]
    this.startTime = Date.now();
    this.stateFile = join(LOG_DIR, 'usage-state.json');
    this._restore();
  }

  _restore() {
    // Restore totals from persisted state
    try {
      if (existsSync(this.stateFile)) {
        const saved = JSON.parse(readFileSync(this.stateFile, 'utf-8'));
        this.totals = saved.totals || {};
        this.requests = saved.recent || [];
        this.hourly = saved.hourly || [];
        console.log(`Restored usage: ${Object.keys(this.totals).length} models, ${this.requests.length} recent entries`);
      }
    } catch {}

    // Also rebuild any missing data from today's JSONL logs
    try {
      const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort();
      const todayFile = files[files.length - 1];
      if (todayFile) {
        const lines = readFileSync(join(LOG_DIR, todayFile), 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.cat === 'response' && e.msg) {
              // Extract recent entries from today's log for the recent list
              const match = e.msg.match(/^(\w+)\s+(ok|tool_calls|error)$/);
              if (match && !this.requests.find(r => r.id === match[1])) {
                this.requests.unshift({
                  id: match[1],
                  model: e.model || 'unknown',
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: e.tokens || 0,
                  duration_ms: e.duration_ms || 0,
                  status: match[2],
                  timestamp: e.ts,
                });
              }
            }
          } catch {}
        }
        if (this.requests.length > 500) this.requests.length = 500;
      }
    } catch {}
  }

  _persist() {
    try {
      const state = JSON.stringify({ totals: this.totals, recent: this.requests.slice(0, 100), hourly: this.hourly });
      writeFileSync(this.stateFile, state);
    } catch {}
  }

  record(model, usage, durationMs, status) {
    const cost = status !== 'error' ? calcCost(model, { ...usage, duration_seconds: durationMs / 1000 }) : 0;
    const entry = {
      id: randomUUID().slice(0, 8),
      model,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      duration_ms: durationMs,
      cost,
      status,
      timestamp: new Date().toISOString(),
    };

    this.requests.unshift(entry);
    if (this.requests.length > 500) this.requests.pop();

    if (!this.totals[model]) {
      this.totals[model] = { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, errors: 0, cost: 0, total_latency: 0 };
    }
    const t = this.totals[model];
    t.requests++;
    t.prompt_tokens += entry.prompt_tokens;
    t.completion_tokens += entry.completion_tokens;
    t.total_tokens += entry.total_tokens;
    t.cost = (t.cost || 0) + cost;
    t.total_latency = (t.total_latency || 0) + durationMs;
    if (status === 'error') t.errors++;

    // Hourly usage buckets (last 24h)
    const hour = new Date().toISOString().slice(0, 13); // e.g. "2026-03-08T13"
    let bucket = this.hourly.find(h => h.hour === hour);
    if (!bucket) { bucket = { hour, requests: 0, tokens: 0, cost: 0, errors: 0 }; this.hourly.push(bucket); }
    bucket.requests++;
    bucket.tokens += entry.total_tokens;
    bucket.cost += cost;
    if (status === 'error') bucket.errors++;
    // Trim to last 24 hours
    if (this.hourly.length > 24) this.hourly = this.hourly.slice(-24);

    // Persist every 10 requests
    if ((t.requests % 10) === 0) this._persist();
  }

  getSummary() {
    let totalReqs = 0, totalTokens = 0, totalErrors = 0, totalCost = 0;
    const perModel = {};
    for (const [model, t] of Object.entries(this.totals)) {
      totalReqs += t.requests;
      totalTokens += t.total_tokens;
      totalErrors += t.errors;
      totalCost += t.cost || 0;
      perModel[model] = { ...t, avg_latency: t.requests > 0 ? Math.round((t.total_latency || 0) / t.requests) : 0 };
    }
    return {
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      total_requests: totalReqs,
      total_tokens: totalTokens,
      total_errors: totalErrors,
      total_cost: totalCost,
      per_model: perModel,
      hourly: this.hourly,
      recent: this.requests.slice(0, 50),
    };
  }
}

const tracker = new UsageTracker();

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeId = () => `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
const callId = () => `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
const ts = () => Math.floor(Date.now() / 1000);

function injectSystemPrompt(messages, text) {
  const msgs = [...messages];
  if (msgs[0]?.role === 'system') {
    msgs[0] = { ...msgs[0], content: msgs[0].content + '\n\n' + text };
  } else {
    msgs.unshift({ role: 'system', content: text });
  }
  return msgs;
}

// ── Server ───────────────────────────────────────────────────────────────────

async function main() {
  const broker = new OGBroker();

  console.log('Initializing 0G broker...');
  await broker.initialize();

  console.log('Discovering mainnet models...');
  await broker.discoverModels();

  // Re-discover every 5 minutes
  setInterval(() => broker.discoverModels().catch(console.error), 5 * 60 * 1000);

  const app = express();
  // Skip JSON parsing for multipart routes (audio uploads)
  app.use((req, res, next) => {
    if (req.path === '/v1/audio/transcriptions') return next();
    express.json({ limit: '10mb' })(req, res, next);
  });

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── Auth Middleware ──

  function requireApiKey(req, res, next) {
    // Support both OpenAI (Bearer) and Anthropic (x-api-key) auth styles
    const auth = req.headers.authorization;
    const xApiKey = req.headers['x-api-key'];
    const key = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : xApiKey?.trim();
    if (key && (API_KEYS.has(key) || key === ADMIN_KEY)) {
      // Rate limiting
      if (key !== ADMIN_KEY) {
        const now = Date.now();
        let bucket = rateBuckets.get(key);
        if (!bucket || now > bucket.resetAt) { bucket = { count: 0, resetAt: now + 60000 }; rateBuckets.set(key, bucket); }
        bucket.count++;
        if (bucket.count > RATE_LIMIT) {
          res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
          res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
          return res.status(429).json({ error: { message: `Rate limit exceeded. Max ${RATE_LIMIT} requests/minute.` } });
        }
        // Track key usage
        const meta = API_KEYS.get(key);
        if (meta) { meta.lastUsed = new Date().toISOString(); meta.requests = (meta.requests || 0) + 1; }
      }
      return next();
    }
    if (key) return res.status(403).json({ error: { type: 'authentication_error', message: 'Invalid API key' } });
    const cookie = req.headers.cookie || '';
    if (cookie.includes(`admin=${ADMIN_KEY}`)) return next();
    return res.status(401).json({ error: { type: 'authentication_error', message: 'Missing API key. Use Authorization: Bearer <key> or x-api-key header.' } });
  }

  function requireAdmin(req, res, next) {
    const auth = req.headers.authorization;
    const key = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    // Admin key or any valid API key can access dashboard APIs
    if (key === ADMIN_KEY || API_KEYS.has(key)) return next();
    // Also allow cookie-based auth for the dashboard
    const cookie = req.headers.cookie || '';
    if (cookie.includes(`admin=${ADMIN_KEY}`)) return next();
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }

  // ── Health (public) ──

  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', models: broker.models.size });
  });

  // ── Models ──

  app.get('/v1/models', requireApiKey, (req, res) => {
    const seen = new Set();
    const data = [];
    for (const [name, info] of broker.models) {
      if (seen.has(info.provider)) continue;
      seen.add(info.provider);
      const capabilities = [];
      if (info.type === 'chatbot') capabilities.push('chat');
      if (info.type === 'text-to-image') capabilities.push('image-generation');
      if (info.type === 'speech-to-text') capabilities.push('audio-transcription');
      if (name.includes('vl') || name.includes('vision')) capabilities.push('vision');
      data.push({ id: name, object: 'model', created: ts(), owned_by: '0g-network', capabilities });
    }
    res.json({ object: 'list', data });
  });

  // ── Chat Completions ──

  app.post('/v1/chat/completions', requireApiKey, async (req, res) => {
    const startTime = Date.now();
    const reqId = randomUUID().slice(0, 8);
    try {
      const body = req.body;
      let messages = body.messages || [];
      const modelName = body.model || 'glm-5';
      const stream = body.stream || false;
      const tools = body.tools;
      const toolChoice = body.tool_choice || 'auto';
      const responseFormat = body.response_format;

      const lastMsg = messages[messages.length - 1];
      log('info', 'request', `${reqId} ${modelName}`, {
        stream,
        tools: tools?.length || 0,
        messages: messages.length,
        last_role: lastMsg?.role,
        last_content: typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 100) : '[multimodal]',
        ip: req.headers['x-real-ip'] || req.ip,
      });

      // Check if messages contain images (vision/multimodal)
      const hasImages = messages.some(m =>
        Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
      );

      // Resolve model — auto-route to vision model if images are present
      let resolvedModelName = modelName;
      let info = broker.resolve(modelName);

      if (hasImages && info && info.type === 'chatbot') {
        // Check if requested model supports vision (qwen3-vl does)
        const isVisionModel = modelName.toLowerCase().includes('vl') || modelName.toLowerCase().includes('vision');
        if (!isVisionModel) {
          // Auto-route to qwen3-vl for vision
          const visionInfo = broker.resolve('qwen3-vl-30b-a3b-instruct') || broker.resolve('qwen/qwen3-vl-30b-a3b-instruct');
          if (visionInfo) {
            info = visionInfo;
            resolvedModelName = 'qwen/qwen3-vl-30b-a3b-instruct';
            log('info', 'vision', `${reqId} Auto-routed to ${resolvedModelName} (images detected)`);
          }
        }
      }

      if (!info) {
        log('warn', 'request', `${reqId} Unknown model: ${modelName}`);
        return res.status(400).json({ error: { message: `Unknown model: ${modelName}. Available: ${[...new Set([...broker.models.values()].map(v => v.ogModel))].join(', ')}` } });
      }

      // Tool calling injection
      const hasTools = tools?.length && toolChoice !== 'none';
      if (hasTools) {
        let toolPrompt = buildToolPrompt(tools, info.ogModel || modelName);

        // Handle tool_choice: "required" or {"type": "function", "function": {"name": "..."}}
        if (toolChoice === 'required') {
          toolPrompt += '\n\nIMPORTANT: You MUST call at least one tool. Do NOT respond with plain text. Always use a tool call.';
        } else if (typeof toolChoice === 'object' && toolChoice.function?.name) {
          const forcedName = toolChoice.function.name;
          toolPrompt += `\n\nIMPORTANT: You MUST call the "${forcedName}" tool. Do NOT call any other tool. Do NOT respond with plain text.`;
        }

        messages = injectSystemPrompt(messages, toolPrompt);
      }

      // Structured output injection
      let forceJson = false;
      if (responseFormat) {
        if (responseFormat.type === 'json_schema') {
          const schema = responseFormat.json_schema?.schema || {};
          messages = injectSystemPrompt(messages,
            `You MUST respond with ONLY valid JSON matching this schema. No markdown, no explanation — just raw JSON.\n\nSchema:\n${JSON.stringify(schema, null, 2)}`
          );
          forceJson = true;
        } else if (responseFormat.type === 'json_object') {
          messages = injectSystemPrompt(messages,
            'You MUST respond with ONLY valid JSON. No markdown, no explanation — just raw JSON.'
          );
          forceJson = true;
        }
      }

      // Get auth from 0G
      const contentForAuth = JSON.stringify(messages);
      const { headers: authHeaders, endpoint, model: ogModel } = await broker.getAuth(info.provider, contentForAuth);

      // Build upstream request
      const ogBody = {
        model: ogModel,
        messages,
        stream: stream && !hasTools && !forceJson, // only stream if no post-processing needed
        max_tokens: body.max_tokens || 60000, // High default for reasoning models + long outputs
      };
      for (const k of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop']) {
        if (body[k] !== undefined) ogBody[k] = body[k];
      }
      if (forceJson) ogBody.response_format = { type: 'json_object' };

      const fetchHeaders = { 'Content-Type': 'application/json', ...authHeaders };

      // ── Direct streaming (no post-processing) ──
      if (ogBody.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const upstream = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: fetchHeaders,
          body: JSON.stringify(ogBody),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
          res.end();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamChatId = null;
        let streamUsage = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n')) {
            const idx = buffer.indexOf('\n');
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);

            if (!line) continue;
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (data === '[DONE]') {
                res.write('data: [DONE]\n\n');
                res.end();
                tracker.record(modelName, streamUsage || {}, Date.now() - startTime, 'ok');
                // Pass null chatId for streaming — providers don't generate signatures for streamed responses
                // But pass usage content so the SDK can calculate fees for auto-top-up
                broker.settleResponse(info.provider, null, streamUsage);
                return;
              }
              try {
                const d = JSON.parse(data);
                d.model = modelName;
                // Capture chat ID and usage from stream chunks
                if (d.id && !streamChatId) streamChatId = d.id;
                if (d.usage) streamUsage = d.usage;
                let hasContent = false;
                for (const ch of (d.choices || [])) {
                  const delta = ch.delta || {};
                  delete delta.reasoning_content;
                  delete delta.provider_specific_fields;
                  delete ch.provider_specific_fields;
                  // Check if this chunk has actual content or finish_reason
                  if (delta.content || delta.role || delta.tool_calls || ch.finish_reason || d.usage) {
                    hasContent = true;
                  }
                }
                // Skip empty reasoning-only chunks
                if (hasContent || !d.choices?.length) {
                  res.write(`data: ${JSON.stringify(d)}\n\n`);
                }
              } catch {
                res.write(`${line}\n\n`);
              }
            }
          }
        }
        if (buffer.trim()) res.write(`${buffer.trim()}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        tracker.record(modelName, streamUsage || {}, Date.now() - startTime, 'ok');
        broker.settleResponse(info.provider, null, streamUsage);
        return;
      }

      // ── Non-streaming (or buffered for post-processing) ──
      ogBody.stream = false;

      const upstream = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(ogBody),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        log('error', 'upstream', `${reqId} HTTP ${upstream.status}`, { error: errText.slice(0, 300) });
        return res.status(upstream.status).json({ error: { message: errText } });
      }

      const og = await upstream.json();
      const ogMsg = og.choices?.[0]?.message || {};
      // GLM-5 uses reasoning_content for chain-of-thought; actual answer is in content
      // If content is null/empty but reasoning_content exists, the model ran out of tokens during reasoning
      let content = ogMsg.content || '';
      if (hasTools) {
        log('info', 'tool-parse', `${reqId} Raw (${content.length} chars)`, { raw: content.slice(0, 500) });
      }
      if (!content && ogMsg.reasoning_content) {
        log('warn', 'reasoning', `${reqId} Content empty, using reasoning_content fallback`);
        content = ogMsg.reasoning_content;
      }
      const usage = og.usage || {};
      const id = makeId();

      // Post-process: tool calls
      if (hasTools) {
        const parsed = parseToolCalls(content);
        if (parsed) {
          const toolCallsOut = parsed.map(tc => ({
            id: callId(),
            type: 'function',
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'object' ? JSON.stringify(tc.arguments) : String(tc.arguments || '{}'),
            },
          }));

          const result = {
            id, object: 'chat.completion', created: ts(), model: modelName,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: null, tool_calls: toolCallsOut },
              finish_reason: 'tool_calls',
            }],
            usage,
          };

          tracker.record(modelName, usage, Date.now() - startTime, 'tool_calls');
          const durationMs = Date.now() - startTime;
          log('info', 'response', `${reqId} tool_calls`, {
            tools: toolCallsOut.map(t => t.function.name),
            tokens: usage.total_tokens || 0,
            duration_ms: durationMs,
          });
          broker.settleResponse(info.provider, null, usage);
          if (stream) return fakeStream(res, result, modelName);
          return res.json(result);
        }
        // Tools were requested but model didn't call any
        log('info', 'tool-parse', `${reqId} No tool calls detected, returning as text`);
      }

      // Post-process: structured output
      if (forceJson) {
        const extracted = extractJson(content);
        if (extracted !== null) content = JSON.stringify(extracted);
      }

      const result = {
        id, object: 'chat.completion', created: ts(), model: modelName,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage,
      };

      const durationMs = Date.now() - startTime;
      tracker.record(modelName, usage, durationMs, 'ok');
      log('info', 'response', `${reqId} ok`, {
        tokens: usage.total_tokens || 0,
        content_len: content.length,
        duration_ms: durationMs,
      });
      broker.settleResponse(info.provider, null, usage);
      if (stream) return fakeStream(res, result, modelName);
      res.json(result);

    } catch (err) {
      const durationMs = Date.now() - startTime;
      log('error', 'request', `${reqId} ${err.message}`, { stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
      tracker.record(req.body?.model || 'unknown', {}, durationMs, 'error');
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // ── Fake SSE stream from buffered response ──

  function fakeStream(res, result, modelName) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const id = result.id;
    const msg = result.choices[0].message;

    if (msg.tool_calls) {
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i];
        const chunk = {
          id, object: 'chat.completion.chunk', created: ts(), model: modelName,
          choices: [{
            index: 0,
            delta: {
              ...(i === 0 ? { role: 'assistant' } : {}),
              tool_calls: [{ index: i, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }],
            },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: ts(), model: modelName, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
    } else if (msg.content) {
      const words = msg.content.split(' ');
      for (let i = 0; i < words.length; i++) {
        const token = i === 0 ? words[i] : ' ' + words[i];
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created: ts(), model: modelName,
          choices: [{ index: 0, delta: { ...(i === 0 ? { role: 'assistant' } : {}), content: token }, finish_reason: null }],
        })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: ts(), model: modelName, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  // ── Image Generation (/v1/images/generations) ──

  app.post('/v1/images/generations', requireApiKey, async (req, res) => {
    const startTime = Date.now();
    const reqId = randomUUID().slice(0, 8);
    try {
      const { prompt, n = 1, size = '1024x1024', model = 'z-image', response_format = 'url' } = req.body;
      if (!prompt) return res.status(400).json({ error: { message: 'prompt is required' } });

      log('info', 'image', `${reqId} generate`, { prompt: prompt.slice(0, 100), n, size, model });

      const info = broker.resolve(model) || broker.resolve('z-image');
      if (!info || info.type !== 'text-to-image') {
        return res.status(400).json({ error: { message: `No image model available. Have: ${[...broker.models.entries()].filter(([,v]) => v.type === 'text-to-image').map(([k]) => k).join(', ') || 'none'}` } });
      }

      const contentForAuth = JSON.stringify({ prompt, n, size });
      const { headers: authHeaders, endpoint } = await broker.getAuth(info.provider, contentForAuth);

      // Always request b64_json from provider — their URLs are internal and inaccessible
      const imgBody = { prompt, n, size, model: info.ogModel, response_format: 'b64_json' };
      const fetchHeaders = { 'Content-Type': 'application/json', ...authHeaders };

      let upstream = await fetch(`${endpoint}/images/generations`, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(imgBody),
      });

      // Some providers use /v1/images/generations
      if (!upstream.ok && upstream.status === 404) {
        upstream = await fetch(`${endpoint}/v1/images/generations`, {
          method: 'POST',
          headers: fetchHeaders,
          body: JSON.stringify(imgBody),
        });
      }

      if (!upstream.ok) {
        const errText = await upstream.text();
        log('error', 'image', `${reqId} HTTP ${upstream.status}`, { error: errText.slice(0, 300) });
        return res.status(upstream.status).json({ error: { message: errText } });
      }

      const result = await upstream.json();
      const durationMs = Date.now() - startTime;

      // Normalize to OpenAI format — we always get b64_json from provider
      const data = (result.data || [result]).map((img, i) => {
        const b64 = img.b64_json || img.image || img.b64;
        if (response_format === 'b64_json' || b64) {
          // Client wants b64_json, or we have b64 data — return as data URI for 'url' format
          return {
            url: response_format !== 'b64_json' && b64 ? `data:image/png;base64,${b64}` : undefined,
            b64_json: response_format === 'b64_json' ? b64 : undefined,
            revised_prompt: img.revised_prompt || prompt,
          };
        }
        // Fallback: if provider returned a URL anyway, rewrite internal addresses
        let url = img.url || img.image_url;
        if (url && url.includes('0.0.0.0')) {
          const urlPath = new URL(url).pathname;
          url = `${endpoint}${urlPath}`;
        }
        return { url, revised_prompt: img.revised_prompt || prompt };
      });

      log('info', 'image', `${reqId} ok`, { images: data.length, duration_ms: durationMs });
      const imgUsage = { input_tokens: prompt.length, output_tokens: 0 };
      tracker.record(model, { prompt_tokens: prompt.length, completion_tokens: 0 }, durationMs, 'ok');
      broker.settleResponse(info.provider, null, imgUsage);

      res.json({
        created: ts(),
        data,
      });
    } catch (err) {
      log('error', 'image', `${reqId} ${err.message}`);
      tracker.record('z-image', {}, Date.now() - startTime, 'error');
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // ── Audio Transcriptions (/v1/audio/transcriptions) ──

  app.post('/v1/audio/transcriptions', requireApiKey, async (req, res) => {
    const startTime = Date.now();
    const reqId = randomUUID().slice(0, 8);
    try {
      // This endpoint uses multipart/form-data
      const contentType = req.headers['content-type'] || '';

      const info = broker.resolve('whisper-large-v3') || broker.resolve('openai/whisper-large-v3');
      if (!info || info.type !== 'speech-to-text') {
        return res.status(400).json({ error: { message: 'No speech-to-text model available' } });
      }

      log('info', 'audio', `${reqId} transcribe`, { content_type: contentType });

      // Collect raw body for forwarding
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks);

      const contentForAuth = `audio-transcription-${Date.now()}`;
      const { headers: authHeaders, endpoint } = await broker.getAuth(info.provider, contentForAuth);

      // Forward the multipart request as-is to the provider
      const fetchHeaders = { ...authHeaders, 'content-type': contentType };

      let upstream = await fetch(`${endpoint}/audio/transcriptions`, {
        method: 'POST',
        headers: fetchHeaders,
        body: rawBody,
      });

      if (!upstream.ok && upstream.status === 404) {
        upstream = await fetch(`${endpoint}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: fetchHeaders,
          body: rawBody,
        });
      }

      if (!upstream.ok) {
        const errText = await upstream.text();
        log('error', 'audio', `${reqId} HTTP ${upstream.status}`, { error: errText.slice(0, 300) });
        return res.status(upstream.status).json({ error: { message: errText } });
      }

      const result = await upstream.json();
      const durationMs = Date.now() - startTime;
      log('info', 'audio', `${reqId} ok`, { text_len: result.text?.length || 0, duration_ms: durationMs });
      const audioUsage = { input_tokens: rawBody.length, output_tokens: result.text?.length || 0 };
      tracker.record('whisper-large-v3', { prompt_tokens: 0, completion_tokens: result.text?.length || 0 }, durationMs, 'ok');
      broker.settleResponse(info.provider, null, audioUsage);

      // OpenAI format
      res.json({
        text: result.text || result.transcription || '',
        ...(result.language && { language: result.language }),
        ...(result.duration && { duration: result.duration }),
        ...(result.segments && { segments: result.segments }),
      });
    } catch (err) {
      log('error', 'audio', `${reqId} ${err.message}`);
      tracker.record('whisper-large-v3', {}, Date.now() - startTime, 'error');
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // ── Anthropic Messages API (/v1/messages) ──
  // Enables Claude Code and other Anthropic SDK clients to use 0G models directly.
  // Translates Anthropic Messages format <-> OpenAI Chat Completions format.

  // Default model mapping for Anthropic model aliases
  const ANTHROPIC_MODEL_MAP = {
    'claude-opus-4-6': 'zai-org/GLM-5-FP8',
    'claude-sonnet-4-6': 'zai-org/GLM-5-FP8',
    'claude-haiku-4-5-20251001': 'deepseek/deepseek-chat-v3-0324',
    'sonnet': 'zai-org/GLM-5-FP8',
    'opus': 'zai-org/GLM-5-FP8',
    'haiku': 'deepseek/deepseek-chat-v3-0324',
    'default': 'zai-org/GLM-5-FP8',
  };

  function anthropicToOpenAI(body) {
    // Convert Anthropic messages to OpenAI format
    const messages = [];

    // Anthropic system is a top-level string or array, not a message
    if (body.system) {
      const sysText = typeof body.system === 'string' ? body.system
        : Array.isArray(body.system) ? body.system.map(b => b.text || '').join('\n') : '';
      if (sysText) messages.push({ role: 'system', content: sysText });
    }

    for (const msg of (body.messages || [])) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        // Content can be string or array of content blocks
        let content = msg.content;
        if (Array.isArray(content)) {
          // Convert Anthropic content blocks to OpenAI format
          const parts = [];
          for (const block of content) {
            if (block.type === 'text') parts.push({ type: 'text', text: block.text });
            else if (block.type === 'image') {
              // Anthropic base64 image -> OpenAI image_url
              parts.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } });
            }
            else if (block.type === 'tool_use') {
              // Assistant tool use block — store for conversion
              parts.push({ type: 'text', text: '' }); // placeholder
            }
            else if (block.type === 'tool_result') {
              // Tool result — will be handled as tool message
              parts.push({ type: 'text', text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) });
            }
          }
          // If all parts are text, simplify
          if (parts.length === 1 && parts[0].type === 'text') content = parts[0].text;
          else if (parts.every(p => p.type === 'text')) content = parts.map(p => p.text).filter(Boolean).join('\n');
          else content = parts;
        }

        // Handle assistant messages with tool_use blocks
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const toolUses = msg.content.filter(b => b.type === 'tool_use');
          const textBlocks = msg.content.filter(b => b.type === 'text');
          if (toolUses.length > 0) {
            messages.push({
              role: 'assistant',
              content: textBlocks.map(b => b.text).join('\n') || null,
              tool_calls: toolUses.map(tu => ({
                id: tu.id,
                type: 'function',
                function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
              })),
            });
            continue;
          }
        }

        // Handle user messages with tool_result blocks
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const toolResults = msg.content.filter(b => b.type === 'tool_result');
          const textBlocks = msg.content.filter(b => b.type === 'text');
          if (toolResults.length > 0) {
            for (const tr of toolResults) {
              const resultContent = typeof tr.content === 'string' ? tr.content
                : Array.isArray(tr.content) ? tr.content.map(b => b.text || '').join('\n')
                : JSON.stringify(tr.content);
              messages.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: resultContent });
            }
            // Also add any text blocks as a user message
            const text = textBlocks.map(b => b.text).filter(Boolean).join('\n');
            if (text) messages.push({ role: 'user', content: text });
            continue;
          }
        }

        messages.push({ role: msg.role, content });
      }
    }

    // Resolve model name
    const modelName = ANTHROPIC_MODEL_MAP[body.model] || body.model || ANTHROPIC_MODEL_MAP['default'];

    // Convert Anthropic tools to OpenAI format
    let tools;
    if (body.tools?.length) {
      tools = body.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || {},
        },
      }));
    }

    return {
      model: modelName,
      messages,
      max_tokens: body.max_tokens || 4096,
      stream: body.stream || false,
      ...(body.temperature !== undefined && { temperature: body.temperature }),
      ...(body.top_p !== undefined && { top_p: body.top_p }),
      ...(body.stop_sequences && { stop: body.stop_sequences }),
      ...(tools && { tools }),
    };
  }

  function openAIToAnthropic(ogResult, requestModel) {
    const choice = ogResult.choices?.[0];
    const msg = choice?.message || {};
    const content = [];

    if (msg.content) content.push({ type: 'text', text: msg.content });

    // Convert OpenAI tool_calls to Anthropic tool_use blocks
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          name: tc.function.name,
          input: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
        });
      }
    }

    if (content.length === 0) content.push({ type: 'text', text: '' });

    const stopReason = choice?.finish_reason === 'tool_calls' ? 'tool_use'
      : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn';

    return {
      id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      content,
      model: requestModel,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: ogResult.usage?.prompt_tokens || 0,
        output_tokens: ogResult.usage?.completion_tokens || 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  }

  app.post('/v1/messages', requireApiKey, async (req, res) => {
    const startTime = Date.now();
    const reqId = randomUUID().slice(0, 8);
    const requestModel = req.body.model || 'default';

    try {
      // Convert Anthropic request to OpenAI format
      const openAIBody = anthropicToOpenAI(req.body);
      const modelName = openAIBody.model;
      const stream = openAIBody.stream;

      log('info', 'anthropic', `${reqId} ${requestModel} -> ${modelName}`, {
        stream,
        tools: openAIBody.tools?.length || 0,
        messages: openAIBody.messages.length,
      });

      // Resolve model
      const info = broker.resolve(modelName);
      if (!info) {
        return res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: `Model ${modelName} not available` } });
      }

      // Get auth from 0G
      const contentForAuth = JSON.stringify(openAIBody.messages);
      const { headers: authHeaders, endpoint, model: ogModel } = await broker.getAuth(info.provider, contentForAuth);

      // Build upstream request (always non-streaming to simplify translation)
      const hasTools = openAIBody.tools?.length > 0;
      let messages = openAIBody.messages;
      const responseFormat = null;
      let forceJson = false;

      // Inject tool prompt if needed
      if (hasTools) {
        messages = injectSystemPrompt(messages, buildToolPrompt(openAIBody.tools, modelName));
      }

      const ogBody = {
        model: ogModel,
        messages,
        stream: stream && !hasTools,
        max_tokens: openAIBody.max_tokens || 60000,
      };
      for (const k of ['temperature', 'top_p', 'stop']) {
        if (openAIBody[k] !== undefined) ogBody[k] = openAIBody[k];
      }

      const fetchHeaders = { 'Content-Type': 'application/json', ...authHeaders };

      // ── Streaming Anthropic response ──
      if (ogBody.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const msgId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

        // Send message_start
        res.write(`event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: msgId, type: 'message', role: 'assistant', content: [],
            model: requestModel, stop_reason: null, stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        })}\n\n`);

        // Send content_block_start
        res.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
        })}\n\n`);

        const upstream = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST', headers: fetchHeaders, body: JSON.stringify(ogBody),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: errText } })}\n\n`);
          res.end();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamUsage = null;
        let outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n')) {
            const idx = buffer.indexOf('\n');
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);

            if (!line || !line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') break;

            try {
              const d = JSON.parse(data);
              if (d.usage) streamUsage = d.usage;
              const delta = d.choices?.[0]?.delta;
              // Forward content, or reasoning_content as fallback (GLM-5 uses reasoning for chain-of-thought)
              const text = delta?.content || delta?.reasoning_content;
              if (text) {
                outputTokens++;
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                  type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text },
                })}\n\n`);
              }
            } catch {}
          }
        }

        // Send content_block_stop
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);

        // Send message_delta with stop reason
        res.write(`event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: streamUsage?.completion_tokens || outputTokens },
        })}\n\n`);

        // Send message_stop
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();

        tracker.record(modelName, streamUsage || {}, Date.now() - startTime, 'ok');
        broker.settleResponse(info.provider, null, streamUsage);
        return;
      }

      // ── Non-streaming Anthropic response (also handles stream+tools) ──
      ogBody.stream = false;

      const upstream = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST', headers: fetchHeaders, body: JSON.stringify(ogBody),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        log('error', 'anthropic', `${reqId} HTTP ${upstream.status}`, { error: errText.slice(0, 300) });
        return res.status(upstream.status).json({ type: 'error', error: { type: 'api_error', message: errText } });
      }

      const og = await upstream.json();
      const ogMsg = og.choices?.[0]?.message || {};
      let content = ogMsg.content || '';
      // GLM-5 reasoning_content fallback
      if (!content && ogMsg.reasoning_content) content = ogMsg.reasoning_content;
      const usage = og.usage || {};

      // Build the Anthropic response
      let anthropicResp;
      let recordStatus = 'ok';

      if (hasTools) {
        log('info', 'anthropic-parse', `${reqId} Raw (${content.length} chars)`, { raw: content.slice(0, 500) });
        const parsed = parseToolCalls(content);
        if (parsed) {
          log('info', 'anthropic-parse', `${reqId} Parsed`, { tools: parsed.map(t => t.name) });
          const toolCallsOut = parsed.map(tc => ({
            id: callId(),
            type: 'function',
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'object' ? JSON.stringify(tc.arguments) : String(tc.arguments || '{}'),
            },
          }));
          const fakeResult = {
            choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCallsOut }, finish_reason: 'tool_calls' }],
            usage,
          };
          anthropicResp = openAIToAnthropic(fakeResult, requestModel);
          recordStatus = 'tool_calls';
        }
      }

      if (!anthropicResp) {
        const fakeResult = {
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage,
        };
        anthropicResp = openAIToAnthropic(fakeResult, requestModel);
      }

      tracker.record(modelName, usage, Date.now() - startTime, recordStatus);
      broker.settleResponse(info.provider, null, usage);

      // If client requested streaming, wrap the non-streaming result as SSE events
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // message_start
        const startMsg = { ...anthropicResp, content: [], stop_reason: null, usage: { input_tokens: anthropicResp.usage.input_tokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: startMsg })}\n\n`);

        // Emit each content block
        for (let i = 0; i < anthropicResp.content.length; i++) {
          const block = anthropicResp.content[i];

          if (block.type === 'text') {
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } })}\n\n`);
            // Send text in chunks for a realistic streaming feel
            const chunkSize = 20;
            for (let j = 0; j < block.text.length; j += chunkSize) {
              res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: block.text.slice(j, j + chunkSize) } })}\n\n`);
            }
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: i })}\n\n`);
          } else if (block.type === 'tool_use') {
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: block.id, name: block.name } })}\n\n`);
            // Send tool input as input_json_delta
            const inputJson = JSON.stringify(block.input);
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: inputJson } })}\n\n`);
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: i })}\n\n`);
          }
        }

        // message_delta + message_stop
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: anthropicResp.stop_reason, stop_sequence: null }, usage: { output_tokens: anthropicResp.usage.output_tokens } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
        return;
      }

      res.json(anthropicResp);

    } catch (err) {
      log('error', 'anthropic', `${reqId} ${err.message}`);
      tracker.record(requestModel, {}, Date.now() - startTime, 'error');
      res.status(500).json({ type: 'error', error: { type: 'api_error', message: err.message } });
    }
  });

  // ── Dashboard & Management APIs ──

  app.use(express.static('public'));

  app.get('/api/usage', requireAdmin, (req, res) => {
    res.json(tracker.getSummary());
  });

  app.get('/api/wallet', requireAdmin, async (req, res) => {
    try {
      const ledger = await broker.broker.ledger.getLedger();
      const balance = ledger.balance || ledger.totalBalance || 0n;
      const locked = ledger.locked || 0n;
      const available = balance - locked;

      let providers = [];
      try {
        const raw = await broker.broker.ledger.getProvidersWithBalance('inference');
        providers = raw.map(([addr, bal, pending]) => ({
          address: addr,
          model: [...broker.models.entries()].find(([, v]) => v.provider === addr)?.[0] || 'unknown',
          balance: ethers.formatEther(bal),
          pending_refund: ethers.formatEther(pending),
        }));
      } catch {}

      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      const nativeBalance = await provider.getBalance(wallet.address);

      res.json({
        address: wallet.address,
        native_balance: ethers.formatEther(nativeBalance),
        ledger_balance: ethers.formatEther(balance),
        locked: ethers.formatEther(locked),
        available: ethers.formatEther(available > 0n ? available : 0n),
        providers,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/deposit', requireAdmin, async (req, res) => {
    try {
      const { amount } = req.body;
      if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount required (number)' });
      try {
        await broker.broker.ledger.depositFund(Number(amount));
      } catch (e) {
        if (e.message?.includes('not exist') || e.message?.includes('LedgerNotExists')) {
          await broker.broker.ledger.addLedger(Number(amount));
        } else throw e;
      }
      res.json({ success: true, deposited: amount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/transfer', requireAdmin, async (req, res) => {
    try {
      const { provider, amount } = req.body;
      if (!provider || !amount) return res.status(400).json({ error: 'provider and amount required' });
      await broker.broker.ledger.transferFund(provider, 'inference', ethers.parseEther(String(amount)));
      res.json({ success: true, transferred: amount, to: provider });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/models', requireAdmin, (req, res) => {
    const seen = new Set();
    const models = [];
    for (const [name, info] of broker.models) {
      if (seen.has(info.provider)) continue;
      seen.add(info.provider);
      models.push({ name, provider: info.provider, type: info.type, ogModel: info.ogModel });
    }
    res.json(models);
  });

  // ── Logs API ──

  app.get('/api/logs', requireAdmin, (req, res) => {
    try {
      const days = req.query.days || 1;
      const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
      const level = req.query.level; // filter by level
      const cat = req.query.cat; // filter by category

      const files = readdirSync(LOG_DIR)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .slice(-days);

      let entries = [];
      for (const file of files) {
        const lines = readFileSync(join(LOG_DIR, file), 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (level && entry.level !== level) continue;
            if (cat && entry.cat !== cat) continue;
            entries.push(entry);
          } catch {}
        }
      }

      // Return most recent first
      entries = entries.slice(-limit).reverse();
      res.json({ count: entries.length, entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Dashboard login ──

  app.post('/api/login', (req, res) => {
    const { key } = req.body;
    if (key === ADMIN_KEY || API_KEYS.has(key)) {
      res.setHeader('Set-Cookie', `admin=${ADMIN_KEY}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return res.json({ success: true });
    }
    res.status(403).json({ error: 'Invalid key' });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'admin=; Path=/; Max-Age=0');
    res.json({ success: true });
  });

  // ── API Key Management ──

  app.get('/api/keys', requireAdmin, (req, res) => {
    const keys = [];
    for (const [key, meta] of API_KEYS) {
      keys.push({
        key: key.slice(0, 12) + '...' + key.slice(-4),
        full_key: key,
        name: meta.name || 'unnamed',
        created: meta.created,
        lastUsed: meta.lastUsed,
        requests: meta.requests || 0,
      });
    }
    res.json({ keys, rate_limit: RATE_LIMIT });
  });

  app.post('/api/keys', requireAdmin, (req, res) => {
    const { name } = req.body;
    const key = `sk-0g-${randomUUID().replace(/-/g, '')}`;
    API_KEYS.set(key, { name: name || 'unnamed', created: new Date().toISOString(), lastUsed: null, requests: 0 });
    saveApiKeys();
    log('info', 'keys', `Created API key: ${name || 'unnamed'}`);
    res.json({ key, name: name || 'unnamed' });
  });

  app.delete('/api/keys/:key', requireAdmin, (req, res) => {
    const key = req.params.key;
    if (!API_KEYS.has(key)) return res.status(404).json({ error: 'Key not found' });
    if (API_KEYS.size <= 1) return res.status(400).json({ error: 'Cannot delete the last API key' });
    const meta = API_KEYS.get(key);
    API_KEYS.delete(key);
    saveApiKeys();
    log('info', 'keys', `Revoked API key: ${meta.name || 'unnamed'}`);
    res.json({ success: true });
  });

  // ── CSV Export ──

  app.get('/api/export/usage', requireAdmin, (req, res) => {
    const summary = tracker.getSummary();
    let csv = 'timestamp,model,prompt_tokens,completion_tokens,total_tokens,cost,duration_ms,status\n';
    for (const r of summary.recent) {
      csv += `${r.timestamp},${r.model},${r.prompt_tokens},${r.completion_tokens},${r.total_tokens},${r.cost || 0},${r.duration_ms},${r.status}\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=0g-usage-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  });

  app.listen(PORT, () => {
    console.log(`\n0G OpenAI Proxy running on http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`\nAPI Keys:`);
    for (const [key, meta] of API_KEYS) console.log(`  ${key} (${meta.name})`);
    console.log(`\nAdmin Key: ${ADMIN_KEY}`);
    console.log(`(Use any API key or admin key to log into dashboard)\n`);
  });
}

// Persist usage state on shutdown
process.on('SIGTERM', () => { tracker._persist(); saveApiKeys(); process.exit(0); });
process.on('SIGINT', () => { tracker._persist(); saveApiKeys(); process.exit(0); });

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
