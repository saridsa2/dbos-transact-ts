// Adapted from mem0ai 3.3.1; Apache-2.0. See LICENSE and PROVENANCE.json.
// Stack Proc: explicit providers and deterministic identity; telemetry/notices disabled.
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/oss/src/memory/index.ts
import { v4 as uuidv45 } from "uuid";
import { createHash as createHash2 } from "crypto";

// src/oss/src/types/index.ts
import { z } from "zod";
var MemoryConfigSchema = z.object({
  version: z.string().optional(),
  embedder: z.object({
    provider: z.string(),
    config: z.object({
      modelProperties: z.record(z.string(), z.any()).optional(),
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      baseURL: z.string().optional(),
      embeddingDims: z.number().optional(),
      url: z.string().optional(),
      vertexCredentialsJson: z.string().optional(),
      googleServiceAccountJson: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
      googleProjectId: z.string().optional(),
      location: z.string().optional(),
      memoryAddEmbeddingType: z.string().optional(),
      memoryUpdateEmbeddingType: z.string().optional(),
      memorySearchEmbeddingType: z.string().optional(),
      awsRegion: z.string().optional(),
      awsAccessKeyId: z.string().optional(),
      awsSecretAccessKey: z.string().optional(),
      awsSessionToken: z.string().optional()
    })
  }),
  vectorStore: z.object({
    provider: z.string(),
    config: z.object({
      collectionName: z.string().optional(),
      dimension: z.number().optional(),
      dbPath: z.string().optional(),
      client: z.any().optional()
    }).passthrough()
  }),
  llm: z.object({
    provider: z.string(),
    config: z.object({
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      modelProperties: z.record(z.string(), z.any()).optional(),
      baseURL: z.string().optional(),
      vllmBaseURL: z.string().optional(),
      vllm_base_url: z.string().optional(),
      url: z.string().optional(),
      timeout: z.number().optional(),
      temperature: z.number().optional(),
      topP: z.number().optional(),
      maxTokens: z.number().optional(),
      awsRegion: z.string().optional(),
      awsAccessKeyId: z.string().optional(),
      awsSecretAccessKey: z.string().optional(),
      awsSessionToken: z.string().optional(),
      client: z.any().optional()
    }).passthrough()
  }),
  historyDbPath: z.string().optional(),
  customInstructions: z.string().optional(),
  historyStore: z.object({
    provider: z.string(),
    config: z.record(z.string(), z.any())
  }).optional(),
  reranker: z.object({
    provider: z.string(),
    config: z.record(z.string(), z.any())
  }).optional(),
  disableHistory: z.boolean().optional()
});

// src/oss/src/embeddings/openai.ts
import OpenAI from "openai";
var OpenAIEmbedder = class {
  constructor(config) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || config.url
    });
    this.model = config.model || "text-embedding-3-small";
    this.embeddingDims = config.embeddingDims;
  }
  async embed(text) {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
      encoding_format: "float",
      ...this.embeddingDims !== void 0 && {
        dimensions: this.embeddingDims
      }
    });
    return response.data[0].embedding;
  }
  async embedBatch(texts) {
    const MAX_BATCH = 100;
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const chunk = texts.slice(i, i + MAX_BATCH);
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: chunk,
        encoding_format: "float",
        ...this.embeddingDims !== void 0 && {
          dimensions: this.embeddingDims
        }
      });
      allEmbeddings.push(
        ...response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
      );
    }
    if (allEmbeddings.length !== texts.length) {
      throw new Error(
        `OpenAI embedBatch() returned ${allEmbeddings.length} embeddings for ${texts.length} texts using model '${this.model}'`
      );
    }
    return allEmbeddings;
  }
};

// src/oss/src/embeddings/aws_bedrock.ts
var DEFAULT_MODEL = "amazon.titan-embed-text-v1";
var DEFAULT_REGION = "us-west-2";
var COHERE_MAX_BATCH = 96;
var TITAN_MAX_CONCURRENCY = 4;
var COHERE_INPUT_TYPES = {
  add: "search_document",
  update: "search_document",
  search: "search_query"
};
async function mapWithConcurrencyLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}
var AWSBedrockEmbedder = class {
  constructor(config) {
    this.model = config.model || DEFAULT_MODEL;
    this.region = config.awsRegion || process.env.AWS_REGION || DEFAULT_REGION;
    this.embeddingDims = config.embeddingDims;
    const hasKeyPair = Boolean(
      config.awsAccessKeyId && config.awsSecretAccessKey
    );
    const hasAnyCredential = Boolean(
      config.awsAccessKeyId || config.awsSecretAccessKey || config.awsSessionToken
    );
    if (hasAnyCredential && !hasKeyPair) {
      throw new Error(
        "AWS Bedrock requires both awsAccessKeyId and awsSecretAccessKey when any explicit credential is configured. Omit all credential fields to use the AWS default credential chain."
      );
    }
    if (hasKeyPair) {
      this.credentials = {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
        ...config.awsSessionToken && { sessionToken: config.awsSessionToken }
      };
    }
  }
  async loadSdk() {
    try {
      return await import("@aws-sdk/client-bedrock-runtime");
    } catch (error) {
      const code = error == null ? void 0 : error.code;
      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        throw Object.assign(
          new Error(
            "The '@aws-sdk/client-bedrock-runtime' package is required to use the AWS Bedrock embedder. Install it with: npm install @aws-sdk/client-bedrock-runtime"
          ),
          { cause: error }
        );
      }
      throw error;
    }
  }
  async createClient() {
    const sdk = await this.loadSdk();
    return {
      sdk,
      client: new sdk.BedrockRuntimeClient({
        region: this.region,
        ...this.credentials && { credentials: this.credentials }
      })
    };
  }
  getClient() {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient().catch((err) => {
        this.clientPromise = void 0;
        throw err;
      });
    }
    return this.clientPromise;
  }
  isCohereModel() {
    return this.model.startsWith("cohere.");
  }
  isCohereV4Model() {
    return this.model.includes("embed-v4");
  }
  buildRequestBody(texts, memoryAction) {
    if (this.isCohereModel()) {
      const body = {
        texts,
        input_type: memoryAction ? COHERE_INPUT_TYPES[memoryAction] : "search_document"
      };
      if (this.isCohereV4Model()) {
        body.embedding_types = ["float"];
        if (this.embeddingDims !== void 0) {
          body.output_dimension = this.embeddingDims;
        }
      }
      return body;
    }
    return {
      inputText: texts[0],
      ...this.embeddingDims !== void 0 && this.model.includes("titan-embed-text-v2") && {
        dimensions: this.embeddingDims
      }
    };
  }
  async invoke(texts, memoryAction) {
    var _a2;
    const { sdk, client } = await this.getClient();
    let payload;
    try {
      const response = await client.send(
        new sdk.InvokeModelCommand({
          modelId: this.model,
          contentType: "application/json",
          accept: "application/json",
          body: new TextEncoder().encode(
            JSON.stringify(this.buildRequestBody(texts, memoryAction))
          )
        })
      );
      payload = JSON.parse(new TextDecoder().decode(response.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Error getting embedding from AWS Bedrock model ${this.model}: ${message}`
      );
    }
    const embeddings = this.isCohereModel() ? Array.isArray(payload.embeddings) ? payload.embeddings : (_a2 = payload.embeddings) == null ? void 0 : _a2.float : payload.embedding && [payload.embedding];
    if (!embeddings || embeddings.length !== texts.length || embeddings.some((embedding) => embedding.length === 0)) {
      throw new Error(
        `AWS Bedrock model ${this.model} returned no embedding for one or more inputs`
      );
    }
    return embeddings;
  }
  async embed(text, memoryAction) {
    return (await this.invoke([text], memoryAction))[0];
  }
  async embedBatch(texts, memoryAction) {
    if (texts.length === 0) return [];
    if (!this.isCohereModel()) {
      return mapWithConcurrencyLimit(
        texts,
        TITAN_MAX_CONCURRENCY,
        (text) => this.embed(text, memoryAction)
      );
    }
    const embeddings = [];
    for (let i = 0; i < texts.length; i += COHERE_MAX_BATCH) {
      embeddings.push(
        ...await this.invoke(
          texts.slice(i, i + COHERE_MAX_BATCH),
          memoryAction
        )
      );
    }
    return embeddings;
  }
};

// src/oss/src/utils/logger.ts
var logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  debug: (message) => console.debug(`[DEBUG] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`)
};

// src/oss/src/utils/load_peer.ts
async function loadPeer(pkg, label, load) {
  try {
    return await load();
  } catch (e) {
    throw new Error(
      `The '${pkg}' package is required to use the ${label}. Install it with: npm install ${pkg}`
    );
  }
}

// src/oss/src/embeddings/ollama.ts
var OllamaEmbedder = class _OllamaEmbedder {
  constructor(config) {
    // Using this variable to avoid calling the Ollama server multiple times
    this.initialized = false;
    this.host = config.url || config.baseURL || "http://localhost:11434";
    this.model = config.model || "nomic-embed-text:latest";
    this.embeddingDims = config.embeddingDims || 768;
    this.ensureModelExists().catch((err) => {
      logger.error(`Error ensuring model exists: ${err}`);
    });
  }
  async ensureClient() {
    if (this.ollama) return;
    const sdk = await loadPeer(
      "ollama",
      "Ollama embedder",
      () => import("ollama")
    );
    this.ollama = new sdk.Ollama({ host: this.host });
  }
  async embed(text) {
    await this.ensureClient();
    try {
      await this.ensureModelExists();
    } catch (err) {
      logger.error(`Error ensuring model exists: ${err}`);
    }
    const input = typeof text === "string" ? text : JSON.stringify(text);
    const response = await this.ollama.embed({
      model: this.model,
      input
    });
    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error(
        `Ollama embed() returned no embeddings for model '${this.model}'`
      );
    }
    return response.embeddings[0];
  }
  async embedBatch(texts) {
    const response = await Promise.all(texts.map((text) => this.embed(text)));
    return response;
  }
  static normalizeModelName(name) {
    return name.includes(":") ? name : `${name}:latest`;
  }
  async ensureModelExists() {
    if (this.initialized) {
      return true;
    }
    await this.ensureClient();
    const local_models = await this.ollama.list();
    const target = _OllamaEmbedder.normalizeModelName(this.model);
    if (!local_models.models.find(
      (m) => _OllamaEmbedder.normalizeModelName(m.name) === target
    )) {
      logger.info(`Pulling model ${this.model}...`);
      await this.ollama.pull({ model: this.model });
    }
    this.initialized = true;
    return true;
  }
};

// src/oss/src/embeddings/lmstudio.ts
import OpenAI2 from "openai";
var DEFAULT_BASE_URL = "http://localhost:1234/v1";
var DEFAULT_MODEL2 = "nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.f16.gguf";
var DEFAULT_LMSTUDIO_API_KEY = "lm-studio";
var LMStudioEmbedder = class {
  constructor(config) {
    var _a2, _b2;
    const baseURL = (_b2 = (_a2 = config.baseURL) != null ? _a2 : config.url) != null ? _b2 : DEFAULT_BASE_URL;
    const apiKey = config.apiKey || DEFAULT_LMSTUDIO_API_KEY;
    this.openai = new OpenAI2({ apiKey, baseURL: String(baseURL) });
    this.model = config.model || DEFAULT_MODEL2;
  }
  async embed(text) {
    const normalized = typeof text === "string" ? text.replace(/\n/g, " ") : String(text);
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: normalized,
        encoding_format: "float"
      });
      return response.data[0].embedding;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio embedder failed: ${message}`);
    }
  }
  async embedBatch(texts) {
    const normalized = texts.map(
      (t) => typeof t === "string" ? t.replace(/\n/g, " ") : String(t)
    );
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: normalized,
        encoding_format: "float"
      });
      return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio embedder failed: ${message}`);
    }
  }
};

// src/oss/src/embeddings/together.ts
var DEFAULT_BASE_URL2 = "https://api.together.ai/v1";
var DEFAULT_MODEL3 = "intfloat/multilingual-e5-large-instruct";
var TogetherEmbedder = class extends OpenAIEmbedder {
  constructor(config) {
    const openAICompatibleConfig = { ...config };
    delete openAICompatibleConfig.embeddingDims;
    const apiKey = config.apiKey || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      throw new Error("Together API key is required");
    }
    super({
      ...openAICompatibleConfig,
      apiKey,
      // Honor TOGETHER_API_BASE like the Together LLM does, so a user behind a
      // gateway who sets it gets it for embeddings too instead of silently
      // hitting api.together.ai.
      baseURL: config.baseURL || config.url || process.env.TOGETHER_API_BASE || DEFAULT_BASE_URL2,
      model: config.model || DEFAULT_MODEL3
    });
  }
};

// src/oss/src/llms/openai.ts
import OpenAI3 from "openai";
var OpenAILLM = class {
  constructor(config) {
    this.openai = new OpenAI3({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...config.timeout != null && { timeout: config.timeout }
    });
    this.model = config.model || "gpt-5-mini";
  }
  async generateResponse(messages, responseFormat, tools) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model,
      response_format: responseFormat,
      ...tools && { tools, tool_choice: "auto" }
    });
    const response = completion.choices[0].message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
};

// src/oss/src/llms/openai_structured.ts
import OpenAI4 from "openai";
var OpenAIStructuredLLM = class {
  constructor(config) {
    this.openai = new OpenAI4({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...config.timeout != null && { timeout: config.timeout }
    });
    this.model = config.model || "gpt-5-mini";
  }
  async generateResponse(messages, responseFormat, tools) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      model: this.model,
      ...tools ? {
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
          }
        })),
        tool_choice: "auto"
      } : responseFormat ? {
        response_format: {
          type: responseFormat.type
        }
      } : {}
    });
    const response = completion.choices[0].message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      model: this.model
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
};

// src/oss/src/llms/anthropic.ts
var AnthropicLLM = class {
  constructor(config) {
    var _a2, _b2;
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }
    const clientArgs = { apiKey };
    if (config.baseURL) {
      clientArgs.baseURL = config.baseURL;
    }
    this.clientArgs = clientArgs;
    this.model = config.model || "claude-sonnet-4-6";
    this.maxTokens = (_a2 = config.maxTokens) != null ? _a2 : 2e3;
    this.temperature = (_b2 = config.temperature) != null ? _b2 : 0.1;
    this.topP = config.topP;
  }
  async ensureClient() {
    if (this.client) return;
    const sdk = await loadPeer(
      "@anthropic-ai/sdk",
      "Anthropic LLM",
      () => import("@anthropic-ai/sdk")
    );
    this.client = new sdk.default(this.clientArgs);
  }
  async generateResponse(messages, responseFormat, tools) {
    await this.ensureClient();
    const systemMessage = messages.find((msg) => msg.role === "system");
    const otherMessages = messages.filter((msg) => msg.role !== "system");
    const params = {
      model: this.model,
      messages: otherMessages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : msg.content.image_url.url
      })),
      system: typeof (systemMessage == null ? void 0 : systemMessage.content) === "string" ? systemMessage.content : void 0,
      max_tokens: this.maxTokens
    };
    if (this.temperature !== void 0) {
      params.temperature = this.temperature;
    } else if (this.topP !== void 0) {
      params.top_p = this.topP;
    }
    if (tools) {
      params.tools = tools;
      params.tool_choice = { type: "auto" };
    }
    const response = await this.client.messages.create(params);
    if (tools) {
      let content = "";
      const toolCalls = [];
      for (const block of response.content) {
        if (block.type === "text") {
          content = block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            name: block.name,
            arguments: JSON.stringify(block.input)
          });
        }
      }
      return { content, role: "assistant", toolCalls };
    }
    for (const block of response.content) {
      if (block.type === "text") {
        return block.text;
      }
    }
    return "";
  }
  async generateChat(messages) {
    const response = await this.generateResponse(messages);
    if (typeof response === "string") {
      return { content: response, role: "assistant" };
    }
    return response;
  }
};

// src/oss/src/llms/groq.ts
var GroqLLM = class {
  constructor(config) {
    const apiKey = config.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("Groq API key is required");
    }
    this.apiKey = apiKey;
    this.model = config.model || "llama3-70b-8192";
  }
  async ensureClient() {
    if (this.client) return;
    const sdk = await loadPeer(
      "groq-sdk",
      "Groq LLM",
      () => import("groq-sdk")
    );
    this.client = new sdk.Groq({ apiKey: this.apiKey });
  }
  async generateResponse(messages, responseFormat) {
    await this.ensureClient();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      response_format: responseFormat
    });
    return response.choices[0].message.content || "";
  }
  async generateChat(messages) {
    await this.ensureClient();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      }))
    });
    const message = response.choices[0].message;
    return {
      content: message.content || "",
      role: message.role
    };
  }
};

// src/oss/src/llms/mistral.ts
var MistralLLM = class {
  constructor(config) {
    if (!config.apiKey) {
      throw new Error("Mistral API key is required");
    }
    this.apiKey = config.apiKey;
    this.model = config.model || "mistral-tiny-latest";
  }
  async ensureClient() {
    if (this.client) return;
    const sdk = await loadPeer(
      "@mistralai/mistralai",
      "Mistral LLM",
      () => import("@mistralai/mistralai")
    );
    this.client = new sdk.Mistral({ apiKey: this.apiKey });
  }
  // Helper function to convert content to string
  contentToString(content) {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((chunk) => {
        if (chunk.type === "text") {
          return chunk.text;
        } else {
          return JSON.stringify(chunk);
        }
      }).join("");
    }
    return String(content || "");
  }
  async generateResponse(messages, responseFormat, tools) {
    await this.ensureClient();
    const response = await this.client.chat.complete({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      ...tools && { tools },
      ...responseFormat && { response_format: responseFormat }
    });
    if (!response || !response.choices || response.choices.length === 0) {
      return "";
    }
    const message = response.choices[0].message;
    if (!message) {
      return "";
    }
    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        content: this.contentToString(message.content),
        role: message.role || "assistant",
        toolCalls: message.toolCalls.map((call) => ({
          name: call.function.name,
          arguments: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments)
        }))
      };
    }
    return this.contentToString(message.content);
  }
  async generateChat(messages) {
    await this.ensureClient();
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
    }));
    const response = await this.client.chat.complete({
      model: this.model,
      messages: formattedMessages
    });
    if (!response || !response.choices || response.choices.length === 0) {
      return {
        content: "",
        role: "assistant"
      };
    }
    const message = response.choices[0].message;
    return {
      content: this.contentToString(message.content),
      role: message.role || "assistant"
    };
  }
};

// src/oss/src/vector_stores/memory.ts
import Database from "better-sqlite3";
import fs2 from "fs";
import path2 from "path";

// src/oss/src/utils/sqlite.ts
import fs from "fs";
import os from "os";
import path from "path";
function getDefaultVectorStoreDbPath() {
  return path.join(os.homedir(), ".mem0", "vector_store.db");
}
function ensureSQLiteDirectory(dbPath) {
  if (!dbPath || dbPath === ":memory:" || dbPath.startsWith("file:")) {
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// src/oss/src/vector_stores/memory.ts
var _MemoryVectorStore = class _MemoryVectorStore {
  normalizePayload(payload) {
    for (const [camel, snake] of Object.entries(
      _MemoryVectorStore.CAMEL_TO_SNAKE
    )) {
      if (camel in payload && !(snake in payload)) {
        payload[snake] = payload[camel];
        delete payload[camel];
      }
    }
    return payload;
  }
  constructor(config) {
    this.dimension = config.dimension || 1536;
    this.dbPath = config.dbPath || getDefaultVectorStoreDbPath();
    if (!config.dbPath) {
      const oldDefault = path2.join(process.cwd(), "vector_store.db");
      if (fs2.existsSync(oldDefault) && oldDefault !== this.dbPath) {
        console.warn(
          `[mem0] Default vector_store.db location changed from ${oldDefault} to ${this.dbPath}. Move your existing file or set vectorStore.config.dbPath explicitly.`
        );
      }
    }
    ensureSQLiteDirectory(this.dbPath);
    this.db = new Database(this.dbPath);
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        payload TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE
      )
    `);
  }
  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  /**
   * Check if a single field condition matches the payload.
   * Supports comparison operators: eq, ne, gt, gte, lt, lte, in, nin, contains, icontains
   */
  matchFieldCondition(payload, key, value) {
    const payloadValue = payload[key];
    if (typeof value !== "object" || value === null) {
      if (value === "*") {
        return true;
      }
      return payloadValue === value;
    }
    if (Array.isArray(value)) {
      return value.includes(payloadValue);
    }
    if ("eq" in value) {
      return payloadValue === value.eq;
    }
    if ("ne" in value) {
      return payloadValue !== value.ne;
    }
    if ("gt" in value) {
      return payloadValue > value.gt;
    }
    if ("gte" in value) {
      return payloadValue >= value.gte;
    }
    if ("lt" in value) {
      return payloadValue < value.lt;
    }
    if ("lte" in value) {
      return payloadValue <= value.lte;
    }
    if ("in" in value) {
      return Array.isArray(value.in) && value.in.includes(payloadValue);
    }
    if ("nin" in value) {
      return !Array.isArray(value.nin) || !value.nin.includes(payloadValue);
    }
    if ("contains" in value) {
      return typeof payloadValue === "string" && payloadValue.includes(value.contains);
    }
    if ("icontains" in value) {
      return typeof payloadValue === "string" && payloadValue.toLowerCase().includes(value.icontains.toLowerCase());
    }
    return payloadValue === value;
  }
  /**
   * Filter a vector by the given filters.
   * Supports logical operators (AND, OR, NOT) and comparison operators.
   */
  filterVector(vector, filters) {
    if (!filters || Object.keys(filters).length === 0) return true;
    const keyMap = {
      $and: "AND",
      $or: "OR",
      $not: "NOT"
    };
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      const normKey = keyMap[key] || key;
      if (!(normKey in normalized)) {
        normalized[normKey] = value;
      }
    }
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "AND") {
        if (!Array.isArray(value)) {
          throw new Error(
            `AND filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        const allMatch = value.every(
          (sub) => this.filterVector(vector, sub)
        );
        if (!allMatch) return false;
      } else if (key === "OR") {
        if (!Array.isArray(value)) {
          throw new Error(
            `OR filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        const anyMatch = value.some(
          (sub) => this.filterVector(vector, sub)
        );
        if (!anyMatch) return false;
      } else if (key === "NOT") {
        if (!Array.isArray(value)) {
          throw new Error(
            `NOT filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        const noneMatch = value.every(
          (sub) => !this.filterVector(vector, sub)
        );
        if (!noneMatch) return false;
      } else {
        if (!this.matchFieldCondition(vector.payload, key, value)) {
          return false;
        }
      }
    }
    return true;
  }
  async insert(vectors, ids, payloads) {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO vectors (id, vector, payload) VALUES (?, ?, ?)`
    );
    const insertMany = this.db.transaction(
      (vecs, vIds, vPayloads) => {
        for (let i = 0; i < vecs.length; i++) {
          if (vecs[i].length !== this.dimension) {
            throw new Error(
              `Vector dimension mismatch. Expected ${this.dimension}, got ${vecs[i].length}`
            );
          }
          const vectorBuffer = Buffer.from(new Float32Array(vecs[i]).buffer);
          stmt.run(vIds[i], vectorBuffer, JSON.stringify(vPayloads[i]));
        }
      }
    );
    insertMany(vectors, ids, payloads);
  }
  tokenize(text) {
    return text.toLowerCase().split(/\s+/).filter(Boolean);
  }
  async keywordSearch(query, topK = 10, filters) {
    try {
      const rows = this.db.prepare(`SELECT * FROM vectors`).all();
      const candidates = [];
      for (const row of rows) {
        const payload = this.normalizePayload(JSON.parse(row.payload));
        const memoryVector = {
          id: row.id,
          vector: Array.from(
            new Float32Array(
              row.vector.buffer,
              row.vector.byteOffset,
              row.vector.byteLength / 4
            )
          ),
          payload
        };
        if (this.filterVector(memoryVector, filters)) {
          const text = payload.textLemmatized || payload.data || "";
          candidates.push({ id: row.id, payload, tokens: this.tokenize(text) });
        }
      }
      if (candidates.length === 0) {
        return [];
      }
      const tokenizedQuery = this.tokenize(query);
      if (tokenizedQuery.length === 0) {
        return [];
      }
      const k1 = 1.5;
      const b = 0.75;
      const N = candidates.length;
      const avgDocLength = candidates.reduce((sum, c) => sum + c.tokens.length, 0) / N;
      const docFreq = /* @__PURE__ */ new Map();
      for (const term of tokenizedQuery) {
        if (!docFreq.has(term)) {
          let count = 0;
          for (const c of candidates) {
            if (c.tokens.includes(term)) count++;
          }
          docFreq.set(term, count);
        }
      }
      const idf = /* @__PURE__ */ new Map();
      for (const [term, freq] of docFreq) {
        idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
      }
      const scored = candidates.map((candidate) => {
        let score = 0;
        const docLength = candidate.tokens.length;
        for (const term of tokenizedQuery) {
          const tf = candidate.tokens.filter((t) => t === term).length;
          const termIdf = idf.get(term) || 0;
          score += termIdf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * docLength / avgDocLength));
        }
        return { ...candidate, score };
      });
      const results = scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, topK).map((s) => ({
        id: s.id,
        payload: s.payload,
        score: s.score
      }));
      return results;
    } catch (error) {
      console.error("Error during keyword search:", error);
      return null;
    }
  }
  async search(query, topK = 10, filters) {
    if (query.length !== this.dimension) {
      throw new Error(
        `Query dimension mismatch. Expected ${this.dimension}, got ${query.length}`
      );
    }
    const rows = this.db.prepare(`SELECT * FROM vectors`).all();
    const results = [];
    for (const row of rows) {
      const vector = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4
      );
      const payload = this.normalizePayload(JSON.parse(row.payload));
      const memoryVector = {
        id: row.id,
        vector: Array.from(vector),
        payload
      };
      if (this.filterVector(memoryVector, filters)) {
        const score = this.cosineSimilarity(query, Array.from(vector));
        results.push({
          id: memoryVector.id,
          payload: memoryVector.payload,
          score
        });
      }
    }
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return results.slice(0, topK);
  }
  async get(vectorId) {
    const row = this.db.prepare(`SELECT * FROM vectors WHERE id = ?`).get(vectorId);
    if (!row) return null;
    const payload = this.normalizePayload(JSON.parse(row.payload));
    return {
      id: row.id,
      payload
    };
  }
  async update(vectorId, vector, payload) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }
    const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
    this.db.prepare(`UPDATE vectors SET vector = ?, payload = ? WHERE id = ?`).run(vectorBuffer, JSON.stringify(payload), vectorId);
  }
  async delete(vectorId) {
    this.db.prepare(`DELETE FROM vectors WHERE id = ?`).run(vectorId);
  }
  async deleteCol() {
    this.db.exec(`DROP TABLE IF EXISTS vectors`);
    this.init();
  }
  async list(filters, topK = 100) {
    const rows = this.db.prepare(`SELECT * FROM vectors`).all();
    const results = [];
    for (const row of rows) {
      const payload = this.normalizePayload(JSON.parse(row.payload));
      const memoryVector = {
        id: row.id,
        vector: Array.from(
          new Float32Array(
            row.vector.buffer,
            row.vector.byteOffset,
            row.vector.byteLength / 4
          )
        ),
        payload
      };
      if (this.filterVector(memoryVector, filters)) {
        results.push({
          id: memoryVector.id,
          payload: memoryVector.payload
        });
      }
    }
    return [results.slice(0, topK), results.length];
  }
  async getUserId() {
    const row = this.db.prepare(`SELECT user_id FROM memory_migrations LIMIT 1`).get();
    if (row) {
      return row.user_id;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    this.db.prepare(`INSERT INTO memory_migrations (user_id) VALUES (?)`).run(randomUserId2);
    return randomUserId2;
  }
  async setUserId(userId) {
    this.db.prepare(`DELETE FROM memory_migrations`).run();
    this.db.prepare(`INSERT INTO memory_migrations (user_id) VALUES (?)`).run(userId);
  }
  async initialize() {
    this.init();
  }
};
_MemoryVectorStore.CAMEL_TO_SNAKE = {
  userId: "user_id",
  agentId: "agent_id",
  runId: "run_id"
};
var MemoryVectorStore = _MemoryVectorStore;

// src/oss/src/rerankers/cohere.ts
var DEFAULT_MODEL4 = "rerank-v3.5";
var CohereReranker = class {
  constructor(config) {
    var _a2;
    const apiKey = config.apiKey || process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Cohere API key is required. Set COHERE_API_KEY environment variable or pass apiKey in config."
      );
    }
    this.apiKey = apiKey;
    this.model = config.model || DEFAULT_MODEL4;
    this.topK = config.topK;
    this.returnDocuments = (_a2 = config.returnDocuments) != null ? _a2 : false;
    this.maxChunksPerDoc = config.maxChunksPerDoc;
  }
  /**
   * Lazily construct (or reuse) the Cohere client, importing the optional
   * `cohere-ai` peer only when the reranker is first used so consumers that
   * never touch Cohere don't need it installed.
   */
  async getClient() {
    if (this.clientInstance) return this.clientInstance;
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    this.clientInstance = await this.clientPromise;
    return this.clientInstance;
  }
  async createClient() {
    const sdk = await loadPeer(
      "cohere-ai",
      "Cohere reranker",
      () => import("cohere-ai")
    );
    return new sdk.CohereClient({ token: this.apiKey });
  }
  async rerank(query, documents, topK) {
    if (documents.length === 0) return [];
    try {
      const client = await this.getClient();
      const response = await client.rerank({
        model: this.model,
        query,
        documents,
        topN: topK || this.topK || documents.length,
        returnDocuments: this.returnDocuments,
        maxChunksPerDoc: this.maxChunksPerDoc
      });
      return response.results.map((result) => ({
        index: result.index,
        rerankScore: result.relevanceScore
      }));
    } catch (e) {
      console.warn(
        `Cohere reranking failed, falling back to original order: ${e}`
      );
      const scored = documents.map((_, index) => ({
        index,
        rerankScore: 0
      }));
      const finalTopK = topK || this.topK;
      return finalTopK ? scored.slice(0, finalTopK) : scored;
    }
  }
};

// src/oss/src/rerankers/llm.ts
var SYSTEM_PROMPT = `You are a relevance scoring assistant. Given a query and a document, score how relevant the document is to the query.

Score the relevance on a scale from 0.0 to 1.0, where:
- 1.0 = Perfectly relevant and directly answers the query
- 0.8-0.9 = Highly relevant with good information
- 0.6-0.7 = Moderately relevant with some useful information
- 0.4-0.5 = Slightly relevant with limited useful information
- 0.0-0.3 = Not relevant or no useful information

Respond with only a single numerical score between 0.0 and 1.0. Do not include any explanation or additional text.`;
var MAX_INPUT_LEN = 4e3;
var LLMReranker = class {
  constructor(config, llm) {
    if (!llm) {
      throw new Error(
        "LLMReranker requires an LLM instance; RerankerFactory should always provide one for the llm_reranker provider."
      );
    }
    this.llm = llm;
    this.topK = config.topK;
  }
  async rerank(query, documents, topK) {
    if (documents.length === 0) return [];
    const scored = await Promise.all(
      documents.map(async (document, index) => {
        try {
          const rerankScore = await this.score(query, document);
          return { index, rerankScore };
        } catch (e) {
          console.warn(
            `LLM reranking failed for a document, assigning neutral score: ${e}`
          );
          return { index, rerankScore: 0.5 };
        }
      })
    );
    scored.sort((a, b) => b.rerankScore - a.rerankScore);
    const finalTopK = topK || this.topK;
    return finalTopK ? scored.slice(0, finalTopK) : scored;
  }
  async score(query, document) {
    var _a2;
    const safeQuery = query.slice(0, MAX_INPUT_LEN);
    const safeDoc = document.slice(0, MAX_INPUT_LEN);
    const userMessage = `Query: ${safeQuery}

Document: ${safeDoc}`;
    const response = await this.llm.generateResponse([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage }
    ]);
    const text = typeof response === "string" ? response : (_a2 = response == null ? void 0 : response.content) != null ? _a2 : "";
    return this.extractScore(text);
  }
  extractScore(responseText) {
    const matches = responseText.match(/-?\d+\.\d+/g) || responseText.match(/-?\d+/g);
    if (matches && matches.length > 0) {
      const score = parseFloat(matches[0]);
      return Math.min(Math.max(score, 0), 1);
    }
    return 0.5;
  }
};

// src/oss/src/rerankers/zeroentropy.ts
var DEFAULT_MODEL5 = "zerank-1";
var ZeroEntropyReranker = class {
  constructor(config) {
    const apiKey = config.apiKey || process.env.ZERO_ENTROPY_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Zero Entropy API key is required. Set ZERO_ENTROPY_API_KEY environment variable or pass apiKey in config."
      );
    }
    this.apiKey = apiKey;
    this.model = config.model || DEFAULT_MODEL5;
    this.topK = config.topK;
  }
  /**
   * Lazily construct (or reuse) the ZeroEntropy client, importing the
   * optional `zeroentropy` peer only when the reranker is first used so
   * consumers that never touch ZeroEntropy don't need it installed.
   */
  async getClient() {
    if (this.clientInstance) return this.clientInstance;
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    this.clientInstance = await this.clientPromise;
    return this.clientInstance;
  }
  async createClient() {
    const sdk = await loadPeer(
      "zeroentropy",
      "ZeroEntropy reranker",
      () => import("zeroentropy")
    );
    return new sdk.ZeroEntropy({ apiKey: this.apiKey });
  }
  async rerank(query, documents, topK) {
    if (documents.length === 0) return [];
    try {
      const client = await this.getClient();
      const response = await client.models.rerank({
        model: this.model,
        query,
        documents
      });
      const scored = response.results.map((result) => ({
        index: result.index,
        rerankScore: result.relevance_score
      }));
      scored.sort((a, b) => b.rerankScore - a.rerankScore);
      const finalTopK = topK || this.topK;
      return finalTopK ? scored.slice(0, finalTopK) : scored;
    } catch (e) {
      console.warn(
        `Zero Entropy reranking failed, falling back to original order: ${e}`
      );
      const scored = documents.map((_, index) => ({
        index,
        rerankScore: 0
      }));
      const finalTopK = topK || this.topK;
      return finalTopK ? scored.slice(0, finalTopK) : scored;
    }
  }
};

// src/oss/src/rerankers/cross_encoder.ts
var sigmoid = (x) => 1 / (1 + Math.exp(-x));
var CrossEncoderReranker = class {
  constructor(config, defaultModel, defaultMaxLength) {
    var _a2, _b2;
    this.modelId = config.model || defaultModel;
    this.device = config.device;
    this.maxLength = (_a2 = config.maxLength) != null ? _a2 : defaultMaxLength;
    this.normalize = (_b2 = config.normalize) != null ? _b2 : true;
    this.topK = config.topK;
  }
  load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const { AutoModelForSequenceClassification, AutoTokenizer } = await import("@huggingface/transformers");
        const options = {};
        if (this.device) options.device = this.device;
        const model = await AutoModelForSequenceClassification.from_pretrained(
          this.modelId,
          options
        );
        const tokenizer = await AutoTokenizer.from_pretrained(this.modelId);
        return { model, tokenizer };
      })();
    }
    return this.loaded;
  }
  async rerank(query, documents, topK) {
    if (documents.length === 0) return [];
    try {
      const { model, tokenizer } = await this.load();
      const inputs = tokenizer(
        documents.map(() => query),
        {
          text_pair: documents,
          padding: true,
          truncation: true,
          ...this.maxLength ? { max_length: this.maxLength } : {}
        }
      );
      const { logits } = await model(inputs);
      const rows = logits.tolist();
      const scored = rows.map((row, index) => {
        const logit = Array.isArray(row) ? row[0] : row;
        return {
          index,
          rerankScore: this.normalize ? sigmoid(logit) : logit
        };
      });
      scored.sort((a, b) => b.rerankScore - a.rerankScore);
      const finalTopK = topK || this.topK;
      return finalTopK ? scored.slice(0, finalTopK) : scored;
    } catch (e) {
      console.warn(
        `Cross-encoder reranking failed, falling back to original order: ${e}`
      );
      const scored = documents.map((_, index) => ({
        index,
        rerankScore: 0
      }));
      const finalTopK = topK || this.topK;
      return finalTopK ? scored.slice(0, finalTopK) : scored;
    }
  }
};

// src/oss/src/vector_stores/baidu.ts
var VECTOR_INDEX = "vector_idx";
var FILTERING_INDEX = "metadata_filtering_idx";
var BM25_INDEX = "text_lemmatized_bm25_idx";
var PROJECTIONS = ["id", "data", "metadata"];
var TABLE_POLL_INTERVAL_MS = 2e3;
var TABLE_POLL_ATTEMPTS = 60;
var JSON_FIELD_TYPE = "JSON";
var ROW_KEY_NOT_FOUND = 101;
var SAFE_FILTER_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function escapeFilterString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function check(response, action, ...tolerated) {
  if (response.code !== 0 && !tolerated.includes(response.code)) {
    throw new Error(
      `Baidu Mochow ${action} failed (code ${response.code}): ${response.msg}`
    );
  }
  return response.code;
}
function lemmatizedText(payload) {
  const data = typeof payload.data === "string" ? payload.data : "";
  return typeof payload.textLemmatized === "string" && payload.textLemmatized.length > 0 ? payload.textLemmatized : data;
}
function memoryData(payload) {
  return typeof payload.data === "string" ? payload.data : "";
}
function metadataPayload(payload) {
  const { data: _data, textLemmatized: _textLemmatized, ...metadata } = payload;
  return metadata;
}
function resultPayload(row) {
  return {
    ...row.metadata || {},
    ...typeof row.data === "string" ? { data: row.data } : {}
  };
}
var BaiduDB = class {
  constructor(config) {
    this.client = null;
    this.sdk = null;
    // Fails closed: keyword search stays off until an inverted index is observed.
    this.supportsKeywordSearch = false;
    this.storeUserId = "anonymous-baidu-user";
    this.endpoint = config.endpoint;
    this.account = config.account;
    this.apiKey = config.apiKey;
    this.databaseName = config.databaseName;
    this.tableName = config.tableName;
    this.embeddingModelDims = config.embeddingModelDims;
    this.metricType = config.metricType || "L2";
    this.client = config.client || null;
    const requiredFields = [
      ["databaseName", this.databaseName],
      ["tableName", this.tableName],
      ["embeddingModelDims", this.embeddingModelDims]
    ];
    if (!this.client) {
      requiredFields.unshift(
        ["endpoint", this.endpoint],
        ["account", this.account],
        ["apiKey", this.apiKey]
      );
    }
    for (const [name, value] of requiredFields) {
      if (value === void 0 || value === null || value === "") {
        throw new Error(
          `Baidu vector store requires a non-empty '${name}' config value.`
        );
      }
    }
    this.initialize().catch(console.error);
  }
  get ns() {
    return { database: this.databaseName, table: this.tableName };
  }
  // Loaded dynamically: @mochow/mochow-sdk-node is an optional peer dependency, so a static
  // value import would break `import { Memory } from "mem0ai/oss"` for everyone else.
  async loadSdk() {
    var _a2;
    if (!this.sdk) {
      const module = await loadPeer(
        "@mochow/mochow-sdk-node",
        "Baidu vector store",
        () => import("@mochow/mochow-sdk-node")
      );
      this.sdk = (_a2 = module.default) != null ? _a2 : module;
    }
    return this.sdk;
  }
  async ensureClient() {
    if (!this.client) {
      const sdk = await this.loadSdk();
      this.client = new sdk.MochowClient({
        endpoint: this.endpoint,
        credential: { account: this.account, apiKey: this.apiKey }
      });
    }
    return this.client;
  }
  async ready() {
    await this.initialize();
    return { client: await this.ensureClient(), sdk: await this.loadSdk() };
  }
  buildSchema(sdk) {
    const {
      AutoBuildPolicyType,
      FieldType,
      IndexType,
      InvertedIndexAnalyzer,
      InvertedIndexFieldAttribute,
      InvertedIndexParseMode,
      MetricType
    } = sdk;
    const autoBuildPolicy = {
      policyType: AutoBuildPolicyType.Increment,
      rowCountIncrement: 1e4
    };
    const vectorIndex = {
      indexName: VECTOR_INDEX,
      indexType: IndexType.HNSW,
      field: "vector",
      metricType: MetricType[this.metricType],
      params: { M: 16, efConstruction: 200 },
      autoBuild: true,
      autoBuildPolicy
    };
    return {
      fields: [
        {
          fieldName: "id",
          fieldType: FieldType.String,
          primaryKey: true,
          partitionKey: true,
          autoIncrement: false,
          notNull: true
        },
        {
          fieldName: "data",
          fieldType: FieldType.Text
        },
        {
          fieldName: "vector",
          fieldType: FieldType.FloatVector,
          notNull: true,
          dimension: this.embeddingModelDims
        },
        // Stored outside `metadata` because Mochow cannot build an inverted index on a
        // field inside a JSON column. Memory.search() passes an already-lemmatized query,
        // so only the lemmatized form is worth indexing.
        { fieldName: "textLemmatized", fieldType: FieldType.Text },
        { fieldName: "metadata", fieldType: JSON_FIELD_TYPE }
      ],
      indexes: [
        vectorIndex,
        {
          indexName: FILTERING_INDEX,
          indexType: IndexType.FilteringIndex,
          fields: ["metadata"]
        },
        {
          indexName: BM25_INDEX,
          indexType: IndexType.InvertedIndex,
          fields: ["textLemmatized"],
          fieldAttributes: [InvertedIndexFieldAttribute.Analyzed],
          params: {
            analyzer: InvertedIndexAnalyzer.EnglishAnalyzer,
            parseMode: InvertedIndexParseMode.FineMode
          }
        }
      ]
    };
  }
  buildFilter(filters) {
    const conditions = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!SAFE_FILTER_KEY.test(key)) {
        throw new Error(`Invalid filter key: ${key}`);
      }
      if (typeof value === "string") {
        conditions.push(`metadata["${key}"] = "${escapeFilterString(value)}"`);
        continue;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        conditions.push(`metadata["${key}"] = ${value}`);
        continue;
      }
      throw new Error(
        `Filter value for ${key} must be str, int, float, or bool, got ${Array.isArray(value) ? "array" : typeof value}`
      );
    }
    return conditions.join(" AND ");
  }
  filterOf(filters) {
    return filters && Object.keys(filters).length > 0 ? this.buildFilter(filters) : void 0;
  }
  async pollTable(client, settled, what) {
    for (let attempt = 0; attempt < TABLE_POLL_ATTEMPTS; attempt++) {
      if (settled(await client.descTable(this.databaseName, this.tableName))) {
        return;
      }
      await sleep(TABLE_POLL_INTERVAL_MS);
    }
    throw new Error(
      `Baidu Mochow table '${this.tableName}' was not ${what} after ${TABLE_POLL_ATTEMPTS * TABLE_POLL_INTERVAL_MS / 1e3}s.`
    );
  }
  async ensureTable() {
    const sdk = await this.loadSdk();
    const client = await this.ensureClient();
    const { ServerErrCode, TableState } = sdk;
    check(
      await client.createDatabase(this.databaseName),
      `createDatabase '${this.databaseName}'`,
      ServerErrCode.DBAlreadyExist
    );
    const created = check(
      await client.createTable({
        ...this.ns,
        description: "mem0 memories",
        replication: 3,
        partition: { partitionType: sdk.PartitionType.HASH, partitionNum: 1 },
        enableDynamicField: false,
        schema: this.buildSchema(sdk)
      }),
      `createTable '${this.tableName}'`,
      ServerErrCode.TableAlreadyExist
    );
    let description;
    await this.pollTable(
      client,
      (response) => {
        check(response, `descTable '${this.tableName}'`);
        description = response;
        return response.table.state === TableState.Normal;
      },
      "ready"
    );
    this.applySchema(
      created === ServerErrCode.TableAlreadyExist,
      description.table.schema
    );
  }
  applySchema(preexisting, schema) {
    var _a2, _b2, _c;
    if (!preexisting) {
      this.supportsKeywordSearch = true;
      return;
    }
    const fields = (_a2 = schema == null ? void 0 : schema.fields) != null ? _a2 : [];
    const indexes = (_b2 = schema == null ? void 0 : schema.indexes) != null ? _b2 : [];
    const field = (name) => fields.find((f) => f.fieldName === name);
    const typeOf = (name) => {
      var _a3, _b3;
      return String((_b3 = (_a3 = field(name)) == null ? void 0 : _a3.fieldType) != null ? _b3 : "");
    };
    const label = `${this.databaseName}.${this.tableName}`;
    if (typeOf("id") !== "STRING" || !typeOf("data").startsWith("TEXT") || typeOf("vector") !== "FLOAT_VECTOR" || typeOf("metadata") !== "JSON") {
      throw new Error(
        `Baidu Mochow table '${label}' exists but is missing the id/data/vector/metadata schema mem0 requires. Drop it, or point 'tableName' at an unused table.`
      );
    }
    const dimension = (_c = field("vector")) == null ? void 0 : _c.dimension;
    if (dimension !== void 0 && dimension !== this.embeddingModelDims) {
      throw new Error(
        `Baidu Mochow table '${label}' stores ${dimension}-dimensional vectors, but 'embeddingModelDims' is ${this.embeddingModelDims}.`
      );
    }
    this.supportsKeywordSearch = typeOf("textLemmatized").startsWith("TEXT") && indexes.some((index) => index.indexName === BM25_INDEX);
    if (!this.supportsKeywordSearch) {
      console.warn(
        `Baidu Mochow table '${label}' has no '${BM25_INDEX}' inverted index. keywordSearch() will return null until the table is recreated.`
      );
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this.ensureTable().catch((error) => {
        this._initPromise = void 0;
        throw error;
      });
    }
    return this._initPromise;
  }
  async insert(vectors, ids, payloads) {
    const { client } = await this.ready();
    if (vectors.length !== ids.length || vectors.length !== payloads.length) {
      throw new Error(
        `Baidu insert requires vectors, ids, and payloads of equal length (got ${vectors.length}/${ids.length}/${payloads.length}).`
      );
    }
    const rows = vectors.map((vector, index) => ({
      id: ids[index],
      data: memoryData(payloads[index] || {}),
      vector,
      textLemmatized: lemmatizedText(payloads[index] || {}),
      metadata: metadataPayload(payloads[index] || {})
    }));
    check(await client.upsert({ ...this.ns, rows }), "upsert");
  }
  async search(query, topK = 5, filters) {
    var _a2;
    const { client, sdk } = await this.ready();
    const filter = this.filterOf(filters);
    const request = new sdk.VectorTopkSearchRequest(
      "vector",
      new sdk.Vector(query),
      topK
    ).Projections(PROJECTIONS).Config(new sdk.VectorSearchConfig().Ef(200));
    if (filter) {
      request.Filter(filter);
    }
    const response = await client.vectorSearch({
      ...this.ns,
      request
    });
    check(response, "vectorSearch");
    return ((_a2 = response.rows) != null ? _a2 : []).map((result) => ({
      id: String(result.row.id),
      payload: resultPayload(result.row),
      // L2 is a distance (lower = closer); the VectorStore contract wants higher = better.
      score: this.metricType === "L2" ? result.score != null ? 1 / (1 + result.score) : void 0 : result.score
    }));
  }
  async keywordSearch(query, topK = 5, filters) {
    var _a2;
    const { client, sdk } = await this.ready();
    if (!this.supportsKeywordSearch) {
      return null;
    }
    const filter = this.filterOf(filters);
    const request = new sdk.BM25SearchRequest(BM25_INDEX, query).Projections(PROJECTIONS).Limit(topK);
    if (filter) {
      request.Filter(filter);
    }
    const response = await client.bm25Search({
      ...this.ns,
      request
    });
    check(response, "bm25Search");
    return ((_a2 = response.rows) != null ? _a2 : []).map((result) => ({
      id: String(result.row.id),
      payload: resultPayload(result.row),
      score: result.score
    }));
  }
  async get(vectorId) {
    const { client } = await this.ready();
    const response = await client.query({
      ...this.ns,
      primaryKey: { id: vectorId },
      projections: PROJECTIONS
    });
    check(response, `query '${vectorId}'`, ROW_KEY_NOT_FOUND);
    if (!response.row || response.row.id === void 0) {
      return null;
    }
    return {
      id: String(response.row.id),
      payload: resultPayload(response.row)
    };
  }
  async update(vectorId, vector, payload) {
    const { client } = await this.ready();
    check(
      await client.upsert({
        ...this.ns,
        rows: [
          {
            id: vectorId,
            data: memoryData(payload),
            vector,
            textLemmatized: lemmatizedText(payload),
            metadata: metadataPayload(payload)
          }
        ]
      }),
      `upsert '${vectorId}'`
    );
  }
  async delete(vectorId) {
    const { client } = await this.ready();
    check(
      await client.delete({ ...this.ns, primaryKey: { id: vectorId } }),
      `delete '${vectorId}'`
    );
  }
  async deleteCol() {
    var _a2;
    await ((_a2 = this._initPromise) == null ? void 0 : _a2.catch(() => void 0));
    this._initPromise = void 0;
    this.supportsKeywordSearch = false;
    const sdk = await this.loadSdk();
    const client = await this.ensureClient();
    const { ServerErrCode } = sdk;
    const dropped = check(
      await client.dropTable(this.databaseName, this.tableName),
      `dropTable '${this.tableName}'`,
      ServerErrCode.TableNotExist
    );
    if (dropped === ServerErrCode.TableNotExist) {
      return;
    }
    await this.pollTable(
      client,
      (response) => check(
        response,
        `descTable '${this.tableName}'`,
        ServerErrCode.TableNotExist
      ) === ServerErrCode.TableNotExist,
      "dropped"
    );
  }
  async reset() {
    await this.deleteCol();
    await this.initialize();
  }
  async list(filters, topK = 100) {
    var _a2;
    const { client } = await this.ready();
    const response = await client.select({
      ...this.ns,
      filter: this.filterOf(filters),
      projections: PROJECTIONS,
      limit: topK
    });
    check(response, "select");
    const memories = ((_a2 = response.rows) != null ? _a2 : []).map((row) => ({
      id: String(row.id),
      payload: resultPayload(row)
    }));
    return [memories, memories.length];
  }
  async getUserId() {
    return this.storeUserId;
  }
  async setUserId(userId) {
    this.storeUserId = userId;
  }
};

// src/oss/src/vector_stores/qdrant.ts
import * as fs3 from "fs";
var BM25_VECTOR_NAME = "bm25";
var BM25_MODEL = "Qdrant/bm25";
var KEY_MAP = {
  $and: "AND",
  $or: "OR",
  $not: "NOT"
};
var Qdrant = class {
  constructor(config) {
    // Off for collections without the `bm25` slot (e.g. pre-hybrid-search).
    this._hasBm25Slot = false;
    // Payload indexes apply to a real server, not embedded/local mode.
    this._isRemote = true;
    this.config = config;
    this.collectionName = config.collectionName;
    this.dimension = config.dimension || 1536;
    this.initialize().catch(console.error);
  }
  async ensureClient() {
    if (this.client) return;
    const config = this.config;
    if (config.client) {
      this.client = config.client;
      return;
    }
    const params = {};
    if (config.apiKey) {
      params.apiKey = config.apiKey;
    }
    if (config.url) {
      params.url = config.url;
      try {
        const parsedUrl = new URL(config.url);
        params.port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 6333;
      } catch (_) {
        params.port = 6333;
      }
    }
    if (config.host && config.port) {
      params.host = config.host;
      params.port = config.port;
    }
    if (!Object.keys(params).length) {
      this._isRemote = false;
      params.path = config.path;
      if (!config.onDisk && config.path) {
        if (fs3.existsSync(config.path) && fs3.statSync(config.path).isDirectory()) {
          fs3.rmSync(config.path, { recursive: true });
        }
      }
    }
    const sdk = await loadPeer(
      "@qdrant/js-client-rest",
      "Qdrant vector store",
      () => import("@qdrant/js-client-rest")
    );
    this.client = new sdk.QdrantClient(params);
  }
  /**
   * Build a single field condition from a key-value filter pair.
   * Supports enhanced filter syntax with comparison operators.
   */
  buildFieldCondition(key, value) {
    if (typeof value !== "object" || value === null) {
      if (value === "*") {
        return null;
      }
      return { key, match: { value } };
    }
    if (Array.isArray(value)) {
      return { key, match: { any: value } };
    }
    const ops = Object.keys(value);
    const rangeOps = ["gt", "gte", "lt", "lte"];
    const hasRangeOps = ops.some((op) => rangeOps.includes(op));
    const nonRangeOps = ops.filter((op) => !rangeOps.includes(op));
    if (hasRangeOps) {
      if (nonRangeOps.length > 0) {
        throw new Error(
          `Cannot mix range operators (${ops.filter((o) => rangeOps.includes(o)).join(", ")}) with non-range operators (${nonRangeOps.join(", ")}) for field '${key}'. Use AND to combine them as separate conditions.`
        );
      }
      const range = {};
      for (const op of rangeOps) {
        if (op in value) {
          range[op] = value[op];
        }
      }
      return { key, range };
    }
    if ("eq" in value) {
      return { key, match: { value: value.eq } };
    }
    if ("ne" in value) {
      return { key, match: { except: [value.ne] } };
    }
    if ("in" in value) {
      return { key, match: { any: value.in } };
    }
    if ("nin" in value) {
      return { key, match: { except: value.nin } };
    }
    if ("contains" in value || "icontains" in value) {
      const text = value.contains || value.icontains;
      return { key, match: { text } };
    }
    const supportedOps = [
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "in",
      "nin",
      "contains",
      "icontains"
    ];
    throw new Error(
      `Unsupported filter operator(s) for field '${key}': ${ops.join(", ")}. Supported operators: ${supportedOps.join(", ")}`
    );
  }
  /**
   * Create a Filter object from the provided filters.
   * Supports logical operators (AND, OR, NOT) and comparison operators.
   */
  createFilter(filters) {
    if (!filters || Object.keys(filters).length === 0) return void 0;
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      const normKey = KEY_MAP[key] || key;
      if (!(normKey in normalized)) {
        normalized[normKey] = value;
      }
    }
    const must = [];
    const should = [];
    const mustNot = [];
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "AND" || key === "OR" || key === "NOT") {
        if (!Array.isArray(value)) {
          throw new Error(
            `${key} filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw new Error(
              `${key} filter list item at index ${i} must be a dict, got ${typeof item}`
            );
          }
        }
        if (key === "AND") {
          for (const sub of value) {
            const built = this.createFilter(sub);
            if (built) {
              must.push(built);
            }
          }
        } else if (key === "OR") {
          for (const sub of value) {
            const built = this.createFilter(sub);
            if (built) {
              should.push(built);
            }
          }
        } else if (key === "NOT") {
          for (const sub of value) {
            const built = this.createFilter(sub);
            if (built) {
              mustNot.push(built);
            }
          }
        }
      } else {
        const condition = this.buildFieldCondition(key, value);
        if (condition !== null) {
          must.push(condition);
        }
      }
    }
    if (must.length === 0 && should.length === 0 && mustNot.length === 0) {
      return void 0;
    }
    return {
      must: must.length > 0 ? must : void 0,
      should: should.length > 0 ? should : void 0,
      must_not: mustNot.length > 0 ? mustNot : void 0
    };
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const points = vectors.map((vector, idx) => {
      const payload = payloads[idx] || {};
      return {
        id: ids[idx],
        vector: this.buildPointVector(vector, payload),
        payload
      };
    });
    await this.upsertPoints(points);
  }
  // A server can accept a bm25 `sparse_vectors` config yet be unable to run
  // inference (Qdrant < 1.15.2, or a Cloud cluster created before 2025-07-07
  // where inference was never activated), so no version check catches it and
  // the first upsert failure is the only signal. Retry dense-only rather than
  // lose the write.
  //
  // `as any`: the JS client types predate server-side sparse_vectors, so the
  // named-vector and BM25-inference shapes are not typed.
  async upsertPoints(points) {
    try {
      await this.client.upsert(this.collectionName, { points });
    } catch (error) {
      if (!this._hasBm25Slot) {
        throw error;
      }
      this._hasBm25Slot = false;
      console.warn(
        `Qdrant rejected the server-side BM25 vector for collection '${this.collectionName}'; disabling hybrid keyword search. This requires Qdrant >= 1.15.2 with inference enabled. Retrying the write with a plain dense vector.`
      );
      const denseOnly = points.map((p) => ({
        ...p,
        vector: Array.isArray(p.vector) ? p.vector : p.vector[""]
      }));
      await this.client.upsert(this.collectionName, {
        points: denseOnly
      });
    }
  }
  // With a bm25 slot, return named vectors so Qdrant encodes BM25 server-side;
  // otherwise return the plain dense vector (legacy behavior).
  buildPointVector(vector, payload) {
    if (!this._hasBm25Slot) {
      return vector;
    }
    const named = { "": vector };
    const text = (payload == null ? void 0 : payload.textLemmatized) || (payload == null ? void 0 : payload.data) || "";
    if (text) {
      named[BM25_VECTOR_NAME] = { text, model: BM25_MODEL };
    }
    return named;
  }
  // BM25 keyword search; returns null (semantic-only fallback) when there is no
  // bm25 slot or the query fails.
  async keywordSearch(query, topK = 5, filters) {
    if (!this._hasBm25Slot) {
      return null;
    }
    try {
      const queryFilter = this.createFilter(filters);
      const response = await this.client.query(this.collectionName, {
        query: { text: query, model: BM25_MODEL },
        using: BM25_VECTOR_NAME,
        filter: queryFilter,
        limit: topK,
        with_payload: true
      });
      return response.points.map((point) => ({
        id: String(point.id),
        payload: point.payload || {},
        score: point.score
      }));
    } catch (error) {
      console.error("Error during Qdrant keyword search:", error);
      return null;
    }
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const queryFilter = this.createFilter(filters);
    const results = await this.client.search(this.collectionName, {
      vector: query,
      filter: queryFilter,
      limit: topK
    });
    return results.map((hit) => ({
      id: String(hit.id),
      payload: hit.payload || {},
      score: hit.score
    }));
  }
  async get(vectorId) {
    await this.initialize();
    const results = await this.client.retrieve(this.collectionName, {
      ids: [vectorId],
      with_payload: true
    });
    if (!results.length) return null;
    return {
      id: vectorId,
      payload: results[0].payload || {}
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const point = {
      id: vectorId,
      // Re-encode BM25 so edited memories don't keep a stale sparse vector.
      vector: this.buildPointVector(vector, payload),
      payload
    };
    await this.upsertPoints([point]);
  }
  async delete(vectorId) {
    await this.initialize();
    await this.client.delete(this.collectionName, {
      points: [vectorId]
    });
  }
  async deleteCol() {
    await this.initialize();
    await this.client.deleteCollection(this.collectionName);
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const scrollRequest = {
      limit: topK,
      filter: this.createFilter(filters),
      with_payload: true,
      with_vectors: false
    };
    const response = await this.client.scroll(
      this.collectionName,
      scrollRequest
    );
    const results = response.points.map((point) => ({
      id: String(point.id),
      payload: point.payload || {}
    }));
    return [results, response.points.length];
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  async getUserId() {
    var _a2;
    await this.initialize();
    try {
      await this.ensureCollection("memory_migrations", 1);
      const result = await this.client.scroll("memory_migrations", {
        limit: 1,
        with_payload: true
      });
      if (result.points.length > 0) {
        return (_a2 = result.points[0].payload) == null ? void 0 : _a2.user_id;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.client.upsert("memory_migrations", {
        points: [
          {
            id: this.generateUUID(),
            vector: [0],
            payload: { user_id: randomUserId2 }
          }
        ]
      });
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  async setUserId(userId) {
    await this.initialize();
    try {
      const result = await this.client.scroll("memory_migrations", {
        limit: 1,
        with_payload: true
      });
      const pointId = result.points.length > 0 ? result.points[0].id : this.generateUUID();
      await this.client.upsert("memory_migrations", {
        points: [
          {
            id: pointId,
            vector: [0],
            payload: { user_id: userId }
          }
        ]
      });
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
  async ensureCollection(name, size, enableBm25 = false) {
    var _a2, _b2, _c, _d, _e;
    try {
      const createParams = {
        vectors: {
          size,
          distance: "Cosine"
        }
      };
      if (enableBm25) {
        createParams.sparse_vectors = {
          [BM25_VECTOR_NAME]: { modifier: "idf" }
        };
      }
      await this.client.createCollection(name, createParams);
      if (enableBm25) {
        this._hasBm25Slot = true;
      }
      if (name === this.collectionName) {
        await this.createFilterIndexes(name);
      }
    } catch (error) {
      if ((error == null ? void 0 : error.status) === 409 || (error == null ? void 0 : error.status) === 401 || (error == null ? void 0 : error.status) === 403) {
        if (name === this.collectionName) {
          try {
            const collectionInfo = await this.client.getCollection(name);
            const vectorConfig = (_b2 = (_a2 = collectionInfo.config) == null ? void 0 : _a2.params) == null ? void 0 : _b2.vectors;
            if (vectorConfig && vectorConfig.size !== size) {
              throw new Error(
                `Collection ${name} exists but has wrong vector size. Expected: ${size}, got: ${vectorConfig.size}`
              );
            }
            if (enableBm25) {
              const sparseConfig = (_d = (_c = collectionInfo.config) == null ? void 0 : _c.params) == null ? void 0 : _d.sparse_vectors;
              this._hasBm25Slot = !!(sparseConfig && BM25_VECTOR_NAME in sparseConfig);
              if (!this._hasBm25Slot) {
                console.warn(
                  `Collection '${name}' predates hybrid search (no '${BM25_VECTOR_NAME}' sparse slot). BM25 keyword scoring is disabled for this collection; semantic search works normally. Use a fresh collection to enable hybrid keyword search.`
                );
              }
            }
          } catch (verifyError) {
            if ((_e = verifyError == null ? void 0 : verifyError.message) == null ? void 0 : _e.includes("wrong vector size")) {
              throw verifyError;
            }
            console.warn(
              `Collection '${name}' exists (409) but dimension verification failed: ${(verifyError == null ? void 0 : verifyError.message) || verifyError}. Proceeding anyway.`
            );
          }
          await this.createFilterIndexes(name);
        }
      } else {
        throw error;
      }
    }
  }
  // Index the fields mem0 filters by; remote Qdrant rejects filtering on
  // un-indexed fields. Mirrors Python's `_create_filter_indexes`.
  async createFilterIndexes(name) {
    if (!this._isRemote) {
      return;
    }
    const commonFields = ["user_id", "agent_id", "run_id", "actor_id"];
    for (const field of commonFields) {
      try {
        await this.client.createPayloadIndex(name, {
          field_name: field,
          field_schema: "keyword"
        });
      } catch (err) {
        console.debug(`Qdrant: skipped payload index for '${field}':`, err);
      }
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      await this.ensureClient();
      await this.ensureCollection(this.collectionName, this.dimension, true);
      await this.ensureCollection("memory_migrations", 1);
    } catch (error) {
      console.error("Error initializing Qdrant:", error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/chroma.ts
var MIGRATIONS_COLLECTION = "memory_migrations";
var ChromaDB = class _ChromaDB {
  constructor(config) {
    this.config = config;
    this.collectionName = config.collectionName;
    this.initialize().catch(console.error);
  }
  /**
   * Lazily construct (or reuse) the ChromaDB client, importing the optional
   * `chromadb` peer only when the store is first used so consumers that never
   * touch Chroma don't need it installed.
   */
  async getClient() {
    if (this.clientInstance) return this.clientInstance;
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    this.clientInstance = await this.clientPromise;
    return this.clientInstance;
  }
  async createClient() {
    const config = this.config;
    if (config.client) {
      return config.client;
    }
    const sdk = await loadPeer(
      "chromadb",
      "Chroma vector store",
      () => import("chromadb")
    );
    if (config.apiKey && config.tenant) {
      return new sdk.CloudClient({
        apiKey: config.apiKey,
        tenant: config.tenant,
        database: config.database || "mem0"
      });
    }
    const params = {};
    if (config.host) params.host = config.host;
    if (config.port) params.port = config.port;
    if (config.ssl !== void 0) params.ssl = config.ssl;
    if (config.path) params.path = config.path;
    return new sdk.ChromaClient(params);
  }
  async getCollection() {
    if (!this.collectionPromise) {
      const client = await this.getClient();
      this.collectionPromise = client.getOrCreateCollection({
        name: this.collectionName,
        embeddingFunction: null
      });
    }
    return this.collectionPromise;
  }
  async getMigrationsCollection() {
    if (!this.migrationsPromise) {
      const client = await this.getClient();
      this.migrationsPromise = client.getOrCreateCollection({
        name: MIGRATIONS_COLLECTION,
        embeddingFunction: null
      });
    }
    return this.migrationsPromise;
  }
  flatten(value) {
    if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
      return value[0];
    }
    return Array.isArray(value) ? value : [];
  }
  /** Parse a ChromaDB `get`/`query` response into VectorStoreResult objects. */
  parseOutput(data) {
    const ids = this.flatten(data == null ? void 0 : data.ids);
    const distances = this.flatten(data == null ? void 0 : data.distances);
    const metadatas = this.flatten(data == null ? void 0 : data.metadatas);
    const length = Math.max(ids.length, metadatas.length);
    const results = [];
    for (let i = 0; i < length; i++) {
      const rawDistance = distances[i];
      const score = rawDistance !== void 0 && rawDistance !== null ? 1 / (1 + rawDistance) : void 0;
      results.push({
        id: String(ids[i]),
        payload: metadatas[i] || {},
        score
      });
    }
    return results;
  }
  async insert(vectors, ids, payloads) {
    const collection = await this.getCollection();
    await collection.add({
      ids,
      embeddings: vectors,
      metadatas: payloads
    });
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    const collection = await this.getCollection();
    const where = _ChromaDB.generateWhereClause(filters);
    const results = await collection.query({
      queryEmbeddings: [query],
      nResults: topK,
      where
    });
    return this.parseOutput(results);
  }
  async get(vectorId) {
    const collection = await this.getCollection();
    const results = await collection.get({ ids: [vectorId] });
    const parsed = this.parseOutput(results);
    return parsed.length > 0 ? parsed[0] : null;
  }
  async update(vectorId, vector, payload) {
    const collection = await this.getCollection();
    await collection.update({
      ids: [vectorId],
      embeddings: vector ? [vector] : void 0,
      metadatas: payload ? [payload] : void 0
    });
  }
  async delete(vectorId) {
    const collection = await this.getCollection();
    await collection.delete({ ids: [vectorId] });
  }
  async deleteCol() {
    const client = await this.getClient();
    await client.deleteCollection({ name: this.collectionName });
    this.collectionPromise = void 0;
  }
  async list(filters, topK = 100) {
    const collection = await this.getCollection();
    const where = _ChromaDB.generateWhereClause(filters);
    const results = await collection.get({ where, limit: topK });
    const parsed = this.parseOutput(results);
    return [parsed, parsed.length];
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  async getUserId() {
    var _a2;
    const collection = await this.getMigrationsCollection();
    const result = await collection.get({ limit: 1 });
    const ids = Array.isArray(result == null ? void 0 : result.ids) ? result.ids : [];
    const metadatas = Array.isArray(result == null ? void 0 : result.metadatas) ? result.metadatas : [];
    if (ids.length > 0 && ((_a2 = metadatas[0]) == null ? void 0 : _a2.user_id)) {
      return String(metadatas[0].user_id);
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await collection.add({
      ids: [this.generateUUID()],
      embeddings: [[0]],
      metadatas: [{ user_id: randomUserId2 }]
    });
    return randomUserId2;
  }
  async setUserId(userId) {
    const collection = await this.getMigrationsCollection();
    const result = await collection.get({ limit: 1 });
    const ids = Array.isArray(result == null ? void 0 : result.ids) ? result.ids : [];
    const pointId = ids.length > 0 ? String(ids[0]) : this.generateUUID();
    await collection.upsert({
      ids: [pointId],
      embeddings: [[0]],
      metadatas: [{ user_id: userId }]
    });
  }
  async initialize() {
    await this.getCollection();
    await this.getMigrationsCollection();
  }
  /** Convert a single field filter into a ChromaDB where condition. */
  static convertCondition(key, value) {
    if (value === "*") {
      return [];
    }
    if (Array.isArray(value)) {
      return [{ [key]: { $in: value } }];
    }
    if (value !== null && typeof value === "object") {
      const opMap = {
        eq: "$eq",
        ne: "$ne",
        gt: "$gt",
        gte: "$gte",
        lt: "$lt",
        lte: "$lte",
        in: "$in",
        nin: "$nin"
      };
      return Object.entries(value).map(([op, val]) => {
        var _a2;
        return {
          [key]: { [(_a2 = opMap[op]) != null ? _a2 : "$eq"]: val }
        };
      });
    }
    return [{ [key]: { $eq: value } }];
  }
  /** Combine clauses under a logical operator, unwrapping singletons. */
  static combineClauses(clauses, operator) {
    if (clauses.length === 0) {
      return null;
    }
    if (clauses.length === 1) {
      return clauses[0];
    }
    return { [operator]: clauses };
  }
  /**
   * Generate a properly formatted `where` clause for ChromaDB from mem0's
   * universal filter format. Supports comparison operators plus $or/$not.
   */
  static generateWhereClause(filters) {
    var _a2, _b2;
    if (!filters) {
      return void 0;
    }
    const negateOp = {
      eq: "ne",
      ne: "eq",
      gt: "lte",
      gte: "lt",
      lt: "gte",
      lte: "gt",
      in: "nin",
      nin: "in"
    };
    const processed = [];
    for (const [key, value] of Object.entries(filters)) {
      if (key === "$or" || key === "OR") {
        const orConditions = [];
        for (const condition of value) {
          const subClauses = [];
          for (const [subKey, subValue] of Object.entries(condition)) {
            subClauses.push(..._ChromaDB.convertCondition(subKey, subValue));
          }
          const combined = _ChromaDB.combineClauses(subClauses, "$and");
          if (combined) orConditions.push(combined);
        }
        const combinedOr = _ChromaDB.combineClauses(orConditions, "$or");
        if (combinedOr) processed.push(combinedOr);
      } else if (key === "$not" || key === "NOT") {
        const negatedPerGroup = [];
        for (const condition of value) {
          const negatedFields = [];
          for (const [subKey, subValue] of Object.entries(condition)) {
            if (subValue !== null && typeof subValue === "object") {
              for (const [op, val] of Object.entries(subValue)) {
                const neg = (_a2 = negateOp[op]) != null ? _a2 : "ne";
                negatedFields.push(
                  ..._ChromaDB.convertCondition(subKey, { [neg]: val })
                );
              }
            } else {
              negatedFields.push(
                ..._ChromaDB.convertCondition(subKey, { ne: subValue })
              );
            }
          }
          const combined = _ChromaDB.combineClauses(negatedFields, "$or");
          if (combined) negatedPerGroup.push(combined);
        }
        const combinedNot = _ChromaDB.combineClauses(negatedPerGroup, "$and");
        if (combinedNot) processed.push(combinedNot);
      } else {
        const combined = _ChromaDB.combineClauses(
          _ChromaDB.convertCondition(key, value),
          "$and"
        );
        if (combined) processed.push(combined);
      }
    }
    return (_b2 = _ChromaDB.combineClauses(processed, "$and")) != null ? _b2 : void 0;
  }
};

// src/oss/src/vector_stores/vectorize.ts
var VectorizeDB = class {
  constructor(config) {
    this.client = null;
    this.apiKey = config.apiKey;
    this.dimensions = config.dimension || 1536;
    this.indexName = config.indexName;
    this.accountId = config.accountId;
    this.initialize().catch(console.error);
  }
  async ensureClient() {
    if (this.client) return;
    const sdk = await loadPeer(
      "cloudflare",
      "Vectorize vector store",
      () => import("cloudflare")
    );
    this.client = new sdk.default({ apiToken: this.apiKey });
  }
  async insert(vectors, ids, payloads) {
    var _a2;
    await this.initialize();
    try {
      const vectorObjects = vectors.map(
        (vector, index) => ({
          id: ids[index],
          values: vector,
          metadata: payloads[index] || {}
        })
      );
      const ndjsonPayload = vectorObjects.map((v) => JSON.stringify(v)).join("\n");
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/insert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_a2 = this.client) == null ? void 0 : _a2.apiToken}`
          },
          body: ndjsonPayload
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to insert vectors: ${response.status} ${errorText}`
        );
      }
    } catch (error) {
      console.error("Error inserting vectors:", error);
      throw new Error(
        `Failed to insert vectors: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    var _a2, _b2;
    await this.initialize();
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.query(
        this.indexName,
        {
          account_id: this.accountId,
          vector: query,
          filter: filters,
          returnMetadata: "all",
          topK
        }
      ));
      return ((_b2 = result == null ? void 0 : result.matches) == null ? void 0 : _b2.map((match) => ({
        id: match.id,
        payload: match.metadata,
        score: match.score
      }))) || [];
    } catch (error) {
      console.error("Error searching vectors:", error);
      throw new Error(
        `Failed to search vectors: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async get(vectorId) {
    var _a2;
    await this.initialize();
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.getByIds(
        this.indexName,
        {
          account_id: this.accountId,
          ids: [vectorId]
        }
      ));
      if (!(result == null ? void 0 : result.length)) return null;
      return {
        id: vectorId,
        payload: result[0].metadata
      };
    } catch (error) {
      console.error("Error getting vector:", error);
      throw new Error(
        `Failed to get vector: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async update(vectorId, vector, payload) {
    var _a2;
    await this.initialize();
    try {
      const data = {
        id: vectorId,
        values: vector,
        metadata: payload
      };
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/upsert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_a2 = this.client) == null ? void 0 : _a2.apiToken}`
          },
          body: JSON.stringify(data) + "\n"
          // ndjson format
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to update vector: ${response.status} ${errorText}`
        );
      }
    } catch (error) {
      console.error("Error updating vector:", error);
      throw new Error(
        `Failed to update vector: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async delete(vectorId) {
    var _a2;
    await this.initialize();
    try {
      await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.deleteByIds(this.indexName, {
        account_id: this.accountId,
        ids: [vectorId]
      }));
    } catch (error) {
      console.error("Error deleting vector:", error);
      throw new Error(
        `Failed to delete vector: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async deleteCol() {
    var _a2;
    await this.initialize();
    try {
      await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.delete(this.indexName, {
        account_id: this.accountId
      }));
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw new Error(
        `Failed to delete collection: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async list(filters, topK = 20) {
    var _a2, _b2;
    await this.initialize();
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.query(
        this.indexName,
        {
          account_id: this.accountId,
          vector: Array(this.dimensions).fill(0),
          // Dummy vector for listing
          filter: filters,
          topK,
          returnMetadata: "all"
        }
      ));
      const matches = ((_b2 = result == null ? void 0 : result.matches) == null ? void 0 : _b2.map((match) => ({
        id: match.id,
        payload: match.metadata,
        score: match.score
      }))) || [];
      return [matches, matches.length];
    } catch (error) {
      console.error("Error listing vectors:", error);
      throw new Error(
        `Failed to list vectors: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  async getUserId() {
    var _a2, _b2, _c;
    await this.initialize();
    try {
      let found = false;
      for await (const index of this.client.vectorize.indexes.list({
        account_id: this.accountId
      })) {
        if (index.name === "memory_migrations") {
          found = true;
        }
      }
      if (!found) {
        await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.create({
          account_id: this.accountId,
          name: "memory_migrations",
          config: {
            dimensions: 1,
            metric: "cosine"
          }
        }));
      }
      const result = await ((_b2 = this.client) == null ? void 0 : _b2.vectorize.indexes.query(
        "memory_migrations",
        {
          account_id: this.accountId,
          vector: [0],
          topK: 1,
          returnMetadata: "all"
        }
      ));
      if (result.matches.length > 0) {
        return result.matches[0].metadata.userId;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const data = {
        id: this.generateUUID(),
        values: [0],
        metadata: { userId: randomUserId2 }
      };
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/memory_migrations/upsert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_c = this.client) == null ? void 0 : _c.apiToken}`
          },
          body: JSON.stringify(data) + "\n"
          // ndjson format
        }
      );
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw new Error(
        `Failed to get user ID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async setUserId(userId) {
    var _a2, _b2;
    await this.initialize();
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.query(
        "memory_migrations",
        {
          account_id: this.accountId,
          vector: [0],
          topK: 1,
          returnMetadata: "all"
        }
      ));
      const pointId = result.matches.length > 0 ? result.matches[0].id : this.generateUUID();
      const data = {
        id: pointId,
        values: [0],
        metadata: { userId }
      };
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/memory_migrations/upsert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_b2 = this.client) == null ? void 0 : _b2.apiToken}`
          },
          body: JSON.stringify(data) + "\n"
          // ndjson format
        }
      );
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw new Error(
        `Failed to set user ID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    var _a2, _b2, _c, _d, _e;
    await this.ensureClient();
    try {
      let indexFound = false;
      for await (const idx of this.client.vectorize.indexes.list({
        account_id: this.accountId
      })) {
        if (idx.name === this.indexName) {
          indexFound = true;
          break;
        }
      }
      if (!indexFound) {
        try {
          await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.create({
            account_id: this.accountId,
            name: this.indexName,
            config: {
              dimensions: this.dimensions,
              metric: "cosine"
            }
          }));
          const properties2 = ["userId", "agentId", "runId"];
          for (const propertyName of properties2) {
            await ((_b2 = this.client) == null ? void 0 : _b2.vectorize.indexes.metadataIndex.create(
              this.indexName,
              {
                account_id: this.accountId,
                indexType: "string",
                propertyName
              }
            ));
          }
        } catch (err) {
          throw new Error(err);
        }
      }
      const metadataIndexes = await ((_c = this.client) == null ? void 0 : _c.vectorize.indexes.metadataIndex.list(
        this.indexName,
        {
          account_id: this.accountId
        }
      ));
      const existingMetadataIndexes = /* @__PURE__ */ new Set();
      for (const metadataIndex of (metadataIndexes == null ? void 0 : metadataIndexes.metadataIndexes) || []) {
        existingMetadataIndexes.add(metadataIndex.propertyName);
      }
      const properties = ["userId", "agentId", "runId"];
      for (const propertyName of properties) {
        if (!existingMetadataIndexes.has(propertyName)) {
          await ((_d = this.client) == null ? void 0 : _d.vectorize.indexes.metadataIndex.create(
            this.indexName,
            {
              account_id: this.accountId,
              indexType: "string",
              propertyName
            }
          ));
        }
      }
      let found = false;
      for await (const index of this.client.vectorize.indexes.list({
        account_id: this.accountId
      })) {
        if (index.name === "memory_migrations") {
          found = true;
          break;
        }
      }
      if (!found) {
        await ((_e = this.client) == null ? void 0 : _e.vectorize.indexes.create({
          account_id: this.accountId,
          name: "memory_migrations",
          config: {
            dimensions: 1,
            metric: "cosine"
          }
        }));
      }
    } catch (err) {
      throw new Error(err);
    }
  }
};

// src/oss/src/utils/casing.ts
function toCamelCase(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value
    ])
  );
}
function toCamelCasePreservingIds(payload) {
  const { agent_id, run_id, user_id, ...rest } = payload;
  return {
    ...toCamelCase(rest),
    ...agent_id !== void 0 && { agent_id },
    ...run_id !== void 0 && { run_id },
    ...user_id !== void 0 && { user_id }
  };
}

// src/oss/src/vector_stores/redis.ts
function escapeRedisTagValue(value) {
  return String(value).replace(
    /([,.<>{}\[\]"':;!@#$%^&*()\-+=~|/\\\s])/g,
    "\\$1"
  );
}
var DEFAULT_FIELDS = [
  { name: "memory_id", type: "tag" },
  { name: "hash", type: "tag" },
  { name: "agent_id", type: "tag" },
  { name: "run_id", type: "tag" },
  { name: "user_id", type: "tag" },
  { name: "memory", type: "text" },
  { name: "metadata", type: "text" },
  { name: "created_at", type: "numeric" },
  { name: "updated_at", type: "numeric" },
  {
    name: "embedding",
    type: "vector",
    attrs: {
      algorithm: "flat",
      distance_metric: "cosine",
      datatype: "float32",
      dims: 0
      // Will be set in constructor
    }
  }
];
var EXCLUDED_KEYS = /* @__PURE__ */ new Set([
  "user_id",
  "agent_id",
  "run_id",
  "hash",
  "data",
  "created_at",
  "updated_at"
]);
function toSnakeCase(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value
    ])
  );
}
function buildRedisFilterExpr(filters) {
  if (!filters) return "*";
  const conditions = Object.entries(toSnakeCase(filters)).filter(([, value]) => value !== null && value !== void 0).map(([key, value]) => `@${key}:{${escapeRedisTagValue(value)}}`);
  return conditions.length > 0 ? conditions.join(" ") : "*";
}
var RedisDB = class {
  constructor(config) {
    this.redisUrl = config.redisUrl;
    this.username = config.username;
    this.password = config.password;
    this.indexName = config.collectionName;
    this.indexPrefix = `mem0:${config.collectionName}`;
    this.schema = {
      index: {
        name: this.indexName,
        prefix: this.indexPrefix
      },
      fields: DEFAULT_FIELDS.map((field) => {
        if (field.name === "embedding" && field.attrs) {
          return {
            ...field,
            attrs: {
              ...field.attrs,
              dims: config.embeddingModelDims
            }
          };
        }
        return field;
      })
    };
    this.initialize().catch((err) => {
      console.error("Failed to initialize Redis:", err);
    });
  }
  async ensureClient() {
    if (this.client) return;
    const sdk = await loadPeer(
      "redis",
      "Redis vector store",
      () => import("redis")
    );
    this.client = sdk.createClient({
      url: this.redisUrl,
      username: this.username,
      password: this.password,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error("Max reconnection attempts reached");
            return new Error("Max reconnection attempts reached");
          }
          return Math.min(retries * 100, 3e3);
        }
      }
    });
    this.client.on("error", (err) => console.error("Redis Client Error:", err));
    this.client.on("connect", () => console.log("Redis Client Connected"));
  }
  async createIndex() {
    try {
      try {
        await this.client.ft.dropIndex(this.indexName);
      } catch (error) {
      }
      const schema = {};
      for (const field of this.schema.fields) {
        if (field.type === "vector") {
          schema[field.name] = {
            type: "VECTOR",
            ALGORITHM: "FLAT",
            TYPE: "FLOAT32",
            DIM: field.attrs.dims,
            DISTANCE_METRIC: "COSINE",
            INITIAL_CAP: 1e3
          };
        } else if (field.type === "numeric") {
          schema[field.name] = {
            type: "NUMERIC",
            SORTABLE: true
          };
        } else if (field.type === "tag") {
          schema[field.name] = {
            type: "TAG",
            SEPARATOR: "|"
          };
        } else if (field.type === "text") {
          schema[field.name] = {
            type: "TEXT",
            WEIGHT: 1
          };
        }
      }
      await this.client.ft.create(this.indexName, schema, {
        ON: "HASH",
        PREFIX: this.indexPrefix + ":",
        STOPWORDS: []
      });
    } catch (error) {
      console.error("Error creating Redis index:", error);
      throw error;
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureClient();
    try {
      await this.client.connect();
      console.log("Connected to Redis");
      const modulesResponse = await this.client.moduleList();
      const hasSearch = modulesResponse.some((mod) => {
        if (typeof mod === "object" && !Array.isArray(mod) && mod.name) {
          const name = String(mod.name).toLowerCase();
          return name === "search" || name === "searchlight";
        }
        if (Array.isArray(mod)) {
          const moduleMap = /* @__PURE__ */ new Map();
          for (let i = 0; i < mod.length; i += 2) {
            moduleMap.set(mod[i], mod[i + 1]);
          }
          const name = moduleMap.get("name");
          return (name == null ? void 0 : name.toLowerCase()) === "search" || (name == null ? void 0 : name.toLowerCase()) === "searchlight";
        }
        return false;
      });
      if (!hasSearch) {
        throw new Error(
          "RediSearch module is not loaded. Please ensure Redis Stack is properly installed and running."
        );
      }
      let retries = 0;
      const maxRetries = 3;
      while (retries < maxRetries) {
        try {
          await this.createIndex();
          console.log("Redis index created successfully");
          break;
        } catch (error) {
          console.error(
            `Error creating index (attempt ${retries + 1}/${maxRetries}):`,
            error
          );
          retries++;
          if (retries === maxRetries) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error initializing Redis:", error.message);
      } else {
        console.error("Error initializing Redis:", error);
      }
      throw error;
    }
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const data = vectors.map((vector, idx) => {
      var _a2, _b2;
      const payload = toSnakeCase(payloads[idx]);
      const id = ids[idx];
      const createdAt = payload.created_at ? new Date(payload.created_at).getTime() : 0;
      const entry = {
        memory_id: id,
        hash: (_a2 = payload.hash) != null ? _a2 : "",
        memory: (_b2 = payload.data) != null ? _b2 : "",
        created_at: createdAt,
        embedding: new Float32Array(vector).buffer
      };
      ["agent_id", "run_id", "user_id"].forEach((field) => {
        if (field in payload) {
          entry[field] = payload[field];
        }
      });
      entry.metadata = JSON.stringify(
        Object.fromEntries(
          Object.entries(payload).filter(([key]) => !EXCLUDED_KEYS.has(key))
        )
      );
      return entry;
    });
    try {
      await Promise.all(
        data.map(
          (entry) => this.client.hSet(`${this.indexPrefix}:${entry.memory_id}`, {
            ...entry,
            embedding: Buffer.from(entry.embedding)
          })
        )
      );
    } catch (error) {
      console.error("Error during vector insert:", error);
      throw error;
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const filterExpr = buildRedisFilterExpr(filters);
    const queryVector = new Float32Array(query).buffer;
    const searchOptions = {
      PARAMS: {
        vec: Buffer.from(queryVector)
      },
      RETURN: [
        "memory_id",
        "hash",
        "agent_id",
        "run_id",
        "user_id",
        "memory",
        "metadata",
        "created_at",
        "__vector_score"
      ],
      SORTBY: "__vector_score",
      DIALECT: 2,
      LIMIT: {
        from: 0,
        size: topK
      }
    };
    try {
      const results = await this.client.ft.search(
        this.indexName,
        `${filterExpr} =>[KNN ${topK} @embedding $vec AS __vector_score]`,
        searchOptions
      );
      return results.documents.map((doc) => {
        var _a2;
        const resultPayload2 = {
          hash: doc.value.hash,
          data: doc.value.memory,
          created_at: new Date(parseInt(doc.value.created_at)).toISOString(),
          ...doc.value.updated_at && {
            updated_at: new Date(parseInt(doc.value.updated_at)).toISOString()
          },
          ...doc.value.agent_id && { agent_id: doc.value.agent_id },
          ...doc.value.run_id && { run_id: doc.value.run_id },
          ...doc.value.user_id && { user_id: doc.value.user_id },
          ...JSON.parse(doc.value.metadata || "{}")
        };
        return {
          id: doc.value.memory_id,
          payload: toCamelCasePreservingIds(resultPayload2),
          score: Math.max(0, 1 - ((_a2 = Number(doc.value.__vector_score)) != null ? _a2 : 0))
        };
      });
    } catch (error) {
      console.error("Error during vector search:", error);
      throw error;
    }
  }
  async get(vectorId) {
    await this.initialize();
    try {
      const exists = await this.client.exists(
        `${this.indexPrefix}:${vectorId}`
      );
      if (!exists) {
        console.warn(`Memory with ID ${vectorId} does not exist`);
        return null;
      }
      const result = await this.client.hGetAll(
        `${this.indexPrefix}:${vectorId}`
      );
      if (!Object.keys(result).length) return null;
      const doc = {
        memory_id: result.memory_id,
        hash: result.hash,
        memory: result.memory,
        created_at: result.created_at,
        updated_at: result.updated_at,
        agent_id: result.agent_id,
        run_id: result.run_id,
        user_id: result.user_id,
        metadata: result.metadata
      };
      let created_at;
      try {
        if (!result.created_at) {
          created_at = /* @__PURE__ */ new Date();
        } else {
          const timestamp = Number(result.created_at);
          if (timestamp.toString().length === 10) {
            created_at = new Date(timestamp * 1e3);
          } else {
            created_at = new Date(timestamp);
          }
          if (isNaN(created_at.getTime())) {
            console.warn(
              `Invalid created_at timestamp: ${result.created_at}, using current date`
            );
            created_at = /* @__PURE__ */ new Date();
          }
        }
      } catch (error) {
        console.warn(
          `Error parsing created_at timestamp: ${result.created_at}, using current date`
        );
        created_at = /* @__PURE__ */ new Date();
      }
      let updated_at;
      try {
        if (result.updated_at) {
          const timestamp = Number(result.updated_at);
          if (timestamp.toString().length === 10) {
            updated_at = new Date(timestamp * 1e3);
          } else {
            updated_at = new Date(timestamp);
          }
          if (isNaN(updated_at.getTime())) {
            console.warn(
              `Invalid updated_at timestamp: ${result.updated_at}, setting to undefined`
            );
            updated_at = void 0;
          }
        }
      } catch (error) {
        console.warn(
          `Error parsing updated_at timestamp: ${result.updated_at}, setting to undefined`
        );
        updated_at = void 0;
      }
      const payload = {
        hash: doc.hash,
        data: doc.memory,
        created_at: created_at.toISOString(),
        ...updated_at && { updated_at: updated_at.toISOString() },
        ...doc.agent_id && { agent_id: doc.agent_id },
        ...doc.run_id && { run_id: doc.run_id },
        ...doc.user_id && { user_id: doc.user_id },
        ...JSON.parse(doc.metadata || "{}")
      };
      return {
        id: vectorId,
        payload: toCamelCasePreservingIds(payload)
      };
    } catch (error) {
      console.error("Error getting vector:", error);
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    var _a2, _b2;
    await this.initialize();
    const snakePayload = toSnakeCase(payload);
    const createdAt = snakePayload.created_at ? new Date(snakePayload.created_at).getTime() : 0;
    const updatedAt = snakePayload.updated_at ? new Date(snakePayload.updated_at).getTime() : 0;
    const entry = {
      memory_id: vectorId,
      hash: (_a2 = snakePayload.hash) != null ? _a2 : "",
      memory: (_b2 = snakePayload.data) != null ? _b2 : "",
      created_at: createdAt,
      updated_at: updatedAt,
      embedding: Buffer.from(new Float32Array(vector).buffer)
    };
    ["agent_id", "run_id", "user_id"].forEach((field) => {
      if (field in snakePayload) {
        entry[field] = snakePayload[field];
      }
    });
    entry.metadata = JSON.stringify(
      Object.fromEntries(
        Object.entries(snakePayload).filter(([key]) => !EXCLUDED_KEYS.has(key))
      )
    );
    try {
      await this.client.hSet(`${this.indexPrefix}:${vectorId}`, entry);
    } catch (error) {
      console.error("Error during vector update:", error);
      throw error;
    }
  }
  async delete(vectorId) {
    await this.initialize();
    try {
      const key = `${this.indexPrefix}:${vectorId}`;
      const exists = await this.client.exists(key);
      if (!exists) {
        console.warn(`Memory with ID ${vectorId} does not exist`);
        return;
      }
      const result = await this.client.del(key);
      if (!result) {
        throw new Error(`Failed to delete memory with ID ${vectorId}`);
      }
      console.log(`Successfully deleted memory with ID ${vectorId}`);
    } catch (error) {
      console.error("Error deleting memory:", error);
      throw error;
    }
  }
  async deleteCol() {
    await this.initialize();
    await this.client.ft.dropIndex(this.indexName);
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const filterExpr = buildRedisFilterExpr(filters);
    const searchOptions = {
      SORTBY: "created_at",
      SORTDIR: "DESC",
      LIMIT: {
        from: 0,
        size: topK
      }
    };
    const results = await this.client.ft.search(
      this.indexName,
      filterExpr,
      searchOptions
    );
    const items = results.documents.map((doc) => ({
      id: doc.value.memory_id,
      payload: toCamelCasePreservingIds({
        hash: doc.value.hash,
        data: doc.value.memory,
        created_at: new Date(parseInt(doc.value.created_at)).toISOString(),
        ...doc.value.updated_at && {
          updated_at: new Date(parseInt(doc.value.updated_at)).toISOString()
        },
        ...doc.value.agent_id && { agent_id: doc.value.agent_id },
        ...doc.value.run_id && { run_id: doc.value.run_id },
        ...doc.value.user_id && { user_id: doc.value.user_id },
        ...JSON.parse(doc.value.metadata || "{}")
      })
    }));
    return [items, results.total];
  }
  async close() {
    if (this.client) await this.client.quit();
  }
  async getUserId() {
    await this.initialize();
    try {
      const userId = await this.client.get("memory_migrations:1");
      if (userId) {
        return userId;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.client.set("memory_migrations:1", randomUserId2);
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  async setUserId(userId) {
    await this.initialize();
    try {
      await this.client.set("memory_migrations:1", userId);
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/valkey.ts
function escapeTagValue(value) {
  return String(value).replace(
    /([,.<>{}\[\]"':;!@#$%^&*()\-+=~|/\\\s])/g,
    "\\$1"
  );
}
var EXCLUDED_KEYS2 = /* @__PURE__ */ new Set([
  "user_id",
  "agent_id",
  "run_id",
  "hash",
  "data",
  "created_at",
  "updated_at"
]);
function toSnakeCase2(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value
    ])
  );
}
function parseFtSearchResults(result) {
  const total = Number(result[0]) || 0;
  const docs = [];
  for (let i = 1; i < result.length; i += 2) {
    const fields = result[i + 1];
    const doc = {};
    for (let j = 0; j < fields.length; j += 2) {
      const key = fields[j];
      doc[key] = fields[j + 1];
    }
    docs.push(doc);
  }
  return { total, docs };
}
function parseValkeyUrl(url) {
  const normalized = url.replace(/^valkey:\/\//, "redis://");
  const parsed = new URL(normalized);
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : void 0,
    password: parsed.password ? decodeURIComponent(parsed.password) : void 0
  };
}
function formatTimestamp(timestamp, timezone = "UTC") {
  const date = new Date(timestamp * 1e3);
  if (timezone === "UTC") {
    return date.toISOString();
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => {
    var _a2, _b2;
    return (_b2 = (_a2 = parts.find((part) => part.type === type)) == null ? void 0 : _a2.value) != null ? _b2 : "00";
  };
  const yyyy = get("year");
  const MM = get("month");
  const dd = get("day");
  const HH = get("hour");
  const mm = get("minute");
  const ss = get("second");
  const asIfUtc = Date.UTC(
    Number(yyyy),
    Number(MM) - 1,
    Number(dd),
    Number(HH),
    Number(mm),
    Number(ss)
  );
  const offsetMinutes = Math.round((asIfUtc - date.getTime()) / 6e4);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offHH = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offMM = String(absOffset % 60).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}${sign}${offHH}:${offMM}`;
}
function loadIovalkey() {
  return loadPeer("iovalkey", "Valkey vector store", () => import("iovalkey"));
}
var ValkeyDB = class {
  constructor(config) {
    var _a2, _b2, _c, _d, _e, _f;
    this.collectionName = config.collectionName;
    this.indexPrefix = `mem0:${config.collectionName}`;
    this.embeddingModelDims = config.embeddingModelDims;
    this.timezone = (_a2 = config.timezone) != null ? _a2 : "UTC";
    this.indexType = ((_b2 = config.indexType) != null ? _b2 : "hnsw").toLowerCase();
    this.hnswM = (_c = config.hnswM) != null ? _c : 16;
    this.hnswEfConstruction = (_d = config.hnswEfConstruction) != null ? _d : 200;
    this.hnswEfRuntime = (_e = config.hnswEfRuntime) != null ? _e : 10;
    this.clusterMode = (_f = config.clusterMode) != null ? _f : false;
    this.valkeyUrl = config.valkeyUrl;
    if (this.indexType !== "hnsw" && this.indexType !== "flat") {
      throw new Error(
        `Invalid indexType: ${config.indexType}. Must be 'hnsw' or 'flat'`
      );
    }
    this.initialize().catch((err) => {
      console.error("Failed to initialize Valkey:", err);
    });
  }
  buildIndexCreateCommand(collectionName, embeddingDims, distanceMetric, prefix) {
    const vectorConfig = this.indexType === "hnsw" ? [
      "embedding",
      "VECTOR",
      "HNSW",
      "12",
      "TYPE",
      "FLOAT32",
      "DIM",
      String(embeddingDims),
      "DISTANCE_METRIC",
      distanceMetric,
      "M",
      String(this.hnswM),
      "EF_CONSTRUCTION",
      String(this.hnswEfConstruction),
      "EF_RUNTIME",
      String(this.hnswEfRuntime)
    ] : [
      "embedding",
      "VECTOR",
      "FLAT",
      "6",
      "TYPE",
      "FLOAT32",
      "DIM",
      String(embeddingDims),
      "DISTANCE_METRIC",
      distanceMetric
    ];
    return [
      "FT.CREATE",
      collectionName,
      "ON",
      "HASH",
      "PREFIX",
      "1",
      prefix,
      "SCHEMA",
      "memory_id",
      "TAG",
      "hash",
      "TAG",
      "agent_id",
      "TAG",
      "run_id",
      "TAG",
      "user_id",
      "TAG",
      "memory",
      "TEXT",
      "metadata",
      "TAG",
      "created_at",
      "NUMERIC",
      "updated_at",
      "NUMERIC",
      ...vectorConfig
    ];
  }
  async ensureSearchModule() {
    var _a2;
    try {
      await this.client.call("FT._LIST");
    } catch (error) {
      const message = String((_a2 = error == null ? void 0 : error.message) != null ? _a2 : error).toLowerCase();
      if (message.includes("unknown command")) {
        throw new Error(
          "Valkey search module is not available. Please ensure Valkey is running with the search module enabled."
        );
      }
      throw error;
    }
  }
  async createIndex() {
    var _a2;
    await this.ensureSearchModule();
    try {
      await this.client.call("FT.INFO", this.collectionName);
      return;
    } catch (error) {
      const message = String((_a2 = error == null ? void 0 : error.message) != null ? _a2 : error).toLowerCase();
      if (!message.includes("not found") && !message.includes("unknown index")) {
        throw error;
      }
    }
    const cmd = this.buildIndexCreateCommand(
      this.collectionName,
      this.embeddingModelDims,
      "COSINE",
      this.indexPrefix
    );
    await this.client.call(...cmd);
  }
  async connectClient() {
    const iovalkey = await loadIovalkey();
    const Valkey = iovalkey.default;
    if (this.clusterMode) {
      const { Cluster } = iovalkey;
      const { host, port, username, password } = parseValkeyUrl(this.valkeyUrl);
      const redisOptions = {};
      if (username) redisOptions.username = username;
      if (password) redisOptions.password = password;
      this.client = new Cluster([{ host, port }], {
        redisOptions
      });
    } else {
      this.client = new Valkey(this.valkeyUrl);
    }
    this.client.on(
      "error",
      (err) => console.error("Valkey Client Error:", err)
    );
    this.client.on("connect", () => console.log("Valkey Client Connected"));
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.connectClient();
    await this.createIndex();
  }
  buildSearchQuery(knnPart, filters) {
    const snakeFilters = filters ? toSnakeCase2(filters) : void 0;
    if (!snakeFilters || !Object.entries(snakeFilters).some(
      ([, value]) => value !== null && value !== void 0
    )) {
      return `*=>${knnPart}`;
    }
    const filterParts = Object.entries(snakeFilters).filter(([, value]) => value !== null && value !== void 0).map(([key, value]) => `@${key}:{${escapeTagValue(value)}}`);
    if (!filterParts.length) {
      return `*=>${knnPart}`;
    }
    return `${filterParts.join(" ")} =>${knnPart}`;
  }
  docToResult(doc) {
    var _a2, _b2, _c;
    const rawDistance = doc.vector_score ? Number(doc.vector_score) : void 0;
    const score = rawDistance !== void 0 ? Math.max(0, 1 - rawDistance) : void 0;
    const resultPayload2 = {
      hash: (_a2 = doc.hash) != null ? _a2 : "",
      data: (_b2 = doc.memory) != null ? _b2 : "",
      created_at: doc.created_at ? formatTimestamp(Number(doc.created_at), this.timezone) : void 0
    };
    if (doc.updated_at) {
      resultPayload2.updated_at = formatTimestamp(
        Number(doc.updated_at),
        this.timezone
      );
    }
    if (doc.agent_id) resultPayload2.agent_id = doc.agent_id;
    if (doc.run_id) resultPayload2.run_id = doc.run_id;
    if (doc.user_id) resultPayload2.user_id = doc.user_id;
    if (doc.metadata) {
      try {
        Object.assign(resultPayload2, JSON.parse(doc.metadata));
      } catch (e) {
        console.warn("Failed to parse Valkey metadata:", doc.metadata);
      }
    }
    return {
      id: (_c = doc.memory_id) != null ? _c : "",
      payload: toCamelCasePreservingIds(resultPayload2),
      score
    };
  }
  async insert(vectors, ids, payloads) {
    await Promise.all(
      vectors.map(async (vector, idx) => {
        var _a2, _b2, _c;
        const payload = toSnakeCase2((_a2 = payloads[idx]) != null ? _a2 : {});
        const id = ids[idx];
        const key = `${this.indexPrefix}:${id}`;
        if (!payload.created_at) {
          payload.created_at = (/* @__PURE__ */ new Date()).toISOString();
        }
        const hashData = {
          memory_id: id,
          hash: (_b2 = payload.hash) != null ? _b2 : `hash_${id}`,
          memory: (_c = payload.data) != null ? _c : `data_${id}`,
          created_at: String(
            Math.floor(new Date(payload.created_at).getTime() / 1e3)
          ),
          embedding: Buffer.from(new Float32Array(vector).buffer),
          metadata: JSON.stringify(
            Object.fromEntries(
              Object.entries(payload).filter(([k]) => !EXCLUDED_KEYS2.has(k))
            )
          )
        };
        for (const field of ["agent_id", "run_id", "user_id"]) {
          if (field in payload) {
            hashData[field] = String(payload[field]);
          }
        }
        await this.client.hset(key, hashData);
      })
    );
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    const vectorBytes = Buffer.from(new Float32Array(query).buffer);
    const knnPart = this.indexType === "hnsw" ? `[KNN ${topK} @embedding $vec_param EF_RUNTIME ${this.hnswEfRuntime} AS vector_score]` : `[KNN ${topK} @embedding $vec_param AS vector_score]`;
    const searchQuery = this.buildSearchQuery(knnPart, filters);
    const result = await this.client.call(
      "FT.SEARCH",
      this.collectionName,
      searchQuery,
      "PARAMS",
      "2",
      "vec_param",
      vectorBytes,
      "RETURN",
      "10",
      "memory_id",
      "hash",
      "agent_id",
      "run_id",
      "user_id",
      "memory",
      "metadata",
      "created_at",
      "updated_at",
      "vector_score",
      "DIALECT",
      "2",
      "LIMIT",
      "0",
      String(topK)
    );
    const { docs } = parseFtSearchResults(result);
    return docs.map((doc) => this.docToResult(doc));
  }
  async get(vectorId) {
    const key = `${this.indexPrefix}:${vectorId}`;
    const exists = await this.client.exists(key);
    if (!exists) {
      return null;
    }
    const result = await this.client.hgetall(key);
    if (!Object.keys(result).length) {
      return null;
    }
    const doc = {
      memory_id: result.memory_id,
      hash: result.hash,
      memory: result.memory,
      created_at: result.created_at,
      updated_at: result.updated_at,
      agent_id: result.agent_id,
      run_id: result.run_id,
      user_id: result.user_id,
      metadata: result.metadata
    };
    return this.docToResult(doc);
  }
  async update(vectorId, vector, payload) {
    var _a2, _b2;
    const snakePayload = toSnakeCase2(payload);
    const key = `${this.indexPrefix}:${vectorId}`;
    if (!snakePayload.created_at) {
      snakePayload.created_at = (/* @__PURE__ */ new Date()).toISOString();
    }
    const hashData = {
      memory_id: vectorId,
      hash: (_a2 = snakePayload.hash) != null ? _a2 : `hash_${vectorId}`,
      memory: (_b2 = snakePayload.data) != null ? _b2 : `data_${vectorId}`,
      created_at: String(
        Math.floor(new Date(snakePayload.created_at).getTime() / 1e3)
      ),
      embedding: Buffer.from(new Float32Array(vector).buffer),
      metadata: JSON.stringify(
        Object.fromEntries(
          Object.entries(snakePayload).filter(([k]) => !EXCLUDED_KEYS2.has(k))
        )
      )
    };
    if (snakePayload.updated_at) {
      hashData.updated_at = String(
        Math.floor(new Date(snakePayload.updated_at).getTime() / 1e3)
      );
    }
    for (const field of ["agent_id", "run_id", "user_id"]) {
      if (field in snakePayload) {
        hashData[field] = String(snakePayload[field]);
      }
    }
    await this.client.hset(key, hashData);
  }
  async delete(vectorId) {
    const key = `${this.indexPrefix}:${vectorId}`;
    const exists = await this.client.exists(key);
    if (!exists) {
      console.warn(`Memory with ID ${vectorId} does not exist`);
      return;
    }
    await this.client.del(key);
  }
  async deleteCol() {
    var _a2;
    try {
      await this.client.call("FT.DROPINDEX", this.collectionName);
    } catch (error) {
      const message = String((_a2 = error == null ? void 0 : error.message) != null ? _a2 : error);
      if (!message.includes("Unknown index name")) {
        throw error;
      }
    }
  }
  async list(filters, topK = 100) {
    const dummyVector = new Array(this.embeddingModelDims).fill(0);
    const results = await this.search(dummyVector, topK, filters);
    return [results, results.length];
  }
  async close() {
    await this.client.quit();
  }
  async getUserId() {
    const userId = await this.client.get("memory_migrations:1");
    if (userId) {
      return userId;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.client.set("memory_migrations:1", randomUserId2);
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.client.set("memory_migrations:1", userId);
  }
};

// src/oss/src/llms/ollama.ts
var OllamaLLM = class {
  constructor(config) {
    // Using this variable to avoid calling the Ollama server multiple times
    this.initialized = false;
    this.host = config.url || config.baseURL || "http://localhost:11434";
    this.model = config.model || "llama3.1:8b";
    this.ensureModelExists().catch((err) => {
      logger.error(`Error ensuring model exists: ${err}`);
    });
  }
  async ensureClient() {
    if (this.ollama) return;
    const sdk = await loadPeer("ollama", "Ollama LLM", () => import("ollama"));
    this.ollama = new sdk.Ollama({ host: this.host });
  }
  async generateResponse(messages, responseFormat, tools) {
    await this.ensureClient();
    try {
      await this.ensureModelExists();
    } catch (err) {
      logger.error(`Error ensuring model exists: ${err}`);
    }
    const completion = await this.ollama.chat({
      model: this.model,
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      ...(responseFormat == null ? void 0 : responseFormat.type) === "json_object" && { format: "json" },
      ...tools && { tools, tool_choice: "auto" }
    });
    const response = completion.message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: JSON.stringify(call.function.arguments)
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    await this.ensureClient();
    try {
      await this.ensureModelExists();
    } catch (err) {
      logger.error(`Error ensuring model exists: ${err}`);
    }
    const completion = await this.ollama.chat({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model
    });
    const response = completion.message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
  async ensureModelExists() {
    if (this.initialized) {
      return true;
    }
    await this.ensureClient();
    const local_models = await this.ollama.list();
    if (!local_models.models.find((m) => m.name === this.model)) {
      logger.info(`Pulling model ${this.model}...`);
      await this.ollama.pull({ model: this.model });
    }
    this.initialized = true;
    return true;
  }
};

// src/oss/src/llms/lmstudio.ts
var DEFAULT_BASE_URL3 = "http://localhost:1234/v1";
var DEFAULT_MODEL6 = "lmstudio-community/Meta-Llama-3.1-70B-Instruct-GGUF/Meta-Llama-3.1-70B-Instruct-IQ2_M.gguf";
var DEFAULT_LMSTUDIO_API_KEY2 = "lm-studio";
var LMStudioLLM = class extends OpenAILLM {
  constructor(config) {
    var _a2;
    super({
      ...config,
      apiKey: config.apiKey || DEFAULT_LMSTUDIO_API_KEY2,
      baseURL: (_a2 = config.baseURL) != null ? _a2 : DEFAULT_BASE_URL3,
      model: config.model || DEFAULT_MODEL6
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/deepseek.ts
var DeepSeekLLM = class extends OpenAILLM {
  constructor(config) {
    const apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("DeepSeek API key is required");
    }
    super({
      ...config,
      apiKey,
      baseURL: config.baseURL || process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com",
      model: config.model || "deepseek-chat"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DeepSeek LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DeepSeek LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/xai.ts
var XAILLM = class extends OpenAILLM {
  constructor(config) {
    const apiKey = config.apiKey || process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error("xAI API key is required");
    }
    super({
      ...config,
      apiKey,
      baseURL: config.baseURL || process.env.XAI_API_BASE || "https://api.x.ai/v1",
      model: config.model || "grok-4.3"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`xAI LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`xAI LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/sarvam.ts
var SarvamLLM = class extends OpenAILLM {
  constructor(config) {
    const apiKey = config.apiKey || process.env.SARVAM_API_KEY;
    if (!apiKey) {
      throw new Error("Sarvam API key is required");
    }
    super({
      ...config,
      apiKey,
      baseURL: config.baseURL || process.env.SARVAM_API_BASE || "https://api.sarvam.ai/v1",
      model: config.model || "sarvam-m"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Sarvam LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Sarvam LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/aws_bedrock.ts
var PROVIDERS = [
  "ai21",
  "amazon",
  "anthropic",
  "cohere",
  "meta",
  "mistral",
  "stability",
  "writer",
  "deepseek",
  "gpt-oss",
  "perplexity",
  "snowflake",
  "titan",
  "command",
  "j2",
  "llama",
  "minimax"
];
function extractProvider(model, providerOverride) {
  if (providerOverride) {
    if (!PROVIDERS.includes(providerOverride)) {
      throw new Error(
        `Unknown providerOverride '${providerOverride}'. Valid providers: ${PROVIDERS.join(", ")}`
      );
    }
    return providerOverride;
  }
  for (const provider of PROVIDERS) {
    const re = new RegExp(
      `\\b${provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
    );
    if (re.test(model)) return provider;
  }
  throw new Error(`Unknown provider in model: ${model}`);
}
var AWSBedrockLLM = class {
  constructor(config = {}) {
    var _a2, _b2;
    this.model = typeof config.model === "string" && config.model || "anthropic.claude-3-5-sonnet-20240620-v1:0";
    this.provider = extractProvider(this.model, config.providerOverride);
    this.temperature = (_a2 = config.temperature) != null ? _a2 : 0.1;
    this.maxTokens = (_b2 = config.maxTokens) != null ? _b2 : 2e3;
    this.topP = config.topP;
    const region = config.awsRegion || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    const clientConfig = {};
    if (region) clientConfig.region = region;
    if (config.awsAccessKeyId && config.awsSecretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
        ...config.awsSessionToken && {
          sessionToken: config.awsSessionToken
        }
      };
    }
    this.clientConfig = clientConfig;
    this.clientOverride = config.client;
  }
  /**
   * Load the optional AWS SDK on first use.
   *
   * This MUST be a dynamic `import()`, never `require()`: tsup/esbuild rewrite
   * `require()` in the published ESM bundle (`dist/oss/index.mjs`) into a
   * `__require` shim that throws `Dynamic require of "..." is not supported`,
   * so every ESM consumer would hit a dead provider even with the SDK installed.
   */
  async getSDK() {
    if (!this.sdkPromise) {
      this.sdkPromise = import("@aws-sdk/client-bedrock-runtime").then(
        (sdk) => sdk,
        (err) => {
          this.sdkPromise = void 0;
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `The '@aws-sdk/client-bedrock-runtime' package is required to use the AWS Bedrock LLM provider. Install it with: npm install @aws-sdk/client-bedrock-runtime (original error: ${detail})`
          );
        }
      );
    }
    return this.sdkPromise;
  }
  /** Memoized Bedrock client; an injected `config.client` short-circuits the SDK. */
  async getClient() {
    if (this.clientOverride) return this.clientOverride;
    if (!this.clientPromise) {
      this.clientPromise = this.getSDK().then(
        ({ BedrockRuntimeClient }) => new BedrockRuntimeClient(this.clientConfig)
      );
    }
    return this.clientPromise;
  }
  /**
   * Split messages into a top-level `system` block (Converse passes system
   * prompts separately) and role-tagged content blocks for everything else.
   */
  formatMessages(messages) {
    const systemParts = [];
    const converseMessages = [];
    for (const msg of messages) {
      const role = msg.role;
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      if (role === "system") {
        systemParts.push(content);
      } else {
        converseMessages.push({
          role: role === "assistant" ? "assistant" : "user",
          content: [{ text: content }]
        });
      }
    }
    if (converseMessages.length === 0) {
      converseMessages.push({ role: "user", content: [{ text: "" }] });
    }
    return {
      system: systemParts.length ? [{ text: systemParts.join("\n") }] : void 0,
      converseMessages
    };
  }
  /**
   * Build the Converse `inferenceConfig`. Anthropic and MiniMax reasoning
   * models reject requests carrying both `temperature` and `topP`, so `topP`
   * is omitted for those families (mirrors the Python `_build_inference_config`).
   */
  buildInferenceConfig() {
    const inferenceConfig = {
      maxTokens: this.maxTokens,
      temperature: this.temperature
    };
    if (this.topP != null && !["anthropic", "minimax"].includes(this.provider)) {
      inferenceConfig.topP = this.topP;
    }
    return inferenceConfig;
  }
  /** Convert OpenAI-style tools to the Converse `toolConfig` shape. */
  convertToolsToConverse(tools) {
    if (!tools || tools.length === 0) return void 0;
    const converseTools = tools.filter((t) => (t == null ? void 0 : t.type) === "function" && t.function).map((t) => ({
      toolSpec: {
        name: t.function.name,
        description: t.function.description || "",
        inputSchema: { json: t.function.parameters || {} }
      }
    }));
    return converseTools.length ? { tools: converseTools } : void 0;
  }
  async converse(messages, tools) {
    const { system, converseMessages } = this.formatMessages(messages);
    const input = {
      modelId: this.model,
      messages: converseMessages,
      inferenceConfig: this.buildInferenceConfig()
    };
    if (system) input.system = system;
    const toolConfig = tools ? this.convertToolsToConverse(tools) : void 0;
    if (toolConfig) input.toolConfig = toolConfig;
    const [{ ConverseCommand }, client] = await Promise.all([
      this.getSDK(),
      this.getClient()
    ]);
    return client.send(new ConverseCommand(input));
  }
  /** Pull the first text block out of a Converse response. */
  parseText(response) {
    var _a2, _b2;
    const content = ((_b2 = (_a2 = response == null ? void 0 : response.output) == null ? void 0 : _a2.message) == null ? void 0 : _b2.content) || [];
    for (const block of content) {
      if (block && typeof block.text === "string") return block.text;
    }
    return "";
  }
  /** Collect any toolUse blocks out of a Converse response. */
  parseToolCalls(response) {
    var _a2, _b2, _c;
    const content = ((_b2 = (_a2 = response == null ? void 0 : response.output) == null ? void 0 : _a2.message) == null ? void 0 : _b2.content) || [];
    const calls = [];
    for (const block of content) {
      if (block == null ? void 0 : block.toolUse) {
        calls.push({
          name: block.toolUse.name,
          arguments: JSON.stringify((_c = block.toolUse.input) != null ? _c : {})
        });
      }
    }
    return calls;
  }
  async generateResponse(messages, _responseFormat, tools) {
    try {
      const response = await this.converse(messages, tools);
      if (tools && tools.length) {
        const toolCalls = this.parseToolCalls(response);
        if (toolCalls.length) {
          return {
            content: this.parseText(response),
            role: "assistant",
            toolCalls
          };
        }
      }
      return this.parseText(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`AWS Bedrock LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      const response = await this.converse(messages);
      return { content: this.parseText(response), role: "assistant" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`AWS Bedrock LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/litellm.ts
var LiteLLM = class extends OpenAILLM {
  constructor(config) {
    super({
      ...config,
      apiKey: config.apiKey || process.env.LITELLM_API_KEY || "sk-anything",
      baseURL: config.baseURL || process.env.LITELLM_API_BASE || "http://localhost:4000",
      model: config.model || "gpt-5-mini"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LiteLLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LiteLLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/minimax.ts
var MiniMaxLLM = class extends OpenAILLM {
  constructor(config) {
    const apiKey = config.apiKey || process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new Error("MiniMax API key is required");
    }
    super({
      ...config,
      apiKey,
      baseURL: config.baseURL || process.env.MINIMAX_API_BASE || "https://api.minimax.io/v1",
      model: config.model || "MiniMax-M2.7"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`MiniMax LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`MiniMax LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/together.ts
var TogetherLLM = class extends OpenAILLM {
  constructor(config) {
    const apiKey = config.apiKey || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      throw new Error("Together API key is required");
    }
    super({
      ...config,
      apiKey,
      baseURL: config.baseURL || process.env.TOGETHER_API_BASE || "https://api.together.ai/v1",
      model: config.model || "MiniMaxAI/MiniMax-M3"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Together LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Together LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/vllm.ts
var DEFAULT_MODEL7 = "Qwen/Qwen2.5-32B-Instruct";
var DEFAULT_API_KEY = "vllm-api-key";
var DEFAULT_BASE_URL4 = "http://localhost:8000/v1";
var VllmLLM = class extends OpenAILLM {
  constructor(config) {
    const baseURL = config.baseURL || config.vllmBaseURL || config.vllm_base_url || config.url || process.env.VLLM_BASE_URL || DEFAULT_BASE_URL4;
    super({
      ...config,
      apiKey: config.apiKey || process.env.VLLM_API_KEY || DEFAULT_API_KEY,
      baseURL,
      model: config.model || DEFAULT_MODEL7
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`vLLM LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`vLLM LLM failed: ${message}`);
    }
  }
};

// src/oss/src/vector_stores/supabase.ts
var POSTGREST_MAX_ROWS = 1e3;
var SupabaseDB = class {
  constructor(config) {
    this.supabaseUrl = config.supabaseUrl;
    this.supabaseKey = config.supabaseKey;
    this.tableName = config.tableName;
    this.embeddingColumnName = config.embeddingColumnName || "embedding";
    this.metadataColumnName = config.metadataColumnName || "metadata";
    this.initialize().catch((err) => {
      console.error("Failed to initialize Supabase:", err);
    });
  }
  async ensureClient() {
    if (this.client) return;
    const sdk = await loadPeer(
      "@supabase/supabase-js",
      "Supabase vector store",
      () => import("@supabase/supabase-js")
    );
    this.client = sdk.createClient(this.supabaseUrl, this.supabaseKey);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureClient();
    try {
      const { error: probeError } = await this.client.from(this.tableName).select(this.embeddingColumnName).limit(1);
      if (probeError) {
        console.error("Table probe error:", probeError);
        throw new Error(
          `Vector operations failed. Please ensure:
1. The vector extension is enabled
2. The table "${this.tableName}" exists with correct schema
3. The match_vectors function is created
4. Row Level Security policies allow the configured Supabase key to read the table

RUN THE FOLLOWING SQL IN YOUR SUPABASE SQL EDITOR:

-- Enable the vector extension
create extension if not exists vector;

-- Create the memories table
create table if not exists memories (
  id text primary key,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone default timezone('utc', now())
);

-- Create the memory migrations table
create table if not exists memory_migrations (
  user_id text primary key,
  created_at timestamp with time zone default timezone('utc', now())
);

-- Create the vector similarity search function
create or replace function match_vectors(
  query_embedding vector(1536),
  match_count int,
  filter jsonb default '{}'::jsonb
)
returns table (
  id text,
  similarity float,
  metadata jsonb
)
language plpgsql
as $$
begin
  return query
  select
    t.id::text,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.metadata
  from memories t
  where case
    when filter::text = '{}'::text then true
    else t.metadata @> filter
  end
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

See the SQL migration instructions in the code comments.`
        );
      }
      console.log("Connected to Supabase successfully");
    } catch (error) {
      console.error("Error during Supabase initialization:", error);
      throw error;
    }
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    try {
      const data = vectors.map((vector, idx) => ({
        id: ids[idx],
        [this.embeddingColumnName]: vector,
        [this.metadataColumnName]: {
          ...payloads[idx],
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      const { error } = await this.client.from(this.tableName).insert(data);
      if (error) throw error;
    } catch (error) {
      console.error("Error during vector insert:", error);
      throw error;
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    try {
      const rpcQuery = {
        query_embedding: query,
        match_count: topK
      };
      if (filters) {
        rpcQuery.filter = filters;
      }
      const { data, error } = await this.client.rpc("match_vectors", rpcQuery);
      if (error) throw error;
      if (!data) return [];
      const results = data;
      if (topK > POSTGREST_MAX_ROWS && results.length === POSTGREST_MAX_ROWS) {
        console.warn(
          `Supabase search requested topK=${topK} but match_vectors returned exactly the PostgREST row cap of ${POSTGREST_MAX_ROWS}; results were likely truncated.`
        );
      }
      return results.map((result) => ({
        id: result.id,
        payload: result.metadata,
        score: result.similarity
      }));
    } catch (error) {
      console.error("Error during vector search:", error);
      throw error;
    }
  }
  async get(vectorId) {
    await this.initialize();
    try {
      const { data, error } = await this.client.from(this.tableName).select("*").eq("id", vectorId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        payload: data[this.metadataColumnName]
      };
    } catch (error) {
      console.error("Error getting vector:", error);
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    try {
      const { error } = await this.client.from(this.tableName).update({
        [this.embeddingColumnName]: vector,
        [this.metadataColumnName]: {
          ...payload,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      }).eq("id", vectorId);
      if (error) throw error;
    } catch (error) {
      console.error("Error during vector update:", error);
      throw error;
    }
  }
  async delete(vectorId) {
    await this.initialize();
    try {
      const { error } = await this.client.from(this.tableName).delete().eq("id", vectorId);
      if (error) throw error;
    } catch (error) {
      console.error("Error deleting vector:", error);
      throw error;
    }
  }
  async deleteCol() {
    await this.initialize();
    try {
      const { error } = await this.client.from(this.tableName).delete().neq("id", "");
      if (error) throw error;
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw error;
    }
  }
  async list(filters, topK = 100) {
    await this.initialize();
    try {
      const results = [];
      let totalCount = 0;
      let offset = 0;
      while (results.length < topK) {
        const to = Math.min(offset + POSTGREST_MAX_ROWS, topK) - 1;
        let query = this.client.from(this.tableName).select("*", { count: "exact" }).order("id", { ascending: true });
        if (filters) {
          Object.entries(filters).forEach(([key, value]) => {
            query = query.eq(`${this.metadataColumnName}->>${key}`, value);
          });
        }
        const { data, error, count } = await query.range(offset, to);
        if (error) throw error;
        totalCount = count != null ? count : totalCount;
        const page = (data != null ? data : []).map((item) => ({
          id: item.id,
          payload: item[this.metadataColumnName]
        }));
        results.push(...page);
        const requestedPageSize = to - offset + 1;
        if (page.length < requestedPageSize) break;
        offset += page.length;
        if (results.length >= totalCount) break;
      }
      return [results, totalCount];
    } catch (error) {
      console.error("Error listing vectors:", error);
      throw error;
    }
  }
  async getUserId() {
    await this.initialize();
    try {
      const { data: tableExists } = await this.client.from("memory_migrations").select("user_id").limit(1);
      if (!tableExists || tableExists.length === 0) {
        const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const { error: insertError } = await this.client.from("memory_migrations").insert({ user_id: randomUserId2 });
        if (insertError) throw insertError;
        return randomUserId2;
      }
      const { data, error } = await this.client.from("memory_migrations").select("user_id").limit(1);
      if (error) throw error;
      if (!data || data.length === 0) {
        const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const { error: insertError } = await this.client.from("memory_migrations").insert({ user_id: randomUserId2 });
        if (insertError) throw insertError;
        return randomUserId2;
      }
      return data[0].user_id;
    } catch (error) {
      console.error("Error getting user ID:", error);
      return "anonymous-supabase";
    }
  }
  async setUserId(userId) {
    await this.initialize();
    try {
      const { error: deleteError } = await this.client.from("memory_migrations").delete().neq("user_id", "");
      if (deleteError) throw deleteError;
      const { error: insertError } = await this.client.from("memory_migrations").insert({ user_id: userId });
      if (insertError) throw insertError;
    } catch (error) {
      console.error("Error setting user ID:", error);
    }
  }
};

// src/oss/src/storage/SQLiteManager.ts
import Database2 from "better-sqlite3";
import { randomUUID } from "crypto";
var SQLiteManager = class {
  constructor(dbPath) {
    ensureSQLiteDirectory(dbPath);
    this.db = new Database2(dbPath);
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        action TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        is_deleted INTEGER DEFAULT 0
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_scope TEXT,
        role TEXT,
        content TEXT,
        name TEXT,
        created_at TEXT
      )
    `);
    this.stmtInsert = this.db.prepare(
      `INSERT INTO memory_history
      (memory_id, previous_value, new_value, action, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtSelect = this.db.prepare(
      "SELECT * FROM memory_history WHERE memory_id = ? ORDER BY id DESC"
    );
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    this.stmtInsert.run(
      memoryId,
      previousValue,
      newValue,
      action,
      createdAt != null ? createdAt : null,
      updatedAt != null ? updatedAt : null,
      isDeleted
    );
  }
  async getHistory(memoryId) {
    return this.stmtSelect.all(memoryId);
  }
  async saveMessages(messages, sessionScope) {
    if (!messages.length) return;
    const insertMsg = this.db.prepare(
      `INSERT INTO messages (id, session_scope, role, content, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const evict = this.db.prepare(
      `DELETE FROM messages WHERE session_scope = ? AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM messages WHERE session_scope = ? ORDER BY created_at DESC LIMIT 10
         )
       )`
    );
    const txn = this.db.transaction(() => {
      var _a2;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      for (const msg of messages) {
        insertMsg.run(
          randomUUID(),
          sessionScope,
          msg.role,
          msg.content,
          (_a2 = msg.name) != null ? _a2 : null,
          now
        );
      }
      evict.run(sessionScope, sessionScope);
    });
    txn();
  }
  async getLastMessages(sessionScope, limit = 10) {
    const rows = this.db.prepare(
      `SELECT role, content, name, created_at FROM (
           SELECT role, content, name, created_at
           FROM messages
           WHERE session_scope = ?
           ORDER BY created_at DESC
           LIMIT ?
         ) ORDER BY created_at ASC`
    ).all(sessionScope, limit);
    return rows.map((r) => ({
      role: r.role,
      content: r.content,
      ...r.name != null ? { name: r.name } : {},
      createdAt: r.created_at
    }));
  }
  async batchAddHistory(records) {
    const txn = this.db.transaction(() => {
      var _a2, _b2, _c;
      for (const record of records) {
        this.stmtInsert.run(
          record.memoryId,
          record.previousValue,
          record.newValue,
          record.action,
          (_a2 = record.createdAt) != null ? _a2 : null,
          (_b2 = record.updatedAt) != null ? _b2 : null,
          (_c = record.isDeleted) != null ? _c : 0
        );
      }
    });
    txn();
  }
  async reset() {
    this.db.exec("DROP TABLE IF EXISTS memory_history");
    this.db.exec("DROP TABLE IF EXISTS messages");
    this.init();
  }
  close() {
    this.db.close();
  }
};

// src/oss/src/storage/MemoryHistoryManager.ts
import { v4 as uuidv4 } from "uuid";
var MemoryHistoryManager = class {
  constructor() {
    this.memoryStore = /* @__PURE__ */ new Map();
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    const historyEntry = {
      id: uuidv4(),
      memory_id: memoryId,
      previous_value: previousValue,
      new_value: newValue,
      action,
      created_at: createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: updatedAt || null,
      is_deleted: isDeleted
    };
    this.memoryStore.set(historyEntry.id, historyEntry);
  }
  async getHistory(memoryId) {
    return Array.from(this.memoryStore.values()).filter((entry) => entry.memory_id === memoryId).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).slice(0, 100);
  }
  async reset() {
    this.memoryStore.clear();
  }
  close() {
    return;
  }
};

// src/oss/src/storage/SupabaseHistoryManager.ts
import { v4 as uuidv42 } from "uuid";
var SupabaseHistoryManager = class {
  constructor(config) {
    this.tableName = config.tableName || "memory_history";
    this.supabaseUrl = config.supabaseUrl;
    this.supabaseKey = config.supabaseKey;
    this.initializeSupabase().catch(console.error);
  }
  async ensureClient() {
    if (this.supabase) return;
    const sdk = await loadPeer(
      "@supabase/supabase-js",
      "Supabase history manager",
      () => import("@supabase/supabase-js")
    );
    this.supabase = sdk.createClient(this.supabaseUrl, this.supabaseKey);
  }
  async initializeSupabase() {
    await this.ensureClient();
    const { error } = await this.supabase.from(this.tableName).select("id").limit(1);
    if (error) {
      console.error(
        "Error: Table does not exist. Please run this SQL in your Supabase SQL Editor:"
      );
      console.error(`
create table ${this.tableName} (
  id text primary key,
  memory_id text not null,
  previous_value text,
  new_value text,
  action text not null,
  created_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone,
  is_deleted integer default 0
);
      `);
      throw error;
    }
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    await this.ensureClient();
    const historyEntry = {
      id: uuidv42(),
      memory_id: memoryId,
      previous_value: previousValue,
      new_value: newValue,
      action,
      created_at: createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: updatedAt || null,
      is_deleted: isDeleted
    };
    const { error } = await this.supabase.from(this.tableName).insert(historyEntry);
    if (error) {
      console.error("Error adding history to Supabase:", error);
      throw error;
    }
  }
  async getHistory(memoryId) {
    await this.ensureClient();
    const { data, error } = await this.supabase.from(this.tableName).select("*").eq("memory_id", memoryId).order("created_at", { ascending: false }).limit(100);
    if (error) {
      console.error("Error getting history from Supabase:", error);
      throw error;
    }
    return data || [];
  }
  async reset() {
    await this.ensureClient();
    const { error } = await this.supabase.from(this.tableName).delete().neq("id", "");
    if (error) {
      console.error("Error resetting Supabase history:", error);
      throw error;
    }
  }
  close() {
    return;
  }
};

// src/oss/src/embeddings/google.ts
var GoogleEmbedder = class {
  constructor(config) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    this.model = config.model || "gemini-embedding-001";
    this.embeddingDims = config.embeddingDims;
  }
  async ensureClient() {
    if (this.google) return;
    const sdk = await loadPeer(
      "@google/genai",
      "Google embedder",
      () => import("@google/genai")
    );
    this.google = new sdk.GoogleGenAI({ apiKey: this.apiKey });
  }
  async embed(text) {
    await this.ensureClient();
    const response = await this.google.models.embedContent({
      model: this.model,
      contents: text,
      ...this.embeddingDims !== void 0 && {
        config: { outputDimensionality: this.embeddingDims }
      }
    });
    return response.embeddings[0].values;
  }
  async embedBatch(texts) {
    await this.ensureClient();
    const response = await this.google.models.embedContent({
      model: this.model,
      contents: texts,
      ...this.embeddingDims !== void 0 && {
        config: { outputDimensionality: this.embeddingDims }
      }
    });
    return response.embeddings.map((item) => item.values);
  }
};

// src/oss/src/llms/google.ts
var GoogleLLM = class {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.model = config.model || "gemini-2.0-flash";
  }
  async ensureClient() {
    if (this.google) return;
    const sdk = await loadPeer(
      "@google/genai",
      "Google LLM",
      () => import("@google/genai")
    );
    this.google = new sdk.GoogleGenAI({ apiKey: this.apiKey });
  }
  formatContents(messages) {
    return messages.map((msg) => ({
      parts: [
        {
          text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        }
      ],
      role: msg.role === "system" ? "model" : "user"
    }));
  }
  async generateResponse(messages, responseFormat, tools) {
    var _a2;
    await this.ensureClient();
    const contents = this.formatContents(messages);
    const config = {};
    if (tools && tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
          }))
        }
      ];
    }
    if ((responseFormat == null ? void 0 : responseFormat.type) === "json_object") {
      config.responseMimeType = "application/json";
    }
    const completion = await this.google.models.generateContent({
      contents,
      model: this.model,
      config
    });
    if (completion.functionCalls && completion.functionCalls.length > 0) {
      return {
        content: completion.text || "",
        role: "assistant",
        toolCalls: completion.functionCalls.map((call) => ({
          name: call.name,
          arguments: JSON.stringify(call.args)
        }))
      };
    }
    const text = (_a2 = completion.text) == null ? void 0 : _a2.replace(/^```json\n/, "").replace(/\n```$/, "");
    return text || "";
  }
  async generateChat(messages) {
    var _a2, _b2, _c;
    await this.ensureClient();
    const completion = await this.google.models.generateContent({
      contents: this.formatContents(messages),
      model: this.model
    });
    const response = (_b2 = (_a2 = completion.candidates) == null ? void 0 : _a2[0]) == null ? void 0 : _b2.content;
    const content = ((_c = response == null ? void 0 : response.parts) == null ? void 0 : _c.map((part) => part.text || "").join("")) || completion.text || "";
    return {
      content,
      role: (response == null ? void 0 : response.role) || "assistant"
    };
  }
};

// src/oss/src/llms/azure.ts
import { AzureOpenAI } from "openai";
var AzureOpenAILLM = class {
  constructor(config) {
    var _a2;
    if (!config.apiKey || !((_a2 = config.modelProperties) == null ? void 0 : _a2.endpoint)) {
      throw new Error("Azure OpenAI requires both API key and endpoint");
    }
    const { endpoint, ...rest } = config.modelProperties;
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint,
      ...rest
    });
    this.model = config.model || "gpt-5-mini";
  }
  async generateResponse(messages, responseFormat, tools) {
    const completion = await this.client.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model,
      response_format: responseFormat,
      ...tools && { tools, tool_choice: "auto" }
    });
    const response = completion.choices[0].message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    const completion = await this.client.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
};

// src/oss/src/embeddings/azure.ts
import { AzureOpenAI as AzureOpenAI2 } from "openai";
var AzureOpenAIEmbedder = class {
  constructor(config) {
    var _a2;
    if (!config.apiKey || !((_a2 = config.modelProperties) == null ? void 0 : _a2.endpoint)) {
      throw new Error("Azure OpenAI requires both API key and endpoint");
    }
    const { endpoint, ...rest } = config.modelProperties;
    this.client = new AzureOpenAI2({
      apiKey: config.apiKey,
      endpoint,
      ...rest
    });
    this.model = config.model || "text-embedding-3-small";
    this.embeddingDims = config.embeddingDims;
  }
  async embed(text) {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      ...this.embeddingDims !== void 0 && {
        dimensions: this.embeddingDims
      }
    });
    return response.data[0].embedding;
  }
  async embedBatch(texts) {
    const MAX_BATCH = 100;
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const chunk = texts.slice(i, i + MAX_BATCH);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: chunk,
        ...this.embeddingDims !== void 0 && {
          dimensions: this.embeddingDims
        }
      });
      allEmbeddings.push(
        ...response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
      );
    }
    if (allEmbeddings.length !== texts.length) {
      throw new Error(
        `Azure OpenAI embedBatch() returned ${allEmbeddings.length} embeddings for ${texts.length} texts using model '${this.model}'`
      );
    }
    return allEmbeddings;
  }
};

// src/oss/src/embeddings/fastembed.ts
var SUPPORTED_MODELS = [
  "fast-all-MiniLM-L6-v2",
  "fast-bge-base-en",
  "fast-bge-base-en-v1.5",
  "fast-bge-small-en",
  "fast-bge-small-en-v1.5",
  "fast-bge-small-zh-v1.5",
  "fast-multilingual-e5-large"
];
var DEFAULT_MODEL8 = "fast-bge-small-en-v1.5";
var FastEmbedEmbedder = class {
  constructor(config) {
    if (typeof config.model === "string" && config.model.length > 0) {
      if (!SUPPORTED_MODELS.includes(config.model)) {
        throw new Error(
          `Unsupported FastEmbed model "${config.model}". Supported models: ${SUPPORTED_MODELS.join(", ")}.`
        );
      }
      this.modelName = config.model;
    } else {
      this.modelName = DEFAULT_MODEL8;
    }
  }
  getEmbeddingModel() {
    if (!this.embeddingModel) {
      this.embeddingModel = this.initEmbeddingModel().catch((error) => {
        this.embeddingModel = void 0;
        throw error;
      });
    }
    return this.embeddingModel;
  }
  /**
   * Lazily import the optional `fastembed` peer and initialize the model, so
   * consumers that never touch FastEmbed don't need it installed.
   */
  async initEmbeddingModel() {
    const sdk = await loadPeer(
      "fastembed",
      "FastEmbed embedder",
      () => import("fastembed")
    );
    return sdk.FlagEmbedding.init({ model: this.modelName });
  }
  normalizeInput(text) {
    return text.replace(/\n/g, " ");
  }
  async embed(text) {
    const normalizedText = this.normalizeInput(text);
    const model = await this.getEmbeddingModel();
    for await (const batch of model.embed([normalizedText])) {
      const embedding = batch[0];
      if (embedding !== void 0) {
        return embedding;
      }
    }
    throw new Error("FastEmbed embed() returned no embeddings");
  }
  async embedBatch(texts) {
    const normalizedTexts = texts.map((text) => this.normalizeInput(text));
    const model = await this.getEmbeddingModel();
    const embeddings = [];
    for await (const batch of model.embed(normalizedTexts)) {
      embeddings.push(...batch);
    }
    return embeddings;
  }
};

// src/oss/src/prompts/index.ts
import { z as z2 } from "zod";
var factItem = z2.union([
  z2.string(),
  z2.object({ fact: z2.string() }).transform((o) => o.fact),
  z2.object({ text: z2.string() }).transform((o) => o.text)
]);
var FactRetrievalSchema = z2.object({
  facts: z2.array(factItem).transform((arr) => arr.filter((s) => s.length > 0)).describe("An array of distinct facts extracted from the conversation.")
});
var MemoryUpdateSchema = z2.object({
  memory: z2.array(
    z2.object({
      id: z2.string().describe("The unique identifier of the memory item."),
      text: z2.string().describe("The content of the memory item."),
      event: z2.enum(["ADD", "UPDATE", "DELETE", "NONE"]).describe(
        "The action taken for this memory item (ADD, UPDATE, DELETE, or NONE)."
      ),
      old_memory: z2.string().optional().nullable().describe(
        "The previous content of the memory item if the event was UPDATE."
      )
    })
  ).describe(
    "An array representing the state of memory items after processing new facts."
  )
});
var ADDITIVE_EXTRACTION_PROMPT = `
# ROLE

You are a Memory Extractor \u2014 a precise, evidence-bound processor responsible for extracting rich, contextual memories from conversations. Your sole operation is ADD: identify every piece of memorable information and produce self-contained, contextually rich factual statements.

You extract from BOTH user and assistant messages. User messages reveal personal facts, preferences, plans, and experiences. Assistant messages contain recommendations, plans, suggestions, and actionable information the user may later reference.

Accuracy and completeness are critical. Every piece of memorable information must be captured \u2014 a missed extraction means lost context that degrades future personalization. When a conversation covers multiple topics, extract each one separately. Do not let a dominant topic cause you to miss secondary information.

# INPUTS

## New Messages

The current conversation turn(s) with "role" (user/assistant) and "content".

Both roles contain extractable information:
- **User messages**: Personal facts, preferences, plans, experiences, things done / never done before, opinions, requests, implicit preferences revealed through questions
- **Assistant messages**: Specific recommendations given, plans or schedules created, information researched, solutions provided, agreements reached

Attribute correctly: use "User" for user-stated facts. For assistant-generated content, frame in terms of the user's context (e.g., "User was recommended X" or "User's plan includes X as discussed in conversation").

Do NOT extract:
- Vague assistant characterizations ("you seem passionate", "that sounds stressful") unless the user explicitly confirms them
- Generic assistant acknowledgments ("Sure!", "Great question!")
- Assistant meta-commentary about its own capabilities


## Summary

A narrative summary of the user's profile from prior conversations. May be empty for new users. Use it to enrich extractions \u2014 it holds established context like names, locations, and relationships.


## Recently Extracted Memories

Memories already captured from recent messages in this session (up to 20). This is your primary deduplication reference \u2014 do not re-extract information already captured here.


## Existing Memories

Memories currently in the system relevant to this conversation. Formatted as:
[{"id": "uuid-string", "text": "..."}, ...]

Use these ONLY for deduplication and linking \u2014 do NOT extract new memories from Existing Memories. Your extractions must come exclusively from New Messages. If new information in New Messages is semantically equivalent to an Existing Memory with no meaningful new context, skip it.

When a new memory is related to an Existing Memory \u2014 same topic, overlapping entities, updated/shifted preference, follow-up event, or continuation of a narrative \u2014 include the Existing Memory's ID in the new memory's "linked_memory_ids" array. Your ADD output IDs remain sequential ("0", "1", ...) but linked_memory_ids uses the UUIDs from this list.


IMPORTANT: An existing memory about an entity (e.g., "User has a dog named Max") does NOT mean all information about that entity has been captured. New events, activities, experiences, or details about a known entity MUST still be extracted as separate memories and linked back. Only skip extraction when the specific fact or event itself is already captured \u2014 not merely because the entity appears in an existing memory. "User has a dog named Max" and "User went on a camping trip with Max where they hiked and swam" are two distinct memories, not duplicates.


## Last k Messages

Recent messages (up to 20) preceding New Messages. Use to resolve references and pronouns in New Messages.


## Observation Date

When the conversation actually took place (e.g., "2023-05-24"). This is your ONLY temporal anchor for resolving time references.

Resolve ALL relative references against Observation Date:
- "yesterday" \u2192 day before Observation Date
- "last week" \u2192 week preceding Observation Date
- "next month" \u2192 month following Observation Date
- "recently" \u2192 shortly before Observation Date
- "just finished", "today" \u2192 on or near Observation Date

CRITICAL: "User went to Paris last week" is useless 6 months later. "User went to Paris the week of May 15, 2023" is meaningful forever. Always ground relative references to specific dates.


## Current Date

Today's system date. May be years after Observation Date. Do NOT use this to resolve temporal references in messages \u2014 only Observation Date grounds user and assistant statements.


## Optional Inputs

- **includes**: Topics to focus on
- **excludes**: Topics to skip
- **custom_instructions**: User-defined rules (highest priority)
- **feedback_str**: Adjust extraction based on this feedback


# GUIDELINES

## What to Extract

Extract ALL memorable information from both user and assistant messages. Think broadly:

**From user messages:**
- Personal details, preferences, plans, relationships, professional context
- Health/wellness, opinions, hobbies, emotional states
- Entity attributes (breed, model, color, make, size)
- Implicit preferences revealed through requests
- **Shared content and reference material** \u2014 when a user shares documents, case studies, articles, data, specifications, stat blocks, code, or any structured information, extract the key factual data FROM that content. The user shared it because they want it remembered.
- Firsts and milestones \u2014 'first call-out', 'just started', 'recently joined', etc.
- Specific foods, meals, and who was present (e.g. 'dinner with mom \u2014 salads, sandwiches, homemade desserts').
- Inspiration and motivation \u2014 what inspired someone to start something, who encouraged them.

**From assistant messages (ONLY when genuinely new):**
- Specific recommendations given (books, restaurants, products, services)
- Plans or schedules created for the user
- Information researched or provided (facts, instructions, solutions)
- Agreements reached during conversation
- **Personal facts, experiences, and details shared by named speakers** \u2014 in multi-speaker conversations, the "assistant" role may represent a real person sharing their own life (e.g., "Maria: I just got a new cat named Bailey"). Extract their personal information with the same rigor as user-stated facts, attributed to the speaker by name.

Do NOT extract from assistant messages that merely restate, summarize, or confirm what the user already said. The user's own words are the primary source \u2014 if the user said it and the assistant echoed it, extract only once from the user's version. Note: a single assistant message may contain BOTH an echo AND new personal facts \u2014 skip the echo portion but still extract the new facts.

Do NOT extract: greetings, filler, vague acknowledgments, or content too generic to be useful.

**When in doubt, extract.** A slightly redundant memory is far less costly than a missing one. The deduplication system downstream will handle true duplicates \u2014 your job is to ensure nothing meaningful is lost.

### Casual Topics Are Still Extractable

Conversations about pets, hobbies, childhood memories, funny anecdotes, and personal preferences are NOT "chitchat" to be skipped. In a personal memory system, these casual revelations are often the MOST valuable \u2014 someone's pet's name, a childhood activity with a parent, a funny incident, a new hobby. Only skip messages that are PURELY phatic ("Hi!", "Sounds good!", "Thanks!") with zero informational content.

### Extract Incidental Facts, Not Just Requests

When a user asks a question or makes a request, their message often contains INCIDENTAL PERSONAL FACTS stated as context. These facts are just as extractable as the request itself:

- "I've harvested cherry tomatoes from my garden \u2014 any companion plant suggestions?" \u2192 Extract BOTH "User grows cherry tomatoes in their garden"
- "I just started 'The Nightingale' by Kristin Hannah \u2014 can you recommend similar books?" \u2192 Extract BOTH "User started reading 'The Nightingale' by Kristin Hannah on [date]"
- "As an aspiring stand-up comedian, can you suggest Netflix comedy specials?" \u2192 Extract BOTH the career aspiration
- "My daughter Sara loves painting \u2014 where can I find kids' art classes?" \u2192 Extract "User has a daughter named Sara who loves painting"

Do NOT let the request overshadow the facts. A question about companion plants is transient; the fact that the user grows cherry tomatoes is a persistent personal detail worth remembering.

**IMPORTANT \u2014 Extract ALL dimensions of a conversation.** A single session may contain career facts, entertainment preferences, scheduled plans, and personal opinions. Extract each dimension as a separate memory. Do not let one dominant topic cause you to miss secondary information.

### Shared Photos and Images

When a message contains a photo description (e.g., "[Shared photo: ...]" or describes sharing/showing an image), extract factual information from BOTH the surrounding conversation text AND the photo description. The photo description provides visual context that may contain important details:

- A photo of a group at a park \u2192 extract the activity (e.g., "had a picnic at the park")
- A photo showing a specific object, place, or person \u2192 extract what is depicted
- A photo with visible text (signs, posters, book covers) \u2192 extract the text content

## Memory Quality Standards

### Contextually Rich, Not Atomic
Capture the full picture \u2014 fact AND surrounding context \u2014 in a single unified memory, not scattered fragments.

Bad: "User has a dog" | Good: "User has a dog named Poppy and their morning walks together are the highlight of their day"

This applies especially to **transitions and changes**. When the user describes changing, switching, replacing, stopping, or trying something new in place of something else, the memory MUST capture the transition \u2014 what the new state is AND what it replaces or changes from. The relationship between old and new is critical context. Without it, the system has an isolated new fact with no understanding of what changed.

Bad: "User prefers oat milk lattes"
Good: "User switched from almond milk to oat milk lattes after developing an almond sensitivity"

Bad: "User is taking online Spanish classes on Wednesdays"
Good: "User switched from in-person French classes to online Spanish classes on Wednesdays after relocating"

When the change is explicitly temporary or a trial, capture that too \u2014 "for a month", "trying out", "testing" \u2014 these signal the old arrangement may resume.

### Clean Factual Statements
Preserve the FULL meaning including emotional reactions, motivations, and subjective experiences. Remove filler words and conversation mechanics (greetings, "like", "you know"), but KEEP:
- Emotional states: "scared but reassured", "happy and thankful", "liberated and empowered"
- Motivations and reasons: "motivated by her own journey and the support she received"
- Subjective descriptions: "resilient", "therapeutic", "nerve-wracking"

### Self-Contained
Every memory must be understandable on its own. Replace all pronouns with specific names or "User."

### Concise but Complete (15-80 words, up to 100 for detail-rich content)
1-2 sentences per memory (up to 3 for content with multiple proper nouns, specific quantities, or enumerated items). When a topic has too many details, split into multiple focused memories rather than compressing details away. NEVER sacrifice a proper noun, title, date, or specific detail to meet a word count \u2014 completeness beats brevity.

### Temporally Grounded
Preserve exact dates, durations, and temporal relationships. Convert relative \u2192 absolute using Observation Date (NOT Current Date). NEVER convert absolute \u2192 vague. "18 days" stays "18 days", not "some time."

### Numerically Precise
Preserve exact quantities as stated. "416 pages" stays "416 pages", not "about 400 pages."

### Preserve Specific Details \u2014 Never Generalize Concrete Information

When information contains specific details \u2014 whether quantities, identifiers, descriptions, visual details, quoted text, named objects, proper nouns, or any concrete information \u2014 those specifics MUST survive extraction. Replacing a specific detail with a vague category is a critical error.

#### Proper Nouns and Titles Should be Preserved

Book titles, movie titles, game names, song titles, restaurant names, neighborhood names, brand names, character names, and named places are the HIGHEST-VALUE details in a memory. Users search by name \u2014 a memory without the name is unfindable. ALWAYS preserve exact proper nouns:

- "watched 'Eternal Sunshine of the Spotless Mind'" \u2192 KEEP the full title
- "went to Woodhaven for a road trip" \u2192 KEEP "Woodhaven"
- "tried the new restaurant Osteria Francescana" \u2192 KEEP "Osteria Francescana", NOT "a new restaurant"
- "reading 'A Court of Thorns and Roses'" \u2192 KEEP the title in quotes, NOT "a fantasy book"
- "his favorite character is Aragorn from Lord of the Rings" \u2192 KEEP "Aragorn" and "Lord of the Rings"

#### Qualifiers and Specific Attributes Are Essential

Never generalize specific qualifiers. The qualifier is almost always the detail that matters most for recall:

- "promoted to assistant manager" \u2192 KEEP "assistant manager", NOT "manager"
- "ordered grilled salmon and roasted vegetables" \u2192 KEEP "grilled salmon and roasted vegetables", NOT "healthy meal"
- "started doing aerial yoga" \u2192 KEEP "aerial yoga", NOT "yoga" or "a workout class"
- "painted a forest scene in watercolors" \u2192 KEEP "a forest scene in watercolors", NOT "started painting"
- "drove a Ferrari 488 GTB" \u2192 KEEP "Ferrari 488 GTB", NOT "sports car"
- "scored 3 goals in the semifinal" \u2192 KEEP "3 goals in the semifinal", NOT "scored several goals"
- "walks her dogs multiple times a day" \u2192 KEEP "multiple times a day", NOT "regularly" or "daily"

If the input is specific, the memory must be equally specific. The concrete details are precisely what distinguishes a useful memory from a useless one. NEVER replace a specific noun, number, title, or description with a vague category or paraphrase \u2014 this destroys the information the user actually shared.

### Meaning-Preserving
Capture the EXACT meaning of what was said. Read carefully:
- "Didn't get to bed until 2 AM" = went TO BED at 2 AM (late bedtime), NOT "slept until 2 AM" (late wakeup)
- "Can't stop eating chocolate" = eats a lot of chocolate, NOT has stopped eating chocolate
- "I used to love hiking" = no longer loves hiking, NOT currently loves hiking

Misinterpreting the user's words is worse than not extracting at all.


## Integrity Rules

- **No Fabrication**: Every detail must trace to the inputs. If you can't point to where it came from, don't include it.
- **No Implicit Attribute Inference**: Don't infer gender, age, ethnicity, etc. from names or context. Only record explicitly stated attributes.
- **Correct Attribution**: Distinguish user-stated facts from assistant-provided information. Frame assistant content appropriately.
- **No Echo Extraction**: When an assistant message restates, summarizes, or confirms information the user already provided in the same conversation, do NOT extract it again from the assistant's message. Only extract from assistant messages when they contribute genuinely NEW information not already present in the user's messages \u2014 specific recommendations, newly created plans or schedules, researched facts, or solutions the assistant provided that the user did not state themselves. If the user says "I want daily check-ins at 7:30 AM" and the assistant responds "I've set up daily check-ins at 7:30 AM", that is already captured from the user's message \u2014 do not extract a second memory from the assistant's echo.
- **No Within-Response Duplication**: Each piece of information must appear exactly ONCE in your output, regardless of how many messages mention it. Before finalizing your output, review your extractions and remove any that are semantically equivalent to another extraction in the same response. Two memories about the same fact phrased differently are redundant \u2014 keep the richer one and drop the other.
- **No Meta-Extraction**: Extract the CONTENT of what was shared, not a description of the user's action. When a user shares a document, data, or reference material, extract the actual facts FROM that material.
  - WRONG: "User asked for the introductory paragraph to be shortened" / "User shared a case summary for optimization"
  - RIGHT: "The Bajimaya v Reward Homes case involved construction starting in 2014, contract signed in 2015, with completion due by October 2015" / "The tribunal found Reward Homes breached its contract through poor workmanship, waterproofing defects, and non-compliance with the Building Code of Australia"
  - WRONG: "Assistant created a D&D adventure with enemies"
  - RIGHT: "The Lost Temple of the Djinn adventure includes 4 Mummies (AC 11, 45 HP), 2 Construct Guardians (AC 17, 110 HP), and 6 Skeletal Warriors (AC 12, 22 HP)"
- **No Detail Contamination from Context**: When extracting from New Messages, do NOT import or merge details from Existing Memories or Recent Memories into the new extraction UNLESS the new message explicitly references those details. If the New Message says "I had a great meal" and an Existing Memory says "User's favorite restaurant is Olive Garden," do NOT produce "User had a great meal at Olive Garden" \u2014 the new message never mentioned the restaurant. Each extraction must be faithful to its source message only.


## Memory Linking

When extracting a new memory, check if it relates to any Existing Memory. Add related Existing Memory IDs to "linked_memory_ids". Link when:

- **Same entity/topic**: New fact about a person, place, or thing already mentioned
- **Updated preference**: A changed or evolved opinion on something previously captured
- **Continuation**: Follow-up event or next step in a previously captured narrative
- **Contradiction**: New information that conflicts with an existing memory

Do NOT link memories that merely share a vague theme. Links should be specific and meaningful \u2014 the linked memories should be about the same specific entity, event, or topic. If no existing memories are related, omit linked_memory_ids or pass an empty array.


# EXAMPLES


## Example 1: Multi-Topic Extraction

Summary: ""
Recently Extracted: []
Existing Memories: []
New Messages:
[{"role": "user", "content": "Hey! I'm Marcus. I just got promoted to Senior Engineer at Shopify last week - been grinding for two years for this. My wife Elena and I celebrated with dinner at Osteria Francescana, it's our go-to spot for special occasions. We're also expecting our first baby in March!"},
 {"role": "assistant", "content": "Congratulations on everything, Marcus! What exciting times."}]
Observation Date: 2025-08-19

Output:
{"memory": [
  {"id": "0", "text": "User's name is Marcus and was promoted to Senior Engineer at Shopify around August 12, 2025 after working toward it for two years"},
  {"id": "1", "text": "Marcus has a wife named Elena and they celebrate special occasions at Osteria Francescana, their go-to restaurant"},
  {"id": "2", "text": "Marcus and his wife Elena are expecting their first baby in March 2026"}
]}

Three distinct topics \u2014 career, relationship/dining, family milestone \u2014 each get their own memory with full context.


## Example 2: Extracting from Assistant Recommendations

Summary: "User is an aspiring stand-up comedian interested in improving their craft."
Recently Extracted: []
Existing Memories: []
New Messages:
[{"role": "user", "content": "Can you recommend some sports documentaries on Netflix with strong storytelling? I love \\"The Last Dance\\" by Michael Jordan."},
 {"role": "assistant", "content": "Great taste! Here are some Netflix documentaries known for their storytelling: 1) \\"Formula 1: Drive to Survive\\" (behind the scenes of Formula 1 racing) 2) \\"Athlete A\\" (investigative look at USA Gymnastics) 3) \\"The Battered Bastards of Baseball\\" (independent baseball story). All focus on powerful, narrative-driven sports stories."}]
Observation Date: 2023-06-01

Output:
{"memory": [
  {"id": "0", "text": "User enjoys watching sports documentaries on Netflix with strong storytelling, such as 'The Last Dance' featuring Michael Jordan"},
  {"id": "1", "text": "User was recommended the following sports documentaries on Netflix for storytelling: 'Formula 1: Drive to Survive', 'Athlete A', and 'The Battered Bastards of Baseball'"}
]}

The user's viewing preference (Netflix stand-up comedy) is extracted alongside the assistant's specific recommendations. Both are valuable for future personalization.


## Example 3: Nothing to Extract

Summary: "User is a product manager named David."
Existing Memories: [{"id": "0", "text": "David is a product manager at a fintech startup"}]
New Messages:
[{"role": "user", "content": "Hey, good morning!"},
 {"role": "assistant", "content": "Good morning, David! How can I help you today?"}]
Observation Date: 2025-08-19

Output: {"memory": []}

## Example 5: Deduplication \u2014 Skip Already Captured

Recently Extracted: ["Marcus was promoted to Senior Engineer at Shopify around August 12, 2025"]
Existing Memories: [{"id": "0", "text": "Marcus was promoted to Senior Engineer at Shopify around August 12, 2025"}]
New Messages:
[{"role": "user", "content": "Still can't believe I got the senior engineer promotion at Shopify!"}]
Observation Date: 2025-08-19

Output: {"memory": []}


## Example 6: Extract ALL Dimensions \u2014 Don't Miss Secondary Info

Summary: "User is an aspiring actor."
Recently Extracted: []
Existing Memories: []
New Messages:
[{"role": "user", "content": "As an aspiring actor, I'm looking for advice on improving my craft. Can you recommend some films on Netflix with strong acting performances like Daniel Day-Lewis in 'There Will Be Blood'? I also want to find online resources for acting techniques."},
 {"role": "assistant", "content": "For Netflix films with great acting, check out 'Marriage Story' and 'The Irishman'. For acting techniques, I'd recommend 'An Actor Prepares' by Stanislavski and the MasterClass by Helen Mirren."}]
Observation Date: 2023-06-01

Output:
{"memory": [
  {"id": "0", "text": "User is an aspiring actor seeking to improve their craft through studying films with strong performances and acting technique resources"},
  {"id": "1", "text": "User enjoys watching films on Netflix with outstanding acting, especially performances like Daniel Day-Lewis in 'There Will Be Blood'"},
  {"id": "2", "text": "User was recommended 'Marriage Story' and 'The Irishman' for performance study, 'An Actor Prepares' by Stanislavski, and Helen Mirren's MasterClass for acting techniques"}
]}

Three dimensions: (1) career aspiration, (2) entertainment viewing preference, (3) specific recommendations. Each extracted separately.


## Example 7: Vague Temporal References with Historical Observation Date

Recently Extracted: ["User started reading 'The Hitchhiker's Guide to the Galaxy' on January 16, 2022"]
Existing Memories: [{"id": "0", "text": "User started reading 'The Hitchhiker's Guide to the Galaxy' on January 16, 2022"}]
New Messages:
[{"role": "user", "content": "I've actually listened to Ready Player One as an audiobook recently and enjoyed the pop culture references."}]
Observation Date: 2022-01-16
Current Date: 2026-02-18

Output:
{"memory": [{"id": "0", "text": "User listened to the Ready Player One audiobook around early January 2022 and enjoyed the pop culture references"}]}

"Recently" is grounded to the Observation Date (January 2022), NOT Current Date (February 2026). The Hitchhiker's Guide memory already exists \u2014 not re-extracted.


## Example 8: Document / Reference Material \u2014 Extract Content, Not Actions

Summary: ""
Recently Extracted: []
Existing Memories: []
New Messages:
[{"role": "user", "content": "I want you to remember this case. If you understand, just say acknowledged. Bajimaya v Reward Homes Pty Ltd [2021] NSWCATAP 297 \u2014 The construction began in 2014, contract signed in 2015 with completion due by October 2015. The plaintiff received keys in December 2016 and found defects including incomplete works, poor workmanship, and non-compliance with the building code. The tribunal found the builder breached contract."},
 {"role": "assistant", "content": "Acknowledged."}]
Observation Date: 2024-03-10

Output:
{"memory": [
  {"id": "0", "text": "Bajimaya v Reward Homes Pty Ltd [2021] NSWCATAP 297: construction of the home began in 2014, contract signed in 2015, with completion due by October 2015. Keys were delivered in December 2016."},
  {"id": "1", "text": "In Bajimaya v Reward Homes, the plaintiff found defects including incomplete works, poor workmanship, and non-compliance with the Building Code of Australia after receiving the home in December 2016."},
  {"id": "2", "text": "The tribunal found Reward Homes Pty Ltd breached its contract with Mr. Bajimaya by failing to complete work in a proper and workmanlike manner and failing to comply with plans, specifications, and the Building Code."}
]}

The user shared reference material to be remembered. Extract the actual factual content \u2014 dates, parties, findings \u2014 NOT "User shared a case summary" or "User asked to remember a case."


## Example 9: Structured Data with Counts and Specifics

Summary: ""
Recently Extracted: []
Existing Memories: []
New Messages:
[{"role": "user", "content": "Here are the enemy stat blocks for our D&D campaign: Mummies (4): AC 11, HP 45, Speed 20 ft, with Curse of the Pharaohs (DC 15 Wisdom) and Mummy Rot (DC 15 Constitution). Construct Guardians (2): AC 17, HP 110, Speed 30 ft, with Immutable Form, Magic Resistance, and Siege Monster. Skeletal Warriors (6): AC 12, HP 22, Speed 30 ft, with Undead Fortitude."},
 {"role": "assistant", "content": "Got it! I've noted all the stat blocks. Ready when you want to start the encounter."}]
Observation Date: 2024-01-15

Output:
{"memory": [
  {"id": "0", "text": "User's D&D campaign encounter includes 4 Mummies (AC 11, 45 HP, Speed 20 ft) with Curse of the Pharaohs (DC 15 Wisdom save) and Mummy Rot (DC 15 Constitution save)"},
  {"id": "1", "text": "User's D&D campaign encounter includes 2 Construct Guardians (AC 17, 110 HP, Speed 30 ft) with Immutable Form, Magic Resistance, and Siege Monster traits"},
  {"id": "2", "text": "User's D&D campaign encounter includes 6 Skeletal Warriors (AC 12, 22 HP, Speed 30 ft) with the Undead Fortitude trait"}
]}

Every count (4 Mummies, 2 Construct Guardians, 6 Skeletal Warriors) and every specific value (AC, HP, DCs, trait names) is preserved. Dropping the counts or stat values would destroy the most queryable information.


## Example 10: Memory Linking \u2014 Connecting Related Memories

Summary: ""
Recently Extracted: []
Existing Memories: [{"id": "a1b2c3d4-5678-9abc-def0-111111111111", "text": "User has a dog named Poppy, a golden retriever"}, {"id": "b2c3d4e5-6789-abcd-ef01-222222222222", "text": "User works as a Senior Engineer at Shopify"}]
New Messages:
[{"role": "user", "content": "Poppy had her vet checkup yesterday \u2014 she's healthy but needs to lose a few pounds. Also, I'm switching teams at work next month to the payments platform."}]
Observation Date: 2025-03-15

Output:
{"memory": [
  {"id": "0", "text": "User's dog Poppy had a vet checkup around March 14, 2025, is healthy but needs to lose weight", "linked_memory_ids": ["a1b2c3d4-5678-9abc-def0-111111111111"]},
  {"id": "1", "text": "User is switching teams at Shopify to the payments platform in April 2025", "linked_memory_ids": ["b2c3d4e5-6789-abcd-ef01-222222222222"]}
]}

Both new memories link to related existing memories \u2014 the vet checkup links to the existing Poppy memory, and the team switch links to the existing Shopify memory. This enables the system to build a graph of related memories.


## Example 11: Long Multi-Topic Conversation \u2014 Don't Stop After First Topic

Summary: ""
Recently Extracted: []
Existing Memories: []
New Messages:
[{"role": "user", "content": "I adopted a puppy named Max last weekend! He's a beagle mix."},
 {"role": "assistant", "content": "Congratulations! How's he settling in?"},
 {"role": "user", "content": "Great! Oh, and I also started pottery classes on Tuesdays. Made a mug with my daughter's face on it."},
 {"role": "assistant", "content": "Fun! Sounds like a lot going on."},
 {"role": "user", "content": "Yeah \u2014 my sister just moved to Portland too. I'm happy but honestly a bit overwhelmed. My boss gave me a promotion to team lead last week as well."}]
Observation Date: 2025-03-10

Output:
{"memory": [
  {"id": "0", "text": "User adopted a beagle mix puppy named Max around March 1-2, 2025"},
  {"id": "1", "text": "User started taking pottery classes on Tuesdays"},
  {"id": "2", "text": "User made a ceramic mug with their daughter's face on it in pottery class"},
  {"id": "3", "text": "User's sister recently moved to Portland"},
  {"id": "4", "text": "User was promoted to team lead around March 3, 2025, and feels happy but overwhelmed about all the recent changes"}
]}

FIVE topics across 5 messages \u2014 each one extracted separately. Do not stop after the first topic (the puppy). The pottery mug detail, the sister's move, and the emotional reaction to the promotion are all distinct, extractable facts.


## Example 12: Multi-Speaker Conversation \u2014 Extract From ALL Speakers

Summary: "John has a dog named Max."
Recently Extracted: []
Existing Memories: [{"id": "a1b2c3d4-0000-0000-0000-111111111111", "text": "John has a dog named Max"}]
New Messages:
[{"role": "user", "content": "John: Max and I had a blast on our camping trip last summer. We hiked, swam, and made great memories. It was a really peaceful experience."},
 {"role": "assistant", "content": "Maria: That sounds amazing! I actually just got a new cat named Bailey last week \u2014 she's been such a joy already. Camping with pets is so soul-nourishing."},
 {"role": "user", "content": "John: Congrats on Bailey! Here's a picture of my family too \u2014 that was from a trip we took for my daughter Sara's birthday last fall."}]
Observation Date: 2023-08-11

Output:
{"memory": [
  {"id": "0", "text": "John and his dog Max went on a camping trip in the summer of 2023 where they hiked, swam, and found it a peaceful experience", "linked_memory_ids": ["a1b2c3d4-0000-0000-0000-111111111111"]},
  {"id": "1", "text": "Maria got a new cat named Bailey around early August 2023 and describes her as a joy"},
  {"id": "2", "text": "John has a daughter named Sara and the family took a trip for her birthday in fall 2022"}
]}

Three key lessons: (1) The existing memory "John has a dog named Max" does NOT mean all Max-related information is captured \u2014 the camping trip is a new event with specific activities (hiking, swimming) and must be extracted and linked. (2) Maria is a named speaker in the "assistant" role but shares a genuine personal fact (new cat Bailey) \u2014 this MUST be extracted with the same rigor as user facts. Her echo ("that sounds amazing", "camping is soul-nourishing") is correctly skipped, but her personal fact is not. (3) Sara's name and the birthday trip are separate factual details that each deserve their own extraction.


# CRITICAL: Exhaustive Extraction Checklist

Before producing output, mentally scan the ENTIRE conversation \u2014 every single message \u2014 and verify:
1. Have you extracted at least one memory from every distinct topic or subject change in the conversation?
2. Have you extracted facts from messages in the MIDDLE and END of the conversation, not just the beginning?
3. For conversations with 10+ messages, you should typically extract 5-15 memories. If you have fewer than 3, re-read the conversation \u2014 you are almost certainly missing information.
4. Re-read each user message individually: does EVERY specific fact, preference, experience, or event mentioned in that message have a corresponding extraction? If a single message mentions two distinct facts (e.g., an allergy AND a hobby), both must be captured.

A common failure mode is "first topic dominance" \u2014 the extractor captures the first major topic thoroughly, then treats subsequent topics as filler. This is WRONG. Every topic mentioned deserves extraction if it contains memorable facts. If a chunk has 8 messages covering 4 different topics, you MUST produce memories for all 4 topics \u2014 not just the first or most prominent one.


# OUTPUT FORMAT

Return ONLY valid JSON parsable by json.loads(). No text, reasoning, explanations, or wrappers.

## Structure

{
  "memory": [
    {"id": "0", "text": "First extracted memory", "attributed_to": "user", "linked_memory_ids": ["uuid-of-related-existing-memory"]},
    {"id": "1", "text": "Second extracted memory", "attributed_to": "assistant"}
  ]
}

## Fields

- **id** (string, required): Sequential integers as strings starting at "0".
- **text** (string, required): A contextually rich, self-contained factual statement (15-80 words).
- **attributed_to** (string, required): Who this memory is about. Use "user" for facts stated by or about the user (preferences, plans, personal facts). Use "assistant" for information provided by the assistant (recommendations, confirmations, plans created, information researched).
- **linked_memory_ids** (array of strings, optional): IDs of Existing Memories that this new memory relates to. Use the exact IDs from the Existing Memories list. Omit or pass [] if no existing memories are related.

## Rules

- Extract every piece of memorable information as a separate memory object.
- If nothing is worth extracting, return: {"memory": []}
- No duplicate IDs. Use double quotes. No trailing commas.

`;
var AGENT_CONTEXT_SUFFIX = `

## Entity Context

The primary entity is an AI agent. Frame memories from the agent's perspective:
- For user-stated facts, frame as agent knowledge: "Agent was informed that [fact]" or "Agent learned that [fact]"
- For agent actions, use direct statements: "Agent recommended [X]" or "Agent specializes in [domain]"
- For agent configuration or instructions, capture directly: "Agent is configured to [behavior]"

The attributed_to field should still reflect the original source: "user" for facts the user stated, "assistant" for things the agent said or did.
`;
var AdditiveExtractionSchema = z2.object({
  memory: z2.array(
    z2.object({
      id: z2.string(),
      text: z2.string(),
      attributed_to: z2.enum(["user", "assistant"]).optional(),
      linked_memory_ids: z2.array(z2.string()).optional()
    })
  )
});
var PAST_MESSAGE_TRUNCATION_LIMIT = 300;
function truncateContent(text, limit = PAST_MESSAGE_TRUNCATION_LIMIT) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}
function formatConversationHistory(messages) {
  var _a2, _b2;
  if (!messages || messages.length === 0) return "";
  let result = "";
  for (const msg of messages) {
    const role = (_a2 = msg.role) != null ? _a2 : "";
    const content = (_b2 = msg.content) != null ? _b2 : "";
    if (role && content) {
      result += `${role}: ${truncateContent(content)}
`;
    }
  }
  return result;
}
function serializeMemories(memories) {
  return JSON.stringify(memories != null ? memories : []);
}
function generateAdditiveExtractionPrompt(options) {
  var _a2, _b2, _c;
  const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const currentDate = (_a2 = options.currentDate) != null ? _a2 : now;
  const observationDate = (_b2 = options.observationDate) != null ? _b2 : currentDate;
  const sections = [];
  sections.push("## Summary\n");
  sections.push(
    `## Last k Messages
${formatConversationHistory(options.lastKMessages)}`
  );
  sections.push("## Recently Extracted Memories\n[]");
  sections.push(
    `## Existing Memories
${serializeMemories(options.existingMemories)}`
  );
  sections.push(`## New Messages
${(_c = options.newMessages) != null ? _c : "[]"}`);
  sections.push(`## Observation Date
${observationDate}`);
  sections.push(`## Current Date
${currentDate}`);
  if (options.customInstructions) {
    sections.push(`## Custom Instructions
${options.customInstructions}`);
  }
  sections.push("# Output:");
  return sections.join("\n\n");
}
function removeCodeBlocks(text) {
  const stripped = text.replace(/```(?:\w+)?\n?([\s\S]*?)(?:```|$)/g, "$1").trim();
  return stripped.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
function extractJson(text) {
  let cleaned = text.replace(/<\|end_of_text\|>/g, "").replace(/<\|eot_id\|>/g, "").replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "").replace(/<\|endoftext\|>/g, "");
  cleaned = removeCodeBlocks(cleaned);
  const trimmed = cleaned.trim();
  if (!trimmed) return "";
  const braceIndices = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{") braceIndices.push(i);
  }
  for (const start of braceIndices) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.substring(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch (e) {
            break;
          }
        }
      }
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {
    }
  }
  const bracketIndices = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "[") bracketIndices.push(i);
  }
  for (const start of bracketIndices) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "[") depth++;
      else if (char === "]") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.substring(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch (e) {
            break;
          }
        }
      }
    }
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.substring(firstBracket, lastBracket + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {
    }
  }
  return trimmed;
}

// src/oss/src/llms/langchain.ts
var convertToLangchainMessages = async (messages) => {
  const { AIMessage, HumanMessage, SystemMessage } = await import("@langchain/core/messages");
  return messages.map((msg) => {
    var _a2;
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    switch ((_a2 = msg.role) == null ? void 0 : _a2.toLowerCase()) {
      case "system":
        return new SystemMessage(content);
      case "user":
      case "human":
        return new HumanMessage(content);
      case "assistant":
      case "ai":
        return new AIMessage(content);
      default:
        console.warn(
          `Unsupported message role '${msg.role}' for Langchain. Treating as 'human'.`
        );
        return new HumanMessage(content);
    }
  });
};
var LangchainLLM = class {
  constructor(config) {
    if (!config.model || typeof config.model !== "object") {
      throw new Error(
        "Langchain provider requires an initialized Langchain instance passed via the 'model' field in the LLM config."
      );
    }
    if (typeof config.model.invoke !== "function") {
      throw new Error(
        "Provided Langchain 'instance' in the 'model' field does not appear to be a valid Langchain language model (missing invoke method)."
      );
    }
    this.llmInstance = config.model;
    this.modelName = this.llmInstance.modelId || this.llmInstance.model || "langchain-model";
  }
  async generateResponse(messages, response_format, tools) {
    var _a2, _b2, _c, _d, _e;
    const langchainMessages = await convertToLangchainMessages(messages);
    let runnable = this.llmInstance;
    const invokeOptions = {};
    let isStructuredOutput = false;
    let selectedSchema = null;
    const systemPromptContent = ((_a2 = messages.find((m) => m.role === "system")) == null ? void 0 : _a2.content) || "";
    const userPromptContent = ((_b2 = messages.find((m) => m.role === "user")) == null ? void 0 : _b2.content) || "";
    if (systemPromptContent.includes("Personal Information Organizer") && systemPromptContent.includes("extract relevant pieces of information")) {
      selectedSchema = FactRetrievalSchema;
    } else if (userPromptContent.includes("smart memory manager") && userPromptContent.includes("Compare newly retrieved facts")) {
      selectedSchema = MemoryUpdateSchema;
    }
    if (selectedSchema && typeof this.llmInstance.withStructuredOutput === "function") {
      try {
        runnable = this.llmInstance.withStructuredOutput(
          selectedSchema,
          { name: (_c = tools == null ? void 0 : tools[0]) == null ? void 0 : _c.function.name }
        );
        isStructuredOutput = true;
      } catch (e) {
        isStructuredOutput = false;
        if ((response_format == null ? void 0 : response_format.type) === "json_object") {
          invokeOptions.response_format = { type: "json_object" };
        }
      }
    } else if (selectedSchema && (response_format == null ? void 0 : response_format.type) === "json_object") {
      if (((_d = this.llmInstance._identifyingParams) == null ? void 0 : _d.response_format) || this.llmInstance.response_format) {
        invokeOptions.response_format = { type: "json_object" };
      }
    } else if (!selectedSchema && (response_format == null ? void 0 : response_format.type) === "json_object") {
      if (((_e = this.llmInstance._identifyingParams) == null ? void 0 : _e.response_format) || this.llmInstance.response_format) {
        invokeOptions.response_format = { type: "json_object" };
      }
    }
    if (tools && tools.length > 0) {
      if (typeof runnable.bindTools === "function") {
        try {
          runnable = runnable.bindTools(tools);
        } catch (e) {
        }
      } else {
      }
    }
    try {
      const response = await runnable.invoke(langchainMessages, invokeOptions);
      if (isStructuredOutput) {
        return JSON.stringify(response);
      } else if (response && response.tool_calls && Array.isArray(response.tool_calls)) {
        const mappedToolCalls = response.tool_calls.map((call) => ({
          name: call.name || "unknown_tool",
          arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args)
        }));
        return {
          content: response.content || "",
          role: "assistant",
          toolCalls: mappedToolCalls
        };
      } else if (response && typeof response.content === "string") {
        return response.content;
      } else {
        return JSON.stringify(response);
      }
    } catch (error) {
      throw error;
    }
  }
  async generateChat(messages) {
    const langchainMessages = await convertToLangchainMessages(messages);
    try {
      const response = await this.llmInstance.invoke(langchainMessages);
      if (response && typeof response.content === "string") {
        return {
          content: response.content,
          role: response.lc_id ? "assistant" : "assistant"
        };
      } else {
        console.warn(
          `Unexpected response format from Langchain instance (${this.modelName}) for generateChat:`,
          response
        );
        return {
          content: JSON.stringify(response),
          role: "assistant"
        };
      }
    } catch (error) {
      console.error(
        `Error invoking Langchain instance (${this.modelName}) for generateChat:`,
        error
      );
      throw error;
    }
  }
};

// src/oss/src/embeddings/langchain.ts
var LangchainEmbedder = class {
  // Some LC embedders have batch size
  constructor(config) {
    if (!config.model || typeof config.model !== "object") {
      throw new Error(
        "Langchain embedder provider requires an initialized Langchain Embeddings instance passed via the 'model' field in the embedder config."
      );
    }
    if (typeof config.model.embedQuery !== "function" || typeof config.model.embedDocuments !== "function") {
      throw new Error(
        "Provided Langchain 'instance' in the 'model' field does not appear to be a valid Langchain Embeddings instance (missing embedQuery or embedDocuments method)."
      );
    }
    this.embedderInstance = config.model;
    this.batchSize = this.embedderInstance.batchSize;
  }
  async embed(text) {
    try {
      return await this.embedderInstance.embedQuery(text);
    } catch (error) {
      console.error("Error embedding text with Langchain Embedder:", error);
      throw error;
    }
  }
  async embedBatch(texts) {
    try {
      return await this.embedderInstance.embedDocuments(texts);
    } catch (error) {
      console.error("Error embedding batch with Langchain Embedder:", error);
      throw error;
    }
  }
};

// src/oss/src/embeddings/huggingface.ts
import OpenAI5 from "openai";
var HuggingFaceEmbedder = class {
  constructor(config) {
    const baseURL = config.huggingfaceBaseUrl || config.baseURL || config.url || process.env.HUGGINGFACE_BASE_URL;
    if (!baseURL) {
      throw new Error(
        "HuggingFace embedder requires an inference endpoint. Set `huggingfaceBaseUrl` (or `baseURL`) in the embedder config, or the HUGGINGFACE_BASE_URL environment variable (e.g. a TEI server at http://localhost:8080/v1)."
      );
    }
    this.openai = new OpenAI5({
      apiKey: config.apiKey || process.env.HUGGINGFACE_API_KEY || "hf",
      baseURL
    });
    this.model = config.model || "tei";
  }
  async embed(text) {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text
    });
    if (!response.data || response.data.length === 0) {
      throw new Error(
        `HuggingFace embed() returned no embeddings for model '${this.model}'`
      );
    }
    return response.data[0].embedding;
  }
  async embedBatch(texts) {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: texts
    });
    const embeddings = response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (embeddings.length !== texts.length) {
      throw new Error(
        `HuggingFace embedBatch() returned ${embeddings.length} embeddings for ${texts.length} texts using model '${this.model}'`
      );
    }
    return embeddings;
  }
};

// src/oss/src/vector_stores/langchain.ts
var LangchainVectorStore = class {
  // Simple in-memory user ID
  constructor(config) {
    this.storeUserId = "anonymous-langchain-user";
    var _a2, _b2;
    if (!config.client || typeof config.client !== "object") {
      throw new Error(
        "Langchain vector store provider requires an initialized Langchain VectorStore instance passed via the 'client' field."
      );
    }
    if (typeof config.client.addVectors !== "function" || typeof config.client.similaritySearchVectorWithScore !== "function") {
      throw new Error(
        "Provided Langchain 'client' does not appear to be a valid Langchain VectorStore (missing addVectors or similaritySearchVectorWithScore method)."
      );
    }
    this.lcStore = config.client;
    this.dimension = config.dimension;
    if (!this.dimension && ((_a2 = this.lcStore.embeddings) == null ? void 0 : _a2.embeddingDimension)) {
      this.dimension = this.lcStore.embeddings.embeddingDimension;
    }
    if (!this.dimension && ((_b2 = this.lcStore.embedding) == null ? void 0 : _b2.embeddingDimension)) {
      this.dimension = this.lcStore.embedding.embeddingDimension;
    }
    if (!this.dimension) {
      console.warn(
        "LangchainVectorStore: Could not determine embedding dimension. Input validation might be skipped."
      );
    }
  }
  // --- Method Mappings ---
  async insert(vectors, ids, payloads) {
    if (!ids || ids.length !== vectors.length) {
      throw new Error(
        "IDs array must be provided and have the same length as vectors."
      );
    }
    if (this.dimension) {
      vectors.forEach((v, i) => {
        if (v.length !== this.dimension) {
          throw new Error(
            `Vector dimension mismatch at index ${i}. Expected ${this.dimension}, got ${v.length}`
          );
        }
      });
    }
    const { Document } = await import("@langchain/core/documents");
    const documents = payloads.map((payload, i) => {
      return new Document({
        pageContent: "",
        // Add required empty pageContent
        metadata: { ...payload, _mem0_id: ids[i] }
      });
    });
    try {
      await this.lcStore.addVectors(vectors, documents, { ids });
    } catch (e) {
      console.warn(
        "Langchain store might not support custom IDs on insert. Trying without IDs.",
        e
      );
      await this.lcStore.addVectors(vectors, documents);
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    if (this.dimension && query.length !== this.dimension) {
      throw new Error(
        `Query vector dimension mismatch. Expected ${this.dimension}, got ${query.length}`
      );
    }
    const results = await this.lcStore.similaritySearchVectorWithScore(
      query,
      topK
      // Do not pass lcFilter here
    );
    return results.map(([doc, score]) => ({
      id: doc.metadata._mem0_id || "unknown_id",
      payload: doc.metadata,
      score
    }));
  }
  // --- Methods with No Direct Langchain Equivalent (Throwing Errors) ---
  async get(vectorId) {
    console.error(
      `LangchainVectorStore: The 'get' method is not directly supported by most Langchain VectorStores.`
    );
    throw new Error(
      "Method 'get' not reliably supported by LangchainVectorStore wrapper."
    );
  }
  async update(vectorId, vector, payload) {
    console.error(
      `LangchainVectorStore: The 'update' method is not directly supported. Use delete followed by insert.`
    );
    throw new Error(
      "Method 'update' not supported by LangchainVectorStore wrapper."
    );
  }
  async delete(vectorId) {
    if (typeof this.lcStore.delete === "function") {
      try {
        console.warn(
          "LangchainVectorStore: Attempting delete via filter on '_mem0_id'. Success depends on the specific Langchain VectorStore's delete implementation."
        );
        await this.lcStore.delete({ filter: { _mem0_id: vectorId } });
      } catch (e) {
        console.error(
          `LangchainVectorStore: Delete failed. Underlying store's delete method might expect different arguments or filters. Error: ${e}`
        );
        throw new Error(`Delete failed in underlying Langchain store: ${e}`);
      }
    } else {
      console.error(
        `LangchainVectorStore: The underlying Langchain store instance does not seem to support a 'delete' method.`
      );
      throw new Error(
        "Method 'delete' not available on the provided Langchain VectorStore client."
      );
    }
  }
  async list(filters, topK = 100) {
    console.error(
      `LangchainVectorStore: The 'list' method is not supported by the generic LangchainVectorStore wrapper.`
    );
    throw new Error(
      "Method 'list' not supported by LangchainVectorStore wrapper."
    );
  }
  async deleteCol() {
    console.error(
      `LangchainVectorStore: The 'deleteCol' method is not supported by the generic LangchainVectorStore wrapper.`
    );
    throw new Error(
      "Method 'deleteCol' not supported by LangchainVectorStore wrapper."
    );
  }
  // --- Wrapper-Specific Methods (In-Memory User ID) ---
  async getUserId() {
    return this.storeUserId;
  }
  async setUserId(userId) {
    this.storeUserId = userId;
  }
  async initialize() {
    return Promise.resolve();
  }
};

// src/oss/src/vector_stores/azure_ai_search.ts
var AzureAISearch = class {
  constructor(config) {
    this.serviceName = config.serviceName;
    this.indexName = config.collectionName;
    this.embeddingModelDims = config.embeddingModelDims;
    this.compressionType = config.compressionType || "none";
    this.useFloat16 = config.useFloat16 || false;
    this.hybridSearch = config.hybridSearch || false;
    this.vectorFilterMode = config.vectorFilterMode || "preFilter";
    this.apiKey = config.apiKey;
    this.initialize().catch(console.error);
  }
  async ensureClient() {
    if (this.searchClient) return;
    const searchSdk = await loadPeer(
      "@azure/search-documents",
      "Azure AI Search vector store",
      () => import("@azure/search-documents")
    );
    const serviceEndpoint = `https://${this.serviceName}.search.windows.net`;
    let credential;
    if (this.apiKey && this.apiKey !== "" && this.apiKey !== "your-api-key") {
      credential = new searchSdk.AzureKeyCredential(this.apiKey);
    } else {
      const identitySdk = await loadPeer(
        "@azure/identity",
        "Azure AI Search without an apiKey",
        () => import("@azure/identity")
      );
      credential = new identitySdk.DefaultAzureCredential();
    }
    this.searchClient = new searchSdk.SearchClient(
      serviceEndpoint,
      this.indexName,
      credential
    );
    this.indexClient = new searchSdk.SearchIndexClient(
      serviceEndpoint,
      credential
    );
  }
  /**
   * Initialize the Azure AI Search index if it doesn't exist
   */
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureClient();
    try {
      const collections = await this.listCols();
      if (!collections.includes(this.indexName)) {
        await this.createCol();
      }
    } catch (error) {
      console.error("Error initializing Azure AI Search:", error);
      throw error;
    }
  }
  /**
   * Create a new index in Azure AI Search
   */
  async createCol() {
    const vectorType = this.useFloat16 ? "Collection(Edm.Half)" : "Collection(Edm.Single)";
    const compressionConfigurations = [];
    let compressionName = void 0;
    if (this.compressionType === "scalar") {
      compressionName = "myCompression";
      compressionConfigurations.push({
        kind: "scalarQuantization",
        compressionName
      });
    } else if (this.compressionType === "binary") {
      compressionName = "myCompression";
      compressionConfigurations.push({
        kind: "binaryQuantization",
        compressionName
      });
    }
    const fields = [
      {
        name: "id",
        type: "Edm.String",
        key: true
      },
      {
        name: "user_id",
        type: "Edm.String",
        filterable: true
      },
      {
        name: "run_id",
        type: "Edm.String",
        filterable: true
      },
      {
        name: "agent_id",
        type: "Edm.String",
        filterable: true
      },
      {
        name: "vector",
        type: vectorType,
        searchable: true,
        vectorSearchDimensions: this.embeddingModelDims,
        vectorSearchProfileName: "my-vector-config"
      },
      {
        name: "payload",
        type: "Edm.String",
        searchable: true
      }
    ];
    const vectorSearch = {
      profiles: [
        {
          name: "my-vector-config",
          algorithmConfigurationName: "my-algorithms-config",
          compressionName: this.compressionType !== "none" ? compressionName : void 0
        }
      ],
      algorithms: [
        {
          kind: "hnsw",
          name: "my-algorithms-config"
        }
      ],
      compressions: compressionConfigurations
    };
    const index = {
      name: this.indexName,
      fields,
      vectorSearch
    };
    await this.indexClient.createOrUpdateIndex(index);
  }
  /**
   * Generate a document for insertion
   */
  generateDocument(vector, payload, id) {
    const document = {
      id,
      vector,
      payload: JSON.stringify(payload)
    };
    for (const field of ["user_id", "run_id", "agent_id"]) {
      if (field in payload) {
        document[field] = payload[field];
      }
    }
    return document;
  }
  /**
   * Insert vectors into the index
   */
  async insert(vectors, ids, payloads) {
    await this.initialize();
    console.log(
      `Inserting ${vectors.length} vectors into index ${this.indexName}`
    );
    const documents = vectors.map(
      (vector, idx) => this.generateDocument(vector, payloads[idx] || {}, ids[idx])
    );
    const response = await this.searchClient.uploadDocuments(documents);
    for (const result of response.results) {
      if (!result.succeeded) {
        throw new Error(
          `Insert failed for document ${result.key}: ${result.errorMessage}`
        );
      }
    }
  }
  /**
   * Sanitize filter keys to remove non-alphanumeric characters
   */
  sanitizeKey(key) {
    return key.replace(/[^\w]/g, "");
  }
  /**
   * Build OData filter expression from SearchFilters
   */
  buildFilterExpression(filters) {
    const filterConditions = [];
    for (const [key, value] of Object.entries(filters)) {
      const safeKey = this.sanitizeKey(key);
      if (typeof value === "string") {
        const safeValue = value.replace(/'/g, "''");
        filterConditions.push(`${safeKey} eq '${safeValue}'`);
      } else {
        filterConditions.push(`${safeKey} eq ${value}`);
      }
    }
    return filterConditions.join(" and ");
  }
  /**
   * Extract JSON from payload string
   * Handles cases where payload might have extra text
   */
  extractJson(payload) {
    try {
      JSON.parse(payload);
      return payload;
    } catch (e) {
      const match = payload.match(/\{.*\}/s);
      return match ? match[0] : payload;
    }
  }
  /**
   * Keyword search using Azure AI Search native full-text (BM25) capabilities
   */
  async keywordSearch(query, topK = 5, filters) {
    await this.initialize();
    try {
      const filterExpression = filters ? this.buildFilterExpression(filters) : void 0;
      const searchResults = await this.searchClient.search(query, {
        filter: filterExpression,
        top: topK,
        searchFields: ["payload"]
      });
      const results = [];
      for await (const result of searchResults.results) {
        const payloadStr = result.document.payload;
        const payload = JSON.parse(this.extractJson(payloadStr));
        results.push({
          id: result.document.id,
          score: result.score,
          payload
        });
      }
      return results;
    } catch (error) {
      console.error("Error during keyword search:", error);
      return null;
    }
  }
  /**
   * Search for similar vectors
   */
  async search(query, topK = 5, filters) {
    await this.initialize();
    const filterExpression = filters ? this.buildFilterExpression(filters) : void 0;
    const vectorQuery = {
      kind: "vector",
      vector: query,
      kNearestNeighborsCount: topK,
      fields: ["vector"]
    };
    let searchResults;
    if (this.hybridSearch) {
      searchResults = await this.searchClient.search("*", {
        vectorSearchOptions: {
          queries: [vectorQuery],
          filterMode: this.vectorFilterMode
        },
        filter: filterExpression,
        top: topK,
        searchFields: ["payload"]
      });
    } else {
      searchResults = await this.searchClient.search("*", {
        vectorSearchOptions: {
          queries: [vectorQuery],
          filterMode: this.vectorFilterMode
        },
        filter: filterExpression,
        top: topK
      });
    }
    const results = [];
    for await (const result of searchResults.results) {
      const payloadStr = result.document.payload;
      const payload = JSON.parse(this.extractJson(payloadStr));
      results.push({
        id: result.document.id,
        score: result.score,
        payload
      });
    }
    return results;
  }
  /**
   * Delete a vector by ID
   */
  async delete(vectorId) {
    await this.initialize();
    const response = await this.searchClient.deleteDocuments([
      { id: vectorId }
    ]);
    for (const result of response.results) {
      if (!result.succeeded) {
        throw new Error(
          `Delete failed for document ${vectorId}: ${result.errorMessage}`
        );
      }
    }
    console.log(
      `Deleted document with ID '${vectorId}' from index '${this.indexName}'.`
    );
  }
  /**
   * Update a vector and its payload
   */
  async update(vectorId, vector, payload) {
    await this.initialize();
    const document = { id: vectorId };
    if (vector) {
      document.vector = vector;
    }
    if (payload) {
      document.payload = JSON.stringify(payload);
      for (const field of ["user_id", "run_id", "agent_id"]) {
        if (field in payload) {
          document[field] = payload[field];
        }
      }
    }
    const response = await this.searchClient.mergeOrUploadDocuments([document]);
    for (const result of response.results) {
      if (!result.succeeded) {
        throw new Error(
          `Update failed for document ${vectorId}: ${result.errorMessage}`
        );
      }
    }
  }
  /**
   * Retrieve a vector by ID
   */
  async get(vectorId) {
    await this.initialize();
    try {
      const result = await this.searchClient.getDocument(vectorId);
      const payloadStr = result.payload;
      const payload = JSON.parse(this.extractJson(payloadStr));
      return {
        id: result.id,
        payload
      };
    } catch (error) {
      if ((error == null ? void 0 : error.statusCode) === 404) {
        return null;
      }
      throw error;
    }
  }
  /**
   * List all collections (indexes)
   */
  async listCols() {
    const names = [];
    for await (const index of this.indexClient.listIndexes()) {
      names.push(index.name);
    }
    return names;
  }
  /**
   * Delete the index
   */
  async deleteCol() {
    await this.initialize();
    await this.indexClient.deleteIndex(this.indexName);
  }
  /**
   * Get information about the index
   */
  async colInfo() {
    const index = await this.indexClient.getIndex(this.indexName);
    return {
      name: index.name,
      fields: index.fields
    };
  }
  /**
   * List all vectors in the index
   */
  async list(filters, topK = 100) {
    await this.initialize();
    const filterExpression = filters ? this.buildFilterExpression(filters) : void 0;
    const searchResults = await this.searchClient.search("*", {
      filter: filterExpression,
      top: topK
    });
    const results = [];
    for await (const result of searchResults.results) {
      const payloadStr = result.document.payload;
      const payload = JSON.parse(this.extractJson(payloadStr));
      results.push({
        id: result.document.id,
        score: result.score,
        payload
      });
    }
    return [results, results.length];
  }
  /**
   * Generate a random user ID
   */
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  /**
   * Get user ID from memory_migrations collection
   * Required by VectorStore interface
   */
  async getUserId() {
    await this.initialize();
    try {
      const collections = await this.listCols();
      const migrationIndexExists = collections.includes("memory_migrations");
      if (!migrationIndexExists) {
        const migrationIndex = {
          name: "memory_migrations",
          fields: [
            {
              name: "id",
              type: "Edm.String",
              key: true
            },
            {
              name: "user_id",
              type: "Edm.String",
              searchable: false,
              filterable: true
            }
          ]
        };
        await this.indexClient.createOrUpdateIndex(migrationIndex);
      }
      const searchResults = await this.searchClient.search("*", {
        top: 1
      });
      for await (const result of searchResults.results) {
        const userId = result.document.user_id;
        if (userId) {
          return userId;
        }
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.searchClient.uploadDocuments([
        {
          id: this.generateUUID(),
          user_id: randomUserId2
        }
      ]);
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  /**
   * Set user ID in memory_migrations collection
   * Required by VectorStore interface
   */
  async setUserId(userId) {
    await this.initialize();
    try {
      const searchResults = await this.searchClient.search("*", {
        top: 1
      });
      let pointId = this.generateUUID();
      for await (const result of searchResults.results) {
        pointId = result.document.id;
        break;
      }
      await this.searchClient.mergeOrUploadDocuments([
        {
          id: pointId,
          user_id: userId
        }
      ]);
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
  /**
   * Reset the index by deleting and recreating it
   */
  async reset() {
    await this.initialize();
    console.log(`Resetting index ${this.indexName}...`);
    try {
      await this.deleteCol();
      await this.createCol();
    } catch (error) {
      console.error(`Error resetting index ${this.indexName}:`, error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/pgvector.ts
function escapeIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}
var SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
function validateIdentifier(name, label = "identifier") {
  if (!SAFE_IDENTIFIER_RE.test(name)) {
    throw new Error(
      `Invalid ${label} '${name}': only letters, digits, and underscores are allowed, must start with a letter or underscore, and be at most 128 characters.`
    );
  }
  return name;
}
function escapeFilterKey(key) {
  if (!SAFE_IDENTIFIER_RE.test(key)) {
    throw new Error(
      `Invalid filter key '${key}': only letters, digits, and underscores are allowed.`
    );
  }
  return key;
}
var OPERATOR_SQL_MAP = {
  eq: { template: "payload->>'%KEY%' = $%IDX%", numeric: false },
  ne: { template: "payload->>'%KEY%' != $%IDX%", numeric: false },
  gt: { template: "(payload->>'%KEY%')::numeric > $%IDX%", numeric: true },
  gte: { template: "(payload->>'%KEY%')::numeric >= $%IDX%", numeric: true },
  lt: { template: "(payload->>'%KEY%')::numeric < $%IDX%", numeric: true },
  lte: { template: "(payload->>'%KEY%')::numeric <= $%IDX%", numeric: true },
  in: { template: "payload->>'%KEY%' = ANY($%IDX%::text[])", numeric: false },
  nin: {
    template: "NOT (payload->>'%KEY%' = ANY($%IDX%::text[]))",
    numeric: false
  },
  contains: {
    template: "payload->>'%KEY%' LIKE $%IDX% ESCAPE '\\'",
    numeric: false
  },
  icontains: {
    template: "payload->>'%KEY%' ILIKE $%IDX% ESCAPE '\\'",
    numeric: false
  }
};
function buildFilterConditions(filters, startIndex) {
  const conditions = [];
  const values = [];
  let paramIndex = startIndex;
  if (!filters) {
    return { conditions, values, paramIndex };
  }
  for (const [key, value] of Object.entries(filters)) {
    if (key === "$or") {
      const orGroups = [];
      for (const orFilter of value) {
        const sub = buildFilterConditions(orFilter, paramIndex);
        if (sub.conditions.length > 0) {
          orGroups.push("(" + sub.conditions.join(" AND ") + ")");
          values.push(...sub.values);
          paramIndex = sub.paramIndex;
        }
      }
      if (orGroups.length > 0) {
        conditions.push("(" + orGroups.join(" OR ") + ")");
      }
      continue;
    }
    if (key === "$not") {
      const notGroups = [];
      for (const notFilter of value) {
        const sub = buildFilterConditions(notFilter, paramIndex);
        if (sub.conditions.length > 0) {
          notGroups.push("(" + sub.conditions.join(" AND ") + ")");
          values.push(...sub.values);
          paramIndex = sub.paramIndex;
        }
      }
      if (notGroups.length > 0) {
        conditions.push("NOT (" + notGroups.join(" OR ") + ")");
      }
      continue;
    }
    const safeKey = escapeFilterKey(key);
    if (value === "*") {
      conditions.push(`payload ? $${paramIndex}`);
      values.push(key);
      paramIndex++;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [op, opValue] of Object.entries(value)) {
        const mapping = OPERATOR_SQL_MAP[op];
        if (!mapping) {
          throw new Error(`Unsupported filter operator: ${op}`);
        }
        const clause = mapping.template.replace("%KEY%", safeKey).replace("%IDX%", String(paramIndex));
        conditions.push(clause);
        if (op === "in" || op === "nin") {
          values.push(opValue.map(String));
        } else if (op === "contains" || op === "icontains") {
          const escaped = String(opValue).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
          values.push(`%${escaped}%`);
        } else if (mapping.numeric) {
          values.push(Number(opValue));
        } else {
          values.push(String(opValue));
        }
        paramIndex++;
      }
    } else if (Array.isArray(value)) {
      conditions.push(`payload->>'${safeKey}' = ANY($${paramIndex}::text[])`);
      values.push(value.map(String));
      paramIndex++;
    } else {
      conditions.push(`payload->>'${safeKey}' = $${paramIndex}`);
      if (typeof value === "boolean") {
        values.push(JSON.stringify(value));
      } else {
        values.push(String(value));
      }
      paramIndex++;
    }
  }
  return { conditions, values, paramIndex };
}
function getConnectionString(config) {
  var _a2;
  return ((_a2 = config.connectionString) == null ? void 0 : _a2.trim()) || void 0;
}
function validateConnectionConfig(config) {
  if (getConnectionString(config)) {
    return;
  }
  const missingFields = ["user", "password", "host", "port"].filter((field) => {
    const v = config[field];
    return v === void 0 || v === null || v === "";
  });
  if (missingFields.length > 0) {
    throw new Error(
      `PGVector requires either connectionString or ${missingFields.join(", ")}`
    );
  }
}
function buildClientConfig(config, database) {
  const connectionString = getConnectionString(config);
  if (connectionString) {
    return {
      connectionString,
      ...config.ssl !== void 0 ? { ssl: config.ssl } : {}
    };
  }
  return {
    database,
    user: config.user,
    password: config.password,
    host: config.host,
    port: config.port,
    ...config.ssl !== void 0 ? { ssl: config.ssl } : {}
  };
}
var PGVector = class {
  constructor(config) {
    validateConnectionConfig(config);
    this.collectionName = validateIdentifier(
      config.collectionName || "memories",
      "collectionName"
    );
    this.useDiskann = config.diskann || false;
    this.useHnsw = config.hnsw || false;
    this.useDirectConnection = !!getConnectionString(config);
    this.dbName = this.useDirectConnection ? "" : validateIdentifier(config.dbname || "vector_store", "dbname");
    this.config = config;
    this.initialize().catch(console.error);
  }
  col() {
    return escapeIdentifier(this.collectionName);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    var _a2;
    try {
      const pg = await loadPeer(
        "pg",
        "PGVector vector store",
        () => import("pg")
      );
      const { Client } = (_a2 = pg.default) != null ? _a2 : pg;
      this.client = new Client(
        buildClientConfig(
          this.config,
          this.useDirectConnection ? void 0 : "postgres"
        )
      );
      await this.client.connect();
      if (!this.useDirectConnection) {
        const dbExists = await this.checkDatabaseExists(this.dbName);
        if (!dbExists) {
          await this.createDatabase(this.dbName);
        }
        await this.client.end();
        this.client = new Client(buildClientConfig(this.config, this.dbName));
        await this.client.connect();
      }
      await this.client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS memory_migrations (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE
        )
      `);
      const collections = await this.listCols();
      if (!collections.includes(this.collectionName)) {
        await this.createCol(this.config.embeddingModelDims);
      }
    } catch (error) {
      console.error("Error during initialization:", error);
      throw error;
    }
  }
  async checkDatabaseExists(dbName) {
    const result = await this.client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    return result.rows.length > 0;
  }
  async createDatabase(dbName) {
    await this.client.query(`CREATE DATABASE ${escapeIdentifier(dbName)}`);
  }
  async createCol(embeddingModelDims) {
    const dims = Math.floor(embeddingModelDims);
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.col()} (
        id UUID PRIMARY KEY,
        vector vector(${dims}),
        payload JSONB
      );
    `);
    if (this.useDiskann && embeddingModelDims < 2e3) {
      try {
        const result = await this.client.query(
          "SELECT * FROM pg_extension WHERE extname = 'vectorscale'"
        );
        if (result.rows.length > 0) {
          await this.client.query(`
            CREATE INDEX IF NOT EXISTS ${escapeIdentifier(this.collectionName + "_diskann_idx")}
            ON ${this.col()}
            USING diskann (vector);
          `);
        }
      } catch (error) {
        console.warn("DiskANN index creation failed:", error);
      }
    } else if (this.useHnsw) {
      try {
        await this.client.query(`
          CREATE INDEX IF NOT EXISTS ${escapeIdentifier(this.collectionName + "_hnsw_idx")}
          ON ${this.col()}
          USING hnsw (vector vector_cosine_ops);
        `);
      } catch (error) {
        console.warn("HNSW index creation failed:", error);
      }
    }
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const values = vectors.map((vector, i) => ({
      id: ids[i],
      vector: `[${vector.join(",")}]`,
      payload: payloads[i]
    }));
    const query = `
      INSERT INTO ${this.col()} (id, vector, payload)
      VALUES ($1, $2::vector, $3::jsonb)
    `;
    await Promise.all(
      values.map(
        (value) => this.client.query(query, [value.id, value.vector, value.payload])
      )
    );
  }
  async keywordSearch(query, topK = 5, filters) {
    await this.initialize();
    try {
      const {
        conditions,
        values,
        paramIndex: _
      } = buildFilterConditions(filters, 3);
      const filterValues = [query, topK, ...values];
      const filterClause = conditions.length > 0 ? "AND " + conditions.join(" AND ") : "";
      const searchQuery = `
        SELECT id, ts_rank_cd(to_tsvector('simple', payload->>'textLemmatized'), plainto_tsquery('simple', $1)) AS score, payload
        FROM ${this.col()}
        WHERE to_tsvector('simple', payload->>'textLemmatized') @@ plainto_tsquery('simple', $1)
        ${filterClause}
        ORDER BY score DESC
        LIMIT $2
      `;
      const result = await this.client.query(searchQuery, filterValues);
      return result.rows.map((row) => ({
        id: row.id,
        payload: row.payload,
        score: row.score
      }));
    } catch (error) {
      console.error("Error during keyword search:", error);
      return null;
    }
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const queryVector = `[${query.join(",")}]`;
    const {
      conditions,
      values,
      paramIndex: _
    } = buildFilterConditions(filters, 3);
    const filterValues = [queryVector, topK, ...values];
    const filterClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const searchQuery = `
      SELECT id, vector <=> $1::vector AS distance, payload
      FROM ${this.col()}
      ${filterClause}
      ORDER BY distance
      LIMIT $2
    `;
    const result = await this.client.query(searchQuery, filterValues);
    return result.rows.map((row) => ({
      id: row.id,
      payload: row.payload,
      score: Math.max(0, Math.min(1, 1 - Number(row.distance)))
    }));
  }
  async get(vectorId) {
    await this.initialize();
    const result = await this.client.query(
      `SELECT id, payload FROM ${this.col()} WHERE id = $1`,
      [vectorId]
    );
    if (result.rows.length === 0) return null;
    return {
      id: result.rows[0].id,
      payload: result.rows[0].payload
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const vectorStr = `[${vector.join(",")}]`;
    await this.client.query(
      `
      UPDATE ${this.col()}
      SET vector = $1::vector, payload = $2::jsonb
      WHERE id = $3
      `,
      [vectorStr, payload, vectorId]
    );
  }
  async delete(vectorId) {
    await this.initialize();
    await this.client.query(`DELETE FROM ${this.col()} WHERE id = $1`, [
      vectorId
    ]);
  }
  async deleteCol() {
    await this.initialize();
    await this.client.query(`DROP TABLE IF EXISTS ${this.col()}`);
  }
  async listCols() {
    const result = await this.client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    return result.rows.map((row) => row.table_name);
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const {
      conditions,
      values: filterValues,
      paramIndex
    } = buildFilterConditions(filters, 1);
    const filterClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const listQuery = `
      SELECT id, payload
      FROM ${this.col()}
      ${filterClause}
      LIMIT $${paramIndex}
    `;
    const countQuery = `
      SELECT COUNT(*)
      FROM ${this.col()}
      ${filterClause}
    `;
    const listValues = [...filterValues, topK];
    const [listResult, countResult] = await Promise.all([
      this.client.query(listQuery, listValues),
      this.client.query(countQuery, filterValues)
    ]);
    const results = listResult.rows.map((row) => ({
      id: row.id,
      payload: row.payload
    }));
    return [results, parseInt(countResult.rows[0].count)];
  }
  async close() {
    var _a2;
    await ((_a2 = this.client) == null ? void 0 : _a2.end());
  }
  async getUserId() {
    await this.initialize();
    const result = await this.client.query(
      "SELECT user_id FROM memory_migrations LIMIT 1"
    );
    if (result.rows.length > 0) {
      return result.rows[0].user_id;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.client.query(
      "INSERT INTO memory_migrations (user_id) VALUES ($1)",
      [randomUserId2]
    );
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.client.query("DELETE FROM memory_migrations");
    await this.client.query(
      "INSERT INTO memory_migrations (user_id) VALUES ($1)",
      [userId]
    );
  }
};

// src/oss/src/vector_stores/databricks.ts
import axios from "axios";
var SAFE_IDENTIFIER_RE2 = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
var DEFAULT_PAGE_SIZE = 100;
var MAX_QUERY_RESULTS = 1e4;
var MAX_FULL_TEXT_RESULTS = 200;
var DEFAULT_SYNC_POLL_INTERVAL_MS = 1e3;
var DEFAULT_SYNC_TIMEOUT_MS = 5 * 60 * 1e3;
var DATABRICKS_SERVER_FILTER_KEYS = /* @__PURE__ */ new Set([
  "memory_id",
  "user_id",
  "agent_id",
  "run_id"
]);
function buildDatabricksAuthorizationDetails(indexName, operation) {
  return JSON.stringify([
    {
      type: "unity_catalog_permission",
      securable_type: "table",
      securable_object_name: indexName,
      operation
    }
  ]);
}
function validateIdentifier2(name, label = "identifier") {
  if (!SAFE_IDENTIFIER_RE2.test(name)) {
    throw new Error(
      `Invalid ${label} '${name}': only letters, digits, and underscores are allowed, must start with a letter or underscore, and be at most 128 characters.`
    );
  }
  return name;
}
function extractHostAndWorkspaceUrl(config) {
  if (config.workspaceUrl) {
    const url = new URL(config.workspaceUrl);
    return {
      host: url.host,
      workspaceUrl: `${url.protocol}//${url.host}`
    };
  }
  if (config.host) {
    return {
      host: config.host,
      workspaceUrl: `https://${config.host}`
    };
  }
  throw new Error(
    "Databricks vector store requires either workspaceUrl or host."
  );
}
function lemmatizedText2(payload) {
  const data = typeof payload.data === "string" ? payload.data : "";
  return typeof payload.textLemmatized === "string" && payload.textLemmatized.length > 0 ? payload.textLemmatized : data;
}
function formatSqlValue(value) {
  if (value === null || value === void 0) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Databricks vector store only accepts finite numbers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `array(${value.map((entry) => formatSqlValue(entry)).join(", ")})`;
  }
  const json = typeof value === "string" ? value : JSON.stringify(value != null ? value : {}) || "{}";
  const escaped = json.replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${escaped}'`;
}
function extractRowValue(row, keys) {
  for (const key of keys) {
    if (key in row) {
      return row[key];
    }
    const upper = key.toUpperCase();
    if (upper in row) {
      return row[upper];
    }
  }
  return void 0;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeFilterValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFilterValue(entry));
  }
  return value;
}
function isDatabricksServerFilterKey(key) {
  return DATABRICKS_SERVER_FILTER_KEYS.has(key);
}
function mergeDatabricksFilters(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (key in target && JSON.stringify(target[key]) !== JSON.stringify(value)) {
      return false;
    }
    target[key] = value;
  }
  return true;
}
function buildSimpleDatabricksFilter(key, value) {
  if (!isDatabricksServerFilterKey(key)) {
    return null;
  }
  const safeKey = validateIdentifier2(key, "filter key");
  if (!isPlainObject(value)) {
    return {
      [safeKey]: normalizeFilterValue(value)
    };
  }
  const entries = Object.entries(value);
  if (entries.length !== 1) {
    return null;
  }
  const [operator, operand] = entries[0];
  switch (operator) {
    case "eq":
      return { [safeKey]: normalizeFilterValue(operand) };
    case "ne":
      return { [`${safeKey} NOT`]: normalizeFilterValue(operand) };
    case "gt":
      return { [`${safeKey} >`]: normalizeFilterValue(operand) };
    case "gte":
      return { [`${safeKey} >=`]: normalizeFilterValue(operand) };
    case "lt":
      return { [`${safeKey} <`]: normalizeFilterValue(operand) };
    case "lte":
      return { [`${safeKey} <=`]: normalizeFilterValue(operand) };
    case "in":
      return Array.isArray(operand) ? { [safeKey]: normalizeFilterValue(operand) } : null;
    case "nin":
      return Array.isArray(operand) && operand.length === 1 ? { [`${safeKey} NOT`]: normalizeFilterValue(operand[0]) } : null;
    default:
      return null;
  }
}
function buildStandardDatabricksFiltersFromClauses(clauses) {
  const result = {};
  for (const [key, value] of clauses) {
    const translated = buildSimpleDatabricksFilter(key, value);
    if (!translated) {
      continue;
    }
    if (!mergeDatabricksFilters(result, translated)) {
      return void 0;
    }
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
function buildStorageOptimizedDatabricksFilterClause(key, value) {
  if (!isDatabricksServerFilterKey(key)) {
    return null;
  }
  const safeKey = validateIdentifier2(key, "filter key");
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      return value.length > 0 ? `${safeKey} IN (${value.map((entry) => formatSqlValue(normalizeFilterValue(entry))).join(", ")})` : null;
    }
    return `${safeKey} = ${formatSqlValue(normalizeFilterValue(value))}`;
  }
  const entries = Object.entries(value);
  if (entries.length !== 1) {
    return null;
  }
  const [operator, operand] = entries[0];
  switch (operator) {
    case "eq":
      return `${safeKey} = ${formatSqlValue(normalizeFilterValue(operand))}`;
    case "ne":
      return `(${safeKey} IS NULL OR ${safeKey} != ${formatSqlValue(normalizeFilterValue(operand))})`;
    case "gt":
      return `${safeKey} > ${formatSqlValue(normalizeFilterValue(operand))}`;
    case "gte":
      return `${safeKey} >= ${formatSqlValue(normalizeFilterValue(operand))}`;
    case "lt":
      return `${safeKey} < ${formatSqlValue(normalizeFilterValue(operand))}`;
    case "lte":
      return `${safeKey} <= ${formatSqlValue(normalizeFilterValue(operand))}`;
    case "in":
      return Array.isArray(operand) && operand.length > 0 ? `${safeKey} IN (${operand.map((entry) => formatSqlValue(normalizeFilterValue(entry))).join(", ")})` : null;
    case "nin":
      return Array.isArray(operand) && operand.length > 0 ? `(${safeKey} IS NULL OR ${safeKey} NOT IN (${operand.map((entry) => formatSqlValue(normalizeFilterValue(entry))).join(", ")}))` : null;
    default:
      return null;
  }
}
function collectConjunctiveDatabricksFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return [];
  }
  const clauses = [];
  for (const [key, value] of Object.entries(filters)) {
    if (key === "$and") {
      if (!Array.isArray(value)) {
        continue;
      }
      for (const entry of value) {
        if (!isPlainObject(entry)) {
          continue;
        }
        clauses.push(...collectConjunctiveDatabricksFilters(entry));
      }
      continue;
    }
    if (key === "$or" || key === "$not") {
      continue;
    }
    clauses.push([key, value]);
  }
  return clauses;
}
function isFullyConjunctiveDatabricksFilter(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return true;
  }
  for (const [key, value] of Object.entries(filters)) {
    if (key === "$and") {
      if (!Array.isArray(value)) {
        return false;
      }
      if (value.some(
        (entry) => !isPlainObject(entry) || !isFullyConjunctiveDatabricksFilter(entry)
      )) {
        return false;
      }
      continue;
    }
    if (key === "$or" || key === "$not") {
      return false;
    }
  }
  return true;
}
function buildDatabricksServerFilters(endpointType, filters) {
  const clauses = collectConjunctiveDatabricksFilters(filters);
  if (clauses.length === 0) {
    return {};
  }
  if (endpointType === "STORAGE_OPTIMIZED") {
    const translatedClauses = clauses.map(
      ([key, value]) => buildStorageOptimizedDatabricksFilterClause(key, value)
    ).filter((clause) => Boolean(clause));
    return translatedClauses.length > 0 ? { filters: translatedClauses.join(" AND ") } : {};
  }
  const translatedFilters = buildStandardDatabricksFiltersFromClauses(clauses);
  return translatedFilters ? { filters_json: JSON.stringify(translatedFilters) } : {};
}
var DatabricksVectorStore = class {
  constructor(config) {
    this.indexSyncWait = null;
    this.indexSyncRunning = false;
    this.indexSyncQueued = false;
    this.indexSyncError = null;
    this.oauthTokens = /* @__PURE__ */ new Map();
    var _a2, _b2, _c;
    const { host, workspaceUrl } = extractHostAndWorkspaceUrl(config);
    this.host = host;
    this.workspaceUrl = workspaceUrl;
    this.httpPath = config.httpPath;
    this.accessToken = config.accessToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.endpointName = config.endpointName || "mem0_vector_search";
    this.endpointType = config.endpointType || "STANDARD";
    this.pipelineType = config.pipelineType || "TRIGGERED";
    this.queryType = config.queryType || "ANN";
    this.dimension = config.embeddingModelDims || config.dimension || 1536;
    this.catalog = validateIdentifier2(config.catalog || "main", "catalog");
    this.schema = validateIdentifier2(config.schema || "default", "schema");
    this.indexName = validateIdentifier2(
      config.collectionName || "mem0",
      "collectionName"
    );
    this.tableName = validateIdentifier2(
      config.tableName || this.indexName,
      "tableName"
    );
    this.fullTableName = `${this.catalog}.${this.schema}.${this.tableName}`;
    this.fullIndexName = `${this.catalog}.${this.schema}.${this.indexName}`;
    this.syncPollIntervalMs = (_a2 = config.syncPollIntervalMs) != null ? _a2 : DEFAULT_SYNC_POLL_INTERVAL_MS;
    this.syncTimeoutMs = (_b2 = config.syncTimeoutMs) != null ? _b2 : DEFAULT_SYNC_TIMEOUT_MS;
    this.sqlClient = (_c = config.sqlClient) != null ? _c : null;
    this.httpClient = config.httpClient || this.createHttpClient();
    if (this.endpointType === "STORAGE_OPTIMIZED" && this.pipelineType !== "TRIGGERED") {
      throw new Error(
        "Databricks storage-optimized endpoints only support TRIGGERED pipelineType."
      );
    }
    if (this.endpointType === "STORAGE_OPTIMIZED" && this.dimension % 16 !== 0) {
      throw new Error(
        "Databricks storage-optimized endpoints require dimensions divisible by 16."
      );
    }
    this.initialize().catch(console.error);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize().catch((error) => {
        this._initPromise = void 0;
        throw error;
      });
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.executeSql(
      `CREATE SCHEMA IF NOT EXISTS ${this.catalog}.${this.schema}`
    );
    await this.executeSql(`
      CREATE TABLE IF NOT EXISTS ${this.fullTableName} (
        memory_id STRING,
        embedding ARRAY<FLOAT>,
        payload STRING,
        text_lemmatized STRING,
        user_id STRING,
        agent_id STRING,
        run_id STRING
      ) USING DELTA
      TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')
    `);
    await this.ensureChangeDataFeedEnabled();
    await this.executeSql(`
      CREATE TABLE IF NOT EXISTS ${this.catalog}.${this.schema}.memory_migrations (
        user_id STRING
      ) USING DELTA
    `);
    await this.ensureEndpointExists();
    await this.waitForEndpointReadiness();
    await this.ensureIndexExists();
    await this.waitForIndexReadiness();
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const values = vectors.map((vector, index) => {
      this.assertVectorDimension(vector, "Vector");
      const payload = payloads[index] || {};
      const sessionValues = this.extractSessionValues(payload);
      return `(
        ${formatSqlValue(ids[index])},
        ${formatSqlValue(vector)},
        ${formatSqlValue(JSON.stringify(payload))},
        ${formatSqlValue(lemmatizedText2(payload))},
        ${formatSqlValue(sessionValues.user_id)},
        ${formatSqlValue(sessionValues.agent_id)},
        ${formatSqlValue(sessionValues.run_id)}
      )`;
    });
    await this.executeSql(`
      INSERT INTO ${this.fullTableName}
        (memory_id, embedding, payload, text_lemmatized, user_id, agent_id, run_id)
      VALUES ${values.join(", ")}
    `);
    this.requestIndexSync();
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    this.assertVectorDimension(query, "Query");
    if (this.queryType === "HYBRID") {
      throw new Error(
        "Databricks HYBRID search requires query_text, but search() only receives query vectors."
      );
    }
    const requestFilters = buildDatabricksServerFilters(
      this.endpointType,
      filters
    );
    return this.queryIndex(
      {
        columns: ["memory_id", "payload"],
        query_type: this.queryType,
        query_vector: query,
        ...requestFilters
      },
      filters,
      topK
    );
  }
  async keywordSearch(query, topK = 5, filters) {
    await this.initialize();
    const requestFilters = buildDatabricksServerFilters(
      this.endpointType,
      filters
    );
    return this.queryIndex(
      {
        columns: ["memory_id", "payload"],
        query_type: "FULL_TEXT",
        query_text: query,
        ...requestFilters
      },
      filters,
      topK
    );
  }
  async get(vectorId) {
    await this.initialize();
    const rows = await this.executeSql(`
      SELECT memory_id, payload
      FROM ${this.fullTableName}
      WHERE memory_id = ${formatSqlValue(vectorId)}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: String(extractRowValue(row, ["memory_id"]) || vectorId),
      payload: this.parsePayload(extractRowValue(row, ["payload"]))
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    this.assertVectorDimension(vector, "Vector");
    await this.executeSql(`
      UPDATE ${this.fullTableName}
      SET embedding = ${formatSqlValue(vector)},
          payload = ${formatSqlValue(JSON.stringify(payload || {}))},
          text_lemmatized = ${formatSqlValue(lemmatizedText2(payload || {}))}
      WHERE memory_id = ${formatSqlValue(vectorId)}
    `);
    this.requestIndexSync();
  }
  async delete(vectorId) {
    await this.initialize();
    await this.executeSql(`
      DELETE FROM ${this.fullTableName}
      WHERE memory_id = ${formatSqlValue(vectorId)}
    `);
    this.requestIndexSync();
  }
  async deleteCol() {
    var _a2;
    await this.initialize();
    try {
      await this.httpClient.delete(
        `/indexes/${encodeURIComponent(this.fullIndexName)}`
      );
    } catch (error) {
      if (((_a2 = error == null ? void 0 : error.response) == null ? void 0 : _a2.status) !== 404) {
        throw error;
      }
    }
    await this.executeSql(`DROP TABLE IF EXISTS ${this.fullTableName}`);
  }
  async list(filters, topK = 100) {
    if (!Number.isSafeInteger(topK) || topK <= 0) {
      throw new Error(
        `Databricks vector store: topK must be a positive integer, got ${topK}`
      );
    }
    await this.initialize();
    const conjunctiveFilters = collectConjunctiveDatabricksFilters(filters);
    const clauses = conjunctiveFilters.map(
      ([key, value]) => buildStorageOptimizedDatabricksFilterClause(key, value)
    );
    const whereClause = clauses.filter((clause) => Boolean(clause)).join(" AND ");
    const isFullyExpressed = isFullyConjunctiveDatabricksFilter(filters) && clauses.every((clause) => clause !== null);
    const limit = isFullyExpressed ? topK : MAX_QUERY_RESULTS;
    const rows = await this.executeSql(`
      SELECT memory_id, payload
      FROM ${this.fullTableName}
      ${whereClause ? `WHERE ${whereClause}` : ""}
      LIMIT ${limit}
    `);
    const results = [];
    for (const row of rows) {
      const item = {
        id: String(extractRowValue(row, ["memory_id"])),
        payload: this.parsePayload(extractRowValue(row, ["payload"]))
      };
      if (!this.filterVector(item, filters)) {
        continue;
      }
      results.push({
        id: item.id,
        payload: item.payload
      });
    }
    return [results.slice(0, topK), results.length];
  }
  async getUserId() {
    await this.initialize();
    const rows = await this.executeSql(`
      SELECT user_id
      FROM ${this.catalog}.${this.schema}.memory_migrations
      LIMIT 1
    `);
    const existing = rows[0] ? extractRowValue(rows[0], ["user_id"]) : void 0;
    if (typeof existing === "string" && existing.length > 0) {
      return existing;
    }
    const userId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.setUserId(userId);
    return userId;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.executeSql(
      `DELETE FROM ${this.catalog}.${this.schema}.memory_migrations`
    );
    await this.executeSql(`
      INSERT INTO ${this.catalog}.${this.schema}.memory_migrations (user_id)
      VALUES (${formatSqlValue(userId)})
    `);
  }
  async ensureEndpointExists() {
    var _a2;
    try {
      await this.httpClient.get(
        `/endpoints/${encodeURIComponent(this.endpointName)}`
      );
    } catch (error) {
      if (((_a2 = error == null ? void 0 : error.response) == null ? void 0 : _a2.status) !== 404) {
        throw error;
      }
      await this.httpClient.post("/endpoints", {
        name: this.endpointName,
        endpoint_type: this.endpointType
      });
    }
  }
  async ensureIndexExists() {
    var _a2;
    try {
      await this.httpClient.get(
        `/indexes/${encodeURIComponent(this.fullIndexName)}`
      );
    } catch (error) {
      if (((_a2 = error == null ? void 0 : error.response) == null ? void 0 : _a2.status) !== 404) {
        throw error;
      }
      await this.httpClient.post("/indexes", {
        name: this.fullIndexName,
        endpoint_name: this.endpointName,
        primary_key: "memory_id",
        index_type: "DELTA_SYNC",
        delta_sync_index_spec: {
          source_table: this.fullTableName,
          pipeline_type: this.pipelineType,
          // ponytail: `payload` stays synced because query results are hydrated straight
          // from it. Drop it here and hydrate by memory_id over SQL if index size bites.
          columns_to_sync: this.endpointType === "STANDARD" ? [
            "memory_id",
            "payload",
            "text_lemmatized",
            "user_id",
            "agent_id",
            "run_id"
          ] : void 0,
          embedding_vector_columns: [
            {
              name: "embedding",
              embedding_dimension: this.dimension
            }
          ]
        }
      });
    }
  }
  async ensureChangeDataFeedEnabled() {
    if (this.endpointType !== "STANDARD") {
      return;
    }
    await this.executeSql(`
      ALTER TABLE ${this.fullTableName}
      SET TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')
    `);
  }
  createHttpClient() {
    const baseURL = `${this.workspaceUrl}/api/2.0/vector-search`;
    if (this.accessToken) {
      return axios.create({
        baseURL,
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "Databricks vector store requires accessToken or clientId/clientSecret when httpClient is not provided."
      );
    }
    const baseClient = axios.create({ baseURL });
    return {
      get: async (url, config) => baseClient.get(url, await this.withOAuthHeaders("GET", url, config)),
      post: async (url, data, config) => baseClient.post(
        url,
        data,
        await this.withOAuthHeaders("POST", url, config)
      ),
      delete: async (url, config) => baseClient.delete(
        url,
        await this.withOAuthHeaders("DELETE", url, config)
      )
    };
  }
  async withOAuthHeaders(method, url, config) {
    const token = await this.getOAuthAccessToken(
      this.getOAuthAuthorizationDetails(method, url)
    );
    return {
      ...config || {},
      headers: {
        ...(config == null ? void 0 : config.headers) || {},
        Authorization: `Bearer ${token}`
      }
    };
  }
  getOAuthAuthorizationDetails(method, url) {
    if (method === "POST" && (url.endsWith("/query") || url.endsWith("/query-next-page"))) {
      return buildDatabricksAuthorizationDetails(
        this.fullIndexName,
        "ReadVectorIndex"
      );
    }
    if (method === "POST" && (url.endsWith("/sync") || url.endsWith("/upsert-data") || url.endsWith("/delete-data"))) {
      return buildDatabricksAuthorizationDetails(
        this.fullIndexName,
        "WriteVectorIndex"
      );
    }
    return void 0;
  }
  async getOAuthAccessToken(authorizationDetails) {
    var _a2, _b2, _c;
    const cacheKey = authorizationDetails || "__management__";
    const cached = this.oauthTokens.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt - 6e4) {
      return cached.accessToken;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "Databricks vector store requires clientId/clientSecret for OAuth token refresh."
      );
    }
    const formData = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "all-apis"
    });
    if (authorizationDetails) {
      formData.set("authorization_details", authorizationDetails);
    }
    const response = await axios.post(
      `${this.workspaceUrl}/oidc/v1/token`,
      formData,
      {
        auth: {
          username: this.clientId,
          password: this.clientSecret
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );
    const token = (_a2 = response == null ? void 0 : response.data) == null ? void 0 : _a2.access_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(
        "Databricks OAuth token response did not include access_token."
      );
    }
    const expiresInSeconds = Number((_c = (_b2 = response == null ? void 0 : response.data) == null ? void 0 : _b2.expires_in) != null ? _c : 3600);
    this.oauthTokens.set(cacheKey, {
      accessToken: token,
      expiresAt: Date.now() + Math.max(1, expiresInSeconds) * 1e3
    });
    return token;
  }
  async getSession() {
    if (this.session) {
      return this.session;
    }
    if (!this._sessionPromise) {
      this._sessionPromise = this.openSession();
    }
    try {
      this.session = await this._sessionPromise;
    } catch (error) {
      this.resetSession();
      throw error;
    }
    return this.session;
  }
  /**
   * `@databricks/sql` is an OPTIONAL peer, and `index.ts` re-exports this module eagerly, so a
   * top-level `import` makes `import "mem0ai/oss"` throw MODULE_NOT_FOUND for every user who
   * never installed the driver -- including everyone who uses a different vector store. Load it
   * on the first SQL call instead, the way milvus.ts and baidu.ts load theirs.
   *
   * This MUST be a dynamic `import()`, never `require()`: tsup/esbuild rewrite `require()` in
   * the published ESM bundle (`dist/oss/index.mjs`) into a `__require` shim that throws
   * `Dynamic require of "..." is not supported`, so every ESM consumer would hit a dead
   * provider even with the driver installed.
   */
  async getSqlModule() {
    if (!this.sqlModulePromise) {
      this.sqlModulePromise = import("@databricks/sql").then(
        (mod) => mod,
        (err) => {
          this.sqlModulePromise = void 0;
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `The '@databricks/sql' package is required to use the Databricks vector store. Install it with: npm install @databricks/sql (original error: ${detail})`
          );
        }
      );
    }
    return this.sqlModulePromise;
  }
  async getSqlClient() {
    if (!this.sqlClient) {
      const { DBSQLClient } = await this.getSqlModule();
      this.sqlClient = new DBSQLClient();
    }
    return this.sqlClient;
  }
  async openSession() {
    const sqlClient = await this.getSqlClient();
    const connected = await sqlClient.connect(this.buildSqlConnectionOptions());
    return connected.openSession();
  }
  buildSqlConnectionOptions() {
    const base = {
      host: this.host,
      path: this.httpPath
    };
    if (this.clientId && this.clientSecret) {
      return {
        ...base,
        authType: "databricks-oauth",
        oauthClientId: this.clientId,
        oauthClientSecret: this.clientSecret
      };
    }
    if (!this.accessToken) {
      throw new Error(
        "Databricks vector store requires accessToken or clientId/clientSecret for SQL connections."
      );
    }
    return {
      ...base,
      token: this.accessToken
    };
  }
  /**
   * Drop the cached session/session-promise so the next `getSession()` opens a fresh one.
   * Called after any SQL failure below -- a stale session (expired token, dropped socket)
   * would otherwise keep being handed out and keep failing forever.
   */
  resetSession() {
    this.session = void 0;
    this._sessionPromise = void 0;
  }
  async executeSql(statement) {
    const session = await this.getSession();
    let operation;
    try {
      operation = await session.executeStatement(statement);
    } catch (error) {
      this.resetSession();
      throw error;
    }
    try {
      return await operation.fetchAll();
    } catch (error) {
      this.resetSession();
      throw error;
    } finally {
      if (typeof operation.close === "function") {
        await operation.close();
      }
    }
  }
  /**
   * A TRIGGERED pipeline only ingests new rows when it is explicitly synced, so every write
   * must request one. Writers fire the sync and return; only readers wait for it to land.
   * A sync already in flight absorbs later writes -- deleteAll()'s N sequential deletes
   * collapse into far fewer than N pipeline runs.
   */
  requestIndexSync() {
    if (this.pipelineType !== "TRIGGERED") {
      return;
    }
    this.indexSyncQueued = true;
    if (this.indexSyncRunning) {
      return;
    }
    this.indexSyncRunning = true;
    this.indexSyncWait = this.drainIndexSync();
  }
  async drainIndexSync() {
    try {
      while (this.indexSyncQueued) {
        this.indexSyncQueued = false;
        await this.httpClient.post(
          `/indexes/${encodeURIComponent(this.fullIndexName)}/sync`
        );
        await this.waitForIndexReadiness();
      }
      this.indexSyncError = null;
    } catch (error) {
      this.indexSyncError = error;
    } finally {
      this.indexSyncRunning = false;
    }
  }
  async awaitIndexSync() {
    while (this.indexSyncWait) {
      const wait = this.indexSyncWait;
      await wait;
      if (this.indexSyncWait === wait) {
        this.indexSyncWait = null;
      }
    }
    if (this.indexSyncError) {
      const error = this.indexSyncError;
      this.indexSyncError = null;
      throw error;
    }
  }
  async waitForEndpointReadiness() {
    var _a2, _b2, _c, _d;
    const deadline = Date.now() + this.syncTimeoutMs;
    while (Date.now() <= deadline) {
      const response = await this.httpClient.get(
        `/endpoints/${encodeURIComponent(this.endpointName)}`
      );
      const state = (_d = (_b2 = (_a2 = response == null ? void 0 : response.data) == null ? void 0 : _a2.endpoint_status) == null ? void 0 : _b2.state) != null ? _d : (_c = response == null ? void 0 : response.data) == null ? void 0 : _c.state;
      if (state === "ONLINE") {
        return;
      }
      if (typeof state !== "string") {
        throw new Error(
          "Databricks endpoint status did not report a state during initialization."
        );
      }
      if (this.syncPollIntervalMs > 0) {
        await new Promise(
          (resolve) => setTimeout(resolve, this.syncPollIntervalMs)
        );
      }
    }
    throw new Error(
      `Timed out waiting for Databricks endpoint ${this.endpointName} to become ready.`
    );
  }
  async waitForIndexReadiness() {
    var _a2, _b2;
    const deadline = Date.now() + this.syncTimeoutMs;
    while (Date.now() <= deadline) {
      const response = await this.httpClient.get(
        `/indexes/${encodeURIComponent(this.fullIndexName)}`
      );
      const ready = (_b2 = (_a2 = response == null ? void 0 : response.data) == null ? void 0 : _a2.status) == null ? void 0 : _b2.ready;
      if (ready === true) {
        return;
      }
      if (ready !== false) {
        throw new Error(
          "Databricks index status did not report a readiness flag after sync."
        );
      }
      if (this.syncPollIntervalMs > 0) {
        await new Promise(
          (resolve) => setTimeout(resolve, this.syncPollIntervalMs)
        );
      }
    }
    throw new Error(
      `Timed out waiting for Databricks index ${this.fullIndexName} to become ready after sync.`
    );
  }
  shouldPaginateForLocalFiltering(filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return false;
    }
    for (const [key, value] of Object.entries(filters)) {
      if (key === "$and") {
        if (!Array.isArray(value)) {
          return true;
        }
        if (value.some(
          (entry) => !isPlainObject(entry) || this.shouldPaginateForLocalFiltering(entry)
        )) {
          return true;
        }
        continue;
      }
      if (key === "$or" || key === "$not") {
        return true;
      }
      const translated = this.endpointType === "STORAGE_OPTIMIZED" ? buildStorageOptimizedDatabricksFilterClause(key, value) : buildSimpleDatabricksFilter(key, value);
      if (!translated) {
        return true;
      }
    }
    return false;
  }
  extractNextPageToken(responseData) {
    var _a2, _b2;
    const token = (_b2 = responseData == null ? void 0 : responseData.next_page_token) != null ? _b2 : (_a2 = responseData == null ? void 0 : responseData.result) == null ? void 0 : _a2.next_page_token;
    return typeof token === "string" && token.length > 0 ? token : void 0;
  }
  async queryIndex(requestBody, filters, topK) {
    await this.awaitIndexSync();
    const requiresLocalFilteringPagination = this.shouldPaginateForLocalFiltering(filters);
    const queryResultCap = requestBody.query_type === "FULL_TEXT" ? MAX_FULL_TEXT_RESULTS : MAX_QUERY_RESULTS;
    const response = await this.httpClient.post(
      `/indexes/${encodeURIComponent(this.fullIndexName)}/query`,
      {
        ...requestBody,
        num_results: Math.min(
          requiresLocalFilteringPagination ? queryResultCap : Math.max(topK, DEFAULT_PAGE_SIZE),
          queryResultCap
        )
      }
    );
    const results = this.normalizeQueryResults(
      response.data,
      ["memory_id", "payload"],
      filters
    );
    if (results.length >= topK) {
      return results.slice(0, topK);
    }
    let nextPageToken = this.extractNextPageToken(response.data);
    while (nextPageToken && results.length < topK) {
      const nextPage = await this.httpClient.post(
        `/indexes/${encodeURIComponent(this.fullIndexName)}/query-next-page`,
        {
          endpoint_name: this.endpointName,
          page_token: nextPageToken
        }
      );
      results.push(
        ...this.normalizeQueryResults(
          nextPage.data,
          ["memory_id", "payload"],
          filters
        )
      );
      nextPageToken = this.extractNextPageToken(nextPage.data);
    }
    return results.slice(0, topK);
  }
  normalizeQueryResults(responseData, fallbackColumns, filters) {
    var _a2, _b2;
    const resultData = (responseData == null ? void 0 : responseData.result) || responseData;
    const dataArray = Array.isArray(resultData == null ? void 0 : resultData.data_array) ? resultData.data_array : [];
    const manifestColumns = Array.isArray((_a2 = resultData == null ? void 0 : resultData.manifest) == null ? void 0 : _a2.columns) ? resultData.manifest.columns.map(
      (column) => typeof column === "string" ? column : column.name
    ) : fallbackColumns;
    const results = [];
    for (const row of dataArray) {
      const rowDict = this.rowToObject(row, manifestColumns);
      const item = {
        id: String(rowDict.memory_id || rowDict.id || rowDict.vector_id),
        payload: this.parsePayload(rowDict.payload)
      };
      if (!this.filterVector(item, filters)) {
        continue;
      }
      const rawScore = (_b2 = rowDict.score) != null ? _b2 : Array.isArray(row) && row.length > manifestColumns.length ? row[row.length - 1] : void 0;
      results.push({
        id: item.id,
        payload: item.payload,
        score: rawScore === void 0 || rawScore === null ? void 0 : Number(rawScore)
      });
    }
    return results;
  }
  rowToObject(row, columns) {
    if (!Array.isArray(row)) {
      return row || {};
    }
    return Object.fromEntries(
      columns.map((column, index) => [column, row[index]])
    );
  }
  parsePayload(rawValue) {
    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        return {};
      }
    }
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      return rawValue;
    }
    return {};
  }
  extractSessionValues(payload) {
    return {
      user_id: payload.user_id,
      agent_id: payload.agent_id,
      run_id: payload.run_id
    };
  }
  assertVectorDimension(vector, label) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `${label} dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new Error(
          `${label} values must be finite numbers for Databricks vector search.`
        );
      }
    }
  }
  matchFieldCondition(vector, key, value) {
    const fieldValue = key === "memory_id" ? vector.id : vector.payload[key];
    if (typeof value !== "object" || value === null) {
      if (value === "*") {
        return true;
      }
      return fieldValue === value;
    }
    if (Array.isArray(value)) {
      return value.includes(fieldValue);
    }
    let sawOperator = false;
    if ("eq" in value) {
      sawOperator = true;
      if (fieldValue !== value.eq) {
        return false;
      }
    }
    if ("ne" in value) {
      sawOperator = true;
      if (fieldValue === value.ne) {
        return false;
      }
    }
    if ("gt" in value) {
      sawOperator = true;
      if (!(fieldValue > value.gt)) {
        return false;
      }
    }
    if ("gte" in value) {
      sawOperator = true;
      if (!(fieldValue >= value.gte)) {
        return false;
      }
    }
    if ("lt" in value) {
      sawOperator = true;
      if (!(fieldValue < value.lt)) {
        return false;
      }
    }
    if ("lte" in value) {
      sawOperator = true;
      if (!(fieldValue <= value.lte)) {
        return false;
      }
    }
    if ("in" in value) {
      sawOperator = true;
      if (!Array.isArray(value.in) || !value.in.includes(fieldValue)) {
        return false;
      }
    }
    if ("nin" in value) {
      sawOperator = true;
      if (Array.isArray(value.nin) && value.nin.includes(fieldValue)) {
        return false;
      }
    }
    if ("contains" in value) {
      sawOperator = true;
      if (typeof fieldValue !== "string" || !fieldValue.includes(value.contains)) {
        return false;
      }
    }
    if ("icontains" in value) {
      sawOperator = true;
      if (typeof fieldValue !== "string" || !fieldValue.toLowerCase().includes(value.icontains.toLowerCase())) {
        return false;
      }
    }
    return sawOperator ? true : fieldValue === value;
  }
  filterVector(vector, filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return true;
    }
    const keyMap = {
      $and: "AND",
      $or: "OR",
      $not: "NOT"
    };
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      const normalizedKey = keyMap[key] || key;
      if (!(normalizedKey in normalized)) {
        normalized[normalizedKey] = value;
      }
    }
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "AND") {
        if (!Array.isArray(value)) {
          throw new Error(
            `AND filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        if (!value.every(
          (entry) => this.filterVector(vector, entry)
        )) {
          return false;
        }
      } else if (key === "OR") {
        if (!Array.isArray(value)) {
          throw new Error(
            `OR filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        if (!value.some(
          (entry) => this.filterVector(vector, entry)
        )) {
          return false;
        }
      } else if (key === "NOT") {
        if (!Array.isArray(value)) {
          throw new Error(
            `NOT filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        if (!value.every(
          (entry) => !this.filterVector(vector, entry)
        )) {
          return false;
        }
      } else if (!this.matchFieldCondition(vector, key, value)) {
        return false;
      }
    }
    return true;
  }
};

// src/oss/src/vector_stores/neptune_analytics.ts
var NeptuneAnalyticsVectorStore = class {
  constructor(config) {
    this.graphIdentifier = this.resolveGraphIdentifier(config);
    this.collectionName = config.collectionName || "memories";
    this.collectionLabel = `MEM0_VECTOR_${this.collectionName}`;
    this.collectionLabelExpr = this.escapeLabel(this.collectionLabel);
    this.userLabel = "MEM0_VECTOR_memory_migrations";
    this.userLabelExpr = this.escapeLabel(this.userLabel);
    this.userNodeId = "mem0-user";
    this.dimension = config.dimension || 1536;
    this.clientConfig = this.buildClientConfig(config);
    this.clientOverride = config.client;
    void this.initialize().catch(console.error);
  }
  initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    return;
  }
  async insert(vectors, ids, payloads) {
    this.assertBatchDimensions(vectors, "Insert");
    const existingIds = await this.findExistingIds(ids);
    const rows = vectors.map((vector, index) => ({
      node_id: ids[index],
      properties: this.buildStoredPayload(payloads[index] || {}),
      embedding: vector
    }));
    const propertiesQuery = `
      UNWIND $rows AS row
      MERGE (n:${this.collectionLabelExpr} {\`~id\`: row.node_id})
      ON CREATE SET n = row.properties
      ON MATCH SET n += row.properties
    `;
    const vectorQuery = `
      UNWIND $rows AS row
      MATCH (n:${this.collectionLabelExpr} {\`~id\`: row.node_id})
      WITH n, row.embedding AS embedding
      CALL neptune.algo.vectors.upsert(n, embedding)
      YIELD success
      RETURN success
    `;
    try {
      await this.executeQuery(propertiesQuery, { rows });
      const results = await this.executeQuery(vectorQuery, { rows });
      this.assertSuccessfulResults(results, "Insert");
    } catch (error) {
      await this.cleanupFailedInsert(ids.filter((id) => !existingIds.has(id)));
      throw error;
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    this.assertVectorDimension(query, "Query");
    const vertexFilter = this.buildVertexFilter(filters);
    const results = await this.executeQuery(
      `
        CALL neptune.algo.vectors.topK.byEmbedding(
          ${this.serializeAlgorithmInput({
        topK,
        embedding: query,
        vertexFilter
      })}
        )
        YIELD node, score
        RETURN node, score
      `
    );
    return results.map((record) => this.normalizeSearchResult(record));
  }
  async get(vectorId) {
    const results = await this.executeQuery(
      `
        MATCH (n:${this.collectionLabelExpr} {\`~id\`: $vectorId})
        RETURN n
        LIMIT 1
      `,
      {
        vectorId
      }
    );
    if (results.length === 0) {
      return null;
    }
    return this.normalizeNodeResult(results[0]);
  }
  async update(vectorId, vector, payload) {
    if (vector.length > 0) {
      this.assertVectorDimension(vector, "Vector");
    }
    const hasPayload = !!payload && Object.keys(payload).length > 0;
    const hasVector = vector.length > 0;
    const priorResult = hasPayload && hasVector ? await this.get(vectorId) : null;
    if (hasPayload) {
      const properties = this.buildStoredPayload(payload);
      await this.executeQuery(
        `
          MATCH (n:${this.collectionLabelExpr} {\`~id\`: $vectorId})
          SET n = $properties
          RETURN n
        `,
        {
          vectorId,
          properties
        }
      );
    }
    if (hasVector) {
      try {
        const updateResults = await this.executeQuery(
          `
            MATCH (n:${this.collectionLabelExpr} {\`~id\`: $vectorId})
            WITH n, $embedding AS embedding
            CALL neptune.algo.vectors.upsert(n, embedding)
            YIELD success
            RETURN success
          `,
          {
            vectorId,
            embedding: vector
          }
        );
        this.assertSuccessfulResults(updateResults, "Update");
      } catch (error) {
        if (priorResult) {
          try {
            await this.executeQuery(
              `
                MATCH (n:${this.collectionLabelExpr} {\`~id\`: $vectorId})
                SET n = $properties
                RETURN n
              `,
              {
                vectorId,
                properties: priorResult.payload
              }
            );
          } catch (restoreError) {
            console.error(
              "Neptune Analytics: failed to restore prior payload after a failed update upsert",
              restoreError
            );
          }
        }
        throw error;
      }
    }
  }
  async delete(vectorId) {
    await this.executeQuery(
      `
        MATCH (n:${this.collectionLabelExpr} {\`~id\`: $vectorId})
        DETACH DELETE n
      `,
      {
        vectorId
      }
    );
  }
  async deleteCol() {
    await this.executeQuery(
      `
        MATCH (n:${this.collectionLabelExpr})
        DETACH DELETE n
      `
    );
  }
  async list(filters, topK = 100) {
    var _a2;
    const { clause, parameters } = this.buildWhereClause(filters);
    const whereClause = clause ? `WHERE ${clause}` : "";
    const [results, countResults] = await Promise.all([
      this.executeQuery(
        `
          MATCH (n:${this.collectionLabelExpr})
          ${whereClause}
          RETURN n
          LIMIT $limit
        `,
        {
          ...parameters,
          limit: topK
        }
      ),
      this.executeQuery(
        `
          MATCH (n:${this.collectionLabelExpr})
          ${whereClause}
          RETURN count(n) AS count
        `,
        parameters
      )
    ]);
    const items = results.map((record) => this.normalizeNodeResult(record));
    const count = Number((_a2 = countResults[0]) == null ? void 0 : _a2.count);
    return [items, Number.isFinite(count) ? count : items.length];
  }
  async getUserId() {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }
    const results = await this.executeQuery(
      `
        MATCH (n:${this.userLabelExpr} {\`~id\`: $userNodeId})
        RETURN n
        LIMIT 1
      `,
      {
        userNodeId: this.userNodeId
      }
    );
    const existing = results[0];
    const userId = existing ? this.extractUserId(existing) : void 0;
    if (userId) {
      this.cachedUserId = userId;
      return userId;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.setUserId(randomUserId2);
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.executeQuery(
      `
        MERGE (n:${this.userLabelExpr} {\`~id\`: $userNodeId})
        SET n.user_id = $userId
        RETURN n
      `,
      {
        userNodeId: this.userNodeId,
        userId
      }
    );
    this.cachedUserId = userId;
  }
  async findExistingIds(nodeIds) {
    if (nodeIds.length === 0) {
      return /* @__PURE__ */ new Set();
    }
    const results = await this.executeQuery(
      `
        UNWIND $nodeIds AS nodeId
        MATCH (n:${this.collectionLabelExpr} {\`~id\`: nodeId})
        RETURN nodeId
      `,
      {
        nodeIds
      }
    );
    return new Set(
      results.map((record) => record.nodeId).filter((nodeId) => typeof nodeId === "string")
    );
  }
  async cleanupFailedInsert(nodeIds) {
    if (nodeIds.length === 0) {
      return;
    }
    try {
      await this.executeQuery(
        `
          UNWIND $nodeIds AS nodeId
          MATCH (n:${this.collectionLabelExpr} {\`~id\`: nodeId})
          DETACH DELETE n
        `,
        {
          nodeIds
        }
      );
    } catch (error) {
      console.error(
        "Neptune Analytics: failed to clean up node(s) after a failed insert",
        error
      );
    }
  }
  resolveGraphIdentifier(config) {
    if (config.graphIdentifier) {
      return config.graphIdentifier;
    }
    const rawIdentifier = config.endpoint;
    if (!rawIdentifier) {
      throw new Error(
        "Neptune Analytics vector store requires graphIdentifier or endpoint."
      );
    }
    if (/^https?:\/\//i.test(rawIdentifier)) {
      throw new Error(
        "Neptune Analytics HTTPS endpoints require graphIdentifier; pass graphIdentifier separately or use neptune-graph://<graph-id>."
      );
    }
    if (rawIdentifier.startsWith("neptune-graph://")) {
      return rawIdentifier.slice("neptune-graph://".length);
    }
    return rawIdentifier;
  }
  buildClientConfig(config) {
    const {
      client: _client,
      collectionName: _collectionName,
      dimension: _dimension,
      graphIdentifier: _graphIdentifier,
      endpoint,
      ...clientConfig
    } = config;
    if (endpoint && /^https?:\/\//i.test(endpoint)) {
      return {
        ...clientConfig,
        endpoint
      };
    }
    return clientConfig;
  }
  escapeLabel(label) {
    return `\`${label.replace(/`/g, "``")}\``;
  }
  buildStoredPayload(payload) {
    return {
      ...payload,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  buildVertexFilter(filters) {
    const conditions = [
      {
        equals: {
          property: "~label",
          value: this.collectionLabel
        }
      }
    ];
    const metadataFilter = this.buildMetadataVertexFilter(filters);
    if (metadataFilter) {
      conditions.push(metadataFilter);
    }
    return this.combineVertexFilters("andAll", conditions);
  }
  buildMetadataVertexFilter(filters) {
    const operations = [];
    for (const [key, value] of Object.entries(filters || {})) {
      if (value === void 0) {
        continue;
      }
      if (key === "$and" || key === "$or") {
        if (!Array.isArray(value)) {
          throw new Error(`${key} filter value must be an array.`);
        }
        const nested = value.map((entry) => this.buildMetadataVertexFilter(entry)).filter((entry) => !!entry);
        const joiner = key === "$and" ? "andAll" : "orAll";
        const combined = this.combineVertexFilters(joiner, nested);
        if (combined) {
          operations.push(combined);
        }
        continue;
      }
      if (key === "$not") {
        if (!Array.isArray(value)) {
          throw new Error("$not filter value must be an array.");
        }
        const nested = value.map((entry) => this.buildMetadataVertexFilter(entry)).filter((entry) => !!entry).map((entry) => this.negateVertexFilter(entry));
        const combined = this.combineVertexFilters("andAll", nested);
        if (combined) {
          operations.push(combined);
        }
        continue;
      }
      operations.push(this.buildFieldVertexFilter(key, value));
    }
    return this.combineVertexFilters("andAll", operations);
  }
  combineVertexFilters(joiner, operations) {
    if (operations.length === 0) {
      return void 0;
    }
    if (operations.length === 1) {
      return operations[0];
    }
    return {
      [joiner]: operations
    };
  }
  buildFieldVertexFilter(key, value) {
    if (value === "*") {
      throw new Error(
        "Neptune Analytics vector search does not support property-existence filters."
      );
    }
    if (Array.isArray(value)) {
      return {
        in: {
          property: key,
          value
        }
      };
    }
    if (typeof value !== "object" || value === null) {
      return {
        equals: {
          property: key,
          value
        }
      };
    }
    const operations = Object.entries(value).map(
      ([operator, operand]) => this.buildSingleVertexFilter(key, operator, operand)
    );
    return this.combineVertexFilters("andAll", operations);
  }
  buildSingleVertexFilter(key, operator, operand) {
    switch (operator) {
      case "eq":
        return {
          equals: {
            property: key,
            value: operand
          }
        };
      case "ne":
        return {
          notEquals: {
            property: key,
            value: operand
          }
        };
      case "gt":
        return {
          greaterThan: {
            property: key,
            value: operand
          }
        };
      case "gte":
        return {
          greaterThanOrEquals: {
            property: key,
            value: operand
          }
        };
      case "lt":
        return {
          lessThan: {
            property: key,
            value: operand
          }
        };
      case "lte":
        return {
          lessThanOrEquals: {
            property: key,
            value: operand
          }
        };
      case "in":
        return {
          in: {
            property: key,
            value: operand
          }
        };
      case "nin":
        return {
          notIn: {
            property: key,
            value: operand
          }
        };
      case "contains":
        return {
          stringContains: {
            property: key,
            value: operand
          }
        };
      case "startsWith":
        return {
          startsWith: {
            property: key,
            value: operand
          }
        };
      case "icontains":
        throw new Error(
          "Neptune Analytics vector search does not support case-insensitive contains filters."
        );
      default:
        throw new Error(
          `Unsupported Neptune Analytics filter operator: ${operator}`
        );
    }
  }
  negateVertexFilter(filter) {
    if (Array.isArray(filter.andAll)) {
      return this.combineVertexFilters(
        "orAll",
        filter.andAll.map(
          (entry) => this.negateVertexFilter(entry)
        )
      );
    }
    if (Array.isArray(filter.orAll)) {
      return this.combineVertexFilters(
        "andAll",
        filter.orAll.map(
          (entry) => this.negateVertexFilter(entry)
        )
      );
    }
    if (filter.equals) {
      return {
        notEquals: filter.equals
      };
    }
    if (filter.notEquals) {
      return {
        equals: filter.notEquals
      };
    }
    if (filter.greaterThan) {
      return {
        lessThanOrEquals: filter.greaterThan
      };
    }
    if (filter.greaterThanOrEquals) {
      return {
        lessThan: filter.greaterThanOrEquals
      };
    }
    if (filter.lessThan) {
      return {
        greaterThanOrEquals: filter.lessThan
      };
    }
    if (filter.lessThanOrEquals) {
      return {
        greaterThan: filter.lessThanOrEquals
      };
    }
    if (filter.in) {
      return {
        notIn: filter.in
      };
    }
    if (filter.notIn) {
      return {
        in: filter.notIn
      };
    }
    throw new Error(
      "Neptune Analytics cannot negate this filter shape for vector search."
    );
  }
  buildWhereClause(filters, startIndex = 1) {
    const clauses = [];
    const parameters = {};
    let nextIndex = startIndex;
    for (const [key, value] of Object.entries(filters || {})) {
      if (value === void 0) {
        continue;
      }
      if (key === "$and" || key === "$or") {
        if (!Array.isArray(value)) {
          throw new Error(`${key} filter value must be an array.`);
        }
        const nestedClauses = [];
        for (const entry of value) {
          const nested = this.buildWhereClause(entry, nextIndex);
          nextIndex = nested.nextIndex;
          Object.assign(parameters, nested.parameters);
          if (nested.clause) {
            nestedClauses.push(nested.clause);
          }
        }
        if (nestedClauses.length > 0) {
          const joiner = key === "$and" ? " AND " : " OR ";
          clauses.push(`(${nestedClauses.join(joiner)})`);
        }
        continue;
      }
      if (key === "$not") {
        if (!Array.isArray(value)) {
          throw new Error("$not filter value must be an array.");
        }
        const nestedClauses = [];
        for (const entry of value) {
          const nested = this.buildWhereClause(entry, nextIndex);
          nextIndex = nested.nextIndex;
          Object.assign(parameters, nested.parameters);
          if (nested.clause) {
            nestedClauses.push(nested.clause);
          }
        }
        if (nestedClauses.length > 0) {
          clauses.push(`NOT (${nestedClauses.join(" OR ")})`);
        }
        continue;
      }
      const fieldResult = this.buildFieldWhereClauses(key, value, nextIndex);
      nextIndex = fieldResult.nextIndex;
      Object.assign(parameters, fieldResult.parameters);
      clauses.push(...fieldResult.clauses);
    }
    return {
      clause: clauses.join(" AND "),
      parameters,
      nextIndex
    };
  }
  buildFieldWhereClauses(key, value, startIndex) {
    const field = `n.${this.escapeProperty(key)}`;
    const parameters = {};
    const clauses = [];
    let nextIndex = startIndex;
    const addParameter = (prefix, rawValue) => {
      const parameterName = `${prefix}_${key.replace(/[^\w]/g, "_")}_${nextIndex}`;
      parameters[parameterName] = rawValue;
      nextIndex += 1;
      return parameterName;
    };
    if (value === "*") {
      return {
        clauses: [`${field} IS NOT NULL`],
        parameters,
        nextIndex
      };
    }
    if (Array.isArray(value)) {
      const parameterName = addParameter("filter_in", value);
      return {
        clauses: [`${field} IN $${parameterName}`],
        parameters,
        nextIndex
      };
    }
    if (typeof value !== "object" || value === null) {
      const parameterName = addParameter("filter", value);
      return {
        clauses: [`${field} = $${parameterName}`],
        parameters,
        nextIndex
      };
    }
    for (const [operator, operand] of Object.entries(value)) {
      const parameterName = addParameter(`filter_${operator}`, operand);
      switch (operator) {
        case "eq":
          clauses.push(`${field} = $${parameterName}`);
          break;
        case "ne":
          clauses.push(`${field} <> $${parameterName}`);
          break;
        case "gt":
          clauses.push(`${field} > $${parameterName}`);
          break;
        case "gte":
          clauses.push(`${field} >= $${parameterName}`);
          break;
        case "lt":
          clauses.push(`${field} < $${parameterName}`);
          break;
        case "lte":
          clauses.push(`${field} <= $${parameterName}`);
          break;
        case "in":
          clauses.push(`${field} IN $${parameterName}`);
          break;
        case "nin":
          clauses.push(`NOT ${field} IN $${parameterName}`);
          break;
        case "contains":
          clauses.push(`toString(${field}) CONTAINS $${parameterName}`);
          break;
        case "icontains":
          throw new Error(
            "Neptune Analytics list filters do not support case-insensitive contains filters."
          );
        case "startsWith":
          clauses.push(`toString(${field}) STARTS WITH $${parameterName}`);
          break;
        default:
          throw new Error(
            `Unsupported Neptune Analytics filter operator: ${operator}`
          );
      }
    }
    return {
      clauses,
      parameters,
      nextIndex
    };
  }
  escapeProperty(key) {
    return `\`${key.replace(/`/g, "``")}\``;
  }
  serializeAlgorithmInput(value) {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.serializeAlgorithmInput(entry)).join(", ")}]`;
    }
    if (value === null) {
      return "null";
    }
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "object") {
      return `{ ${Object.entries(value).map(
        ([key, entry]) => `${this.serializeAlgorithmKey(key)}: ${this.serializeAlgorithmInput(entry)}`
      ).join(", ")} }`;
    }
    throw new Error(
      `Unsupported Neptune Analytics algorithm value type: ${typeof value}`
    );
  }
  serializeAlgorithmKey(key) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return key;
    }
    return JSON.stringify(key);
  }
  assertVectorDimension(vector, context) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `${context} dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }
  }
  assertBatchDimensions(vectors, context) {
    for (const vector of vectors) {
      this.assertVectorDimension(vector, context);
    }
  }
  normalizeNodeResult(record) {
    const node = this.extractNode(record);
    const payload = this.normalizePayload(this.extractPayload(node));
    return {
      id: this.extractId(node, record),
      payload
    };
  }
  normalizeSearchResult(record) {
    const base = this.normalizeNodeResult(record);
    const score = this.normalizeScore(record.score);
    return {
      ...base,
      score
    };
  }
  extractNode(record) {
    return record.n || record.node || record.m || record.item || record.v || record;
  }
  extractPayload(node) {
    return node["~properties"] || node.properties || node.payload || {};
  }
  extractId(node, record) {
    const rawId = node["~id"] || node.id || record.id;
    return String(rawId);
  }
  extractUserId(record) {
    const node = this.extractNode(record);
    const payload = this.extractPayload(node);
    const userId = payload.user_id || payload.userId;
    return userId ? String(userId) : void 0;
  }
  normalizePayload(payload) {
    return { ...payload };
  }
  normalizeScore(score) {
    if (score === void 0 || score === null) {
      return void 0;
    }
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) {
      return void 0;
    }
    return 1 / (1 + Math.max(0, numericScore));
  }
  assertSuccessfulResults(results, context) {
    for (const record of results) {
      if ("success" in record && record.success !== true) {
        throw new Error(`${context} failed in Neptune Analytics`);
      }
    }
  }
  /**
   * Load the optional AWS SDK on first use.
   *
   * This MUST be a dynamic `import()`, never `require()`: tsup/esbuild rewrite
   * `require()` in the published ESM bundle (`dist/oss/index.mjs`) into a
   * `__require` shim that throws `Dynamic require of "..." is not supported`,
   * so every ESM consumer would hit a dead provider even with the SDK installed.
   */
  async getSDK() {
    if (!this.sdkPromise) {
      this.sdkPromise = import("@aws-sdk/client-neptune-graph").then(
        (sdk) => sdk,
        (err) => {
          this.sdkPromise = void 0;
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `The '@aws-sdk/client-neptune-graph' package is required to use the Neptune Analytics vector store. Install it with: npm install @aws-sdk/client-neptune-graph (original error: ${detail})`
          );
        }
      );
    }
    return this.sdkPromise;
  }
  /** Memoized Neptune client; an injected `config.client` short-circuits the SDK. */
  async getClient() {
    if (this.clientOverride) return this.clientOverride;
    if (!this.clientPromise) {
      this.clientPromise = this.getSDK().then(
        ({ NeptuneGraphClient }) => new NeptuneGraphClient(this.clientConfig)
      ).catch((err) => {
        this.clientPromise = void 0;
        throw err;
      });
    }
    return this.clientPromise;
  }
  async executeQuery(queryString, parameters = {}) {
    const [client, sdk] = await Promise.all([this.getClient(), this.getSDK()]);
    const response = await client.send(
      new sdk.ExecuteQueryCommand({
        graphIdentifier: this.graphIdentifier,
        language: "OPEN_CYPHER",
        queryString,
        parameters: Object.keys(parameters).length > 0 ? parameters : void 0
      })
    );
    const rawPayload = response.payload ? await response.payload.transformToString("utf-8") : "";
    if (!rawPayload.trim()) {
      return [];
    }
    const parsed = JSON.parse(rawPayload);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.results)) {
      return parsed.results;
    }
    if (Array.isArray(parsed.result)) {
      return parsed.result;
    }
    return [];
  }
};

// src/oss/src/embeddings/vertexai.ts
function maxInstancesPerRequest(model) {
  return model.startsWith("gemini-embedding") ? 1 : 250;
}
function isValidEmbedding(value) {
  if (typeof value !== "object" || value === null) return false;
  const obj = value;
  if (typeof obj.embeddings !== "object" || obj.embeddings === null)
    return false;
  const embeddings = obj.embeddings;
  const values = embeddings.values;
  return Array.isArray(values) && values.every((v) => typeof v === "number" && Number.isFinite(v));
}
var VertexAIEmbedder = class {
  constructor(config) {
    this.model = config.model || "gemini-embedding-001";
    this.embeddingDims = config.embeddingDims || 256;
    this.location = config.location || process.env.GCP_LOCATION || "us-central1";
    this.projectId = config.googleProjectId || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
    this.embeddingTypes = {
      add: config.memoryAddEmbeddingType || "RETRIEVAL_DOCUMENT",
      update: config.memoryUpdateEmbeddingType || "RETRIEVAL_DOCUMENT",
      search: config.memorySearchEmbeddingType || "RETRIEVAL_QUERY"
    };
    const endpoint = `${this.location}-aiplatform.googleapis.com`;
    this.clientOptions = { apiEndpoint: endpoint };
    if (config.vertexCredentialsJson) {
      this.clientOptions.keyFilename = config.vertexCredentialsJson;
    } else if (config.googleServiceAccountJson) {
      try {
        this.clientOptions.credentials = typeof config.googleServiceAccountJson === "string" ? JSON.parse(config.googleServiceAccountJson) : config.googleServiceAccountJson;
      } catch (err) {
        throw new Error(
          "Failed to parse googleServiceAccountJson: " + err.message
        );
      }
    }
  }
  async initClient() {
    if (!this.initPromise) {
      this.initPromise = this.createClient().catch((err) => {
        this.initPromise = void 0;
        throw err;
      });
    }
    await this.initPromise;
  }
  async createClient() {
    const aiplatform = await loadPeer(
      "@google-cloud/aiplatform",
      "Vertex AI embedding provider",
      () => import("@google-cloud/aiplatform")
    );
    const client = new aiplatform.PredictionServiceClient(this.clientOptions);
    if (!this.projectId) {
      try {
        this.projectId = await client.getProjectId();
      } catch (err) {
        throw new Error(
          "Vertex AI could not determine a Google Cloud project ID. Set googleProjectId in config, one of the GCP_PROJECT_ID / GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT env vars, or configure Application Default Credentials: " + err.message
        );
      }
    }
    this.client = client;
    this.helpers = aiplatform.helpers;
  }
  endpoint() {
    return `projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.model}`;
  }
  formatInstance(text, taskType) {
    return {
      content: text,
      task_type: taskType
    };
  }
  async embed(text, memoryAction) {
    await this.initClient();
    if (!this.client || !this.helpers) {
      throw new Error("Client not initialized");
    }
    let embeddingType = "SEMANTIC_SIMILARITY";
    if (memoryAction !== void 0) {
      if (!(memoryAction in this.embeddingTypes)) {
        throw new Error(`Invalid memory action: ${memoryAction}`);
      }
      embeddingType = this.embeddingTypes[memoryAction];
    }
    const instance = this.formatInstance(text, embeddingType);
    const parameters = {
      outputDimensionality: this.embeddingDims
    };
    const [response] = await this.client.predict({
      endpoint: this.endpoint(),
      instances: [this.helpers.toValue(instance)],
      parameters: this.helpers.toValue(parameters)
    });
    if (!response.predictions || response.predictions.length === 0) {
      throw new Error("No predictions returned from Vertex AI");
    }
    const decoded = this.helpers.fromValue(response.predictions[0]);
    if (!isValidEmbedding(decoded)) {
      throw new Error("Failed to extract embedding values from response");
    }
    return decoded.embeddings.values;
  }
  async embedBatch(texts, memoryAction = "add") {
    if (!texts || texts.length === 0) {
      return [];
    }
    await this.initClient();
    if (!this.client || !this.helpers) {
      throw new Error("Client not initialized");
    }
    if (!(memoryAction in this.embeddingTypes)) {
      throw new Error(`Invalid memory action: ${memoryAction}`);
    }
    const embeddingType = this.embeddingTypes[memoryAction];
    const allEmbeddings = [];
    const batchSize = maxInstancesPerRequest(this.model);
    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const instances = chunk.map(
        (text) => this.helpers.toValue(
          this.formatInstance(text, embeddingType)
        )
      );
      const parameters = {
        outputDimensionality: this.embeddingDims
      };
      const [response] = await this.client.predict({
        endpoint: this.endpoint(),
        instances,
        parameters: this.helpers.toValue(parameters)
      });
      if (!response.predictions || response.predictions.length === 0) {
        throw new Error("No predictions returned from Vertex AI batch request");
      }
      for (const prediction of response.predictions) {
        const decoded = this.helpers.fromValue(prediction);
        if (!isValidEmbedding(decoded)) {
          throw new Error(
            "Failed to extract embedding values from batch response"
          );
        }
        allEmbeddings.push(decoded.embeddings.values);
      }
    }
    if (allEmbeddings.length !== texts.length) {
      throw new Error(
        `Vertex AI embedBatch() returned ${allEmbeddings.length} embeddings for ${texts.length} texts using model '${this.model}'`
      );
    }
    return allEmbeddings;
  }
};

// src/oss/src/vector_stores/elasticsearch.ts
var SAFE_FILTER_KEY2 = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function validateFilter(key, value) {
  if (typeof key !== "string" || !SAFE_FILTER_KEY2.test(key)) {
    throw new Error(`Invalid filter key: ${JSON.stringify(key)}`);
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error(
      `Filter value for ${JSON.stringify(key)} must be string, number, or boolean`
    );
  }
}
var ElasticsearchDB = class {
  constructor(config) {
    this.config = config;
    this.collectionName = config.collectionName;
    this.dimension = config.dimension || config.embeddingModelDims || 1536;
    this.autoCreateIndex = config.autoCreateIndex !== false;
    this.initialize().catch(console.error);
  }
  // The client is created lazily on first initialize() so the optional
  // `@elastic/elasticsearch` peer is only loaded when the store is actually used.
  async ensureClient() {
    if (this.client) return;
    const config = this.config;
    if (config.client) {
      this.client = config.client;
    } else {
      const params = {};
      if (config.cloudId) {
        params.cloud = { id: config.cloudId };
        if (config.apiKey) {
          params.auth = { apiKey: config.apiKey };
        }
      } else {
        const host = config.host || "localhost";
        const port = config.port || 9200;
        params.node = `${config.useSsl !== false ? "https" : "http"}://${host}:${port}`;
        if (config.apiKey) {
          params.auth = { apiKey: config.apiKey };
        } else if (config.username && config.password) {
          params.auth = {
            username: config.username,
            password: config.password
          };
        }
      }
      if (config.verifyCerts !== void 0) {
        params.tls = { rejectUnauthorized: config.verifyCerts };
      }
      if (config.caCerts) {
        params.tls = { ...params.tls, ca: config.caCerts };
      }
      if (config.headers) {
        params.headers = config.headers;
      }
      const sdk = await loadPeer(
        "@elastic/elasticsearch",
        "Elasticsearch vector store",
        () => import("@elastic/elasticsearch")
      );
      this.client = new sdk.Client(params);
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureClient();
    try {
      if (this.autoCreateIndex) {
        await this.ensureIndex(this.collectionName, this.dimension);
      }
      await this.ensureIndex("memory_migrations", 1);
    } catch (error) {
      console.error("Error initializing Elasticsearch:", error);
      throw error;
    }
  }
  async ensureIndex(name, size) {
    const exists = await this.client.indices.exists({ index: name });
    if (!exists) {
      await this.client.indices.create({
        index: name,
        settings: {
          number_of_replicas: 1,
          number_of_shards: 5,
          refresh_interval: "1s"
        },
        mappings: {
          properties: {
            vector: {
              type: "dense_vector",
              dims: size,
              index: true,
              similarity: "cosine"
            },
            metadata: {
              type: "object",
              properties: {
                user_id: { type: "keyword" },
                agent_id: { type: "keyword" },
                run_id: { type: "keyword" }
              }
            }
          }
        }
      });
    }
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const operations = [];
    for (let i = 0; i < vectors.length; i++) {
      operations.push(
        { index: { _index: this.collectionName, _id: ids[i] } },
        { vector: vectors[i], metadata: payloads[i] || {} }
      );
    }
    await this.client.bulk({ operations });
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const searchBody = {
      knn: {
        field: "vector",
        query_vector: query,
        k: topK,
        num_candidates: topK * 2
      }
    };
    if (filters && Object.keys(filters).length > 0) {
      const filterConditions = Object.entries(filters).map(([key, value]) => {
        validateFilter(key, value);
        return { term: { [`metadata.${key}`]: value } };
      });
      searchBody.knn.filter = { bool: { must: filterConditions } };
    }
    const response = await this.client.search({
      index: this.collectionName,
      ...searchBody
    });
    return response.hits.hits.map((hit) => {
      var _a2;
      return {
        id: hit._id,
        score: hit._score,
        payload: ((_a2 = hit._source) == null ? void 0 : _a2.metadata) || {}
      };
    });
  }
  async get(vectorId) {
    var _a2, _b2;
    await this.initialize();
    try {
      const response = await this.client.get({
        index: this.collectionName,
        id: vectorId
      });
      return {
        id: response._id,
        payload: ((_a2 = response._source) == null ? void 0 : _a2.metadata) || {}
      };
    } catch (error) {
      if (((_b2 = error == null ? void 0 : error.meta) == null ? void 0 : _b2.statusCode) === 404) return null;
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const doc = {};
    if (vector) doc.vector = vector;
    if (payload) doc.metadata = payload;
    await this.client.update({
      index: this.collectionName,
      id: vectorId,
      doc
    });
  }
  async delete(vectorId) {
    await this.initialize();
    await this.client.delete({
      index: this.collectionName,
      id: vectorId
    });
  }
  async deleteCol() {
    await this.initialize();
    await this.client.indices.delete({ index: this.collectionName });
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const query = { query: { match_all: {} } };
    if (filters && Object.keys(filters).length > 0) {
      const filterConditions = Object.entries(filters).map(([key, value]) => {
        validateFilter(key, value);
        return { term: { [`metadata.${key}`]: value } };
      });
      query.query = { bool: { must: filterConditions } };
    }
    query.size = topK;
    const response = await this.client.search({
      index: this.collectionName,
      ...query
    });
    const results = response.hits.hits.map((hit) => {
      var _a2;
      return {
        id: hit._id,
        payload: ((_a2 = hit._source) == null ? void 0 : _a2.metadata) || {}
      };
    });
    return [results, results.length];
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  async getUserId() {
    var _a2, _b2;
    await this.initialize();
    try {
      const response = await this.client.search({
        index: "memory_migrations",
        query: { match_all: {} },
        size: 1
      });
      if (response.hits.hits.length > 0) {
        return (_b2 = (_a2 = response.hits.hits[0]._source) == null ? void 0 : _a2.metadata) == null ? void 0 : _b2.user_id;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.client.index({
        index: "memory_migrations",
        id: this.generateUUID(),
        document: { metadata: { user_id: randomUserId2 } }
      });
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  async setUserId(userId) {
    await this.initialize();
    try {
      const response = await this.client.search({
        index: "memory_migrations",
        query: { match_all: {} },
        size: 1
      });
      const docId = response.hits.hits.length > 0 ? response.hits.hits[0]._id : this.generateUUID();
      await this.client.index({
        index: "memory_migrations",
        id: docId,
        document: { metadata: { user_id: userId } }
      });
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/opensearch.ts
var KEY_MAP2 = {
  $and: "AND",
  $or: "OR",
  $not: "NOT"
};
function responseBody(response) {
  if (response && typeof response === "object" && "body" in response && response.body !== void 0) {
    return response.body;
  }
  return response;
}
function escapeWildcard(value) {
  return value.replace(/([\\*?])/g, "\\$1");
}
var OpenSearchDB = class {
  constructor(config) {
    var _a2;
    this.config = config;
    this.collectionName = config.collectionName;
    this.embeddingModelDims = config.embeddingModelDims;
    this.autoRefresh = (_a2 = config.autoRefresh) != null ? _a2 : false;
    this.initialize().catch(console.error);
  }
  // The client is created lazily on first initialize() so the optional
  // `@opensearch-project/opensearch` peer is only loaded when the store is
  // actually used.
  async ensureClient() {
    var _a2, _b2;
    if (this.client) return;
    const config = this.config;
    if (config.client) {
      this.client = config.client;
    } else {
      const useSSL = (_a2 = config.useSSL) != null ? _a2 : false;
      const host = config.host || "localhost";
      const port = config.port || 9200;
      const auth = config.httpAuth || (config.user && config.password ? { username: config.user, password: config.password } : void 0);
      const sdk = await loadPeer(
        "@opensearch-project/opensearch",
        "OpenSearch vector store",
        () => import("@opensearch-project/opensearch")
      );
      this.client = new sdk.Client({
        node: `${useSSL ? "https" : "http"}://${host}:${port}`,
        auth: this.normalizeAuth(auth),
        ssl: {
          // Default false to match the Python SDK: self-hosted OpenSearch
          // commonly uses self-signed certs, so verification is opt-in.
          rejectUnauthorized: (_b2 = config.verifyCerts) != null ? _b2 : false
        }
      });
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureClient();
    await this.createCol(this.collectionName, this.embeddingModelDims);
    await this.ensureMigrationIndex();
  }
  normalizeAuth(auth) {
    if (!auth) return void 0;
    if (Array.isArray(auth)) {
      return {
        username: auth[0],
        password: auth[1]
      };
    }
    if ("user" in auth && auth.user) {
      const { user, ...rest } = auth;
      return {
        ...rest,
        username: user
      };
    }
    return auth;
  }
  async indexExists(index) {
    const response = await this.client.indices.exists({ index });
    return Boolean(responseBody(response));
  }
  async createCol(name, vectorSize) {
    if (await this.indexExists(name)) return;
    await this.client.indices.create({
      index: name,
      body: {
        settings: {
          index: {
            knn: true
          }
        },
        mappings: {
          properties: {
            vector_field: {
              type: "knn_vector",
              dimension: vectorSize,
              method: {
                engine: "nmslib",
                name: "hnsw",
                space_type: "cosinesimil"
              }
            },
            // payload is a dynamic object so that string sub-fields (user_id,
            // agent_id, run_id, and any user metadata) each get an automatic
            // `.keyword` sub-field, which the filter builder queries for exact
            // match term/terms clauses. Mapping these as explicit `keyword`
            // fields would remove the `.keyword` sub-field and make every
            // scoped filter silently match nothing.
            payload: { type: "object" },
            id: { type: "keyword" }
          }
        }
      }
    });
  }
  async ensureMigrationIndex() {
    if (await this.indexExists("memory_migrations")) return;
    await this.client.indices.create({
      index: "memory_migrations",
      body: {
        mappings: {
          properties: {
            user_id: { type: "keyword" }
          }
        }
      }
    });
  }
  validateVector(vector, index) {
    if (!vector) {
      throw new Error(`Vector at index ${index} is null or undefined.`);
    }
    if (vector.length === 0) {
      throw new Error(
        `Vector at index ${index} is empty. Expected dimension ${this.embeddingModelDims}.`
      );
    }
    if (vector.length !== this.embeddingModelDims) {
      throw new Error(
        `Vector at index ${index} has dimension ${vector.length}, but index '${this.collectionName}' expects dimension ${this.embeddingModelDims}.`
      );
    }
  }
  async insert(vectors, ids, payloads) {
    var _a2;
    await this.initialize();
    vectors.forEach((vector, index) => this.validateVector(vector, index));
    const operations = vectors.flatMap((vector, index) => {
      const id = ids[index] || String(index);
      return [
        { index: { _index: this.collectionName, _id: id } },
        {
          vector_field: vector,
          payload: payloads[index] || {},
          id
        }
      ];
    });
    if (operations.length === 0) return;
    const response = responseBody(
      await this.client.bulk({
        refresh: this.autoRefresh,
        body: operations
      })
    );
    if (response.errors) {
      const failedItem = (_a2 = response.items) == null ? void 0 : _a2.find((item) => {
        const action = item.index || item.create || item.update || item.delete;
        return action == null ? void 0 : action.error;
      });
      throw new Error(
        `OpenSearch bulk insert failed: ${JSON.stringify(failedItem)}`
      );
    }
  }
  async keywordSearch(query, topK = 5, filters) {
    await this.initialize();
    const boolQuery = {
      should: [
        { match: { "payload.data": query } },
        { match: { "payload.text_lemmatized": query } },
        { match: { "payload.textLemmatized": query } }
      ],
      minimum_should_match: 1
    };
    const filter = this.buildFilterClauses(filters);
    if (filter.length) {
      boolQuery.filter = filter;
    }
    const response = responseBody(
      await this.client.search({
        index: this.collectionName,
        body: {
          size: topK,
          query: { bool: boolQuery }
        }
      })
    );
    return response.hits.hits.map((hit) => this.hitToResult(hit));
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const knnQuery = {
      knn: {
        vector_field: {
          vector: query,
          k: topK * 2
        }
      }
    };
    const filter = this.buildFilterClauses(filters);
    const searchQuery = filter.length ? {
      bool: {
        must: knnQuery,
        filter
      }
    } : knnQuery;
    const response = responseBody(
      await this.client.search({
        index: this.collectionName,
        body: {
          size: topK * 2,
          query: searchQuery
        }
      })
    );
    return response.hits.hits.slice(0, topK).map((hit) => this.hitToResult(hit));
  }
  async get(vectorId) {
    var _a2;
    await this.initialize();
    try {
      const response = responseBody(
        await this.client.get({
          index: this.collectionName,
          id: vectorId
        })
      );
      if (!response._source) return null;
      return {
        id: response._source.id || vectorId,
        payload: response._source.payload || {}
      };
    } catch (error) {
      if ((error == null ? void 0 : error.statusCode) === 404 || ((_a2 = error == null ? void 0 : error.meta) == null ? void 0 : _a2.statusCode) === 404) {
        return null;
      }
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    if (vector) {
      this.validateVector(vector, 0);
    }
    await this.client.update({
      index: this.collectionName,
      id: vectorId,
      body: {
        doc: {
          ...vector && { vector_field: vector },
          ...payload && { payload },
          id: vectorId
        }
      },
      refresh: this.autoRefresh
    });
  }
  async delete(vectorId) {
    var _a2;
    await this.initialize();
    try {
      await this.client.delete({
        index: this.collectionName,
        id: vectorId,
        refresh: this.autoRefresh
      });
    } catch (error) {
      if ((error == null ? void 0 : error.statusCode) === 404 || ((_a2 = error == null ? void 0 : error.meta) == null ? void 0 : _a2.statusCode) === 404) {
        return;
      }
      throw error;
    }
  }
  async deleteCol() {
    await this.initialize();
    if (!await this.indexExists(this.collectionName)) return;
    await this.client.indices.delete({ index: this.collectionName });
  }
  async list(filters, topK = 100) {
    var _a2;
    await this.initialize();
    const filter = this.buildFilterClauses(filters);
    const query = filter.length ? { bool: { filter } } : { match_all: {} };
    const response = responseBody(
      await this.client.search({
        index: this.collectionName,
        body: {
          size: topK,
          query
        }
      })
    );
    const results = response.hits.hits.map((hit) => this.hitToResult(hit));
    const total = typeof response.hits.total === "number" ? response.hits.total : ((_a2 = response.hits.total) == null ? void 0 : _a2.value) || results.length;
    return [results, total];
  }
  async reset() {
    await this.initialize();
    await this.deleteCol();
    await this.createCol(this.collectionName, this.embeddingModelDims);
  }
  async getUserId() {
    var _a2, _b2, _c;
    await this.initialize();
    await this.ensureMigrationIndex();
    const response = responseBody(
      await this.client.search({
        index: "memory_migrations",
        body: {
          size: 1,
          query: { match_all: {} }
        }
      })
    );
    const existing = (_c = (_b2 = (_a2 = response.hits.hits[0]) == null ? void 0 : _a2._source) == null ? void 0 : _b2.payload) == null ? void 0 : _c.user_id;
    if (existing) return String(existing);
    const userId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.setUserId(userId);
    return userId;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.ensureMigrationIndex();
    await this.client.index({
      index: "memory_migrations",
      id: "user_id",
      body: {
        user_id: userId,
        payload: { user_id: userId }
      },
      refresh: this.autoRefresh
    });
  }
  hitToResult(hit) {
    var _a2, _b2;
    return {
      id: ((_a2 = hit._source) == null ? void 0 : _a2.id) || hit._id || "",
      payload: ((_b2 = hit._source) == null ? void 0 : _b2.payload) || {},
      score: hit._score
    };
  }
  buildFilterClauses(filters) {
    if (!filters || Object.keys(filters).length === 0) return [];
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      normalized[KEY_MAP2[key] || key] = value;
    }
    return Object.entries(normalized).map(([key, value]) => this.buildFilterClause(key, value)).filter((clause) => Boolean(clause));
  }
  buildFilterClause(key, value) {
    if (value === null || value === void 0) return null;
    if (key === "AND" || key === "OR" || key === "NOT") {
      if (!Array.isArray(value)) {
        throw new Error(`${key} filter value must be an array.`);
      }
      const clauses = value.flatMap((filter) => this.buildFilterClauses(filter)).filter(Boolean);
      if (clauses.length === 0) return null;
      if (key === "AND") {
        return { bool: { filter: clauses } };
      }
      if (key === "OR") {
        return { bool: { should: clauses, minimum_should_match: 1 } };
      }
      return { bool: { must_not: clauses } };
    }
    if (value === "*") {
      return { exists: { field: this.payloadField(key, false) } };
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.assertScalarValue(key, item));
      return { terms: { [this.payloadField(key, true)]: value } };
    }
    if (typeof value === "object") {
      return this.buildOperatorClause(key, value);
    }
    return {
      term: { [this.payloadField(key, typeof value === "string")]: value }
    };
  }
  buildOperatorClause(key, value) {
    const clauses = Object.entries(value).map(([operator, operatorValue]) => {
      switch (operator) {
        case "eq":
          this.assertScalarValue(key, operatorValue);
          return {
            term: {
              [this.payloadField(key, typeof operatorValue === "string")]: operatorValue
            }
          };
        case "ne":
          this.assertScalarValue(key, operatorValue);
          return {
            bool: {
              must_not: [
                {
                  term: {
                    [this.payloadField(key, typeof operatorValue === "string")]: operatorValue
                  }
                }
              ]
            }
          };
        case "in":
          this.assertScalarArray(key, operatorValue);
          return { terms: { [this.payloadField(key, true)]: operatorValue } };
        case "nin":
          this.assertScalarArray(key, operatorValue);
          return {
            bool: {
              must_not: [
                { terms: { [this.payloadField(key, true)]: operatorValue } }
              ]
            }
          };
        case "gt":
        case "gte":
        case "lt":
        case "lte":
          this.assertScalarValue(key, operatorValue);
          return {
            range: {
              [this.payloadField(key, false)]: {
                [operator]: operatorValue
              }
            }
          };
        case "contains":
        case "icontains":
          this.assertScalarValue(key, operatorValue);
          return {
            wildcard: {
              [this.payloadField(key, true)]: {
                value: `*${escapeWildcard(String(operatorValue))}*`,
                case_insensitive: operator === "icontains"
              }
            }
          };
        default:
          throw new Error(`Unsupported filter operator: ${operator}`);
      }
    });
    return clauses.length === 1 ? clauses[0] : { bool: { filter: clauses } };
  }
  payloadField(key, keyword) {
    if (key.startsWith("payload.")) {
      return keyword && !key.endsWith(".keyword") ? `${key}.keyword` : key;
    }
    const field = `payload.${key}`;
    return keyword ? `${field}.keyword` : field;
  }
  // Filter values become OpenSearch term/terms/range/wildcard leaves. Allowing
  // an object here lets a caller inject raw query parameters (e.g. a `term`
  // object form with `boost`/`case_insensitive`), so reject non-scalar leaves.
  // Mirrors the Python SDK's `_validate_filter` scalar allow-list (PR #5986).
  assertScalarValue(key, value) {
    if (value !== null && typeof value === "object") {
      throw new Error(
        `Filter value for '${key}' must be a string, number, or boolean, got ${Array.isArray(value) ? "an array" : "an object"}.`
      );
    }
  }
  assertScalarArray(key, value) {
    if (!Array.isArray(value)) {
      throw new Error(`Filter value for '${key}' must be an array.`);
    }
    value.forEach((item) => this.assertScalarValue(key, item));
  }
};

// src/oss/src/vector_stores/upstash_vector.ts
var UpstashVector = class {
  constructor(config) {
    if (!config.collectionName) {
      throw new Error("collectionName is required for Upstash Vector.");
    }
    if (!config.client && !(config.url && config.token)) {
      throw new Error("Either a client or url and token must be provided.");
    }
    this.config = config;
    this.collectionName = config.collectionName;
  }
  /**
   * Lazily construct (or reuse) the Upstash Vector client, importing the
   * optional `@upstash/vector` peer only when the store is first used so
   * consumers that never touch Upstash Vector don't need it installed.
   */
  async ensureClient() {
    if (this.client) return;
    const config = this.config;
    if (config.client) {
      this.client = config.client;
    } else {
      const sdk = await loadPeer(
        "@upstash/vector",
        "Upstash Vector store",
        () => import("@upstash/vector")
      );
      this.client = new sdk.Index({
        url: config.url,
        token: config.token
      });
    }
  }
  async initialize() {
    await this.ensureClient();
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const upsertData = vectors.map((vector, idx) => {
      var _a2;
      return {
        id: ids[idx],
        vector,
        metadata: (_a2 = payloads[idx]) != null ? _a2 : {}
      };
    });
    await this.client.upsert(upsertData, { namespace: this.collectionName });
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const response = await this.client.query(
      {
        vector: query,
        topK,
        filter: this.convertFilters(filters),
        includeMetadata: true
      },
      { namespace: this.collectionName }
    );
    return response.map((result) => this.parseResult(result));
  }
  async keywordSearch(query, topK = 5, filters) {
    await this.initialize();
    try {
      const response = await this.client.query(
        {
          data: query,
          topK,
          filter: this.convertFilters(filters),
          includeMetadata: true
        },
        { namespace: this.collectionName }
      );
      return response.map((result) => this.parseResult(result));
    } catch (error) {
      console.error(`Error during keyword search for query '${query}':`, error);
      return null;
    }
  }
  async get(vectorId) {
    var _a2;
    await this.initialize();
    const response = await this.client.fetch([vectorId], {
      includeMetadata: true,
      namespace: this.collectionName
    });
    const vector = response[0];
    if (!vector) {
      return null;
    }
    return {
      id: String(vector.id),
      payload: (_a2 = vector.metadata) != null ? _a2 : {}
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    await this.client.upsert(
      {
        id: vectorId,
        vector,
        metadata: payload
      },
      { namespace: this.collectionName }
    );
  }
  async delete(vectorId) {
    await this.initialize();
    await this.client.delete(vectorId, { namespace: this.collectionName });
  }
  async deleteCol() {
    await this.initialize();
    await this.client.reset({ namespace: this.collectionName });
  }
  async list(filters, topK = 100) {
    var _a2;
    await this.initialize();
    const results = [];
    let cursor = "0";
    do {
      const response = await this.client.range(
        {
          cursor,
          limit: Math.min(100, topK - results.length),
          includeMetadata: true
        },
        { namespace: this.collectionName }
      );
      for (const vector of response.vectors) {
        if (this.matchesFilters(vector, filters)) {
          results.push({
            id: String(vector.id),
            payload: (_a2 = vector.metadata) != null ? _a2 : {}
          });
        }
        if (results.length >= topK) {
          break;
        }
      }
      cursor = response.nextCursor;
    } while (cursor !== "" && results.length < topK);
    return [results, results.length];
  }
  async getUserId() {
    return "anonymous-upstash-vector";
  }
  async setUserId() {
    return;
  }
  async reset() {
    await this.deleteCol();
  }
  parseResult(result) {
    var _a2;
    return {
      id: String(result.id),
      payload: (_a2 = result.metadata) != null ? _a2 : {},
      score: result.score
    };
  }
  stringifyFilterValue(value) {
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    return String(value);
  }
  convertFilters(filters) {
    if (!filters) {
      return void 0;
    }
    const expressions = Object.entries(filters).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => `${key} = ${this.stringifyFilterValue(value)}`);
    return expressions.length > 0 ? expressions.join(" AND ") : void 0;
  }
  matchesFilters(vector, filters) {
    if (!filters) {
      return true;
    }
    return Object.entries(filters).every(([key, value]) => {
      var _a2;
      if (value === void 0 || value === null) {
        return true;
      }
      return ((_a2 = vector.metadata) == null ? void 0 : _a2[key]) === value;
    });
  }
};

// src/oss/src/vector_stores/azure_mysql.ts
var SAFE_IDENTIFIER_RE3 = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
function validateIdentifier3(name, label = "identifier") {
  if (!SAFE_IDENTIFIER_RE3.test(name)) {
    throw new Error(
      `Invalid ${label} '${name}': only letters, digits, and underscores are allowed, must start with a letter or underscore, and be at most 128 characters.`
    );
  }
  return name;
}
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
var AzureMySQLDB = class {
  constructor(config) {
    this.collectionName = validateIdentifier3(
      config.collectionName || "memories",
      "collectionName"
    );
    this.config = config;
  }
  col() {
    return `\`${this.collectionName}\``;
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    var _a2, _b2;
    let password = this.config.password;
    if (this.config.useAzureCredential) {
      try {
        const { DefaultAzureCredential } = await import("@azure/identity");
        const credential = new DefaultAzureCredential();
        const token = await credential.getToken(
          "https://ossrdbms-aad.database.windows.net/.default"
        );
        password = token.token;
      } catch (err) {
        throw new Error(`Azure credential authentication failed: ${err}`);
      }
    }
    const ssl = this.config.sslDisabled ? void 0 : {
      rejectUnauthorized: true,
      ...this.config.sslCa ? { ca: this.config.sslCa } : {}
    };
    const { createPool } = await loadPeer(
      "mysql2",
      "Azure MySQL vector store",
      () => import("mysql2/promise")
    );
    this.pool = createPool({
      host: this.config.host,
      port: (_a2 = this.config.port) != null ? _a2 : 3306,
      user: this.config.user,
      password,
      database: this.config.database,
      ssl,
      connectionLimit: (_b2 = this.config.maxConn) != null ? _b2 : 5,
      waitForConnections: true,
      ...this.config.useAzureCredential ? {
        authPlugins: {
          mysql_clear_password: () => () => Buffer.from(`${password != null ? password : ""}\0`)
        }
      } : {}
    });
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS ${this.col()} (
        id VARCHAR(255) PRIMARY KEY,
        vector JSON,
        payload JSON,
        text_lemmatized VARCHAR(1000) GENERATED ALWAYS AS
          (CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.textLemmatized')) AS CHAR(1000))) STORED
      )
    `);
    try {
      await this.pool.execute(
        `CREATE FULLTEXT INDEX ft_text_lemmatized ON ${this.col()} (text_lemmatized)`
      );
    } catch (e) {
    }
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS memory_migrations (
        id INT PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL
      )
    `);
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < vectors.length; i++) {
        await conn.execute(
          `INSERT INTO ${this.col()} (id, vector, payload) VALUES (?, ?, ?) AS new
           ON DUPLICATE KEY UPDATE vector = new.vector, payload = new.payload`,
          [ids[i], JSON.stringify(vectors[i]), JSON.stringify(payloads[i])]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const conditions = [];
    const params = [];
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        conditions.push("JSON_EXTRACT(payload, ?) = ?");
        params.push(`$.${k}`, JSON.stringify(v));
      }
    }
    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const sql = `SELECT id, vector, payload FROM ${this.col()} ${whereClause}`;
    const [rows] = await this.pool.execute(sql, params);
    const scored = [];
    for (const row of rows) {
      const vec = typeof row.vector === "string" ? JSON.parse(row.vector) : row.vector;
      const score = cosineSimilarity(query, vec);
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      scored.push({ id: row.id, score, payload });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((r) => ({
      id: r.id,
      payload: r.payload,
      score: r.score
    }));
  }
  async keywordSearch(query, topK = 5, filters) {
    try {
      await this.initialize();
      const conditions = [];
      const params = [query, query];
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          conditions.push("JSON_EXTRACT(payload, ?) = ?");
          params.push(`$.${k}`, JSON.stringify(v));
        }
      }
      const filterClause = conditions.length > 0 ? " AND " + conditions.join(" AND ") : "";
      const sql = `
        SELECT id, payload,
               MATCH(text_lemmatized) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
        FROM ${this.col()}
        WHERE MATCH(text_lemmatized) AGAINST(? IN NATURAL LANGUAGE MODE)
        ${filterClause}
        ORDER BY score DESC
        LIMIT ?
      `;
      params.push(topK);
      const [rows] = await this.pool.execute(sql, params);
      return rows.map((row) => ({
        id: row.id,
        payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
        score: Number(row.score)
      }));
    } catch (e) {
      return null;
    }
  }
  async get(vectorId) {
    await this.initialize();
    const [rows] = await this.pool.execute(
      `SELECT id, payload FROM ${this.col()} WHERE id = ?`,
      [vectorId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE ${this.col()} SET vector = ?, payload = ? WHERE id = ?`,
        [JSON.stringify(vector), JSON.stringify(payload), vectorId]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
  async delete(vectorId) {
    await this.initialize();
    await this.pool.execute(`DELETE FROM ${this.col()} WHERE id = ?`, [
      vectorId
    ]);
  }
  async deleteCol() {
    await this.initialize();
    await this.pool.execute(`DROP TABLE IF EXISTS ${this.col()}`);
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const conditions = [];
    const params = [];
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        conditions.push("JSON_EXTRACT(payload, ?) = ?");
        params.push(`$.${k}`, JSON.stringify(v));
      }
    }
    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const listSql = `SELECT id, payload FROM ${this.col()} ${whereClause} LIMIT ?`;
    const countSql = `SELECT COUNT(*) AS cnt FROM ${this.col()} ${whereClause}`;
    const [rows] = await this.pool.execute(listSql, [
      ...params,
      topK
    ]);
    const [countRows] = await this.pool.execute(
      countSql,
      params
    );
    const results = rows.map((row) => ({
      id: row.id,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
    }));
    return [results, Number(countRows[0].cnt)];
  }
  async getUserId() {
    await this.initialize();
    const [rows] = await this.pool.execute(
      "SELECT user_id FROM memory_migrations WHERE id = 1"
    );
    if (rows.length > 0) {
      return rows[0].user_id;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.pool.execute(
      "INSERT INTO memory_migrations (id, user_id) VALUES (1, ?) AS new ON DUPLICATE KEY UPDATE user_id = new.user_id",
      [randomUserId2]
    );
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.pool.execute(
      "INSERT INTO memory_migrations (id, user_id) VALUES (1, ?) AS new ON DUPLICATE KEY UPDATE user_id = new.user_id",
      [userId]
    );
  }
  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
};

// src/oss/src/vector_stores/vertex_ai_vector_search.ts
var VertexAIVectorSearch = class {
  constructor(config) {
    this.config = { ...config };
    if (!this.config.collectionName) {
      this.config.collectionName = this.config.indexId || this.config.deploymentIndexId;
    }
    this.initialize().catch(console.error);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      const aiplatform = await import("@google-cloud/aiplatform");
      const { MatchServiceClient, IndexServiceClient } = aiplatform.v1;
      const clientOptions = {
        projectId: this.config.projectId,
        apiEndpoint: this.config.vectorSearchApiEndpoint || `${this.config.region}-aiplatform.googleapis.com`
      };
      if (this.config.credentialsPath) {
        clientOptions.keyFilename = this.config.credentialsPath;
      } else if (this.config.serviceAccountJson) {
        clientOptions.credentials = {
          client_email: this.config.serviceAccountJson.client_email,
          private_key: this.config.serviceAccountJson.private_key
        };
      }
      this.matchClient = new MatchServiceClient(clientOptions);
      this.indexClient = new IndexServiceClient(clientOptions);
    } catch (error) {
      console.error(
        "Failed to initialize Vertex AI client. Make sure @google-cloud/aiplatform is installed.",
        error
      );
      throw error;
    }
  }
  _createRestriction(key, value) {
    return {
      namespace: key,
      allowList: [String(value)]
    };
  }
  _createDatapoint(vectorId, vector, payload = {}) {
    const restricts = Object.entries(payload).map(
      ([key, value]) => this._createRestriction(key, value)
    );
    return {
      datapointId: vectorId,
      featureVector: vector,
      restricts: restricts.length > 0 ? restricts : void 0
    };
  }
  get indexPath() {
    return `projects/${this.config.projectNumber}/locations/${this.config.region}/indexes/${this.config.indexId}`;
  }
  get indexEndpointPath() {
    return `projects/${this.config.projectNumber}/locations/${this.config.region}/indexEndpoints/${this.config.endpointId}`;
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const datapoints = vectors.map(
      (vector, i) => this._createDatapoint(ids[i], vector, payloads[i] || {})
    );
    await this.indexClient.upsertDatapoints({
      index: this.indexPath,
      datapoints
    });
  }
  async search(query, topK = 5, filters) {
    if (!this.config.vectorSearchApiEndpoint) {
      throw new Error(
        "vectorSearchApiEndpoint is required for search operation"
      );
    }
    await this.initialize();
    const restricts = [];
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (typeof value === "object" && value !== null) {
          const includes = value.include || [];
          const excludes = value.exclude || [];
          restricts.push({
            namespace: key,
            allowList: includes.map(String),
            denyList: excludes.map(String)
          });
        } else {
          restricts.push({
            namespace: key,
            allowList: [String(value)]
          });
        }
      }
    }
    const request = {
      indexEndpoint: this.indexEndpointPath,
      deployedIndexId: this.config.deploymentIndexId,
      queries: [
        {
          datapoint: {
            featureVector: query,
            restricts: restricts.length > 0 ? restricts : void 0
          },
          neighborCount: topK
        }
      ],
      returnFullDatapoint: true
    };
    const [response] = await this.matchClient.findNeighbors(request);
    if (!response || !response.nearestNeighbors || response.nearestNeighbors.length === 0) {
      return [];
    }
    const neighbors = response.nearestNeighbors[0].neighbors || [];
    return neighbors.filter(
      (neighbor) => {
        var _a2;
        return ((_a2 = neighbor.datapoint) == null ? void 0 : _a2.datapointId) !== "mem0-user-id-record";
      }
    ).map((neighbor) => {
      var _a2;
      const payload = {};
      if ((_a2 = neighbor.datapoint) == null ? void 0 : _a2.restricts) {
        for (const restrict of neighbor.datapoint.restricts) {
          if (restrict.allowList && restrict.allowList.length > 0) {
            payload[restrict.namespace] = restrict.allowList[0];
          }
        }
      }
      const score = neighbor.distance !== void 0 ? Math.max(0, 1 - neighbor.distance) : void 0;
      return {
        id: neighbor.datapoint.datapointId,
        payload,
        score
      };
    });
  }
  async get(vectorId) {
    var _a2, _b2;
    if (!this.config.vectorSearchApiEndpoint) {
      throw new Error("vectorSearchApiEndpoint is required for get operation");
    }
    await this.initialize();
    const request = {
      indexEndpoint: this.indexEndpointPath,
      deployedIndexId: this.config.deploymentIndexId,
      queries: [
        {
          datapoint: {
            datapointId: vectorId
          },
          neighborCount: 1
        }
      ],
      returnFullDatapoint: true
    };
    const [response] = await this.matchClient.findNeighbors(request);
    if (!response || !response.nearestNeighbors || response.nearestNeighbors.length === 0) {
      return null;
    }
    const neighbors = response.nearestNeighbors[0].neighbors || [];
    if (neighbors.length === 0) {
      return null;
    }
    const neighbor = neighbors[0];
    if (((_a2 = neighbor.datapoint) == null ? void 0 : _a2.datapointId) !== vectorId) {
      return null;
    }
    const payload = {};
    if ((_b2 = neighbor.datapoint) == null ? void 0 : _b2.restricts) {
      for (const restrict of neighbor.datapoint.restricts) {
        if (restrict.allowList && restrict.allowList.length > 0) {
          payload[restrict.namespace] = restrict.allowList[0];
        }
      }
    }
    const score = neighbor.distance !== void 0 ? Math.max(0, 1 - neighbor.distance) : void 0;
    return {
      id: neighbor.datapoint.datapointId,
      payload,
      score
    };
  }
  async keywordSearch(query, topK, filters) {
    return null;
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const existing = await this.get(vectorId);
    if (!existing) {
      console.warn(`Vector not found for id: ${vectorId}`);
      return;
    }
    const datapoint = this._createDatapoint(vectorId, vector, payload);
    await this.indexClient.upsertDatapoints({
      index: this.indexPath,
      datapoints: [datapoint]
    });
  }
  async delete(vectorId) {
    await this.initialize();
    try {
      await this.indexClient.removeDatapoints({
        index: this.indexPath,
        datapointIds: [vectorId]
      });
    } catch (error) {
      if (error.code !== 5) {
        throw error;
      }
    }
  }
  async deleteCol() {
    console.warn(
      "Delete collection operation is not supported for Google Matching Engine"
    );
  }
  async list(filters, topK = 1e4) {
    await this.initialize();
    const dimension = this.config.dimension || 768;
    const zeroVector = Array(dimension).fill(0);
    const results = await this.search(zeroVector, topK, filters);
    return [results, results.length];
  }
  async getUserId() {
    var _a2;
    const userIdDatapointId = "mem0-user-id-record";
    const existing = await this.get(userIdDatapointId);
    if (existing && ((_a2 = existing.payload) == null ? void 0 : _a2.user_id)) {
      return existing.payload.user_id;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.setUserId(randomUserId2);
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.initialize();
    const userIdDatapointId = "mem0-user-id-record";
    const dimension = this.config.dimension || 768;
    const zeroVector = Array(dimension).fill(0);
    const datapoint = this._createDatapoint(userIdDatapointId, zeroVector, {
      user_id: userId
    });
    await this.indexClient.upsertDatapoints({
      index: this.indexPath,
      datapoints: [datapoint]
    });
  }
};

// src/oss/src/vector_stores/cassandra.ts
var MIGRATION_ROW_ID = "mem0-user";
var SAFE_IDENTIFIER_RE4 = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
var _CassandraDB = class _CassandraDB {
  constructor(config) {
    this.driver = config.driver;
    this.contactPoints = config.contactPoints;
    this.port = config.port || 9042;
    this.username = config.username;
    this.password = config.password;
    this.keyspace = this.validateIdentifier(
      config.keyspace || "mem0",
      "keyspace"
    );
    this.collectionName = this.validateIdentifier(
      config.collectionName || "memories",
      "collectionName"
    );
    this.dimension = config.embeddingModelDims || config.dimension || 1536;
    this.secureConnectBundle = config.secureConnectBundle;
    this.localDataCenter = config.localDataCenter;
    this.protocolVersion = config.protocolVersion;
    this.loadBalancingPolicy = config.loadBalancingPolicy;
    this.client = config.client;
    this.initialize().catch(console.error);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    if (!this.client) {
      this.client = await this.createClient();
    }
    if (typeof this.client.connect === "function") {
      await this.client.connect();
    }
    await this.client.execute(`
      CREATE KEYSPACE IF NOT EXISTS ${this.keyspace}
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.keyspace}.${this.collectionName} (
        id text PRIMARY KEY,
        vector list<float>,
        payload text
      )
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.keyspace}.memory_migrations (
        id text PRIMARY KEY,
        user_id text
      )
    `);
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    this.assertBatchDimensions(vectors, "Vector");
    const query = `
      INSERT INTO ${this.keyspace}.${this.collectionName} (id, vector, payload)
      VALUES (?, ?, ?)
    `;
    for (let index = 0; index < vectors.length; index += 1) {
      await this.client.execute(
        query,
        [ids[index], vectors[index], JSON.stringify(payloads[index] || {})],
        { prepare: true }
      );
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    this.assertVectorDimension(query, "Query");
    const scored = [];
    await this.scanRows(
      `
        SELECT id, vector, payload
        FROM ${this.keyspace}.${this.collectionName}
      `,
      async (row) => {
        const vector = this.normalizeVector(row.vector);
        const payload = this.parsePayload(row.payload);
        if (!vector || vector.length !== this.dimension) {
          return;
        }
        const item = {
          id: String(row.id),
          vector,
          payload
        };
        if (!this.filterVector(item, filters)) {
          return;
        }
        this.pushTopResult(
          scored,
          {
            id: item.id,
            payload: item.payload,
            score: this.cosineSimilarity(query, item.vector)
          },
          topK
        );
      },
      Math.max(topK, _CassandraDB.PAGE_SIZE)
    );
    return scored;
  }
  async get(vectorId) {
    var _a2;
    await this.initialize();
    const result = await this.client.execute(
      `
        SELECT id, payload
        FROM ${this.keyspace}.${this.collectionName}
        WHERE id = ?
      `,
      [vectorId],
      { prepare: true }
    );
    const row = (_a2 = result.rows) == null ? void 0 : _a2[0];
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      payload: this.parsePayload(row.payload)
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    this.assertVectorDimension(vector, "Vector");
    await this.client.execute(
      `
        INSERT INTO ${this.keyspace}.${this.collectionName} (id, vector, payload)
        VALUES (?, ?, ?)
      `,
      [vectorId, vector, JSON.stringify(payload || {})],
      { prepare: true }
    );
  }
  async delete(vectorId) {
    await this.initialize();
    await this.client.execute(
      `
        DELETE FROM ${this.keyspace}.${this.collectionName}
        WHERE id = ?
      `,
      [vectorId],
      { prepare: true }
    );
  }
  async deleteCol() {
    await this.initialize();
    await this.client.execute(`
      DROP TABLE IF EXISTS ${this.keyspace}.${this.collectionName}
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.keyspace}.${this.collectionName} (
        id text PRIMARY KEY,
        vector list<float>,
        payload text
      )
    `);
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const rows = [];
    let total = 0;
    await this.scanRows(
      `
        SELECT id, payload
        FROM ${this.keyspace}.${this.collectionName}
      `,
      async (row) => {
        const item = {
          id: String(row.id),
          vector: [],
          payload: this.parsePayload(row.payload)
        };
        if (!this.filterVector(item, filters)) {
          return;
        }
        total += 1;
        if (rows.length < topK) {
          rows.push({
            id: item.id,
            payload: item.payload
          });
        }
      },
      _CassandraDB.PAGE_SIZE
    );
    return [rows, total];
  }
  async getUserId() {
    var _a2, _b2;
    await this.initialize();
    const result = await this.client.execute(
      `
        SELECT user_id
        FROM ${this.keyspace}.memory_migrations
        WHERE id = ?
      `,
      [MIGRATION_ROW_ID],
      { prepare: true }
    );
    const existing = (_b2 = (_a2 = result.rows) == null ? void 0 : _a2[0]) == null ? void 0 : _b2.user_id;
    if (typeof existing === "string" && existing.length > 0) {
      return existing;
    }
    const userId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.setUserId(userId);
    return userId;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.client.execute(
      `
        INSERT INTO ${this.keyspace}.memory_migrations (id, user_id)
        VALUES (?, ?)
      `,
      [MIGRATION_ROW_ID, userId],
      { prepare: true }
    );
  }
  async createClient() {
    var _a2;
    const driver = (_a2 = this.driver) != null ? _a2 : await this.loadDriver();
    const clientConfig = {};
    if (this.secureConnectBundle) {
      clientConfig.cloud = {
        secureConnectBundle: this.secureConnectBundle
      };
    } else {
      if (!this.contactPoints || this.contactPoints.length === 0) {
        throw new Error(
          "Cassandra vector store requires contactPoints when secureConnectBundle is not provided."
        );
      }
      if (!this.localDataCenter) {
        throw new Error(
          "Cassandra vector store requires localDataCenter when secureConnectBundle is not provided."
        );
      }
      clientConfig.contactPoints = this.contactPoints;
      clientConfig.localDataCenter = this.localDataCenter;
      clientConfig.protocolOptions = {
        port: this.port
      };
    }
    if (this.protocolVersion !== void 0) {
      clientConfig.protocolOptions = {
        ...clientConfig.protocolOptions || {},
        maxVersion: this.protocolVersion
      };
    }
    if (this.loadBalancingPolicy) {
      clientConfig.policies = {
        loadBalancing: this.loadBalancingPolicy
      };
    }
    if (this.username && this.password) {
      clientConfig.authProvider = new driver.auth.PlainTextAuthProvider(
        this.username,
        this.password
      );
    }
    return new driver.Client(clientConfig);
  }
  // Loaded dynamically: cassandra-driver is an optional peer dependency, so a static
  // value import would break `import { Memory } from "mem0ai/oss"` for everyone else.
  async loadDriver() {
    var _a2;
    const sdk = await loadPeer(
      "cassandra-driver",
      "Cassandra vector store",
      () => import("cassandra-driver")
    );
    return (_a2 = sdk.default) != null ? _a2 : sdk;
  }
  validateIdentifier(name, label) {
    if (!SAFE_IDENTIFIER_RE4.test(name)) {
      throw new Error(
        `Invalid ${label} '${name}': only letters, digits, and underscores are allowed, must start with a letter or underscore, and be at most 128 characters.`
      );
    }
    return name;
  }
  cosineSimilarity(left, right) {
    let dotProduct = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      dotProduct += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }
    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }
    return dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }
  normalizeVector(rawValue) {
    if (Array.isArray(rawValue)) {
      return rawValue.map((value) => Number(value));
    }
    return void 0;
  }
  parsePayload(rawValue) {
    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (error) {
        return {};
      }
    }
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      return rawValue;
    }
    return {};
  }
  matchFieldCondition(payload, key, value) {
    const payloadValue = payload[key];
    if (typeof value !== "object" || value === null) {
      if (value === "*") {
        return true;
      }
      return payloadValue === value;
    }
    if (Array.isArray(value)) {
      return value.includes(payloadValue);
    }
    let sawOperator = false;
    if ("eq" in value) {
      sawOperator = true;
      if (payloadValue !== value.eq) return false;
    }
    if ("ne" in value) {
      sawOperator = true;
      if (payloadValue === value.ne) return false;
    }
    if ("gt" in value) {
      sawOperator = true;
      if (!(payloadValue > value.gt)) return false;
    }
    if ("gte" in value) {
      sawOperator = true;
      if (!(payloadValue >= value.gte)) return false;
    }
    if ("lt" in value) {
      sawOperator = true;
      if (!(payloadValue < value.lt)) return false;
    }
    if ("lte" in value) {
      sawOperator = true;
      if (!(payloadValue <= value.lte)) return false;
    }
    if ("in" in value) {
      sawOperator = true;
      if (!Array.isArray(value.in) || !value.in.includes(payloadValue))
        return false;
    }
    if ("nin" in value) {
      sawOperator = true;
      if (Array.isArray(value.nin) && value.nin.includes(payloadValue))
        return false;
    }
    if ("contains" in value) {
      sawOperator = true;
      if (typeof payloadValue !== "string" || !payloadValue.includes(value.contains))
        return false;
    }
    if ("icontains" in value) {
      sawOperator = true;
      if (typeof payloadValue !== "string" || !payloadValue.toLowerCase().includes(value.icontains.toLowerCase()))
        return false;
    }
    return sawOperator ? true : payloadValue === value;
  }
  filterVector(vector, filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return true;
    }
    const keyMap = {
      $and: "AND",
      $or: "OR",
      $not: "NOT"
    };
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      const normalizedKey = keyMap[key] || key;
      if (!(normalizedKey in normalized)) {
        normalized[normalizedKey] = value;
      }
    }
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "AND") {
        if (!Array.isArray(value)) {
          throw new Error(
            `AND filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        if (!value.every(
          (entry) => this.filterVector(vector, entry)
        )) {
          return false;
        }
      } else if (key === "OR") {
        if (!Array.isArray(value)) {
          throw new Error(
            `OR filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        if (!value.some(
          (entry) => this.filterVector(vector, entry)
        )) {
          return false;
        }
      } else if (key === "NOT") {
        if (!Array.isArray(value)) {
          throw new Error(
            `NOT filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        if (!value.every(
          (entry) => !this.filterVector(vector, entry)
        )) {
          return false;
        }
      } else if (!this.matchFieldCondition(vector.payload, key, value)) {
        return false;
      }
    }
    return true;
  }
  assertVectorDimension(vector, label) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `${label} dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }
  }
  assertBatchDimensions(vectors, label) {
    for (const vector of vectors) {
      this.assertVectorDimension(vector, label);
    }
  }
  async scanRows(query, onRow, fetchSize) {
    let pageState;
    do {
      const result = await this.client.execute(query, [], {
        autoPage: false,
        fetchSize,
        pageState
      });
      for (const row of result.rows || []) {
        await onRow(row);
      }
      pageState = result.pageState || void 0;
    } while (pageState);
  }
  pushTopResult(results, candidate, topK) {
    results.push(candidate);
    results.sort((left, right) => (right.score || 0) - (left.score || 0));
    if (results.length > topK) {
      results.length = topK;
    }
  }
};
_CassandraDB.PAGE_SIZE = 500;
var CassandraDB = _CassandraDB;

// src/oss/src/vector_stores/pinecone.ts
var MIGRATIONS_NAMESPACE = "__mem0_migrations__";
var MIGRATIONS_RECORD_ID = "mem0-user-id";
var PineconeDB = class {
  constructor(config) {
    if (!config.client) {
      const apiKey = config.apiKey || process.env.PINECONE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Pinecone API key required: pass apiKey or set PINECONE_API_KEY env var"
        );
      }
    }
    this.config = config;
    this.collectionName = config.collectionName;
    this.dimension = config.embeddingModelDims || config.dimension || 1536;
    this.metric = config.metric || "cosine";
    this.batchSize = config.batchSize || 100;
    this.namespace = config.namespace || "";
    this.serverlessConfig = config.serverlessConfig;
    this.podConfig = config.podConfig;
    this.extraParams = config.extraParams || {};
    this.initialize().catch(console.error);
  }
  /**
   * Lazily construct (or reuse) the Pinecone client, importing the optional
   * `@pinecone-database/pinecone` peer only when the store is first used so
   * consumers that never touch Pinecone don't need it installed.
   */
  async ensureClient() {
    if (this.client) return;
    const config = this.config;
    if (config.client) {
      this.client = config.client;
    } else {
      const apiKey = config.apiKey || process.env.PINECONE_API_KEY;
      const sdk = await loadPeer(
        "@pinecone-database/pinecone",
        "Pinecone vector store",
        () => import("@pinecone-database/pinecone")
      );
      this.client = new sdk.Pinecone({ apiKey });
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureClient();
    await this._ensureIndex();
    this._index = this.client.index({ name: this.collectionName });
  }
  async _ensureIndex() {
    const indexList = await this.client.listIndexes();
    const exists = (indexList.indexes || []).some(
      (idx) => idx.name === this.collectionName
    );
    if (exists) return;
    const spec = this.podConfig ? {
      pod: {
        environment: this.podConfig.environment,
        podType: this.podConfig.podType || "p1.x1",
        pods: this.podConfig.pods || 1,
        replicas: this.podConfig.replicas || 1,
        shards: this.podConfig.shards || 1
      }
    } : {
      serverless: this.serverlessConfig || {
        cloud: "aws",
        region: "us-east-1"
      }
    };
    await this.client.createIndex({
      name: this.collectionName,
      dimension: this.dimension,
      metric: this.metric,
      spec,
      waitUntilReady: true,
      ...this.extraParams
    });
  }
  index() {
    return this._index;
  }
  namespacedIndex() {
    return this.namespace ? this.index().namespace(this.namespace) : this.index();
  }
  migrationsIndex() {
    return this.index().namespace(MIGRATIONS_NAMESPACE);
  }
  createFilter(filters) {
    if (!filters || Object.keys(filters).length === 0) return void 0;
    const result = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === void 0 || value === null) continue;
      if (key === "AND" || key === "$and") {
        result["$and"] = value.map(
          (sub) => this.createFilter(sub) || {}
        );
        continue;
      }
      if (key === "OR" || key === "$or") {
        result["$or"] = value.map(
          (sub) => this.createFilter(sub) || {}
        );
        continue;
      }
      if (key === "NOT" || key === "$not") {
        console.warn(
          "Filter operator 'NOT' is not supported by Pinecone metadata filters; skipping."
        );
        continue;
      }
      if (value === "*") continue;
      if (Array.isArray(value)) {
        result[key] = { $in: value };
        continue;
      }
      if (typeof value === "object" && value !== null) {
        const pineconeOps = {};
        for (const [op, opVal] of Object.entries(value)) {
          switch (op) {
            case "eq":
              pineconeOps["$eq"] = opVal;
              break;
            case "ne":
              pineconeOps["$ne"] = opVal;
              break;
            case "gt":
              pineconeOps["$gt"] = opVal;
              break;
            case "gte":
              pineconeOps["$gte"] = opVal;
              break;
            case "lt":
              pineconeOps["$lt"] = opVal;
              break;
            case "lte":
              pineconeOps["$lte"] = opVal;
              break;
            case "in":
              pineconeOps["$in"] = opVal;
              break;
            case "nin":
              pineconeOps["$nin"] = opVal;
              break;
            case "contains":
            case "icontains":
              console.warn(
                `Filter operator '${op}' is not supported by Pinecone metadata filters; skipping.`
              );
              break;
            default:
              throw new Error(
                `Unsupported filter operator '${op}' for Pinecone`
              );
          }
        }
        if (Object.keys(pineconeOps).length > 0) {
          result[key] = pineconeOps;
        }
        continue;
      }
      result[key] = { $eq: value };
    }
    return Object.keys(result).length > 0 ? result : void 0;
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const records = vectors.map((values, i) => ({
      id: ids[i],
      values,
      metadata: payloads[i] || {}
    }));
    for (let i = 0; i < records.length; i += this.batchSize) {
      await this.namespacedIndex().upsert({
        records: records.slice(i, i + this.batchSize)
      });
    }
  }
  async keywordSearch(_query, _topK, _filters) {
    return null;
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const filter = this.createFilter(filters);
    const response = await this.namespacedIndex().query({
      vector: query,
      topK,
      includeMetadata: true,
      includeValues: false,
      ...filter ? { filter } : {}
    });
    return (response.matches || []).map((match) => ({
      id: match.id,
      payload: match.metadata || {},
      score: match.score
    }));
  }
  async get(vectorId) {
    await this.initialize();
    const response = await this.namespacedIndex().fetch({ ids: [vectorId] });
    const record = (response.records || {})[vectorId];
    if (!record) return null;
    return {
      id: record.id,
      payload: record.metadata || {}
    };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    await this.namespacedIndex().upsert({
      records: [{ id: vectorId, values: vector, metadata: payload }]
    });
  }
  async delete(vectorId) {
    await this.initialize();
    await this.namespacedIndex().deleteOne({ id: vectorId });
  }
  async deleteCol() {
    if (this.namespace) {
      await this.initialize();
      await this.namespacedIndex().deleteAll();
      return;
    }
    if (this._initPromise) {
      await this._initPromise.catch(() => {
      });
    }
    await this.client.deleteIndex(this.collectionName);
    this._index = void 0;
    this._initPromise = void 0;
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const zeroVector = new Array(this.dimension).fill(0);
    const filter = this.createFilter(filters);
    const response = await this.namespacedIndex().query({
      vector: zeroVector,
      topK,
      includeMetadata: true,
      includeValues: false,
      ...filter ? { filter } : {}
    });
    const results = (response.matches || []).map((match) => ({
      id: match.id,
      payload: match.metadata || {},
      score: match.score
    }));
    return [results, results.length];
  }
  async getUserId() {
    var _a2;
    await this.initialize();
    try {
      const response = await this.migrationsIndex().fetch({
        ids: [MIGRATIONS_RECORD_ID]
      });
      const record = (response.records || {})[MIGRATIONS_RECORD_ID];
      if ((_a2 = record == null ? void 0 : record.metadata) == null ? void 0 : _a2.user_id) {
        return record.metadata.user_id;
      }
    } catch (e) {
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.migrationsIndex().upsert({
      records: [
        {
          id: MIGRATIONS_RECORD_ID,
          values: new Array(this.dimension).fill(0),
          metadata: { user_id: randomUserId2 }
        }
      ]
    });
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.migrationsIndex().upsert({
      records: [
        {
          id: MIGRATIONS_RECORD_ID,
          values: new Array(this.dimension).fill(0),
          metadata: { user_id: userId }
        }
      ]
    });
  }
};

// src/oss/src/vector_stores/s3_vectors.ts
var MIGRATION_INDEX_NAME = "memory_migrations";
var MIGRATION_VECTOR_KEY = "mem0-user";
var DEFAULT_PAGE_SIZE2 = 500;
var ALWAYS_FALSE_FILTER_KEY = "$alwaysFalse";
var S3Vectors = class {
  constructor(config) {
    var _a2;
    if (!config.vectorBucketName) {
      throw new Error("vectorBucketName is required");
    }
    if (!config.collectionName) {
      throw new Error("collectionName is required");
    }
    const dimension = (_a2 = config.embeddingModelDims) != null ? _a2 : config.dimension;
    if (!dimension || dimension < 1) {
      throw new Error("embeddingModelDims or dimension is required");
    }
    this.config = config;
    this.vectorBucketName = config.vectorBucketName;
    this.collectionName = config.collectionName;
    this.dimension = dimension;
    this.distanceMetric = config.distanceMetric || "cosine";
    void this.initialize().catch(console.error);
  }
  /**
   * Lazily import the optional `@aws-sdk/client-s3vectors` peer so consumers
   * who never use the S3 Vectors store don't need it installed.
   */
  getSdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = import("@aws-sdk/client-s3vectors").catch(() => {
        throw new Error(
          "The '@aws-sdk/client-s3vectors' package is required to use the S3 Vectors store. Install it with: npm install @aws-sdk/client-s3vectors"
        );
      });
    }
    return this.sdkPromise;
  }
  /** Lazily construct (or reuse) the S3 Vectors client. */
  async getClient() {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    this.client = await this.clientPromise;
    return this.client;
  }
  async createClient() {
    const config = this.config;
    if (config.client) {
      return config.client;
    }
    const sdk = await this.getSdk();
    return new sdk.S3VectorsClient({
      ...config.clientConfig || {},
      ...config.region || config.regionName ? { region: config.region || config.regionName } : {}
    });
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    await this.ensureBucketExists();
    await this.ensureIndexExists(
      this.collectionName,
      this.dimension,
      this.distanceMetric
    );
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    this.assertBatchDimensions(vectors, "Insert");
    const sdk = await this.getSdk();
    const client = await this.getClient();
    await client.send(
      new sdk.PutVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.collectionName,
        vectors: vectors.map((vector, index) => ({
          key: ids[index],
          data: this.toVectorData(vector),
          metadata: payloads[index] || {}
        }))
      })
    );
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    this.assertVectorDimension(query, "Query");
    const filter = this.convertFilters(filters);
    if (filter && this.isAlwaysFalseFilter(filter)) {
      return [];
    }
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const response = await client.send(
      new sdk.QueryVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.collectionName,
        queryVector: this.toVectorData(query),
        topK,
        filter,
        returnMetadata: true,
        returnDistance: true
      })
    );
    const responseDistanceMetric = response.distanceMetric || this.distanceMetric;
    return (response.vectors || []).map(
      (vector) => this.normalizeQueryVector(vector, responseDistanceMetric)
    ).slice(0, topK);
  }
  async get(vectorId) {
    var _a2;
    await this.initialize();
    const sdk = await this.getSdk();
    const client = await this.getClient();
    try {
      const response = await client.send(
        new sdk.GetVectorsCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.collectionName,
          keys: [vectorId],
          returnMetadata: true
        })
      );
      const vector = (_a2 = response.vectors) == null ? void 0 : _a2[0];
      if (!vector) {
        return null;
      }
      return this.normalizeStoredVector(vector);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    let nextVector = vector;
    let nextPayload = payload || {};
    if (vector.length === 0 || !payload) {
      const existing = await this.fetchStoredVector(vectorId);
      if (!existing) {
        throw new Error(`Vector with ID ${vectorId} not found`);
      }
      nextVector = vector.length > 0 ? vector : existing.vector;
      nextPayload = payload || existing.payload;
    }
    this.assertVectorDimension(nextVector, "Vector");
    const sdk = await this.getSdk();
    const client = await this.getClient();
    await client.send(
      new sdk.PutVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.collectionName,
        vectors: [
          {
            key: vectorId,
            data: this.toVectorData(nextVector),
            metadata: nextPayload
          }
        ]
      })
    );
  }
  async delete(vectorId) {
    await this.initialize();
    const sdk = await this.getSdk();
    const client = await this.getClient();
    await client.send(
      new sdk.DeleteVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.collectionName,
        keys: [vectorId]
      })
    );
  }
  async deleteCol() {
    await this.initialize();
    const sdk = await this.getSdk();
    const client = await this.getClient();
    try {
      await client.send(
        new sdk.DeleteIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.collectionName
        })
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const filter = this.convertFilters(filters);
    const results = [];
    let nextToken;
    const sdk = await this.getSdk();
    const client = await this.getClient();
    do {
      const response = await client.send(
        new sdk.ListVectorsCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.collectionName,
          maxResults: DEFAULT_PAGE_SIZE2,
          nextToken,
          returnMetadata: true
        })
      );
      for (const vector of response.vectors || []) {
        if (results.length >= topK) {
          break;
        }
        const normalized = this.normalizeListedVector(vector);
        if (filter && !this.matchesFilter(normalized.payload, filter)) {
          continue;
        }
        results.push(normalized);
      }
      nextToken = response.nextToken;
    } while (nextToken && results.length < topK);
    return [results, results.length];
  }
  async getUserId() {
    var _a2, _b2;
    await this.initialize();
    if (this.cachedUserId) {
      return this.cachedUserId;
    }
    await this.ensureMigrationIndex();
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const response = await client.send(
      new sdk.GetVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: MIGRATION_INDEX_NAME,
        keys: [MIGRATION_VECTOR_KEY],
        returnMetadata: true
      })
    );
    const metadata = this.normalizeMetadata((_b2 = (_a2 = response.vectors) == null ? void 0 : _a2[0]) == null ? void 0 : _b2.metadata);
    const userId = metadata.user_id;
    if (typeof userId === "string" && userId.length > 0) {
      this.cachedUserId = userId;
      return userId;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.setUserId(randomUserId2);
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.ensureMigrationIndex();
    const sdk = await this.getSdk();
    const client = await this.getClient();
    await client.send(
      new sdk.PutVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: MIGRATION_INDEX_NAME,
        vectors: [
          {
            key: MIGRATION_VECTOR_KEY,
            data: this.toVectorData([0]),
            metadata: { user_id: userId }
          }
        ]
      })
    );
    this.cachedUserId = userId;
  }
  async ensureBucketExists() {
    const sdk = await this.getSdk();
    const client = await this.getClient();
    try {
      await client.send(
        new sdk.GetVectorBucketCommand({
          vectorBucketName: this.vectorBucketName
        })
      );
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
      try {
        await client.send(
          new sdk.CreateVectorBucketCommand({
            vectorBucketName: this.vectorBucketName
          })
        );
      } catch (createError) {
        if (!this.isConflict(createError)) {
          throw createError;
        }
      }
    }
  }
  async ensureIndexExists(indexName, dimension, distanceMetric) {
    const sdk = await this.getSdk();
    const client = await this.getClient();
    try {
      await client.send(
        new sdk.GetIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName
        })
      );
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
      try {
        await client.send(
          new sdk.CreateIndexCommand({
            vectorBucketName: this.vectorBucketName,
            indexName,
            dataType: "float32",
            dimension,
            distanceMetric
          })
        );
      } catch (createError) {
        if (!this.isConflict(createError)) {
          throw createError;
        }
      }
    }
  }
  async ensureMigrationIndex() {
    await this.ensureIndexExists(MIGRATION_INDEX_NAME, 1, "euclidean");
  }
  async fetchStoredVector(vectorId) {
    var _a2;
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const response = await client.send(
      new sdk.GetVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.collectionName,
        keys: [vectorId],
        returnData: true,
        returnMetadata: true
      })
    );
    const vector = (_a2 = response.vectors) == null ? void 0 : _a2[0];
    const data = this.fromVectorData(vector == null ? void 0 : vector.data);
    if (!vector || !data) {
      return null;
    }
    return {
      vector: data,
      payload: this.normalizeMetadata(vector.metadata)
    };
  }
  convertFilters(filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return void 0;
    }
    const normalized = this.convertFilterNode(filters);
    return this.isNoOpFilter(normalized) ? void 0 : normalized;
  }
  convertFilterNode(node) {
    const clauses = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "$and" || key === "$or") {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`${key} filter requires a non-empty list`);
        }
        const normalizedEntries = value.map(
          (entry) => this.convertFilterNode(entry)
        );
        const entries = normalizedEntries.filter(
          (entry) => !this.isNoOpFilter(entry)
        );
        if (key === "$and") {
          if (entries.some((entry) => this.isAlwaysFalseFilter(entry))) {
            return { [ALWAYS_FALSE_FILTER_KEY]: true };
          }
          if (entries.length === 0) {
            continue;
          }
        } else {
          if (normalizedEntries.some((entry) => this.isNoOpFilter(entry))) {
            continue;
          }
          const viableEntries = entries.filter(
            (entry) => !this.isAlwaysFalseFilter(entry)
          );
          if (viableEntries.length === 0) {
            return { [ALWAYS_FALSE_FILTER_KEY]: true };
          }
          clauses.push(
            viableEntries.length === 1 ? viableEntries[0] : { [key]: viableEntries }
          );
          continue;
        }
        clauses.push(entries.length === 1 ? entries[0] : { [key]: entries });
        continue;
      }
      if (key === "$not") {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error("$not filter requires a non-empty list");
        }
        const normalizedEntries = value.map(
          (entry) => this.convertFilterNode(entry)
        );
        if (normalizedEntries.some((entry) => this.isNoOpFilter(entry))) {
          return { [ALWAYS_FALSE_FILTER_KEY]: true };
        }
        const negated = normalizedEntries.filter(
          (entry) => !this.isAlwaysFalseFilter(entry)
        );
        if (negated.length === 0) {
          continue;
        }
        const negatedFilters = negated.map((entry) => this.negateFilter(entry));
        clauses.push(
          negatedFilters.length === 1 ? negatedFilters[0] : { $and: negatedFilters }
        );
        continue;
      }
      const fieldFilter = this.convertFieldFilter(key, value);
      if (this.isAlwaysFalseFilter(fieldFilter)) {
        return fieldFilter;
      }
      if (this.isNoOpFilter(fieldFilter)) {
        continue;
      }
      clauses.push(fieldFilter);
    }
    if (clauses.some((entry) => this.isAlwaysFalseFilter(entry))) {
      return { [ALWAYS_FALSE_FILTER_KEY]: true };
    }
    if (clauses.length === 1) {
      return clauses[0];
    }
    if (clauses.length === 0) {
      return {};
    }
    return { $and: clauses };
  }
  convertFieldFilter(key, value) {
    if (value === "*") {
      return { [key]: { $exists: true } };
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { [ALWAYS_FALSE_FILTER_KEY]: true };
      }
      return { [key]: { $in: value } };
    }
    if (typeof value !== "object" || value === null) {
      return { [key]: { $eq: value } };
    }
    const operators = {};
    for (const [operator, operand] of Object.entries(value)) {
      switch (operator) {
        case "eq":
          operators.$eq = operand;
          break;
        case "ne":
          operators.$ne = operand;
          break;
        case "gt":
          operators.$gt = operand;
          break;
        case "gte":
          operators.$gte = operand;
          break;
        case "lt":
          operators.$lt = operand;
          break;
        case "lte":
          operators.$lte = operand;
          break;
        case "in":
          if (!Array.isArray(operand) || operand.length === 0) {
            return { [ALWAYS_FALSE_FILTER_KEY]: true };
          }
          operators.$in = operand;
          break;
        case "nin":
          if (!Array.isArray(operand) || operand.length === 0) {
            break;
          }
          operators.$nin = operand;
          break;
        case "contains":
        case "icontains":
        case "startsWith":
          throw new Error(
            `S3 Vectors does not support '${operator}' metadata filters.`
          );
        default:
          throw new Error(
            `Unsupported S3 Vectors filter operator: ${operator}`
          );
      }
    }
    if (Object.keys(operators).length === 0) {
      return {};
    }
    return { [key]: operators };
  }
  negateFilter(filter) {
    if (Array.isArray(filter.$and)) {
      return {
        $or: filter.$and.map((entry) => this.negateFilter(entry))
      };
    }
    if (Array.isArray(filter.$or)) {
      return {
        $and: filter.$or.map((entry) => this.negateFilter(entry))
      };
    }
    const entries = Object.entries(filter);
    if (entries.length !== 1) {
      throw new Error("S3 Vectors cannot negate this filter shape.");
    }
    const [key, rawValue] = entries[0];
    if (key.startsWith("$")) {
      throw new Error("S3 Vectors cannot negate this filter shape.");
    }
    const value = typeof rawValue === "object" && rawValue !== null ? rawValue : { $eq: rawValue };
    const negated = {};
    for (const [operator, operand] of Object.entries(value)) {
      switch (operator) {
        case "$eq":
          negated.$ne = operand;
          break;
        case "$ne":
          negated.$eq = operand;
          break;
        case "$gt":
          negated.$lte = operand;
          break;
        case "$gte":
          negated.$lt = operand;
          break;
        case "$lt":
          negated.$gte = operand;
          break;
        case "$lte":
          negated.$gt = operand;
          break;
        case "$in":
          negated.$nin = operand;
          break;
        case "$nin":
          negated.$in = operand;
          break;
        case "$exists":
          negated.$exists = !operand;
          break;
        default:
          throw new Error("S3 Vectors cannot negate this filter shape.");
      }
    }
    return { [key]: negated };
  }
  matchesFilter(metadata, filter) {
    if (this.isAlwaysFalseFilter(filter)) {
      return false;
    }
    if (Array.isArray(filter.$and)) {
      return filter.$and.every(
        (entry) => this.matchesFilter(metadata, entry)
      );
    }
    if (Array.isArray(filter.$or)) {
      return filter.$or.some(
        (entry) => this.matchesFilter(metadata, entry)
      );
    }
    return Object.entries(filter).every(
      ([key, rawValue]) => this.matchesFieldFilter(metadata[key], rawValue)
    );
  }
  matchesFieldFilter(metadataValue, rawValue) {
    const value = typeof rawValue === "object" && rawValue !== null ? rawValue : { $eq: rawValue };
    return Object.entries(value).every(
      ([operator, operand]) => this.evaluateOperator(metadataValue, operator, operand)
    );
  }
  evaluateOperator(metadataValue, operator, operand) {
    switch (operator) {
      case "$eq":
        if (Array.isArray(metadataValue)) {
          return metadataValue.some((entry) => entry === operand);
        }
        return metadataValue === operand;
      case "$ne":
        if (Array.isArray(metadataValue)) {
          return !metadataValue.some((entry) => entry === operand);
        }
        return metadataValue !== operand;
      case "$gt":
        return typeof metadataValue === "number" && metadataValue > operand;
      case "$gte":
        return typeof metadataValue === "number" && metadataValue >= operand;
      case "$lt":
        return typeof metadataValue === "number" && metadataValue < operand;
      case "$lte":
        return typeof metadataValue === "number" && metadataValue <= operand;
      case "$in":
        if (!Array.isArray(operand) || operand.length === 0) {
          return false;
        }
        if (Array.isArray(metadataValue)) {
          return metadataValue.some((entry) => operand.includes(entry));
        }
        return operand.includes(metadataValue);
      case "$nin":
        if (!Array.isArray(operand) || operand.length === 0) {
          return true;
        }
        if (Array.isArray(metadataValue)) {
          return metadataValue.every((entry) => !operand.includes(entry));
        }
        return !operand.includes(metadataValue);
      case "$exists":
        return operand ? metadataValue !== void 0 : metadataValue === void 0;
      default:
        throw new Error(`Unsupported S3 Vectors filter operator: ${operator}`);
    }
  }
  toVectorData(vector) {
    return { float32: vector };
  }
  fromVectorData(data) {
    if (!data || !("float32" in data) || !Array.isArray(data.float32)) {
      return void 0;
    }
    return data.float32;
  }
  normalizeMetadata(metadata) {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      return { ...metadata };
    }
    return {};
  }
  normalizeQueryVector(vector, distanceMetric) {
    return {
      id: String(vector.key),
      payload: this.normalizeMetadata(vector.metadata),
      score: this.normalizeScore(vector.distance, distanceMetric)
    };
  }
  normalizeStoredVector(vector) {
    return {
      id: String(vector.key),
      payload: this.normalizeMetadata(vector.metadata)
    };
  }
  normalizeListedVector(vector) {
    return this.normalizeStoredVector(vector);
  }
  normalizeScore(distance, distanceMetric = this.distanceMetric) {
    if (distance === void 0 || distance === null) {
      return void 0;
    }
    if (!Number.isFinite(distance)) {
      return void 0;
    }
    if (distanceMetric === "euclidean") {
      return 1 / (1 + distance);
    }
    return Math.max(0, Math.min(1, 1 - distance));
  }
  assertVectorDimension(vector, context) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `${context} dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }
  }
  assertBatchDimensions(vectors, context) {
    for (const vector of vectors) {
      this.assertVectorDimension(vector, context);
    }
  }
  isNotFound(error) {
    return (error == null ? void 0 : error.name) === "NotFoundException";
  }
  isConflict(error) {
    return (error == null ? void 0 : error.name) === "ConflictException";
  }
  isAlwaysFalseFilter(filter) {
    return filter[ALWAYS_FALSE_FILTER_KEY] === true;
  }
  isNoOpFilter(filter) {
    return Object.keys(filter).length === 0;
  }
};

// src/oss/src/vector_stores/turbopuffer.ts
var _TurbopufferDB = class _TurbopufferDB {
  constructor(config) {
    var _a2, _b2, _c, _d;
    const apiKey = (_a2 = config.apiKey) != null ? _a2 : process.env.TURBOPUFFER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Turbopuffer API key is required. Provide it via config.apiKey or the TURBOPUFFER_API_KEY environment variable."
      );
    }
    this.apiKey = apiKey;
    this.region = (_b2 = config.region) != null ? _b2 : "gcp-us-central1";
    this.collectionName = config.collectionName;
    this.distanceMetric = (_c = config.distanceMetric) != null ? _c : "cosine_distance";
    this.batchSize = (_d = config.batchSize) != null ? _d : 100;
  }
  /**
   * Lazily construct (or reuse) the Turbopuffer client, importing the optional
   * `@turbopuffer/turbopuffer` peer only when the store is first used so
   * consumers that never touch Turbopuffer don't need it installed.
   */
  async getClient() {
    if (this.clientInstance) return this.clientInstance;
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    this.clientInstance = await this.clientPromise;
    return this.clientInstance;
  }
  async createClient() {
    const sdk = await loadPeer(
      "@turbopuffer/turbopuffer",
      "Turbopuffer vector store",
      () => import("@turbopuffer/turbopuffer")
    );
    return new sdk.default({
      apiKey: this.apiKey,
      region: this.region
    });
  }
  async getNs() {
    const client = await this.getClient();
    return client.namespace(this.collectionName);
  }
  async getMigrationsNs() {
    const client = await this.getClient();
    return client.namespace(this.collectionName + "_migrations");
  }
  async initialize() {
  }
  async insert(vectors, ids, payloads) {
    const ns = await this.getNs();
    for (let i = 0; i < vectors.length; i += this.batchSize) {
      const batchVectors = vectors.slice(i, i + this.batchSize);
      const batchIds = ids.slice(i, i + this.batchSize);
      const batchPayloads = payloads.slice(i, i + this.batchSize);
      const upsert_rows = batchVectors.map((vector, j) => ({
        ...batchPayloads[j],
        id: batchIds[j],
        vector
      }));
      await ns.write({
        upsert_rows,
        distance_metric: this.distanceMetric
      });
    }
  }
  async search(query, topK, filters) {
    var _a2;
    const queryParams = {
      rank_by: ["vector", "ANN", query],
      top_k: topK != null ? topK : 5,
      include_attributes: true
    };
    const tpufFilters = this.convertFilters(filters);
    if (tpufFilters !== null) queryParams.filters = tpufFilters;
    const ns = await this.getNs();
    try {
      const result = await ns.query(queryParams);
      return this.parseRows((_a2 = result.rows) != null ? _a2 : []);
    } catch (err) {
      console.error("Turbopuffer search error:", err);
      return [];
    }
  }
  async keywordSearch() {
    return null;
  }
  async get(vectorId) {
    var _a2;
    const ns = await this.getNs();
    try {
      const result = await ns.query({
        rank_by: ["id", "asc"],
        top_k: 1,
        include_attributes: true,
        filters: ["id", "Eq", vectorId]
      });
      const rows = (_a2 = result.rows) != null ? _a2 : [];
      return rows.length ? this.parseRows(rows)[0] : null;
    } catch (err) {
      console.error("Turbopuffer get error:", err);
      return null;
    }
  }
  async update(vectorId, vector, payload) {
    const ns = await this.getNs();
    if (vector && vector.length > 0) {
      await ns.write({
        upsert_rows: [{ ...payload, id: vectorId, vector }],
        distance_metric: this.distanceMetric
      });
    } else {
      await ns.write({
        patch_rows: [{ ...payload, id: vectorId }]
      });
    }
  }
  async delete(vectorId) {
    const ns = await this.getNs();
    await ns.write({ deletes: [vectorId] });
  }
  async deleteCol() {
    const ns = await this.getNs();
    await ns.deleteAll();
  }
  async list(filters, topK) {
    var _a2;
    const queryParams = {
      rank_by: ["id", "asc"],
      top_k: topK != null ? topK : 100,
      include_attributes: true
    };
    const tpufFilters = this.convertFilters(filters);
    if (tpufFilters !== null) queryParams.filters = tpufFilters;
    const ns = await this.getNs();
    try {
      const result = await ns.query(queryParams);
      const rows = this.parseRows((_a2 = result.rows) != null ? _a2 : []);
      return [rows, rows.length];
    } catch (err) {
      console.error("Turbopuffer list error:", err);
      return [[], 0];
    }
  }
  async getUserId() {
    var _a2;
    try {
      const migrationsNs = await this.getMigrationsNs();
      let rows = [];
      try {
        const result = await migrationsNs.query({
          rank_by: ["id", "asc"],
          top_k: 1,
          include_attributes: true
        });
        rows = (_a2 = result.rows) != null ? _a2 : [];
      } catch (err) {
        if ((err == null ? void 0 : err.status) !== 404) throw err;
      }
      if (rows.length > 0 && rows[0].user_id) {
        return String(rows[0].user_id);
      }
      const randomId = Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);
      await migrationsNs.write({
        upsert_rows: [{ id: "1", vector: [0], user_id: randomId }],
        distance_metric: "cosine_distance"
      });
      return randomId;
    } catch (err) {
      console.error("Error getting user ID:", err);
      throw err;
    }
  }
  async setUserId(userId) {
    try {
      const migrationsNs = await this.getMigrationsNs();
      await migrationsNs.write({
        upsert_rows: [{ id: "1", vector: [0], user_id: userId }],
        distance_metric: "cosine_distance"
      });
    } catch (err) {
      console.error("Error setting user ID:", err);
      throw err;
    }
  }
  convertFilters(filters) {
    if (!filters || Object.keys(filters).length === 0) return null;
    const conditions = [];
    for (const [key, value] of Object.entries(filters)) {
      if (value === "*") {
        continue;
      }
      if (Array.isArray(value)) {
        conditions.push([key, "In", value]);
        continue;
      }
      if (typeof value === "object" && value !== null) {
        for (const [op, operand] of Object.entries(value)) {
          const token = _TurbopufferDB.OPERATOR_MAP[op];
          if (!token) {
            throw new Error(
              `Unsupported Turbopuffer filter operator '${op}' for field '${key}'. Supported operators: ${Object.keys(_TurbopufferDB.OPERATOR_MAP).join(", ")}.`
            );
          }
          conditions.push([key, token, operand]);
        }
        continue;
      }
      conditions.push([key, "Eq", value]);
    }
    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];
    return ["And", conditions];
  }
  parseRows(rows) {
    return rows.map((row) => {
      const { id, $dist, vector, ...rest } = row;
      let score;
      if ($dist == null) {
        score = void 0;
      } else if (this.distanceMetric === "euclidean_squared") {
        score = 1 / (1 + $dist);
      } else {
        score = 1 - $dist;
      }
      return { id: String(id), payload: rest, score };
    });
  }
};
// Maps mem0's universal filter operators to Turbopuffer's filter tokens.
_TurbopufferDB.OPERATOR_MAP = {
  eq: "Eq",
  ne: "NotEq",
  gt: "Gt",
  gte: "Gte",
  lt: "Lt",
  lte: "Lte",
  in: "In",
  nin: "NotIn"
};
var TurbopufferDB = _TurbopufferDB;

// src/oss/src/vector_stores/milvus.ts
var _Milvus = class _Milvus {
  constructor(config) {
    // Whether this collection has the `text` + `sparse` fields for BM25 hybrid
    // search. Collections created before BM25 support lack them, so writing a
    // top-level `text` field or passing a sparse anns_field would be rejected.
    this.hasBm25Schema = false;
    this.collectionName = config.collectionName || "mem0";
    this.dimension = config.embeddingModelDims || config.dimension || 1536;
    this.metricType = config.metricType || "L2";
    if (config.client) {
      this.client = config.client;
      try {
        const sdk = __require("@zilliz/milvus2-sdk-node");
        this.DataType = sdk.DataType;
        this.FunctionType = sdk.FunctionType;
      } catch (_) {
        this.DataType = void 0;
        this.FunctionType = void 0;
      }
    } else {
      let MilvusClient;
      let DataType;
      let FunctionType;
      try {
        const sdk = __require("@zilliz/milvus2-sdk-node");
        MilvusClient = sdk.MilvusClient;
        DataType = sdk.DataType;
        FunctionType = sdk.FunctionType;
      } catch (_) {
        throw new Error(
          "The '@zilliz/milvus2-sdk-node' package is required to use the Milvus vector store. Install it with: npm install @zilliz/milvus2-sdk-node"
        );
      }
      this.DataType = DataType;
      this.FunctionType = FunctionType;
      this.client = new MilvusClient({
        address: config.url || "http://localhost:19530",
        token: config.token,
        database: config.dbName || void 0
      });
    }
    this.initialize().catch(
      (err) => console.error("Error initializing Milvus:", err)
    );
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this.createCol(this.collectionName, this.dimension);
    }
    return this._initPromise;
  }
  /**
   * Create the collection if it does not already exist, with an AUTOINDEX
   * dense-vector index plus a BM25 `text` -> `sparse` full-text index. Idempotent
   * (mirrors the Python `create_col`). When the collection already exists, detect
   * whether the BM25 `text`/`sparse` fields are present so keyword search
   * degrades gracefully on collections created before BM25 support.
   */
  async createCol(collectionName, vectorSize) {
    var _a2, _b2;
    const has = await this.client.hasCollection({
      collection_name: collectionName
    });
    const exists = typeof has === "object" && has !== null ? has.value : has;
    if (exists) {
      const desc = await this.client.describeCollection({
        collection_name: collectionName
      });
      const names = new Set(
        (((_a2 = desc == null ? void 0 : desc.schema) == null ? void 0 : _a2.fields) || []).map((f) => f.name)
      );
      this.hasBm25Schema = names.has("text") && names.has("sparse");
      if (!this.hasBm25Schema) {
        console.warn(
          `Milvus collection '${collectionName}' predates BM25 hybrid search (no 'text'/'sparse' fields). Keyword scoring is disabled for it; semantic search still works. Use a fresh collection to enable it.`
        );
      }
      return;
    }
    const DataType = this.DataType || {};
    const fields = [
      {
        name: "id",
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 512
      },
      {
        name: "vectors",
        data_type: DataType.FloatVector,
        dim: vectorSize
      },
      {
        name: "metadata",
        data_type: DataType.JSON
      },
      // Analyzer-enabled text field that feeds the BM25 function below.
      {
        name: "text",
        data_type: DataType.VarChar,
        max_length: 65535,
        enable_analyzer: true
      },
      // Sparse vectors are generated automatically by the BM25 function.
      {
        name: "sparse",
        data_type: DataType.SparseFloatVector
      }
    ];
    await this.client.createCollection({
      collection_name: collectionName,
      fields,
      enable_dynamic_field: true,
      // BM25 turns the `text` field into `sparse` vectors for full-text search.
      functions: [
        {
          name: "bm25",
          type: (_b2 = this.FunctionType) == null ? void 0 : _b2.BM25,
          input_field_names: ["text"],
          output_field_names: ["sparse"],
          params: {}
        }
      ],
      index_params: [
        {
          field_name: "vectors",
          index_type: "AUTOINDEX",
          metric_type: this.metricType,
          index_name: "vector_index"
        },
        {
          field_name: "sparse",
          index_type: "SPARSE_INVERTED_INDEX",
          metric_type: "BM25",
          index_name: "sparse_index"
        }
      ]
    });
    await this.client.loadCollection({ collection_name: collectionName });
    this.hasBm25Schema = true;
  }
  /**
   * Build a Milvus boolean filter expression from a flat filters object.
   * Mirrors the Python `_create_filter` (equality only, AND-combined): validate
   * each key, escape string values (backslash first, then double-quote), and
   * reject value types Milvus can't compare against a scalar field.
   */
  createFilter(filters) {
    if (!filters || Object.keys(filters).length === 0) return void 0;
    const operands = [];
    for (const [key, value] of Object.entries(filters)) {
      if (value === void 0 || value === null) continue;
      if (!_Milvus.SAFE_FILTER_KEY.test(key)) {
        throw new Error(`Invalid filter key: ${JSON.stringify(key)}`);
      }
      if (value === "*") {
        continue;
      }
      if (typeof value === "string") {
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        operands.push(`(metadata["${key}"] == "${escaped}")`);
      } else if (typeof value === "number" || typeof value === "boolean") {
        operands.push(`(metadata["${key}"] == ${value})`);
      } else {
        throw new Error(
          `Filter value for ${JSON.stringify(key)} must be a string, number, or boolean, got ${typeof value}`
        );
      }
    }
    return operands.length > 0 ? operands.join(" and ") : void 0;
  }
  /**
   * Text fed to the BM25 sparse index for a payload. Prefers `textLemmatized`,
   * then `text_lemmatized`, then raw `data`; truncates to the VarChar limit.
   */
  bm25Text(payload) {
    if (!payload) return "";
    const raw = payload.textLemmatized || payload.text_lemmatized || payload.data || "";
    return String(raw).slice(0, 65535);
  }
  async insert(vectors, ids, payloads) {
    const data = vectors.map((vector, idx) => {
      const metadata = payloads[idx] || {};
      const row = {
        id: ids[idx],
        vectors: vector,
        metadata
      };
      if (this.hasBm25Schema) row.text = this.bm25Text(metadata);
      return row;
    });
    await this.client.insert({
      collection_name: this.collectionName,
      data
    });
  }
  /**
   * Map raw Milvus search hits to VectorStoreResult. For the L2 metric,
   * distances are unbounded and smaller-is-better, so normalise them to a 0..1
   * similarity; every other metric passes the raw score through. Shared by
   * search and keywordSearch so both match the Python provider's `_parse_output`
   * (which likewise normalises by metric type regardless of dense vs BM25 score).
   */
  parseHits(hits) {
    return hits.map((hit) => {
      var _a2;
      const rawDistance = (_a2 = hit.score) != null ? _a2 : hit.distance;
      let score = rawDistance;
      if (rawDistance != null && this.metricType === "L2") {
        score = 1 / (1 + rawDistance);
      }
      return {
        id: String(hit.id),
        payload: hit.metadata || {},
        score
      };
    });
  }
  async search(query, topK = 5, filters) {
    const filter = this.createFilter(filters);
    const req = {
      collection_name: this.collectionName,
      data: [query],
      limit: topK,
      filter,
      output_fields: ["*"]
    };
    if (this.hasBm25Schema) req.anns_field = "vectors";
    const res = await this.client.search(req);
    return this.parseHits((res == null ? void 0 : res.results) || []);
  }
  /**
   * BM25 full-text keyword search over the sparse field. Milvus tokenizes the
   * raw query string via the collection's BM25 function. Returns null when the
   * collection has no BM25 schema so callers fall back to dense search only
   * (mirrors the Python provider).
   */
  async keywordSearch(query, topK = 5, filters) {
    if (!this.hasBm25Schema) return null;
    try {
      const filter = this.createFilter(filters);
      const res = await this.client.search({
        collection_name: this.collectionName,
        data: [query],
        anns_field: "sparse",
        limit: topK,
        filter,
        output_fields: ["*"]
      });
      return this.parseHits((res == null ? void 0 : res.results) || []);
    } catch (_) {
      return null;
    }
  }
  async get(vectorId) {
    const res = await this.client.get({
      collection_name: this.collectionName,
      ids: [vectorId],
      output_fields: ["id", "metadata"]
    });
    const rows = (res == null ? void 0 : res.data) || [];
    if (!rows.length) return null;
    return {
      id: String(rows[0].id),
      payload: rows[0].metadata || {}
    };
  }
  async update(vectorId, vector, payload) {
    const row = {
      id: vectorId,
      vectors: vector,
      metadata: payload
    };
    if (this.hasBm25Schema) row.text = this.bm25Text(payload);
    await this.client.upsert({
      collection_name: this.collectionName,
      data: [row]
    });
  }
  async delete(vectorId) {
    await this.client.delete({
      collection_name: this.collectionName,
      ids: [vectorId]
    });
  }
  async deleteCol() {
    await this.client.dropCollection({
      collection_name: this.collectionName
    });
  }
  async list(filters, topK = 100) {
    const filter = this.createFilter(filters);
    const res = await this.client.query({
      collection_name: this.collectionName,
      filter: filter != null ? filter : "",
      limit: topK,
      output_fields: ["id", "metadata"]
    });
    const rows = (res == null ? void 0 : res.data) || [];
    const results = rows.map((row) => ({
      id: String(row.id),
      payload: row.metadata || {}
    }));
    return [results, results.length];
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  async ensureMigrationsCol() {
    const name = "memory_migrations";
    const has = await this.client.hasCollection({ collection_name: name });
    const exists = typeof has === "object" && has !== null ? has.value : has;
    if (exists) return;
    const DataType = this.DataType || {};
    await this.client.createCollection({
      collection_name: name,
      fields: [
        {
          name: "id",
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 512
        },
        // Milvus rejects a FloatVector with dim < 2, so use the minimum (2). This
        // helper collection is never vector-searched; the vector is a fixed
        // placeholder that exists only to satisfy the required-vector-field schema.
        { name: "vectors", data_type: DataType.FloatVector, dim: 2 },
        { name: "user_id", data_type: DataType.VarChar, max_length: 512 }
      ],
      index_params: [
        {
          field_name: "vectors",
          index_type: "AUTOINDEX",
          // Fixed metric: this helper collection is never vector-searched, and a
          // zero vector has no direction, so COSINE would be degenerate here.
          metric_type: "L2",
          index_name: "vector_index"
        }
      ]
    });
    await this.client.loadCollection({ collection_name: name });
  }
  async getUserId() {
    await this.ensureMigrationsCol();
    const res = await this.client.query({
      collection_name: "memory_migrations",
      filter: "",
      limit: 1,
      output_fields: ["*"]
    });
    const rows = (res == null ? void 0 : res.data) || [];
    if (rows.length > 0 && rows[0].user_id) {
      return String(rows[0].user_id);
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.client.insert({
      collection_name: "memory_migrations",
      data: [
        { id: this.generateUUID(), vectors: [0, 0], user_id: randomUserId2 }
      ]
    });
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.ensureMigrationsCol();
    const existing = await this.client.query({
      collection_name: "memory_migrations",
      filter: "",
      limit: 1,
      output_fields: ["id"]
    });
    const rows = (existing == null ? void 0 : existing.data) || [];
    const id = rows.length > 0 && rows[0].id ? String(rows[0].id) : this.generateUUID();
    await this.client.upsert({
      collection_name: "memory_migrations",
      data: [{ id, vectors: [0, 0], user_id: userId }]
    });
  }
};
/**
 * Filter keys are interpolated straight into the expression, so restrict them
 * to safe identifiers (same rule as the Python provider) to block injection.
 */
_Milvus.SAFE_FILTER_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
var Milvus = _Milvus;

// src/oss/src/vector_stores/mongodb.ts
var MongoDB = class {
  constructor(config) {
    this.config = config;
    this.collectionName = config.collectionName || "mem0";
    this.dbName = config.dbName || "mem0_db";
    this.embeddingModelDims = config.embeddingModelDims || config.dimension || 1536;
    this.indexName = `${this.collectionName}_vector_index`;
  }
  async ensureClient() {
    if (this.client) return;
    const config = this.config;
    if (config.client) {
      this.client = config.client;
    } else {
      const sdk = await loadPeer(
        "mongodb",
        "MongoDB vector store",
        () => import("mongodb")
      );
      const url = config.url || "mongodb://localhost:27017";
      this.client = new sdk.MongoClient(url, { appName: "Mem0" });
    }
    this.db = this.client.db(this.dbName);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  textSearchIndexDefinition(textIndexName) {
    return {
      name: textIndexName,
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            payload: {
              type: "document",
              fields: {
                data: { type: "string" },
                textLemmatized: { type: "string" },
                text_lemmatized: { type: "string" }
              }
            }
          }
        }
      }
    };
  }
  textSearchIndexMappingIsCurrent(index) {
    var _a2, _b2, _c, _d;
    const definition = (_a2 = index.latestDefinition) != null ? _a2 : index.definition;
    const payloadFields = (_c = (_b2 = definition == null ? void 0 : definition.mappings) == null ? void 0 : _b2.fields) == null ? void 0 : _c.payload;
    const fields = (_d = payloadFields == null ? void 0 : payloadFields.fields) != null ? _d : {};
    const textLemmatized = fields.textLemmatized;
    return (textLemmatized == null ? void 0 : textLemmatized.type) === "string";
  }
  async _doInitialize() {
    var _a2;
    await this.ensureClient();
    try {
      const collections = await this.db.listCollections({ name: this.collectionName }).toArray();
      if (collections.length === 0) {
        this.collection = this.db.collection(this.collectionName);
        await this.collection.insertOne({ _id: 0, placeholder: true });
        await this.collection.deleteOne({ _id: 0 });
      } else {
        this.collection = this.db.collection(this.collectionName);
      }
      try {
        let foundIndex = false;
        try {
          const indexes = await this.collection.listSearchIndexes().toArray();
          foundIndex = indexes.some((idx) => idx.name === this.indexName);
        } catch (e) {
        }
        if (!foundIndex) {
          await this.collection.createSearchIndex({
            name: this.indexName,
            type: "vectorSearch",
            definition: {
              fields: [
                {
                  type: "vector",
                  path: "embedding",
                  numDimensions: this.embeddingModelDims,
                  similarity: "cosine"
                }
              ]
            }
          });
        }
      } catch (e) {
        console.warn(
          `Could not verify or create vector search index: ${e.message}`
        );
      }
      const textIndexName = `${this.collectionName}_text_search_index`;
      try {
        let existingTextIndex = null;
        try {
          const indexes = await this.collection.listSearchIndexes().toArray();
          existingTextIndex = (_a2 = indexes.find((idx) => idx.name === textIndexName)) != null ? _a2 : null;
        } catch (e) {
        }
        const textSearchIndex = this.textSearchIndexDefinition(textIndexName);
        if (!existingTextIndex) {
          await this.collection.createSearchIndex(textSearchIndex);
        } else if (!this.textSearchIndexMappingIsCurrent(existingTextIndex)) {
          await this.collection.dropSearchIndex(textIndexName);
          await this.collection.createSearchIndex(textSearchIndex);
        }
      } catch (e) {
        console.warn(
          `Could not create text search index '${textIndexName}': ${e.message}. Atlas Search may not be available. keywordSearch() will not work.`
        );
      }
    } catch (error) {
      console.error("Error initializing MongoDB:", error);
      throw error;
    }
  }
  validateFilterValue(key, value) {
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            throw new Error(
              `Filter list for '${key}' contains an object, which may contain MongoDB query operators.`
            );
          }
        }
      } else {
        throw new Error(
          `Filter value for '${key}' must be a scalar (string, number, boolean), not an object. Objects may contain MongoDB query operators.`
        );
      }
    }
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const documents = vectors.map((vector, idx) => ({
      _id: ids[idx],
      embedding: vector,
      payload: payloads[idx] || {}
    }));
    try {
      await this.collection.insertMany(documents);
    } catch (error) {
      console.error("Error inserting data:", error);
      throw error;
    }
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        this.validateFilterValue(key, value);
      }
    }
    try {
      let foundIndex = false;
      try {
        const indexes = await this.collection.listSearchIndexes().toArray();
        foundIndex = indexes.some((idx) => idx.name === this.indexName);
      } catch (e) {
        foundIndex = true;
      }
      if (!foundIndex) {
        console.error(`Index '${this.indexName}' does not exist.`);
        return [];
      }
      const pipeline = [
        {
          $vectorSearch: {
            index: this.indexName,
            limit: topK,
            numCandidates: Math.min(topK * 20, 1e4),
            queryVector: query,
            path: "embedding"
          }
        },
        { $set: { score: { $meta: "vectorSearchScore" } } },
        { $project: { embedding: 0 } }
      ];
      if (filters && Object.keys(filters).length > 0) {
        const filterConditions = [];
        for (const [key, value] of Object.entries(filters)) {
          filterConditions.push({ [`payload.${key}`]: value });
        }
        if (filterConditions.length > 0) {
          pipeline.splice(1, 0, { $match: { $and: filterConditions } });
        }
      }
      const results = await this.collection.aggregate(pipeline).toArray();
      return results.map((doc) => ({
        id: String(doc._id),
        score: doc.score,
        payload: doc.payload || {}
      }));
    } catch (error) {
      console.error(
        "Error during vector search:",
        error instanceof Error ? error.message : error
      );
      return [];
    }
  }
  async keywordSearch(query, topK = 5, filters) {
    await this.initialize();
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        this.validateFilterValue(key, value);
      }
    }
    try {
      const textIndexName = `${this.collectionName}_text_search_index`;
      const pipeline = [
        {
          $search: {
            index: textIndexName,
            text: {
              query,
              path: [
                "payload.data",
                "payload.text_lemmatized",
                "payload.textLemmatized"
              ]
            }
          }
        },
        { $set: { score: { $meta: "searchScore" } } },
        { $project: { embedding: 0 } }
      ];
      if (filters && Object.keys(filters).length > 0) {
        const filterConditions = [];
        for (const [key, value] of Object.entries(filters)) {
          filterConditions.push({ [`payload.${key}`]: value });
        }
        if (filterConditions.length > 0) {
          pipeline.splice(1, 0, { $match: { $and: filterConditions } });
        }
      }
      pipeline.push({ $limit: topK });
      const results = await this.collection.aggregate(pipeline).toArray();
      return results.map((doc) => ({
        id: String(doc._id),
        score: doc.score,
        payload: doc.payload || {}
      }));
    } catch (error) {
      console.error(
        "Error during keyword search:",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
  async get(vectorId) {
    await this.initialize();
    try {
      const doc = await this.collection.findOne({ _id: vectorId });
      if (doc) {
        return {
          id: String(doc._id),
          payload: doc.payload || {}
        };
      }
      return null;
    } catch (error) {
      console.error("Error retrieving document:", error);
      return null;
    }
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const updateFields = {};
    if (vector) {
      updateFields.embedding = vector;
    }
    if (payload) {
      for (const [key, value] of Object.entries(payload)) {
        updateFields[`payload.${key}`] = value;
      }
    }
    if (Object.keys(updateFields).length > 0) {
      try {
        const result = await this.collection.updateOne(
          { _id: vectorId },
          { $set: updateFields }
        );
        if (result.matchedCount === 0) {
          console.warn(`No document found with ID '${vectorId}' to update.`);
        }
      } catch (error) {
        console.error("Error updating document:", error);
        throw error;
      }
    }
  }
  async delete(vectorId) {
    await this.initialize();
    try {
      const result = await this.collection.deleteOne({ _id: vectorId });
      if (result.deletedCount === 0) {
        console.warn(`No document found with ID '${vectorId}' to delete.`);
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      throw error;
    }
  }
  async deleteCol() {
    await this.initialize();
    try {
      await this.collection.drop();
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw error;
    }
  }
  async list(filters, topK = 100) {
    await this.initialize();
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        this.validateFilterValue(key, value);
      }
    }
    try {
      let query = {};
      if (filters && Object.keys(filters).length > 0) {
        const filterConditions = [];
        for (const [key, value] of Object.entries(filters)) {
          filterConditions.push({ [`payload.${key}`]: value });
        }
        if (filterConditions.length > 0) {
          query = { $and: filterConditions };
        }
      }
      const results = await this.collection.find(query).limit(topK).toArray();
      const output = results.map((doc) => ({
        id: String(doc._id),
        payload: doc.payload || {}
      }));
      return [output, results.length];
    } catch (error) {
      console.error("Error listing documents:", error);
      return [[], 0];
    }
  }
  async getUserId() {
    await this.initialize();
    try {
      const migrationsCol = this.db.collection("memory_migrations");
      const doc = await migrationsCol.findOne({});
      if (doc && doc.user_id) {
        return doc.user_id;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await migrationsCol.updateOne(
        {},
        { $set: { user_id: randomUserId2 } },
        { upsert: true }
      );
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  async setUserId(userId) {
    await this.initialize();
    try {
      const migrationsCol = this.db.collection("memory_migrations");
      await migrationsCol.updateOne(
        {},
        { $set: { user_id: userId } },
        { upsert: true }
      );
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
  async close() {
    if (this.client) {
      await this.client.close();
    }
  }
};

// src/oss/src/vector_stores/weaviate.ts
import { v4 as uuidv43 } from "uuid";
var RETURN_PROPERTIES = [
  "ids",
  "hash",
  "metadata",
  "data",
  "created_at",
  "category",
  "updated_at",
  "user_id",
  "agent_id",
  "run_id"
];
var WeaviateDB = class {
  constructor(config) {
    this._config = config;
    this._userId = "";
    this.initialize().catch(console.error);
  }
  initialize() {
    var _a2;
    return (_a2 = this._initPromise) != null ? _a2 : this._initPromise = this._doInitialize();
  }
  // Loaded dynamically: weaviate-client is an optional peer dependency, so a static
  // value import would break `import { Memory } from "mem0ai/oss"` for everyone else.
  async ensureClient() {
    if (this._client) return;
    const sdk = await loadPeer(
      "weaviate-client",
      "Weaviate vector store",
      () => import("weaviate-client")
    );
    this._sdk = sdk;
    const { client, clusterUrl, apiKey, additionalHeaders } = this._config;
    const weaviate = sdk.default;
    if (client) {
      this._client = client;
    } else if (clusterUrl == null ? void 0 : clusterUrl.includes("localhost")) {
      this._client = await weaviate.connectToLocal({
        headers: additionalHeaders
      });
    } else if (apiKey) {
      this._client = await weaviate.connectToWeaviateCloud(clusterUrl, {
        authCredentials: new weaviate.ApiKey(apiKey),
        headers: additionalHeaders
      });
    } else {
      if (!clusterUrl) {
        throw new Error(
          "WeaviateDB: clusterUrl is required when client and apiKey are not provided"
        );
      }
      const parsed = new URL(clusterUrl);
      const httpSecure = parsed.protocol === "https:";
      this._client = await weaviate.connectToCustom({
        httpHost: parsed.hostname,
        httpPort: parsed.port ? parseInt(parsed.port, 10) : httpSecure ? 443 : 8080,
        httpSecure,
        grpcHost: parsed.hostname,
        grpcPort: 50051,
        grpcSecure: false,
        headers: additionalHeaders
      });
    }
  }
  async _doInitialize() {
    await this.ensureClient();
    const { collectionName } = this._config;
    const weaviate = this._sdk.default;
    const exists = await this._client.collections.exists(collectionName);
    if (!exists) {
      await this._client.collections.create({
        name: collectionName,
        properties: RETURN_PROPERTIES.map((name) => ({
          name,
          dataType: "text"
        })),
        vectorizers: weaviate.configure.vectorizer.none(),
        vectorIndex: weaviate.configure.vectorIndex.hnsw()
      });
    }
    this._col = this._client.collections.get(collectionName);
  }
  _buildFilters(filters) {
    if (!filters) return void 0;
    const conditions = ["user_id", "agent_id", "run_id"].filter((key) => filters[key] != null).map((key) => this._col.filter.byProperty(key).equal(filters[key]));
    return conditions.length ? this._sdk.Filters.and(...conditions) : void 0;
  }
  async insert(vectors, ids, payloads) {
    await this.initialize();
    const objects = vectors.map((vector, i) => ({
      id: ids[i],
      properties: payloads[i],
      vectors: vector
    }));
    await this._col.data.insertMany(objects);
  }
  async search(query, topK, filters) {
    await this.initialize();
    const result = await this._col.query.nearVector(query, {
      limit: topK != null ? topK : 10,
      filters: this._buildFilters(filters),
      returnMetadata: ["distance"]
    });
    return result.objects.map((obj) => ({
      id: obj.uuid,
      payload: obj.properties,
      score: 1 - obj.metadata.distance
    }));
  }
  async keywordSearch(query, topK, filters) {
    await this.initialize();
    const result = await this._col.query.bm25(query, {
      queryProperties: ["data"],
      limit: topK != null ? topK : 10,
      filters: this._buildFilters(filters),
      returnMetadata: ["score"]
    });
    return result.objects.map((obj) => ({
      id: obj.uuid,
      payload: obj.properties,
      score: obj.metadata.score
    }));
  }
  async get(vectorId) {
    await this.initialize();
    const obj = await this._col.query.fetchObjectById(vectorId, {
      returnProperties: RETURN_PROPERTIES
    });
    if (!obj) return null;
    return { id: obj.uuid, payload: obj.properties };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    await this._col.data.update({
      id: vectorId,
      properties: payload,
      vectors: vector
    });
  }
  async delete(vectorId) {
    await this.initialize();
    await this._col.data.deleteById(vectorId);
  }
  async deleteCol() {
    await this.initialize();
    await this._client.collections.delete(this._config.collectionName);
  }
  async list(filters, topK) {
    await this.initialize();
    const result = await this._col.query.fetchObjects({
      limit: topK != null ? topK : 100,
      filters: this._buildFilters(filters),
      returnProperties: RETURN_PROPERTIES
    });
    const results = result.objects.map((obj) => ({
      id: obj.uuid,
      payload: obj.properties
    }));
    return [results, results.length];
  }
  async getUserId() {
    if (!this._userId) {
      this._userId = uuidv43();
    }
    return this._userId;
  }
  async setUserId(userId) {
    this._userId = userId;
  }
};

// src/oss/src/vector_stores/oracledb.ts
import { v4 as uuidv44 } from "uuid";
var DISTANCE_METRICS = [
  "COSINE",
  "EUCLIDEAN",
  "EUCLIDEAN_SQUARED",
  "DOT",
  "HAMMING",
  "MANHATTAN"
];
var SCORE_FROM_DISTANCE = {
  COSINE: (d) => Math.max(0, Math.min(1, 1 - d)),
  EUCLIDEAN: (d) => 1 / (1 + Math.max(0, d)),
  EUCLIDEAN_SQUARED: (d) => 1 / (1 + Math.sqrt(Math.max(0, d))),
  HAMMING: (d) => 1 / (1 + Math.max(0, d)),
  MANHATTAN: (d) => 1 / (1 + Math.max(0, d)),
  DOT: (d) => -d
};
var INDEX_PARAMETER_RANGES = {
  HNSW: {
    neighbors: [2, 2048],
    efconstruction: [1, 65535]
  },
  IVF: {
    "neighbor partitions": [1, 1e7],
    samples_per_partition: [1, Number.MAX_SAFE_INTEGER],
    min_vectors_per_partition: [0, Number.MAX_SAFE_INTEGER]
  }
};
var IDENTIFIER_RE = /^(?:"[^"]+"|[^".]+)(?:\.(?:"[^"]+"|[^".]+))*$/;
var METADATA_KEY_RE = /^[a-zA-Z0-9_.[\],\s*]+$/;
function quoteIdentifier(name) {
  const trimmed = name.trim();
  if (!IDENTIFIER_RE.test(trimmed)) {
    throw new Error(`Identifier name ${name} is not valid.`);
  }
  return [...trimmed.matchAll(/"([^"]+)"|([^".]+)/g)].map((m) => {
    var _a2;
    return `"${(_a2 = m[1]) != null ? _a2 : m[2]}"`;
  }).join(".");
}
function jsonPath(metadataKey) {
  if (!METADATA_KEY_RE.test(metadataKey)) {
    throw new Error(
      `Invalid metadata key '${metadataKey}'. Only letters, numbers, underscores, nesting via '.', and array wildcards '[*]' are allowed.`
    );
  }
  return metadataKey.split(".").map(
    (part) => part.endsWith("[*]") ? `."${part.slice(0, -3)}"[*]` : `."${part}"`
  ).join("");
}
var COMPARISON_OPERATORS = {
  eq: "==",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<="
};
var FIELD_OPERATORS = /* @__PURE__ */ new Set([
  ...Object.keys(COMPARISON_OPERATORS),
  "in",
  "nin",
  "contains",
  "icontains"
]);
var LOGICAL_OPERATORS = {
  $and: "and",
  $or: "or",
  $not: "not",
  AND: "and",
  OR: "or",
  NOT: "not"
};
function isScalar(value) {
  return value === null || typeof value !== "object" && !Array.isArray(value);
}
function bindFilterValue(value, binds) {
  const name = `f_${Object.keys(binds).length}`;
  binds[name] = value;
  return [`$${name}`, `:${name} AS "${name}"`];
}
function jsonExists(path4, predicate, passings) {
  const passingClause = passings.length > 0 ? ` PASSING ${passings.join(", ")}` : "";
  return `JSON_EXISTS(payload, '$${path4}?(${predicate})'${passingClause})`;
}
function buildFieldCondition(metadataKey, value, binds) {
  const path4 = jsonPath(metadataKey);
  if (value === "*") {
    return `JSON_EXISTS(payload, '$${path4}')`;
  }
  if (isScalar(value)) {
    if (value === null) {
      return jsonExists(path4, "@ == null", []);
    }
    const [variable, passing] = bindFilterValue(value, binds);
    return jsonExists(path4, `@ == ${variable}`, [passing]);
  }
  if (Array.isArray(value)) {
    throw new Error(
      `Oracle filter for field '${metadataKey}' must be a scalar or an operator object`
    );
  }
  const operators = Object.entries(value);
  if (operators.length === 0) {
    throw new Error(
      `Operator filter for field '${metadataKey}' must not be empty`
    );
  }
  const unsupported = operators.map(([op]) => op).filter((op) => !FIELD_OPERATORS.has(op));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported Oracle filter operator(s) for field '${metadataKey}': ${unsupported.sort().join(", ")}`
    );
  }
  const predicates = [];
  const passings = [];
  const additionalClauses = [];
  for (const [operator, operand] of operators) {
    if (operator in COMPARISON_OPERATORS) {
      if (!isScalar(operand)) {
        throw new Error(
          `Oracle filter operator '${operator}' requires a scalar value`
        );
      }
      if (operand === null) {
        if (operator !== "eq" && operator !== "ne") {
          throw new Error(
            `Oracle filter operator '${operator}' does not support null`
          );
        }
        predicates.push(`@ ${COMPARISON_OPERATORS[operator]} null`);
        continue;
      }
      const [variable, passing] = bindFilterValue(operand, binds);
      predicates.push(`@ ${COMPARISON_OPERATORS[operator]} ${variable}`);
      passings.push(passing);
      continue;
    }
    if (operator === "in" || operator === "nin") {
      if (!Array.isArray(operand) || operand.length === 0) {
        throw new Error(
          `Oracle filter operator '${operator}' requires a non-empty array`
        );
      }
      const variables = [];
      const listPassings = [];
      for (const item of operand) {
        if (!isScalar(item)) {
          throw new Error(
            `Oracle filter operator '${operator}' requires scalar values`
          );
        }
        if (item === null) {
          variables.push("null");
          continue;
        }
        const [variable, passing] = bindFilterValue(item, binds);
        variables.push(variable);
        listPassings.push(passing);
      }
      const membership = jsonExists(
        path4,
        `@ in (${variables.join(", ")})`,
        listPassings
      );
      additionalClauses.push(
        operator === "in" ? membership : `NOT (${membership})`
      );
      continue;
    }
    if (typeof operand !== "string") {
      throw new Error(
        `Oracle filter operator '${operator}' requires a string value`
      );
    }
    if (operator === "contains") {
      const [variable, passing] = bindFilterValue(operand, binds);
      predicates.push(`@ has substring ${variable}`);
      passings.push(passing);
    } else {
      const [variable, passing] = bindFilterValue(operand.toLowerCase(), binds);
      predicates.push(`@.lower() has substring ${variable}`);
      passings.push(passing);
    }
  }
  const clauses = [...additionalClauses];
  if (predicates.length > 0) {
    clauses.unshift(jsonExists(path4, predicates.join(" && "), passings));
  }
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" AND ")})`;
}
function buildFilterGroup(filters, binds) {
  const entries = Object.entries(filters != null ? filters : {});
  if (entries.length === 0) {
    throw new Error("Oracle filter groups must be non-empty objects");
  }
  const clauses = [];
  for (const [key, value] of entries) {
    const logicalOperator = LOGICAL_OPERATORS[key];
    if (logicalOperator) {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
          `Logical filter operator '${key}' requires a non-empty array`
        );
      }
      const nested = value.map(
        (condition) => buildFilterGroup(condition, binds)
      );
      if (logicalOperator === "not") {
        clauses.push(`NOT (${nested.join(" OR ")})`);
      } else {
        clauses.push(
          `(${nested.join(logicalOperator === "and" ? " AND " : " OR ")})`
        );
      }
      continue;
    }
    if (key.startsWith("$")) {
      throw new Error(`Unsupported Oracle logical filter operator: ${key}`);
    }
    clauses.push(buildFieldCondition(key, value, binds));
  }
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" AND ")})`;
}
function buildWhereClause(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return ["", {}];
  }
  const binds = {};
  return [`WHERE ${buildFilterGroup(filters, binds)}`, binds];
}
var OracleAIVectorSearch = class {
  constructor(config) {
    this.ownsClient = false;
    var _a2, _b2, _c, _d;
    if (!config.connectionParams && !config.client) {
      throw new Error(
        "Must provide at least one of `connectionParams` and `client`"
      );
    }
    this.collectionName = quoteIdentifier(config.collectionName || "mem0");
    this.indexName = quoteIdentifier(
      config.indexName || `${config.collectionName || "mem0"}_VEC_IDX`
    );
    this.embeddingModelDims = (_a2 = config.embeddingModelDims) != null ? _a2 : 1536;
    if (!Number.isInteger(this.embeddingModelDims) || this.embeddingModelDims <= 0) {
      throw new Error("`embeddingModelDims` must be a positive integer");
    }
    const distanceMetric = (_b2 = config.distanceMetric) != null ? _b2 : "COSINE";
    this.distanceMetric = distanceMetric.toUpperCase();
    if (!DISTANCE_METRICS.includes(this.distanceMetric)) {
      throw new Error(`Unsupported distance metric: ${config.distanceMetric}`);
    }
    const indexType = (_c = config.indexType) != null ? _c : "HNSW";
    this.indexType = indexType.toUpperCase();
    if (this.indexType !== "HNSW" && this.indexType !== "IVF") {
      throw new Error(`Unsupported index type: ${config.indexType}`);
    }
    this.indexAccuracy = config.indexAccuracy;
    if (this.indexAccuracy !== void 0 && (!Number.isInteger(this.indexAccuracy) || this.indexAccuracy <= 0 || this.indexAccuracy > 100)) {
      throw new Error("`indexAccuracy` must be an integer between 1 and 100");
    }
    this.indexParameters = this.validateIndexParameters(config.indexParameters);
    this.doCreateIndex = (_d = config.doCreateIndex) != null ? _d : true;
    this.config = config;
  }
  validateIndexParameters(parameters) {
    if (!parameters) return {};
    const allowed = INDEX_PARAMETER_RANGES[this.indexType];
    const validated = {};
    for (const [key, value] of Object.entries(parameters)) {
      const range = allowed[key];
      if (!range) {
        throw new Error(
          `Unsupported ${this.indexType} index parameter '${key}'. Allowed: ${Object.keys(allowed).join(", ")}`
        );
      }
      if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
        throw new Error(
          `Index parameter '${key}' must be an integer between ${range[0]} and ${range[1]}`
        );
      }
      validated[key] = value;
    }
    return validated;
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize().catch(async (error) => {
        if (this.ownsClient && this.client) {
          await Promise.resolve(this.client.close()).catch(() => {
          });
          this.client = void 0;
          this.ownsClient = false;
        }
        this._initPromise = void 0;
        throw error;
      });
    }
    return this._initPromise;
  }
  async _doInitialize() {
    var _a2, _b2;
    const sdk = await loadPeer(
      "oracledb",
      "Oracle AI Vector Search",
      () => import("oracledb")
    );
    this.oracledb = (_a2 = sdk.default) != null ? _a2 : sdk;
    if (this.config.client) {
      this.client = this.config.client;
    } else if ((_b2 = this.config.useConnectionPool) != null ? _b2 : true) {
      this.client = await this.oracledb.createPool({
        poolMin: 1,
        poolMax: 4,
        ...this.config.connectionParams
      });
      this.ownsClient = true;
    } else {
      this.client = await this.oracledb.getConnection(
        this.config.connectionParams
      );
      this.ownsClient = true;
    }
    await this.assertVectorSupport();
    await this.createCol();
  }
  isPool(client) {
    return typeof client.getConnection === "function";
  }
  async withConnection(fn, commit = false) {
    const client = this.client;
    if (!this.isPool(client)) {
      const connection2 = client;
      try {
        const result = await fn(connection2);
        if (commit) await connection2.commit();
        return result;
      } catch (err) {
        await connection2.rollback();
        throw err;
      }
    }
    const connection = await client.getConnection();
    try {
      const result = await fn(connection);
      if (commit) await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      await connection.close();
    }
  }
  async assertVectorSupport() {
    if (!this.oracledb.thin) {
      const [major2, minor2] = [
        Math.floor(this.oracledb.oracleClientVersion / 1e8),
        Math.floor(this.oracledb.oracleClientVersion / 1e5) % 100
      ];
      if (major2 < 23 || major2 === 23 && minor2 < 4) {
        throw new Error(
          `Oracle DB client driver version ${this.oracledb.oracleClientVersionString} not supported, must be >=23.4 for vector support`
        );
      }
    }
    const version2 = await this.withConnection(
      async (connection) => connection.oracleServerVersionString
    );
    const [major, minor] = version2.split(".").map(Number);
    if (major < 23 || major === 23 && minor < 4) {
      throw new Error(
        `Oracle DB version ${version2} not supported, must be >=23.4 for vector support`
      );
    }
  }
  createIndexDdl() {
    const accuracy = this.indexAccuracy ? `WITH TARGET ACCURACY ${this.indexAccuracy}` : "";
    const parameterEntries = Object.entries(this.indexParameters);
    const parameters = parameterEntries.length > 0 ? `PARAMETERS (${[
      `type ${this.indexType}`,
      ...parameterEntries.map(([key, value]) => `${key} ${value}`)
    ].join(", ")})` : "";
    const organization = this.indexType === "HNSW" ? "INMEMORY NEIGHBOR GRAPH" : "NEIGHBOR PARTITIONS";
    return `CREATE VECTOR INDEX IF NOT EXISTS ${this.indexName} ON ${this.collectionName} (vector) ORGANIZATION ${organization} DISTANCE ${this.distanceMetric} ${accuracy} ${parameters}`;
  }
  async createCol() {
    await this.withConnection(async (connection) => {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS ${this.collectionName} (
          id VARCHAR2(36) PRIMARY KEY,
          vector VECTOR(${this.embeddingModelDims}),
          payload JSON
        )
      `);
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS memory_migrations (
          id NUMBER PRIMARY KEY,
          user_id VARCHAR2(255) NOT NULL
        )
      `);
      if (this.doCreateIndex) {
        await connection.execute(this.createIndexDdl());
      }
    }, true);
  }
  loadPayload(value) {
    if (value === null || value === void 0) return {};
    if (typeof value === "string") return JSON.parse(value);
    if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf-8"));
    return value;
  }
  vectorBind(vector) {
    return {
      type: this.oracledb.DB_TYPE_VECTOR,
      val: new Float32Array(vector)
    };
  }
  payloadBind(payload) {
    return { type: this.oracledb.DB_TYPE_JSON, val: payload };
  }
  async insert(vectors, ids, payloads) {
    if (ids.length !== vectors.length) {
      throw new Error("ids and vectors must have the same length");
    }
    if (payloads.length !== vectors.length) {
      throw new Error("payloads and vectors must have the same length");
    }
    if (vectors.length === 0) return;
    await this.initialize();
    await this.withConnection(async (connection) => {
      await connection.executeMany(
        `INSERT INTO ${this.collectionName} (id, vector, payload) VALUES (:id, :vector, :payload)`,
        vectors.map((vector, i) => {
          var _a2;
          return {
            id: ids[i],
            vector: new Float32Array(vector),
            payload: (_a2 = payloads[i]) != null ? _a2 : {}
          };
        }),
        {
          bindDefs: {
            id: { type: this.oracledb.DB_TYPE_VARCHAR, maxSize: 36 },
            vector: { type: this.oracledb.DB_TYPE_VECTOR },
            payload: { type: this.oracledb.DB_TYPE_JSON }
          }
        }
      );
    }, true);
  }
  async search(query, topK = 5, filters) {
    await this.initialize();
    const [whereClause, filterBinds] = buildWhereClause(filters);
    const hasFilter = whereClause.length > 0;
    const selectClause = hasFilter ? "SELECT" : `SELECT /*+ VECTOR_INDEX_TRANSFORM(${this.collectionName}) */`;
    const sql = `${selectClause} id, payload, VECTOR_DISTANCE(vector, :query_vec, ${this.distanceMetric}) distance FROM ${this.collectionName} ${whereClause} ORDER BY distance FETCH APPROX FIRST :max_rows ROWS ONLY`;
    const rows = await this.withConnection(async (connection) => {
      var _a2;
      const result = await connection.execute(sql, {
        query_vec: this.vectorBind(query),
        max_rows: topK,
        ...filterBinds
      });
      return (_a2 = result.rows) != null ? _a2 : [];
    });
    return rows.map((row) => ({
      id: row[0],
      payload: this.loadPayload(row[1]),
      score: SCORE_FROM_DISTANCE[this.distanceMetric](Number(row[2]))
    }));
  }
  async get(vectorId) {
    await this.initialize();
    const rows = await this.withConnection(async (connection) => {
      var _a2;
      const result = await connection.execute(
        `SELECT id, payload FROM ${this.collectionName} WHERE id = :vector_id`,
        { vector_id: vectorId }
      );
      return (_a2 = result.rows) != null ? _a2 : [];
    });
    if (rows.length === 0) return null;
    return { id: rows[0][0], payload: this.loadPayload(rows[0][1]) };
  }
  async update(vectorId, vector, payload) {
    await this.initialize();
    const assignments = [];
    const binds = { vector_id: vectorId };
    if (vector) {
      assignments.push("vector = :vector");
      binds.vector = this.vectorBind(vector);
    }
    if (payload) {
      assignments.push("payload = :payload");
      binds.payload = this.payloadBind(payload);
    }
    if (assignments.length === 0) return;
    await this.withConnection(
      (connection) => connection.execute(
        `UPDATE ${this.collectionName} SET ${assignments.join(", ")} WHERE id = :vector_id`,
        binds
      ),
      true
    );
  }
  async delete(vectorId) {
    await this.initialize();
    await this.withConnection(
      (connection) => connection.execute(
        `DELETE FROM ${this.collectionName} WHERE id = :vector_id`,
        { vector_id: vectorId }
      ),
      true
    );
  }
  async deleteCol() {
    await this.initialize();
    await this.withConnection(
      (connection) => connection.execute(`DROP TABLE ${this.collectionName} PURGE`),
      true
    );
  }
  async list(filters, topK = 100) {
    await this.initialize();
    const [whereClause, filterBinds] = buildWhereClause(filters);
    return this.withConnection(async (connection) => {
      var _a2, _b2, _c;
      const listResult = await connection.execute(
        `SELECT id, payload, COUNT(*) OVER () total FROM ${this.collectionName} ${whereClause} FETCH FIRST :max_rows ROWS ONLY`,
        { ...filterBinds, max_rows: topK }
      );
      const rows = (_a2 = listResult.rows) != null ? _a2 : [];
      const results = rows.map((row) => ({
        id: row[0],
        payload: this.loadPayload(row[1])
      }));
      return [results, Number((_c = (_b2 = rows[0]) == null ? void 0 : _b2[2]) != null ? _c : 0)];
    });
  }
  async getUserId() {
    await this.initialize();
    const rows = await this.withConnection(async (connection) => {
      var _a2;
      const result = await connection.execute(
        "SELECT user_id FROM memory_migrations WHERE id = 1"
      );
      return (_a2 = result.rows) != null ? _a2 : [];
    });
    if (rows.length > 0) return rows[0][0];
    const generatedUserId = uuidv44();
    await this.setUserId(generatedUserId);
    return generatedUserId;
  }
  async setUserId(userId) {
    await this.initialize();
    await this.withConnection(async (connection) => {
      await connection.execute("DELETE FROM memory_migrations WHERE id = 1");
      await connection.execute(
        "INSERT INTO memory_migrations (id, user_id) VALUES (1, :user_id)",
        { user_id: userId }
      );
    }, true);
  }
  async close() {
    if (this.client && this.ownsClient) {
      await this.client.close();
    }
  }
};

// src/oss/src/utils/factory.ts
var EmbedderFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "openai":
        return new OpenAIEmbedder(config);
      case "aws_bedrock":
        return new AWSBedrockEmbedder(config);
      case "ollama":
        return new OllamaEmbedder(config);
      case "lmstudio":
        return new LMStudioEmbedder(config);
      case "together":
        return new TogetherEmbedder(config);
      case "google":
      case "gemini":
        return new GoogleEmbedder(config);
      case "azure_openai":
        return new AzureOpenAIEmbedder(config);
      case "fastembed":
        return new FastEmbedEmbedder(config);
      case "langchain":
        return new LangchainEmbedder(config);
      case "vertexai":
        return new VertexAIEmbedder(config);
      case "huggingface":
        return new HuggingFaceEmbedder(config);
      default:
        throw new Error(`Unsupported embedder provider: ${provider}`);
    }
  }
};
var LLMFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "openai":
        return new OpenAILLM(config);
      case "openai_structured":
        return new OpenAIStructuredLLM(config);
      case "anthropic":
        return new AnthropicLLM(config);
      case "groq":
        return new GroqLLM(config);
      case "ollama":
        return new OllamaLLM(config);
      case "lmstudio":
        return new LMStudioLLM(config);
      case "google":
      case "gemini":
        return new GoogleLLM(config);
      case "azure_openai":
        return new AzureOpenAILLM(config);
      case "mistral":
        return new MistralLLM(config);
      case "langchain":
        return new LangchainLLM(config);
      case "deepseek":
        return new DeepSeekLLM(config);
      case "xai":
        return new XAILLM(config);
      case "sarvam":
        return new SarvamLLM(config);
      case "aws_bedrock":
        return new AWSBedrockLLM(config);
      case "litellm":
        return new LiteLLM(config);
      case "minimax":
        return new MiniMaxLLM(config);
      case "together":
        return new TogetherLLM(config);
      case "vllm":
        return new VllmLLM(config);
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
};
var VectorStoreFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "memory":
        return new MemoryVectorStore(config);
      case "baidu":
        return new BaiduDB(config);
      case "qdrant":
        return new Qdrant(config);
      case "chroma":
        return new ChromaDB(config);
      case "redis":
        return new RedisDB(config);
      case "valkey":
        return new ValkeyDB(config);
      case "supabase":
        return new SupabaseDB(config);
      case "langchain":
        return new LangchainVectorStore(config);
      case "vectorize":
        return new VectorizeDB(config);
      case "azure-ai-search":
        return new AzureAISearch(config);
      case "vertex_ai_vector_search":
        return new VertexAIVectorSearch(config);
      case "pgvector":
        return new PGVector(config);
      case "databricks":
        return new DatabricksVectorStore(config);
      case "neptune":
      case "neptune-analytics":
        return new NeptuneAnalyticsVectorStore(config);
      case "elasticsearch":
        return new ElasticsearchDB(config);
      case "opensearch":
        return new OpenSearchDB(config);
      case "upstash_vector":
        return new UpstashVector(config);
      case "azure_mysql":
        return new AzureMySQLDB(config);
      case "cassandra":
        return new CassandraDB(config);
      case "pinecone":
        return new PineconeDB(config);
      case "s3-vectors":
      case "s3_vectors":
        return new S3Vectors(config);
      case "turbopuffer":
        return new TurbopufferDB(config);
      case "milvus":
        return new Milvus(config);
      case "mongodb":
        return new MongoDB(config);
      case "weaviate":
        return new WeaviateDB(config);
      case "oracledb":
        return new OracleAIVectorSearch(config);
      default:
        throw new Error(`Unsupported vector store provider: ${provider}`);
    }
  }
};
var RerankerFactory = class _RerankerFactory {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "cohere":
        return new CohereReranker(config);
      case "zero_entropy":
        return new ZeroEntropyReranker(config);
      case "sentence_transformer":
        return new CrossEncoderReranker(
          config,
          "Xenova/ms-marco-MiniLM-L-6-v2"
        );
      case "huggingface":
        return new CrossEncoderReranker(
          config,
          "Xenova/bge-reranker-base",
          512
        );
      case "llm_reranker": {
        const llm = _RerankerFactory.buildLLMRerankerLLM(config);
        return new LLMReranker(config, llm);
      }
      default:
        throw new Error(`Unsupported reranker provider: ${provider}`);
    }
  }
  static buildLLMRerankerLLM(config) {
    var _a2, _b2, _c, _d, _e, _f;
    const nested = config.llm;
    let llmProvider;
    let llmConfig;
    if (nested) {
      llmProvider = nested.provider || config.provider || "openai";
      llmConfig = { ...nested.config || {} };
      if (llmConfig.model === void 0) {
        llmConfig.model = (_a2 = config.model) != null ? _a2 : "gpt-5-mini";
      }
      if (llmConfig.temperature === void 0) {
        llmConfig.temperature = (_b2 = config.temperature) != null ? _b2 : 0;
      }
      if (llmConfig.maxTokens === void 0) {
        llmConfig.maxTokens = (_c = config.maxTokens) != null ? _c : 100;
      }
      if (config.apiKey && llmConfig.apiKey === void 0) {
        llmConfig.apiKey = config.apiKey;
      }
    } else {
      llmProvider = config.provider || "openai";
      llmConfig = {
        model: (_d = config.model) != null ? _d : "gpt-5-mini",
        temperature: (_e = config.temperature) != null ? _e : 0,
        maxTokens: (_f = config.maxTokens) != null ? _f : 100
      };
      if (config.apiKey) {
        llmConfig.apiKey = config.apiKey;
      }
    }
    return LLMFactory.create(llmProvider, llmConfig);
  }
};
var HistoryManagerFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "sqlite":
        return new SQLiteManager(config.config.historyDbPath || ":memory:");
      case "supabase":
        return new SupabaseHistoryManager({
          supabaseUrl: config.config.supabaseUrl || "",
          supabaseKey: config.config.supabaseKey || "",
          tableName: config.config.tableName || "memory_history"
        });
      case "memory":
        return new MemoryHistoryManager();
      default:
        throw new Error(`Unsupported history store provider: ${provider}`);
    }
  }
};

// src/oss/src/storage/DummyHistoryManager.ts
var DummyHistoryManager = class {
  constructor() {
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    return;
  }
  async getHistory(memoryId) {
    return [];
  }
  async reset() {
    return;
  }
  close() {
    return;
  }
};

// src/oss/src/config/defaults.ts
var DEFAULT_MEMORY_CONFIG = {
  disableHistory: false,
  version: "v1.1",
  embedder: {
    provider: "openai",
    config: {
      apiKey: process.env.OPENAI_API_KEY || "",
      model: "text-embedding-3-small"
    }
  },
  vectorStore: {
    provider: "memory",
    config: {
      collectionName: "memories",
      dimension: 1536
    }
  },
  llm: {
    provider: "openai",
    config: {
      baseURL: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY || "",
      model: "gpt-5-mini",
      modelProperties: void 0
    }
  },
  historyStore: {
    provider: "sqlite",
    config: {
      historyDbPath: "memory.db"
    }
  }
};

// src/oss/src/config/manager.ts
var ConfigManager = class {
  static mergeConfig(userConfig = {}) {
    var _a2, _b2, _c, _d, _e, _f, _g;
    const embedderProvider = ((_a2 = userConfig.embedder) == null ? void 0 : _a2.provider) || DEFAULT_MEMORY_CONFIG.embedder.provider;
    const embedderProviderKey = embedderProvider.toLowerCase();
    const mergedConfig = {
      version: userConfig.version || DEFAULT_MEMORY_CONFIG.version,
      embedder: {
        provider: embedderProvider,
        config: (() => {
          var _a3, _b3, _c2, _d2;
          const defaultConf = DEFAULT_MEMORY_CONFIG.embedder.config;
          const userConf = (_a3 = userConfig.embedder) == null ? void 0 : _a3.config;
          let finalModel = embedderProviderKey === "fastembed" ? void 0 : defaultConf.model;
          if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "object") {
            finalModel = userConf.model;
          } else if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "string") {
            finalModel = userConf.model;
          }
          const baseURL = (_c2 = (_b3 = userConf == null ? void 0 : userConf.baseURL) != null ? _b3 : userConf == null ? void 0 : userConf.lmstudio_base_url) != null ? _c2 : userConf == null ? void 0 : userConf.url;
          const embeddingDims = (_d2 = userConf == null ? void 0 : userConf.embeddingDims) != null ? _d2 : userConf == null ? void 0 : userConf.embedding_dims;
          return {
            // Spread first so provider-specific keys (e.g. the Vertex AI
            // project/location/credentials) survive the merge, while the
            // normalized values below still win.
            ...userConf,
            apiKey: (userConf == null ? void 0 : userConf.apiKey) !== void 0 ? userConf.apiKey : defaultConf.apiKey,
            model: finalModel,
            baseURL,
            url: userConf == null ? void 0 : userConf.url,
            embeddingDims,
            modelProperties: (userConf == null ? void 0 : userConf.modelProperties) !== void 0 ? userConf.modelProperties : defaultConf.modelProperties
          };
        })()
      },
      vectorStore: {
        // Every factory already matches the provider case-insensitively, so a capitalized
        // name constructs the right store -- but the `provider === "memory"` comparisons that
        // pick per-provider entity-store settings do not. Normalize once, here, so those
        // comparisons cannot silently miss.
        provider: (((_b2 = userConfig.vectorStore) == null ? void 0 : _b2.provider) || DEFAULT_MEMORY_CONFIG.vectorStore.provider).toLowerCase(),
        config: (() => {
          var _a3, _b3, _c2;
          const defaultConf = DEFAULT_MEMORY_CONFIG.vectorStore.config;
          const userConf = (_a3 = userConfig.vectorStore) == null ? void 0 : _a3.config;
          const explicitDimension = (userConf == null ? void 0 : userConf.dimension) || ((_c2 = (_b3 = userConfig.embedder) == null ? void 0 : _b3.config) == null ? void 0 : _c2.embeddingDims) || void 0;
          if ((userConf == null ? void 0 : userConf.client) && typeof userConf.client === "object") {
            return {
              client: userConf.client,
              collectionName: userConf.collectionName,
              dimension: explicitDimension,
              ...userConf
              // Include any other passthrough fields from user
            };
          } else {
            return {
              collectionName: (userConf == null ? void 0 : userConf.collectionName) || defaultConf.collectionName,
              dimension: explicitDimension,
              // Ensure client is not carried over from defaults if not provided by user
              client: void 0,
              // Include other passthrough fields from userConf even if no client
              ...userConf
            };
          }
        })()
      },
      llm: {
        provider: ((_c = userConfig.llm) == null ? void 0 : _c.provider) || DEFAULT_MEMORY_CONFIG.llm.provider,
        config: (() => {
          var _a3, _b3, _c2, _d2, _e2, _f2, _g2, _h, _i, _j, _k, _l, _m, _n;
          const defaultConf = DEFAULT_MEMORY_CONFIG.llm.config;
          const userConf = (_a3 = userConfig.llm) == null ? void 0 : _a3.config;
          const provider = ((_b3 = userConfig.llm) == null ? void 0 : _b3.provider) || DEFAULT_MEMORY_CONFIG.llm.provider;
          const usesOpenAIDefaults = provider.toLowerCase() === "openai" || provider.toLowerCase() === "openai_structured";
          let finalModel = usesOpenAIDefaults ? defaultConf.model : void 0;
          if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "object") {
            finalModel = userConf.model;
          } else if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "string") {
            finalModel = userConf.model;
          }
          const llmRaw = userConf;
          const llmBaseURL = (_g2 = (_f2 = (_e2 = (_d2 = (_c2 = userConf == null ? void 0 : userConf.baseURL) != null ? _c2 : userConf == null ? void 0 : userConf.vllmBaseURL) != null ? _d2 : llmRaw == null ? void 0 : llmRaw.vllm_base_url) != null ? _e2 : userConf == null ? void 0 : userConf.lmstudio_base_url) != null ? _f2 : userConf == null ? void 0 : userConf.url) != null ? _g2 : usesOpenAIDefaults ? defaultConf.baseURL : void 0;
          const temperature = (_h = userConf == null ? void 0 : userConf.temperature) != null ? _h : llmRaw == null ? void 0 : llmRaw.temperature;
          const topP = (_i = userConf == null ? void 0 : userConf.topP) != null ? _i : llmRaw == null ? void 0 : llmRaw.top_p;
          const maxTokens = (_j = userConf == null ? void 0 : userConf.maxTokens) != null ? _j : llmRaw == null ? void 0 : llmRaw.max_tokens;
          return {
            // Spread user-provided config first so any additional fields
            // (e.g. future aws_bedrock options) pass through without a
            // manager.ts edit, matching the vectorStore.config pattern above
            // and making the schema's .passthrough() on llm.config meaningful.
            ...userConf,
            baseURL: llmBaseURL,
            url: userConf == null ? void 0 : userConf.url,
            apiKey: (userConf == null ? void 0 : userConf.apiKey) !== void 0 ? userConf.apiKey : defaultConf.apiKey,
            model: finalModel,
            modelProperties: (userConf == null ? void 0 : userConf.modelProperties) !== void 0 ? userConf.modelProperties : defaultConf.modelProperties,
            temperature,
            topP,
            maxTokens,
            // Pass through AWS Bedrock fields so the aws_bedrock provider works
            // through the standard Memory config path (snake_case tolerated).
            awsRegion: (_k = userConf == null ? void 0 : userConf.awsRegion) != null ? _k : llmRaw == null ? void 0 : llmRaw.aws_region,
            awsAccessKeyId: (_l = userConf == null ? void 0 : userConf.awsAccessKeyId) != null ? _l : llmRaw == null ? void 0 : llmRaw.aws_access_key_id,
            awsSecretAccessKey: (_m = userConf == null ? void 0 : userConf.awsSecretAccessKey) != null ? _m : llmRaw == null ? void 0 : llmRaw.aws_secret_access_key,
            awsSessionToken: (_n = userConf == null ? void 0 : userConf.awsSessionToken) != null ? _n : llmRaw == null ? void 0 : llmRaw.aws_session_token,
            client: userConf == null ? void 0 : userConf.client
          };
        })()
      },
      historyDbPath: userConfig.historyDbPath || ((_e = (_d = userConfig.historyStore) == null ? void 0 : _d.config) == null ? void 0 : _e.historyDbPath) || ((_g = (_f = DEFAULT_MEMORY_CONFIG.historyStore) == null ? void 0 : _f.config) == null ? void 0 : _g.historyDbPath),
      customInstructions: userConfig.customInstructions,
      historyStore: (() => {
        var _a3, _b3;
        const defaultHistoryStore = DEFAULT_MEMORY_CONFIG.historyStore;
        const historyProvider = ((_a3 = userConfig.historyStore) == null ? void 0 : _a3.provider) || defaultHistoryStore.provider;
        const isSqlite = historyProvider.toLowerCase() === "sqlite";
        return {
          ...defaultHistoryStore,
          ...userConfig.historyStore,
          provider: historyProvider,
          config: {
            ...isSqlite ? defaultHistoryStore.config : {},
            ...isSqlite && userConfig.historyDbPath ? { historyDbPath: userConfig.historyDbPath } : {},
            ...(_b3 = userConfig.historyStore) == null ? void 0 : _b3.config
          }
        };
      })(),
      disableHistory: userConfig.disableHistory || DEFAULT_MEMORY_CONFIG.disableHistory,
      reranker: userConfig.reranker
    };
    return MemoryConfigSchema.parse(mergedConfig);
  }
};

// src/oss/src/utils/memory.ts
var get_image_description = async (image_url) => {
  const llm = new OpenAILLM({
    apiKey: process.env.OPENAI_API_KEY
  });
  const response = await llm.generateResponse([
    {
      role: "user",
      content: "Provide a description of the image and do not include any additional text."
    },
    {
      role: "user",
      content: { type: "image_url", image_url: { url: image_url } }
    }
  ]);
  return response;
};
var parse_vision_messages = async (messages) => {
  var _a2;
  const parsed_messages = [];
  for (const message of messages) {
    let new_message = {
      role: message.role,
      content: ""
    };
    if (message.role !== "system") {
      if (typeof message.content === "object" && message.content.type === "image_url") {
        const imageUrl = (_a2 = message.content.image_url) == null ? void 0 : _a2.url;
        if (!imageUrl) {
          throw new Error("image_url content part is missing image_url.url");
        }
        const description = await get_image_description(imageUrl);
        new_message.content = typeof description === "string" ? description : JSON.stringify(description);
        parsed_messages.push(new_message);
      } else parsed_messages.push(message);
    }
  }
  return parsed_messages;
};

// src/oss/src/utils/telemetry.ts
var version = true ? "3.3.1" : "dev";
var MEM0_TELEMETRY = false;
var _a, _b;
try {
  MEM0_TELEMETRY = false;
} catch (error) {
}
var POSTHOG_API_KEY = "phc_hgJkUVJFYtmaJqrvf6CYN67TIQ8yhXAkWzUn9AMU4yX";
var POSTHOG_HOST = "https://us.i.posthog.com/i/v0/e/";
var NOTICE_EVENT_NAME = "mem0.notice_displayed";
var DEFAULT_SAMPLE_RATE = 0.1;
var MEM0_TELEMETRY_SAMPLE_RATE = (() => {
  var _a2;
  try {
    const raw = (_a2 = process == null ? void 0 : process.env) == null ? void 0 : _a2.MEM0_TELEMETRY_SAMPLE_RATE;
    if (raw !== void 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch (e) {
  }
  return DEFAULT_SAMPLE_RATE;
})();
var ALWAYS_SEND_EVENTS = /* @__PURE__ */ new Set([
  "init",
  "reset",
  "notice_displayed"
]);
var UnifiedTelemetry = class {
  constructor(projectApiKey, host) {
    this.apiKey = projectApiKey;
    this.host = host;
  }
  async captureEvent(distinctId, eventName, properties = {}) {
    if (!MEM0_TELEMETRY) return;
    const eventProperties = {
      client_version: version,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...properties,
      $process_person_profile: distinctId === "anonymous" || distinctId === "anonymous-supabase" ? false : true,
      $lib: "posthog-node"
    };
    const payload = {
      api_key: this.apiKey,
      distinct_id: distinctId,
      event: eventName,
      properties: eventProperties
    };
    try {
      const response = await fetch(this.host, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error("Telemetry event capture failed:", await response.text());
      }
    } catch (error) {
      console.error("Telemetry event capture failed:", error);
    }
  }
  async shutdown() {
  }
};
var telemetry = new UnifiedTelemetry(POSTHOG_API_KEY, POSTHOG_HOST);
function isTelemetryEnabled() {
  return MEM0_TELEMETRY;
}
async function captureClientEvent(eventName, instance, additionalData = {}) {
  if (!instance.telemetryId) {
    console.warn("No telemetry ID found for instance");
    return;
  }
  const alwaysSend = ALWAYS_SEND_EVENTS.has(eventName);
  if (!alwaysSend && Math.random() >= MEM0_TELEMETRY_SAMPLE_RATE) {
    return;
  }
  const eventData = {
    function: `${instance.constructor.name}`,
    method: eventName,
    api_host: instance.host,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    client_version: version,
    client_source: "nodejs",
    ...additionalData,
    // sample_rate set AFTER the spread so callers can never override it
    sample_rate: alwaysSend ? 1 : MEM0_TELEMETRY_SAMPLE_RATE
  };
  await telemetry.captureEvent(
    instance.telemetryId,
    `mem0.${eventName}`,
    eventData
  );
}
async function captureNoticeEvent(instance, properties = {}) {
  if (!instance.telemetryId) return;
  const eventData = {
    function: `${instance.constructor.name}`,
    method: "notice_displayed",
    api_host: instance.host,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    client_version: version,
    client_source: "nodejs",
    ...properties,
    sample_rate: 1
  };
  await telemetry.captureEvent(
    instance.telemetryId,
    NOTICE_EVENT_NAME,
    eventData
  );
}

// src/oss/src/utils/notices.ts
import * as crypto from "crypto";
import * as fs4 from "fs";
import * as os2 from "os";
import * as path3 from "path";

// src/oss/src/utils/oss_notices_config.json
var oss_notices_config_default = {
  version: 1,
  variant_split: 0.5,
  notices: {
    first_run: {
      copy: "",
      enabled: false,
      notice_type: "log_line"
    },
    temporal_stub: {
      copy: "",
      enabled: false,
      notice_type: "error"
    },
    temporal_usage: {
      copy: "",
      enabled: false,
      notice_type: "log_line"
    },
    decay_stub: {
      copy: "",
      enabled: false,
      notice_type: "error"
    },
    decay_usage: {
      copy: "",
      enabled: false,
      notice_type: "log_line"
    },
    scale_threshold: {
      copies: {
        memory_count: "",
        top_k: ""
      },
      enabled: false,
      notice_type: "log_line"
    },
    performance_slow_query: {
      copy: "",
      enabled: false,
      notice_type: "log_line"
    }
  }
};

// src/oss/src/utils/notices.ts
var NOTICE_FLAG_KEY = "mem0-oss-notices";
var NOTICE_STATE_SECTION = "notice_state";
var FIRST_RUN_NOTICE_ID = "first_run";
var TEMPORAL_FEATURE_NOTICE_ID = "temporal_stub";
var TEMPORAL_USAGE_NOTICE_ID = "temporal_usage";
var DECAY_FEATURE_NOTICE_ID = "decay_stub";
var DECAY_USAGE_NOTICE_ID = "decay_usage";
var SCALE_THRESHOLD_NOTICE_ID = "scale_threshold";
var PERFORMANCE_SLOW_QUERY_NOTICE_ID = "performance_slow_query";
var NOTICE_CAP_LIMIT = 10;
var NOTICE_CAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
var NOTICE_FLAG_TIMEOUT_MS = 500;
var REMOTE_CONFIG_URL = "https://raw.githubusercontent.com/mem0ai/mem0/main/mem0/memory/oss_notices_config.json";
var CONFIG_TTL_MS = 36e5;
var _cachedConfig = null;
var _cachedConfigTs = 0;
var _configFetch = null;
async function fetchNoticeConfig(fetchImpl, timeoutMs) {
  const now = Date.now();
  if (_cachedConfig && now - _cachedConfigTs < CONFIG_TTL_MS) {
    return _cachedConfig;
  }
  if (_configFetch) return _configFetch;
  _configFetch = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetchImpl(REMOTE_CONFIG_URL, {
          signal: controller.signal
        });
        if (resp.ok) {
          _cachedConfig = await resp.json();
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
    }
    _cachedConfig != null ? _cachedConfig : _cachedConfig = oss_notices_config_default;
    _cachedConfigTs = Date.now();
    return _cachedConfig;
  })();
  try {
    return await _configFetch;
  } finally {
    _configFetch = null;
  }
}
var DISPLAYED_VARIANT = "displayed";
var HOLDOUT_VARIANT = "holdout";
var LOG_LINE_NOTICE_TYPE = "log_line";
var ERROR_NOTICE_TYPE = "error";
var TEMPORAL_TIMESTAMP_PLAIN_ERROR = "The timestamp parameter is not supported by the OSS Memory SDK.";
var TEMPORAL_REFERENCE_DATE_PLAIN_ERROR = "The referenceDate parameter is not supported by the OSS Memory SDK.";
var DECAY_FEATURE_PLAIN_ERROR = "The decay parameter is not supported by the OSS Memory SDK.";
var DECAY_USAGE_DELETE_THRESHOLD = 5;
var SCALE_MEMORY_COUNT_THRESHOLD = 2e3;
var SCALE_MEMORY_COUNT_CHECK_INTERVAL = 100;
var SCALE_TOP_K_THRESHOLD = 50;
var PERFORMANCE_SLOW_QUERY_THRESHOLD_MS = 2e3;
var MAX_TEMPORAL_DETECTION_DEPTH = 32;
var ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/;
var RELATIVE_TIME_RE = /\b(today|yesterday|tomorrow|last\s+(?:night|week|month|year)|this\s+(?:week|month|year)|next\s+(?:week|month|year)|(?:past|last)\s+\d+\s+(?:day|days|week|weeks|month|months|year|years)|(?:since|before|after|until)\s+(?:today|yesterday|tomorrow|\d{4}-\d{2}-\d{2}|last\s+(?:week|month|year)))\b/i;
var RANGE_OPERATORS = /* @__PURE__ */ new Set(["gt", "gte", "lt", "lte"]);
var firstRunConsumedInProcess = false;
var firstRunClaimInProgress = false;
var decayUsageSuccessfulDeleteCount = 0;
var noticeCapacityReachedInProcess = /* @__PURE__ */ new Set();
var scaleMemoryCountAddsSinceCheck = 0;
var scaleMemoryCountCheckedInProcess = false;
var scaleMemoryCountThresholdEvaluatedInProcess = false;
function getMem0Dir() {
  return process.env.MEM0_DIR || path3.join(os2.homedir(), ".mem0");
}
function getMem0ConfigPath() {
  return path3.join(getMem0Dir(), "config.json");
}
function loadMem0Config() {
  try {
    const configPath = getMem0ConfigPath();
    if (!fs4.existsSync(configPath)) return {};
    const parsed = JSON.parse(fs4.readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}
function writeMem0ConfigAtomic(config) {
  const configPath = getMem0ConfigPath();
  const dir = path3.dirname(configPath);
  const tempPath = path3.join(
    dir,
    `.config.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    fs4.mkdirSync(dir, { recursive: true });
    fs4.writeFileSync(tempPath, JSON.stringify(config, null, 4));
    fs4.renameSync(tempPath, configPath);
    return true;
  } catch (e) {
    try {
      if (fs4.existsSync(tempPath)) fs4.unlinkSync(tempPath);
    } catch (e2) {
    }
    return false;
  }
}
function getNoticeState(config, noticeId) {
  const stateSection = config[NOTICE_STATE_SECTION] && typeof config[NOTICE_STATE_SECTION] === "object" && !Array.isArray(config[NOTICE_STATE_SECTION]) ? config[NOTICE_STATE_SECTION] : {};
  const noticeState = stateSection[noticeId];
  return noticeState && typeof noticeState === "object" && !Array.isArray(noticeState) ? noticeState : {};
}
function setNoticeState(config, noticeId, state) {
  const stateSection = config[NOTICE_STATE_SECTION] && typeof config[NOTICE_STATE_SECTION] === "object" && !Array.isArray(config[NOTICE_STATE_SECTION]) ? { ...config[NOTICE_STATE_SECTION] } : {};
  return {
    ...config,
    [NOTICE_STATE_SECTION]: {
      ...stateSection,
      [noticeId]: state
    }
  };
}
function parsePayload(payload) {
  try {
    if (typeof payload === "string") {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
    }
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : void 0;
  } catch (e) {
    return void 0;
  }
}
function getNoticeConfigFromPayload(payload, noticeId) {
  const parsedPayload = parsePayload(payload);
  const notices = parsedPayload == null ? void 0 : parsedPayload.notices;
  if (!notices || typeof notices !== "object" || Array.isArray(notices)) {
    return { found: false, payload: parsedPayload };
  }
  const noticeConfig = notices[noticeId];
  if (!noticeConfig || typeof noticeConfig !== "object" || Array.isArray(noticeConfig)) {
    return { found: false, payload: parsedPayload };
  }
  return {
    found: true,
    config: noticeConfig,
    payload: parsedPayload
  };
}
async function evaluateNoticeFlag(distinctId, options = {}) {
  var _a2, _b2, _c;
  if (!isTelemetryEnabled()) return null;
  const timeoutMs = (_a2 = options.timeoutMs) != null ? _a2 : NOTICE_FLAG_TIMEOUT_MS;
  const fetchImpl = (_b2 = options.fetchImpl) != null ? _b2 : fetch;
  try {
    const config = await fetchNoticeConfig(fetchImpl, timeoutMs);
    const split = typeof config.variant_split === "number" ? config.variant_split : 0.5;
    const hashKey = `${NOTICE_FLAG_KEY}.${distinctId}variant`;
    const hash = crypto.createHash("sha1").update(hashKey).digest("hex");
    const bucket = parseInt(hash.substring(0, 15), 16) / 1152921504606847e3;
    const variant = bucket < split ? DISPLAYED_VARIANT : HOLDOUT_VARIANT;
    return {
      variant,
      payload: { notices: (_c = config.notices) != null ? _c : {} },
      flag: { key: NOTICE_FLAG_KEY, enabled: true, variant }
    };
  } catch (e) {
    return null;
  }
}
function eventsInWindow(events, now, windowMs) {
  if (!Array.isArray(events)) return [];
  const cutoff = now.getTime() - windowMs;
  return events.filter((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return false;
    }
    const evaluatedAt = event.evaluated_at;
    if (typeof evaluatedAt !== "string") return false;
    const timestamp = Date.parse(evaluatedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}
function hasNoticeCapRoom(state, options = {}) {
  var _a2, _b2, _c;
  const now = (_a2 = options.now) != null ? _a2 : /* @__PURE__ */ new Date();
  const limit = (_b2 = options.limit) != null ? _b2 : NOTICE_CAP_LIMIT;
  const windowMs = (_c = options.windowMs) != null ? _c : NOTICE_CAP_WINDOW_MS;
  return eventsInWindow(state.events, now, windowMs).length < limit;
}
function isNoticeCapacityReachedInProcess(noticeId) {
  return noticeCapacityReachedInProcess.has(noticeId);
}
function markNoticeCapacityReachedInProcess(noticeId) {
  noticeCapacityReachedInProcess.add(noticeId);
}
function hasNoticeCapRoomForNotice(noticeId, state, options = {}) {
  const hasRoom = hasNoticeCapRoom(state, options);
  if (!hasRoom) markNoticeCapacityReachedInProcess(noticeId);
  return hasRoom;
}
function appendNoticeCapEvent(state, event, options = {}) {
  var _a2, _b2, _c;
  const now = (_a2 = options.now) != null ? _a2 : /* @__PURE__ */ new Date();
  const limit = (_b2 = options.limit) != null ? _b2 : NOTICE_CAP_LIMIT;
  const windowMs = (_c = options.windowMs) != null ? _c : NOTICE_CAP_WINDOW_MS;
  const events = eventsInWindow(state.events, now, windowMs);
  if (events.length >= limit) return null;
  return {
    ...state,
    events: [
      ...events,
      {
        evaluated_at: now.toISOString(),
        ...event
      }
    ]
  };
}
function recordNoticeOpportunity(noticeId, event, options = {}) {
  if (!isTelemetryEnabled()) return false;
  if (isNoticeCapacityReachedInProcess(noticeId)) return false;
  const config = loadMem0Config();
  const state = getNoticeState(config, noticeId);
  const nextState = appendNoticeCapEvent(state, event, options);
  if (!nextState) {
    markNoticeCapacityReachedInProcess(noticeId);
    return false;
  }
  const written = writeMem0ConfigAtomic(
    setNoticeState(config, noticeId, nextState)
  );
  if (written && !hasNoticeCapRoom(nextState, options)) {
    markNoticeCapacityReachedInProcess(noticeId);
  }
  return written;
}
function isFirstRunConsumed(config) {
  return getNoticeState(config, FIRST_RUN_NOTICE_ID).consumed === true;
}
function markFirstRunConsumed(triggerFunction, variant) {
  const config = loadMem0Config();
  const state = getNoticeState(config, FIRST_RUN_NOTICE_ID);
  const nextState = {
    ...state,
    consumed: true,
    consumed_at: (/* @__PURE__ */ new Date()).toISOString(),
    trigger_function: triggerFunction,
    variant
  };
  return writeMem0ConfigAtomic(
    setNoticeState(config, FIRST_RUN_NOTICE_ID, nextState)
  );
}
function getDisplayDecision(noticeId, expectedNoticeType, variant, payload) {
  var _a2;
  const parsed = getNoticeConfigFromPayload(payload, noticeId);
  const copy = typeof ((_a2 = parsed.config) == null ? void 0 : _a2.copy) === "string" ? parsed.config.copy : void 0;
  if (!parsed.found || !parsed.config) {
    return {
      displayed: false,
      noticeConfigFound: false,
      bypassReason: "missing_notice_config"
    };
  }
  const noticeConfig = parsed.config;
  if (noticeConfig.enabled === false) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "payload_disabled",
      disabledReason: "payload_disabled"
    };
  }
  if (noticeConfig.notice_type !== expectedNoticeType) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "invalid_notice_type"
    };
  }
  if (!copy || copy.trim() === "") {
    return {
      displayed: false,
      noticeConfigFound: true,
      bypassReason: "missing_copy"
    };
  }
  if (variant !== DISPLAYED_VARIANT) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "holdout"
    };
  }
  return {
    displayed: true,
    noticeConfigFound: true,
    copy
  };
}
function renderScaleCopy(template, trigger) {
  var _a2, _b2, _c;
  if (typeof template !== "string" || template.trim() === "") return void 0;
  return template.replace(/\{top_k\}/g, String((_a2 = trigger.topK) != null ? _a2 : "")).replace(/\{topK\}/g, String((_b2 = trigger.topK) != null ? _b2 : "")).replace(/\{memory_count\}/g, String((_c = trigger.memoryCount) != null ? _c : ""));
}
function getScaleDisplayDecision(variant, payload, trigger) {
  var _a2;
  const parsed = getNoticeConfigFromPayload(payload, SCALE_THRESHOLD_NOTICE_ID);
  const copies = ((_a2 = parsed.config) == null ? void 0 : _a2.copies) && typeof parsed.config.copies === "object" && !Array.isArray(parsed.config.copies) ? parsed.config.copies : {};
  const copyKey = trigger.triggerSource === "memory_count" ? "memory_count" : "top_k";
  const copy = renderScaleCopy(copies[copyKey], trigger);
  if (!parsed.found || !parsed.config) {
    return {
      displayed: false,
      noticeConfigFound: false,
      bypassReason: "missing_notice_config"
    };
  }
  const noticeConfig = parsed.config;
  if (noticeConfig.enabled === false) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "payload_disabled",
      disabledReason: "payload_disabled"
    };
  }
  if (noticeConfig.notice_type !== LOG_LINE_NOTICE_TYPE) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "invalid_notice_type"
    };
  }
  if (!copy || copy.trim() === "") {
    return {
      displayed: false,
      noticeConfigFound: true,
      bypassReason: "missing_copy"
    };
  }
  if (variant !== DISPLAYED_VARIANT) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "holdout"
    };
  }
  return {
    displayed: true,
    noticeConfigFound: true,
    copy
  };
}
function getFeatureErrorDecision(noticeId, expectedNoticeType, variant, payload) {
  var _a2;
  const parsed = getNoticeConfigFromPayload(payload, noticeId);
  const copy = typeof ((_a2 = parsed.config) == null ? void 0 : _a2.copy) === "string" ? parsed.config.copy : void 0;
  if (!parsed.found || !parsed.config) {
    return {
      displayed: false,
      noticeConfigFound: false,
      bypassReason: "missing_notice_config"
    };
  }
  const noticeConfig = parsed.config;
  if (noticeConfig.enabled === false) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "payload_disabled",
      disabledReason: "payload_disabled"
    };
  }
  if (noticeConfig.notice_type !== expectedNoticeType) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "invalid_notice_type"
    };
  }
  if (!copy || copy.trim() === "") {
    return {
      displayed: false,
      noticeConfigFound: true,
      bypassReason: "missing_copy"
    };
  }
  if (variant !== DISPLAYED_VARIANT && variant !== HOLDOUT_VARIANT) {
    return {
      displayed: false,
      noticeConfigFound: true,
      copy,
      bypassReason: "not_displayed"
    };
  }
  return {
    displayed: true,
    noticeConfigFound: true,
    copy
  };
}
async function getDecayFeatureErrorMessage(instance) {
  if (!isTelemetryEnabled()) return DECAY_FEATURE_PLAIN_ERROR;
  try {
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) return DECAY_FEATURE_PLAIN_ERROR;
    const decision = getFeatureErrorDecision(
      DECAY_FEATURE_NOTICE_ID,
      ERROR_NOTICE_TYPE,
      flagEvaluation.variant,
      flagEvaluation.payload
    );
    await emitNoticeDisplayed(instance, {
      notice_id: DECAY_FEATURE_NOTICE_ID,
      notice_type: ERROR_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: "update_project",
      trigger_parameter: "decay"
    });
    if (decision.displayed && decision.copy) {
      return decision.copy;
    }
  } catch (e) {
  }
  return DECAY_FEATURE_PLAIN_ERROR;
}
async function getTemporalFeatureErrorMessage(instance, trigger) {
  const plainError = trigger.triggerParameter === "timestamp" ? TEMPORAL_TIMESTAMP_PLAIN_ERROR : TEMPORAL_REFERENCE_DATE_PLAIN_ERROR;
  if (!isTelemetryEnabled()) return plainError;
  try {
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) return plainError;
    const decision = getFeatureErrorDecision(
      TEMPORAL_FEATURE_NOTICE_ID,
      ERROR_NOTICE_TYPE,
      flagEvaluation.variant,
      flagEvaluation.payload
    );
    await emitNoticeDisplayed(instance, {
      notice_id: TEMPORAL_FEATURE_NOTICE_ID,
      notice_type: ERROR_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_parameter: trigger.triggerParameter
    });
    if (decision.displayed && decision.copy) {
      return decision.copy;
    }
  } catch (e) {
  }
  return plainError;
}
function getDecayUsageDeleteCountAfterSuccess() {
  if (!isTelemetryEnabled()) return 0;
  decayUsageSuccessfulDeleteCount += 1;
  return decayUsageSuccessfulDeleteCount;
}
function isDecayUsageDeleteEligible(deleteCount) {
  return deleteCount >= DECAY_USAGE_DELETE_THRESHOLD;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
function isTemporalKey(key) {
  const keyText = String(key).toLowerCase();
  return [
    "date",
    "time",
    "timestamp",
    "datetime",
    "event_date",
    "reference_date",
    "referencedate",
    "created_at",
    "createdat",
    "updated_at",
    "updatedat",
    "started_at",
    "startedat",
    "ended_at",
    "endedat",
    "expires_at",
    "expiresat"
  ].includes(keyText) || keyText.endsWith("_date") || keyText.endsWith("_time") || keyText.endsWith("_at") || keyText.includes("timestamp");
}
function looksTemporalValue(value, allowEpoch) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "string") {
    return ISO_DATE_RE.test(value) || RELATIVE_TIME_RE.test(value);
  }
  if (allowEpoch && typeof value === "number" && Number.isFinite(value)) {
    return value >= 946684800 && value <= 4102444800 || value >= 9466848e5 && value <= 41024448e5;
  }
  return false;
}
function detectTemporalUsageFromMetadata(metadata) {
  try {
    if (!isRecord(metadata)) return null;
    const visited = /* @__PURE__ */ new WeakSet();
    const stack = [{ value: metadata, depth: 0 }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current.depth > MAX_TEMPORAL_DETECTION_DEPTH) continue;
      if (Array.isArray(current.value)) {
        for (const child of current.value) {
          if (looksTemporalValue(child, false)) {
            return {
              triggerSource: "metadata",
              triggerReason: "date_like_metadata"
            };
          }
          stack.push({
            value: child,
            parentKey: current.parentKey,
            depth: current.depth + 1
          });
        }
        continue;
      }
      if (!isRecord(current.value)) continue;
      if (visited.has(current.value)) continue;
      visited.add(current.value);
      for (const [key, value] of Object.entries(current.value)) {
        const temporalKey = isTemporalKey(key);
        if (temporalKey && looksTemporalValue(value, true) || looksTemporalValue(value, false)) {
          return {
            triggerSource: "metadata",
            triggerReason: "date_like_metadata"
          };
        }
        if (isRecord(value) || Array.isArray(value)) {
          stack.push({ value, parentKey: key, depth: current.depth + 1 });
        }
      }
    }
  } catch (e) {
  }
  return null;
}
function hasTemporalFilter(filters) {
  try {
    if (!isRecord(filters)) return false;
    const visited = /* @__PURE__ */ new WeakSet();
    const stack = [
      { value: filters, depth: 0 }
    ];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current.depth > MAX_TEMPORAL_DETECTION_DEPTH) continue;
      if (Array.isArray(current.value)) {
        for (const child of current.value) {
          stack.push({ value: child, depth: current.depth + 1 });
        }
        continue;
      }
      if (!isRecord(current.value)) continue;
      if (visited.has(current.value)) continue;
      visited.add(current.value);
      for (const [key, value] of Object.entries(current.value)) {
        if (["AND", "OR", "NOT", "$and", "$or", "$not"].includes(key)) {
          if (isRecord(value) || Array.isArray(value)) {
            stack.push({ value, depth: current.depth + 1 });
          }
          continue;
        }
        const temporalKey = isTemporalKey(key);
        if (isRecord(value)) {
          const rangeValues = Object.entries(value).filter(([operator]) => RANGE_OPERATORS.has(operator)).map(([, rangeValue]) => rangeValue);
          if (rangeValues.length > 0 && (temporalKey || rangeValues.some(
            (rangeValue) => looksTemporalValue(rangeValue, temporalKey)
          ))) {
            return true;
          }
          stack.push({ value, depth: current.depth + 1 });
        } else if (temporalKey && looksTemporalValue(value, true)) {
          return true;
        }
      }
    }
  } catch (e) {
  }
  return false;
}
function detectTemporalUsageFromSearch(query, filters) {
  try {
    if (typeof query === "string") {
      if (RELATIVE_TIME_RE.test(query)) {
        return { triggerSource: "query", triggerReason: "relative_phrase" };
      }
      if (ISO_DATE_RE.test(query)) {
        return { triggerSource: "query", triggerReason: "date_like_query" };
      }
    }
    if (hasTemporalFilter(filters)) {
      return { triggerSource: "filter", triggerReason: "date_range_filter" };
    }
  } catch (e) {
  }
  return null;
}
function coerceNonnegativeInteger(value) {
  if (typeof value === "boolean") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
function countAddedMemories(addResult) {
  const results = isRecord(addResult) && Array.isArray(addResult.results) ? addResult.results : addResult;
  if (!Array.isArray(results)) return 0;
  return results.filter((item) => {
    if (!isRecord(item)) return false;
    const metadata = item.metadata;
    return isRecord(metadata) && metadata.event === "ADD";
  }).length;
}
function extractProviderCount(info) {
  if (!info) return null;
  if (typeof info === "number") return coerceNonnegativeInteger(info);
  if (isRecord(info)) {
    for (const key of [
      "count",
      "points_count",
      "vectors_count",
      "indexed_vectors_count"
    ]) {
      const value = coerceNonnegativeInteger(info[key]);
      if (value !== null) return value;
    }
    const result = extractProviderCount(info.result);
    if (result !== null) return result;
  }
  return null;
}
async function getProviderMemoryCount(memoryInstance) {
  try {
    const vectorStore = memoryInstance == null ? void 0 : memoryInstance.vectorStore;
    if (!vectorStore) return null;
    if (typeof vectorStore.count === "function") {
      const value = extractProviderCount(await vectorStore.count());
      if (value !== null) return value;
    }
    const collectionName = vectorStore.collectionName;
    const client = vectorStore.client;
    if (client && collectionName && typeof client.count === "function") {
      const value = extractProviderCount(
        await client.count(collectionName, { exact: true })
      );
      if (value !== null) return value;
    }
    if (client && collectionName && typeof client.getCollection === "function") {
      const value = extractProviderCount(
        await client.getCollection(collectionName)
      );
      if (value !== null) return value;
    }
  } catch (e) {
  }
  return null;
}
function markScaleMemoryCountThresholdEvaluated() {
  try {
    const config = loadMem0Config();
    const state = getNoticeState(config, SCALE_THRESHOLD_NOTICE_ID);
    if (state.memory_count_threshold_evaluated === true) {
      scaleMemoryCountThresholdEvaluatedInProcess = true;
      return false;
    }
    const nextState = {
      ...state,
      memory_count_threshold_evaluated: true
    };
    const written = writeMem0ConfigAtomic(
      setNoticeState(config, SCALE_THRESHOLD_NOTICE_ID, nextState)
    );
    if (written) scaleMemoryCountThresholdEvaluatedInProcess = true;
    return written;
  } catch (e) {
    return false;
  }
}
function detectScaleThresholdFromTopK(topK) {
  const topKValue = coerceNonnegativeInteger(topK);
  if (topKValue === null || topKValue < SCALE_TOP_K_THRESHOLD) return null;
  return {
    triggerSource: "top_k",
    triggerReason: "high_top_k",
    topK: topKValue,
    threshold: SCALE_TOP_K_THRESHOLD
  };
}
async function detectScaleThresholdFromAddResult(memoryInstance, addResult) {
  if (!isTelemetryEnabled()) return null;
  const addedCount = countAddedMemories(addResult);
  if (addedCount === 0) return null;
  try {
    if (scaleMemoryCountThresholdEvaluatedInProcess) return null;
    scaleMemoryCountAddsSinceCheck += addedCount;
    const shouldCheck = !scaleMemoryCountCheckedInProcess || scaleMemoryCountAddsSinceCheck >= SCALE_MEMORY_COUNT_CHECK_INTERVAL;
    if (!shouldCheck) return null;
    scaleMemoryCountCheckedInProcess = true;
    scaleMemoryCountAddsSinceCheck = 0;
    const config = loadMem0Config();
    const state = getNoticeState(config, SCALE_THRESHOLD_NOTICE_ID);
    if (state.memory_count_threshold_evaluated === true) {
      scaleMemoryCountThresholdEvaluatedInProcess = true;
      return null;
    }
    if (!hasNoticeCapRoom(state)) return null;
  } catch (e) {
    return null;
  }
  const providerCount = await getProviderMemoryCount(memoryInstance);
  if (providerCount === null || providerCount < SCALE_MEMORY_COUNT_THRESHOLD) {
    return null;
  }
  if (!markScaleMemoryCountThresholdEvaluated()) return null;
  return {
    triggerSource: "memory_count",
    triggerReason: "memory_count_threshold",
    memoryCount: providerCount,
    threshold: SCALE_MEMORY_COUNT_THRESHOLD
  };
}
function detectPerformanceSlowQuery(elapsedMs, topK, resultCount) {
  const elapsedMsValue = coerceNonnegativeInteger(
    Math.round(Number(elapsedMs))
  );
  const topKValue = coerceNonnegativeInteger(topK);
  const resultCountValue = coerceNonnegativeInteger(resultCount);
  if (elapsedMsValue === null || topKValue === null || resultCountValue === null || elapsedMsValue <= PERFORMANCE_SLOW_QUERY_THRESHOLD_MS) {
    return null;
  }
  return {
    elapsedMs: elapsedMsValue,
    thresholdMs: PERFORMANCE_SLOW_QUERY_THRESHOLD_MS,
    topK: topKValue,
    resultCount: resultCountValue
  };
}
async function displayScaleThresholdNotice(instance, trigger) {
  if (!isTelemetryEnabled()) return;
  if (isNoticeCapacityReachedInProcess(SCALE_THRESHOLD_NOTICE_ID)) return;
  try {
    const config = loadMem0Config();
    const state = getNoticeState(config, SCALE_THRESHOLD_NOTICE_ID);
    if (!hasNoticeCapRoomForNotice(SCALE_THRESHOLD_NOTICE_ID, state)) return;
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) return;
    const decision = getScaleDisplayDecision(
      flagEvaluation.variant,
      flagEvaluation.payload,
      trigger
    );
    const opportunity = {
      variant: flagEvaluation.variant,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_source: trigger.triggerSource,
      trigger_reason: trigger.triggerReason,
      ...trigger.topK !== void 0 && { top_k: trigger.topK },
      ...trigger.memoryCount !== void 0 && {
        memory_count: trigger.memoryCount
      },
      threshold: trigger.threshold
    };
    if (!recordNoticeOpportunity(SCALE_THRESHOLD_NOTICE_ID, opportunity)) {
      return;
    }
    await emitNoticeDisplayed(instance, {
      notice_id: SCALE_THRESHOLD_NOTICE_ID,
      notice_type: LOG_LINE_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_source: trigger.triggerSource,
      trigger_reason: trigger.triggerReason,
      top_k: trigger.topK,
      memory_count: trigger.memoryCount,
      threshold: trigger.threshold
    });
    if (decision.displayed && decision.copy) {
      process.stderr.write(`${decision.copy}
`);
    }
  } catch (e) {
  }
}
async function displayPerformanceSlowQueryNotice(instance, trigger) {
  if (!isTelemetryEnabled()) return;
  if (isNoticeCapacityReachedInProcess(PERFORMANCE_SLOW_QUERY_NOTICE_ID)) {
    return;
  }
  try {
    const config = loadMem0Config();
    const state = getNoticeState(config, PERFORMANCE_SLOW_QUERY_NOTICE_ID);
    if (!hasNoticeCapRoomForNotice(PERFORMANCE_SLOW_QUERY_NOTICE_ID, state)) {
      return;
    }
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) return;
    const decision = getDisplayDecision(
      PERFORMANCE_SLOW_QUERY_NOTICE_ID,
      LOG_LINE_NOTICE_TYPE,
      flagEvaluation.variant,
      flagEvaluation.payload
    );
    const opportunity = {
      variant: flagEvaluation.variant,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_reason: trigger.triggerReason
    };
    if (!recordNoticeOpportunity(PERFORMANCE_SLOW_QUERY_NOTICE_ID, opportunity)) {
      return;
    }
    await emitNoticeDisplayed(instance, {
      notice_id: PERFORMANCE_SLOW_QUERY_NOTICE_ID,
      notice_type: LOG_LINE_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_reason: trigger.triggerReason,
      elapsed_ms: trigger.elapsedMs,
      threshold_ms: trigger.thresholdMs,
      top_k: trigger.topK,
      result_count: trigger.resultCount
    });
    if (decision.displayed && decision.copy) {
      process.stderr.write(`${decision.copy}
`);
    }
  } catch (e) {
  }
}
async function displayTemporalUsageNotice(instance, trigger) {
  if (!isTelemetryEnabled()) return;
  if (isNoticeCapacityReachedInProcess(TEMPORAL_USAGE_NOTICE_ID)) return;
  try {
    const config = loadMem0Config();
    const state = getNoticeState(config, TEMPORAL_USAGE_NOTICE_ID);
    if (!hasNoticeCapRoomForNotice(TEMPORAL_USAGE_NOTICE_ID, state)) return;
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) return;
    const decision = getDisplayDecision(
      TEMPORAL_USAGE_NOTICE_ID,
      LOG_LINE_NOTICE_TYPE,
      flagEvaluation.variant,
      flagEvaluation.payload
    );
    const opportunity = {
      variant: flagEvaluation.variant,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_source: trigger.triggerSource,
      trigger_reason: trigger.triggerReason
    };
    if (!recordNoticeOpportunity(TEMPORAL_USAGE_NOTICE_ID, opportunity)) {
      return;
    }
    await emitNoticeDisplayed(instance, {
      notice_id: TEMPORAL_USAGE_NOTICE_ID,
      notice_type: LOG_LINE_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_source: trigger.triggerSource,
      trigger_reason: trigger.triggerReason
    });
    if (decision.displayed && decision.copy) {
      process.stderr.write(`${decision.copy}
`);
    }
  } catch (e) {
  }
}
async function displayDecayUsageNotice(instance, trigger) {
  if (!isTelemetryEnabled()) return;
  if (isNoticeCapacityReachedInProcess(DECAY_USAGE_NOTICE_ID)) return;
  try {
    const config = loadMem0Config();
    const state = getNoticeState(config, DECAY_USAGE_NOTICE_ID);
    if (!hasNoticeCapRoomForNotice(DECAY_USAGE_NOTICE_ID, state)) return;
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) return;
    const decision = getDisplayDecision(
      DECAY_USAGE_NOTICE_ID,
      LOG_LINE_NOTICE_TYPE,
      flagEvaluation.variant,
      flagEvaluation.payload
    );
    const opportunity = {
      variant: flagEvaluation.variant,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_source: trigger.triggerSource,
      trigger_reason: trigger.triggerReason,
      ...trigger.deleteCount !== void 0 && {
        delete_count: trigger.deleteCount
      },
      ...trigger.deletedCount !== void 0 && {
        deleted_count: trigger.deletedCount
      }
    };
    if (!recordNoticeOpportunity(DECAY_USAGE_NOTICE_ID, opportunity)) {
      return;
    }
    await emitNoticeDisplayed(instance, {
      notice_id: DECAY_USAGE_NOTICE_ID,
      notice_type: LOG_LINE_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: trigger.triggerFunction,
      trigger_source: trigger.triggerSource,
      trigger_reason: trigger.triggerReason,
      ...trigger.deleteCount !== void 0 && {
        delete_count: trigger.deleteCount
      },
      ...trigger.deletedCount !== void 0 && {
        deleted_count: trigger.deletedCount
      }
    });
    if (decision.displayed && decision.copy) {
      process.stderr.write(`${decision.copy}
`);
    }
  } catch (e) {
  }
}
async function displayFirstRunNotice(instance, triggerFunction) {
  if (!isTelemetryEnabled()) return;
  if (firstRunConsumedInProcess || firstRunClaimInProgress) return;
  const config = loadMem0Config();
  if (isFirstRunConsumed(config)) {
    firstRunConsumedInProcess = true;
    return;
  }
  firstRunClaimInProgress = true;
  try {
    const flagEvaluation = await evaluateNoticeFlag(instance.telemetryId);
    if (!flagEvaluation) {
      firstRunClaimInProgress = false;
      return;
    }
    const decision = getDisplayDecision(
      FIRST_RUN_NOTICE_ID,
      LOG_LINE_NOTICE_TYPE,
      flagEvaluation.variant,
      flagEvaluation.payload
    );
    firstRunConsumedInProcess = true;
    markFirstRunConsumed(triggerFunction, flagEvaluation.variant);
    await emitNoticeDisplayed(instance, {
      notice_id: FIRST_RUN_NOTICE_ID,
      notice_type: LOG_LINE_NOTICE_TYPE,
      flag_key: NOTICE_FLAG_KEY,
      variant: flagEvaluation.variant,
      displayed: decision.displayed,
      payload: decision.copy,
      bypass_reason: decision.bypassReason,
      disabled_reason: decision.disabledReason,
      notice_config_found: decision.noticeConfigFound,
      sync_type: "async",
      trigger_function: triggerFunction
    });
    if (decision.displayed && decision.copy) {
      process.stderr.write(`${decision.copy}
`);
    }
  } catch (e) {
    if (!firstRunConsumedInProcess) firstRunClaimInProgress = false;
  } finally {
    if (firstRunConsumedInProcess) firstRunClaimInProgress = false;
  }
}
async function emitNoticeDisplayed(instance, properties) {
  if (!isTelemetryEnabled()) return;
  try {
    await captureNoticeEvent(instance, properties);
  } catch (e) {
  }
}

// src/oss/src/utils/lemmatization.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "can't",
  "cannot",
  "could",
  "couldn't",
  "did",
  "didn't",
  "do",
  "does",
  "doesn't",
  "doing",
  "don't",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "get",
  "got",
  "had",
  "hadn't",
  "has",
  "hasn't",
  "have",
  "haven't",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "itself",
  "just",
  "let's",
  "me",
  "might",
  "more",
  "most",
  "mustn't",
  "must",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "shall",
  "shan't",
  "she",
  "should",
  "shouldn't",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "wasn't",
  "we",
  "were",
  "weren't",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "won't",
  "would",
  "wouldn't",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves"
]);
var _porterStemmer;
function getPorterStemmer() {
  if (_porterStemmer !== void 0) {
    return _porterStemmer;
  }
  try {
    const natural = __require("natural");
    _porterStemmer = natural.PorterStemmer;
    return _porterStemmer;
  } catch (e) {
    _porterStemmer = null;
    return null;
  }
}
function simpleStem(word) {
  if (word.length <= 3) {
    return word;
  }
  let w = word;
  if (w.endsWith("ies") && w.length > 4) {
    w = w.slice(0, -3) + "i";
  } else if (w.endsWith("sses")) {
    w = w.slice(0, -2);
  } else if (w.endsWith("ness")) {
    w = w.slice(0, -4);
  } else if (w.endsWith("ment") && w.length > 5) {
    w = w.slice(0, -4);
  } else if (w.endsWith("ation") && w.length > 6) {
    w = w.slice(0, -5) + "e";
  } else if (w.endsWith("ting") && w.length > 5) {
    w = w.slice(0, -3);
  } else if (w.endsWith("ing") && w.length > 5) {
    w = w.slice(0, -3);
  } else if (w.endsWith("ed") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("ly") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("er") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("est") && w.length > 4) {
    w = w.slice(0, -3);
  } else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    w = w.slice(0, -1);
  }
  return w;
}
function lemmatizeForBm25(text) {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g);
  if (!words) {
    return text.toLowerCase();
  }
  const stemmer = getPorterStemmer();
  const stemFn = stemmer ? (w) => stemmer.stem(w).toLowerCase() : simpleStem;
  const tokens = [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) {
      continue;
    }
    const stemmed = stemFn(word);
    if (stemmed && /^[a-z0-9]+$/.test(stemmed)) {
      tokens.push(stemmed);
    }
    if (word.endsWith("ing") && word !== stemmed && /^[a-z0-9]+$/.test(word)) {
      tokens.push(word);
    }
  }
  return tokens.join(" ");
}

// src/oss/src/utils/entity_extraction.ts
var GENERIC_HEADS = /* @__PURE__ */ new Set([
  "thing",
  "stuff",
  "way",
  "time",
  "experience",
  "situation",
  "case",
  "fact",
  "matter",
  "issue",
  "idea",
  "thought",
  "feeling",
  "place",
  "area",
  "part",
  "kind",
  "type",
  "sort",
  "lot",
  "bit",
  "day",
  "year",
  "week",
  "month",
  "moment",
  "instance",
  "example",
  "technique",
  "method",
  "approach",
  "process",
  "step",
  "tool",
  "result",
  "outcome",
  "goal",
  "task",
  "item",
  "topic",
  "scale",
  "size",
  "level",
  "degree",
  "amount",
  "number",
  "style",
  "look",
  "color",
  "colour",
  "shape",
  "form",
  "piece",
  "section",
  "side",
  "end",
  "edge",
  "surface",
  "point"
]);
var NON_SPECIFIC_ADJ = /* @__PURE__ */ new Set([
  "many",
  "few",
  "several",
  "some",
  "any",
  "all",
  "most",
  "more",
  "less",
  "much",
  "little",
  "enough",
  "various",
  "numerous",
  "multiple",
  "countless",
  "great",
  "good",
  "bad",
  "nice",
  "terrible",
  "awful",
  "awesome",
  "amazing",
  "wonderful",
  "horrible",
  "excellent",
  "poor",
  "best",
  "worst",
  "fine",
  "okay",
  "new",
  "old",
  "recent",
  "past",
  "future",
  "current",
  "previous",
  "next",
  "last",
  "first",
  "latest",
  "early",
  "late",
  "former",
  "modern",
  "ancient",
  "big",
  "small",
  "large",
  "tiny",
  "huge",
  "enormous",
  "long",
  "short",
  "tall",
  "high",
  "low",
  "wide",
  "narrow",
  "thick",
  "thin",
  "deep",
  "shallow",
  "similar",
  "different",
  "same",
  "other",
  "another",
  "such",
  "certain",
  "important",
  "main",
  "major",
  "minor",
  "key",
  "primary",
  "real",
  "actual",
  "true",
  "whole",
  "entire",
  "full",
  "complete",
  "total",
  "basic",
  "simple",
  "interesting",
  "boring",
  "exciting",
  "special",
  "particular",
  "general",
  "common",
  "unique",
  "rare",
  "typical",
  "usual",
  "normal",
  "regular",
  "possible",
  "likely",
  "potential",
  "available",
  "necessary",
  "only",
  "solo",
  "individual",
  "team",
  "group",
  "joint",
  "collaborative",
  "final",
  "initial",
  "side",
  "top"
]);
var TOPIC_PREFIX_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "this",
  "that",
  "these",
  "those"
]);
var GENERIC_ENDINGS = /* @__PURE__ */ new Set([
  "work",
  "works",
  "job",
  "jobs",
  "task",
  "tasks",
  "stuff",
  "things",
  "thing",
  "info",
  "information",
  "details",
  "data",
  "content",
  "material",
  "materials",
  "activities",
  "activity",
  "efforts",
  "effort",
  "options",
  "option",
  "choices",
  "choice",
  "results",
  "result",
  "output",
  "outputs",
  "products",
  "product",
  "items",
  "item"
]);
var GENERIC_CAPS = /* @__PURE__ */ new Set([
  "works",
  "items",
  "things",
  "stuff",
  "resources",
  "options",
  "tips",
  "ideas",
  "steps",
  "ways",
  "methods",
  "tools",
  "features",
  "benefits",
  "examples",
  "details",
  "notes",
  "instructions",
  "guidelines",
  "recommendations",
  "suggestions",
  "overview",
  "summary",
  "conclusion",
  "introduction",
  "pros",
  "cons",
  "advantages",
  "disadvantages"
]);
var GENERIC_SINGLE_ENTITY_TERMS = /* @__PURE__ */ new Set([
  "user",
  "assistant",
  "agent",
  "customer",
  "client",
  "person",
  "people",
  "human",
  "memory",
  "message",
  "conversation",
  "chat",
  "session",
  "system",
  "top"
]);
var FORMATTING_MARKERS = /* @__PURE__ */ new Set([
  "*",
  "-",
  "+",
  "\u2022",
  "\u2013",
  "\u2014",
  "#",
  "##",
  "###",
  "**",
  "__"
]);
var nlp;
try {
  nlp = __require("compromise");
} catch (e) {
}
function hasArtifacts(txt) {
  if (txt.includes("**") || txt.includes("__") || txt.includes(":*")) {
    return true;
  }
  if (/\s\*\s|\s\*$|^\*\s/.test(txt)) {
    return true;
  }
  if (txt.includes("  ") || txt.includes("\n") || txt.includes("	")) {
    return true;
  }
  if (txt.length > 100) {
    return true;
  }
  if (/^[\u2022\-+\u2013\u2014]/.test(txt)) {
    return true;
  }
  return false;
}
function stripGenericEnding(words) {
  if (words.length <= 1) {
    return words;
  }
  const last = words[words.length - 1].toLowerCase();
  if (GENERIC_ENDINGS.has(last) && words.length > 2) {
    return words.slice(0, -1);
  }
  return words;
}
function stripTopicPrefix(words) {
  let start = 0;
  while (start < words.length && TOPIC_PREFIX_WORDS.has(words[start].toLowerCase())) {
    start++;
  }
  return words.slice(start);
}
function cleanToken(token) {
  return token.replace(/^[^\w.]+|[^\w.]+$/g, "");
}
function tokenize(text) {
  var _a2;
  return (_a2 = text.match(
    /[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*|\d[\d,]*(?:\.\d+)?|[,:;.!?&]/g
  )) != null ? _a2 : [];
}
function isCapitalized(token) {
  return /^[A-Z]/.test(token) && /[A-Za-z]/.test(token);
}
function hasInternalCapOrDigit(token) {
  return /\d/.test(token) || /[A-Z]/.test(token.slice(1)) || /^[A-Z]{2,}$/.test(token);
}
function isBadSingleNameToken(token) {
  const lower = token.toLowerCase();
  return GENERIC_SINGLE_ENTITY_TERMS.has(lower) || GENERIC_CAPS.has(lower);
}
function looksLikeMetricCount(token) {
  return /^\d[\d,]*(?:\.\d+)?$/.test(token);
}
function isMetricListContext(tokens, idx) {
  const prev = idx > 0 ? tokens[idx - 1] : "";
  const next = idx + 1 < tokens.length ? tokens[idx + 1] : "";
  return [":", ",", ";"].includes(prev) || [",", ";"].includes(next);
}
function isSentenceStart(tokens, idx) {
  if (idx === 0) return true;
  return [".", "!", "?", ":"].includes(tokens[idx - 1]) || FORMATTING_MARKERS.has(tokens[idx - 1]);
}
function isListItemNameToken(tokens, idx) {
  const token = cleanToken(tokens[idx]);
  if (!isCapitalized(token) || isBadSingleNameToken(token)) return false;
  const next = idx + 1 < tokens.length ? cleanToken(tokens[idx + 1]) : "";
  if (!looksLikeMetricCount(next)) return false;
  return isMetricListContext(tokens, idx) || isMetricListContext(tokens, idx + 1);
}
function isNameToken(tokens, idx) {
  const token = cleanToken(tokens[idx]);
  if (!token || !isCapitalized(token) || isBadSingleNameToken(token))
    return false;
  if (hasInternalCapOrDigit(token) || isListItemNameToken(tokens, idx))
    return true;
  return !isSentenceStart(tokens, idx);
}
function cleanEntityText(text) {
  return text.replace(/^\*+\s*|\s*\*+$/g, "").replace(/\s*:+$/g, "").replace(/^\d+\s*\.\s*/, "").replace(/\s+\d[\d,]*(?:\.\d+)?$/g, "").replace(/[.,;!?]+$/, "").trim().replace(/\s+/g, " ");
}
function isCoordinatedNameTopic(text) {
  return /\b[A-Z][\w-]+\s+and\s+[A-Z][\w-]+\b/.test(text);
}
function extractQuoted(text) {
  const entities = [];
  const doubleQuoteRe = /"([^"]+)"/g;
  let match;
  while ((match = doubleQuoteRe.exec(text)) !== null) {
    const inner = match[1].trim();
    if (inner.length > 2) {
      entities.push({ type: "QUOTED", text: inner });
    }
  }
  const singleQuoteRe = /(?:^|[\s([{,;])'([^']+)'(?=[\s.,;:!?)\]]|$)/g;
  while ((match = singleQuoteRe.exec(text)) !== null) {
    const inner = match[1].trim();
    if (inner.length > 2) {
      entities.push({ type: "QUOTED", text: inner });
    }
  }
  return entities;
}
function extractIdentifiers(text) {
  const entities = [];
  const identifierRe = /\b[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+\b/g;
  let match;
  while ((match = identifierRe.exec(text)) !== null) {
    entities.push({ type: "IDENTIFIER", text: match[0] });
  }
  return entities;
}
function extractProper(text) {
  const entities = [];
  const tokens = tokenize(text);
  const innerConnectors = /* @__PURE__ */ new Set(["of", "the", "in", "for", "at"]);
  let i = 0;
  while (i < tokens.length) {
    const token = cleanToken(tokens[i]);
    const next = i + 1 < tokens.length ? tokens[i + 1] : "";
    const afterNext = i + 2 < tokens.length ? cleanToken(tokens[i + 2]) : "";
    if (token && next === "&" && afterNext && isCapitalized(token) && isCapitalized(afterNext) && !isBadSingleNameToken(token) && !isBadSingleNameToken(afterNext)) {
      entities.push({
        type: "PROPER",
        text: cleanEntityText(`${token} & ${afterNext}`)
      });
      i += 3;
      continue;
    }
    if (!isNameToken(tokens, i)) {
      i++;
      continue;
    }
    const span = [cleanToken(tokens[i])];
    let j = i + 1;
    while (j < tokens.length) {
      const current = cleanToken(tokens[j]);
      if (isNameToken(tokens, j)) {
        span.push(current);
        j++;
        continue;
      }
      if (innerConnectors.has(current.toLowerCase()) && j + 1 < tokens.length && isNameToken(tokens, j + 1)) {
        span.push(current, cleanToken(tokens[j + 1]));
        j += 2;
        continue;
      }
      break;
    }
    const phrase = cleanEntityText(span.join(" "));
    if (phrase.length > 2) {
      entities.push({ type: "PROPER", text: phrase });
    }
    i = Math.max(j, i + 1);
  }
  return entities;
}
function extractCompoundsWithNlp(text) {
  if (!nlp) {
    return [];
  }
  const entities = [];
  const doc = nlp(text);
  const nouns = doc.nouns().out("array");
  for (const nounPhrase of nouns) {
    const trimmed = nounPhrase.trim();
    if (!trimmed || trimmed.length <= 3) {
      continue;
    }
    const words = trimmed.split(/\s+/);
    if (words.length < 2) {
      continue;
    }
    const head = words[words.length - 1].toLowerCase();
    if (GENERIC_HEADS.has(head)) {
      const hasSpecificMod = words.some(
        (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase()) && w !== words[words.length - 1]
      );
      if (!hasSpecificMod) {
        continue;
      }
    }
    const filtered = words.filter(
      (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase())
    );
    const cleaned = stripGenericEnding(stripTopicPrefix(filtered));
    if (cleaned.length >= 2) {
      const phrase = cleanEntityText(cleaned.join(" "));
      if (phrase.length > 3) {
        entities.push({ type: "TOPIC", text: phrase });
      }
    }
  }
  return entities;
}
function extractCompoundsRegex(text) {
  const entities = [];
  const compoundRe = /\b([A-Z][a-z]+(?:\s+(?:of|the|for|in)\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let match;
  while ((match = compoundRe.exec(text)) !== null) {
    const phrase = match[1].trim();
    if (phrase.length > 3 && phrase.includes(" ")) {
      const words = phrase.split(/\s+/);
      const head = words[words.length - 1].toLowerCase();
      if (!GENERIC_HEADS.has(head)) {
        const filtered = words.filter(
          (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase())
        );
        const cleaned = stripGenericEnding(stripTopicPrefix(filtered));
        if (cleaned.length >= 2) {
          entities.push({
            type: "TOPIC",
            text: cleanEntityText(cleaned.join(" "))
          });
        }
      }
    }
  }
  const lowerCompoundRe = /\b([a-z]+(?:\s+[a-z]+){1,3})\b/g;
  while ((match = lowerCompoundRe.exec(text)) !== null) {
    const phrase = match[1].trim();
    const words = phrase.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && phrase.length > 5) {
      const head = words[words.length - 1].toLowerCase();
      const allGeneric = words.every(
        (w) => NON_SPECIFIC_ADJ.has(w.toLowerCase()) || GENERIC_HEADS.has(w.toLowerCase())
      );
      if (!allGeneric && !GENERIC_HEADS.has(head)) {
        const hasContentWord = words.some(
          (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase()) && !GENERIC_HEADS.has(w.toLowerCase()) && w.length > 2
        );
        if (hasContentWord) {
          const filtered = words.filter(
            (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase())
          );
          const cleaned = stripGenericEnding(stripTopicPrefix(filtered));
          if (cleaned.length >= 2) {
            entities.push({
              type: "TOPIC",
              text: cleanEntityText(cleaned.join(" "))
            });
          }
        }
      }
    }
  }
  return entities;
}
function extractEntities(text) {
  var _a2, _b2;
  const raw = [];
  raw.push(...extractQuoted(text));
  raw.push(...extractProper(text));
  raw.push(...extractIdentifiers(text));
  if (nlp) {
    raw.push(...extractCompoundsWithNlp(text));
  } else {
    raw.push(...extractCompoundsRegex(text));
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const entity of raw) {
    const key = entity.text.toLowerCase().trim();
    if (key.length > 2 && !seen.has(key)) {
      seen.add(key);
      deduped.push(entity);
    }
  }
  const cleaned = [];
  for (const entity of deduped) {
    let txt = entity.text.trim();
    txt = cleanEntityText(txt);
    if (!txt || txt.length <= 2 || hasArtifacts(txt)) {
      continue;
    }
    if (entity.type === "TOPIC" && (/^\d/.test(txt) || isCoordinatedNameTopic(txt))) {
      continue;
    }
    if (entity.type === "PROPER" && !txt.includes(" ") && GENERIC_CAPS.has(txt.toLowerCase())) {
      continue;
    }
    cleaned.push({ type: entity.type, text: txt });
  }
  const typePriority = {
    PROPER: 0,
    IDENTIFIER: 1,
    QUOTED: 2,
    TOPIC: 3
  };
  const best = /* @__PURE__ */ new Map();
  for (const entity of cleaned) {
    const key = entity.text.toLowerCase();
    const existing = best.get(key);
    if (!existing || ((_a2 = typePriority[entity.type]) != null ? _a2 : 99) < ((_b2 = typePriority[existing.type]) != null ? _b2 : 99)) {
      best.set(key, entity);
    }
  }
  const bestEntities = Array.from(best.values());
  return bestEntities.filter(
    (entity) => !bestEntities.some(
      (other) => {
        var _a3, _b3;
        return entity.text.toLowerCase() !== other.text.toLowerCase() && ((_a3 = typePriority[entity.type]) != null ? _a3 : 99) >= ((_b3 = typePriority[other.type]) != null ? _b3 : 99) && new RegExp(
          `(^|\\s)${entity.text.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`
        ).test(other.text.toLowerCase());
      }
    )
  );
}
function extractEntitiesBatch(texts) {
  return texts.map(extractEntities);
}

// src/oss/src/utils/scoring.ts
var ENTITY_BOOST_WEIGHT = 0.5;
function getBm25Params(query, lemmatized) {
  const text = lemmatized != null ? lemmatized : query;
  const numTerms = text.trim().split(/\s+/).filter(Boolean).length || 1;
  if (numTerms <= 3) {
    return [5, 0.7];
  } else if (numTerms <= 6) {
    return [7, 0.6];
  } else if (numTerms <= 9) {
    return [9, 0.5];
  } else if (numTerms <= 15) {
    return [10, 0.5];
  } else {
    return [12, 0.5];
  }
}
function normalizeBm25(rawScore, midpoint, steepness) {
  return 1 / (1 + Math.exp(-steepness * (rawScore - midpoint)));
}
function scoreAndRank(semanticResults, bm25Scores, entityBoosts, threshold, topK, explain = false) {
  var _a2, _b2, _c;
  const hasBm25 = Object.keys(bm25Scores).length > 0;
  const hasEntity = Object.keys(entityBoosts).length > 0;
  let maxPossible = 1;
  if (hasBm25) {
    maxPossible += 1;
  }
  if (hasEntity) {
    maxPossible += ENTITY_BOOST_WEIGHT;
  }
  const scored = [];
  for (const result of semanticResults) {
    const memId = result.id;
    if (memId == null) {
      continue;
    }
    const semanticScore = (_a2 = result.score) != null ? _a2 : 0;
    if (semanticScore < threshold) {
      continue;
    }
    const memIdStr = String(memId);
    const bm25Score = (_b2 = bm25Scores[memIdStr]) != null ? _b2 : 0;
    const entityBoost = (_c = entityBoosts[memIdStr]) != null ? _c : 0;
    const rawCombined = semanticScore + bm25Score + entityBoost;
    const combined = Math.min(rawCombined / maxPossible, 1);
    const entry = {
      id: memIdStr,
      score: combined,
      payload: result.payload
    };
    if (explain) {
      entry.scoreDetails = {
        semanticScore,
        bm25Score,
        entityBoost,
        rawScore: rawCombined,
        maxPossibleScore: maxPossible,
        finalScore: combined,
        threshold
      };
    }
    scored.push(entry);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// src/oss/src/utils/expiration.ts
var EXPIRATION_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
function todayUtc() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function normalizeExpirationDate(value) {
  const match = EXPIRATION_DATE_PATTERN.exec(value);
  if (match) {
    const [, year, month, day] = match;
    const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() === Number(month) - 1 && parsed.getUTCDate() === Number(day)) {
      return value;
    }
  }
  throw new Error("expirationDate must be a valid date in YYYY-MM-DD format.");
}
function payloadIsExpired(payload) {
  const raw = payload == null ? void 0 : payload.expiration_date;
  if (!raw) return false;
  try {
    return normalizeExpirationDate(String(raw)) < todayUtc();
  } catch (e) {
    return false;
  }
}

// src/client/config.ts
async function getNodeFs() {
  var _a2, _b2, _c, _d, _e;
  if (typeof process === "undefined" || !((_a2 = process.versions) == null ? void 0 : _a2.node)) return null;
  try {
    const [fs5, path4, os3, crypto2] = await Promise.all([
      import("fs"),
      import("path"),
      import("os"),
      import("crypto")
    ]);
    const fsMod = (_b2 = fs5.default) != null ? _b2 : fs5;
    const pathMod = (_c = path4.default) != null ? _c : path4;
    const osMod = (_d = os3.default) != null ? _d : os3;
    const cryptoMod = (_e = crypto2.default) != null ? _e : crypto2;
    const dir = process.env.MEM0_DIR || pathMod.join(osMod.homedir(), ".mem0");
    return {
      fs: fsMod,
      path: pathMod,
      crypto: cryptoMod,
      configPath: pathMod.join(dir, "config.json")
    };
  } catch (e) {
    return null;
  }
}
function loadConfig(node) {
  try {
    if (!node.fs.existsSync(node.configPath)) return null;
    const parsed = JSON.parse(node.fs.readFileSync(node.configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}
function writeConfig(node, config) {
  node.fs.mkdirSync(node.path.dirname(node.configPath), { recursive: true });
  node.fs.writeFileSync(node.configPath, JSON.stringify(config, null, 4));
}
function randomUserId(node) {
  if (typeof node.crypto.randomUUID === "function") {
    return node.crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
async function getOrCreateMem0UserId() {
  var _a2;
  const node = await getNodeFs();
  if (!node) return null;
  try {
    const config = (_a2 = loadConfig(node)) != null ? _a2 : {};
    if (typeof config.user_id === "string" && config.user_id) {
      return config.user_id;
    }
    const userId = randomUserId(node);
    config.user_id = userId;
    writeConfig(node, config);
    return userId;
  } catch (e) {
    return null;
  }
}

// src/oss/src/memory/index.ts
var LLMError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "LLMError";
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var ENTITY_PARAMS = [
  "user_id",
  "agent_id",
  "run_id",
  "userId",
  "agentId",
  "runId"
];
var IDENTITY_KEYS = [...ENTITY_PARAMS, "actor_id"];
var PAYLOAD_METADATA_EXCLUDED_KEYS = /* @__PURE__ */ new Set([
  "user_id",
  "agent_id",
  "run_id",
  "hash",
  "data",
  "createdAt",
  "updatedAt",
  "textLemmatized",
  "attributedTo"
]);
function stripIdentityKeys(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !IDENTITY_KEYS.includes(key))
  );
}
var DELETE_ALL_BATCH_SIZE = 1e3;
function rejectTopLevelEntityParams(config, methodName) {
  const invalidKeys = Object.keys(config).filter(
    (k) => ENTITY_PARAMS.includes(k)
  );
  if (invalidKeys.length > 0) {
    throw new Error(
      `Top-level entity parameters [${invalidKeys.join(", ")}] are not supported in ${methodName}(). Use filters: { userId: "..." } instead.`
    );
  }
}
function validateAndTrimEntityId(value, name) {
  if (value == null) return void 0;
  const trimmed = String(value).trim();
  if (trimmed === "") {
    throw new Error(
      `Invalid ${name}: cannot be empty or whitespace-only. Provide a valid identifier.`
    );
  }
  if (/\s/.test(trimmed)) {
    throw new Error(
      `Invalid ${name}: cannot contain whitespace. Provide a valid identifier without spaces.`
    );
  }
  return trimmed;
}
function validateSearchParams(threshold, topK) {
  if (threshold !== void 0) {
    if (typeof threshold !== "number" || isNaN(threshold)) {
      throw new Error("threshold must be a valid number");
    }
    if (threshold < 0 || threshold > 1) {
      throw new Error(
        `Invalid threshold: ${threshold}. Must be between 0 and 1 (inclusive).`
      );
    }
  }
  if (topK !== void 0) {
    if (typeof topK !== "number" || isNaN(topK) || !Number.isInteger(topK)) {
      throw new Error("topK must be a valid integer");
    }
    if (topK < 0) {
      throw new Error(`Invalid topK: ${topK}. Must be a non-negative integer.`);
    }
  }
}
var Memory = class _Memory {
  constructor(config = {}, components = {}) {
    this.components = components;
    this.reranker = null;
    this.config = ConfigManager.mergeConfig(config);
    this.customInstructions = this.config.customInstructions;
    this.embedder = this.components?.embedder ?? EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config
    );
    this.llm = this.components?.llm ?? LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config
    );
    if (this.config.reranker) {
      this.reranker = RerankerFactory.create(
        this.config.reranker.provider,
        this.config.reranker.config
      );
    }
    if (this.config.disableHistory) {
      this.db = new DummyHistoryManager();
    } else {
      this.db = HistoryManagerFactory.create(
        this.config.historyStore.provider,
        this.config.historyStore
      );
    }
    this.collectionName = this.config.vectorStore.config.collectionName;
    this.apiVersion = this.config.version || "v1.0";
    this.telemetryId = "anonymous";
    this._initPromise = this._autoInitialize().catch((error) => {
      this._initError = error instanceof Error ? error : new Error(String(error));
      console.error(this._initError);
    });
  }
  /**
   * If no explicit dimension was provided, runs a probe embedding to
   * detect it. Then creates and initializes the vector store.
   */
  async _autoInitialize() {
    if (!this.config.vectorStore.config.dimension) {
      try {
        const probe = await this.embedder.embed("dimension probe");
        this.config.vectorStore.config.dimension = probe.length;
      } catch (error) {
        throw new Error(
          `Failed to auto-detect embedding dimension from provider '${this.config.embedder.provider}': ${error.message}. Please set 'dimension' in vectorStore.config or 'embeddingDims' in embedder.config explicitly.`
        );
      }
    }
    this.vectorStore = this.components?.vectorStore ?? VectorStoreFactory.create(
      this.config.vectorStore.provider,
      this.config.vectorStore.config
    );
    await this.vectorStore.initialize();
    await this._initializeTelemetry();
  }
  /**
   * Ensures that auto-initialization (dimension detection + vector store
   * creation) has completed before any public method proceeds.
   * If a previous init attempt failed, retries automatically.
   */
  async _ensureInitialized() {
    await this._initPromise;
    if (this._initError) {
      this._initError = void 0;
      this._initPromise = this._autoInitialize().catch((error) => {
        this._initError = error instanceof Error ? error : new Error(String(error));
        console.error(this._initError);
      });
      await this._initPromise;
      if (this._initError) {
        throw this._initError;
      }
    }
  }
  async getEntityStore() {
    if (!this._entityStore) {
      const entityProvider = this.config.vectorStore.provider;
      const entityCollectionName = `${this.collectionName}_entities`;
      const entityConfig = {
        ...this.config.vectorStore.config,
        collectionName: entityCollectionName
      };
      if (entityProvider === "memory") {
        const basePath = entityConfig.dbPath || getDefaultVectorStoreDbPath();
        entityConfig.dbPath = basePath.replace(/\.db$/, "_entities.db");
      }
      if (entityProvider === "databricks") {
        entityConfig.tableName = entityConfig.tableName ? `${entityConfig.tableName}_entities` : entityCollectionName;
      }
      this._entityStore = VectorStoreFactory.create(
        entityProvider,
        entityConfig
      );
      await this._entityStore.initialize();
    }
    return this._entityStore;
  }
  /**
   * Normalize a filters object for entity-store scoping: keeps only
   * user_id/agent_id/run_id keys whose values are defined.
   */
  _sessionFiltersFromPayload(payload) {
    const filters = {};
    if (payload.user_id) filters.user_id = payload.user_id;
    if (payload.agent_id) filters.agent_id = payload.agent_id;
    if (payload.run_id) filters.run_id = payload.run_id;
    return filters;
  }
  _normalizeEntityText(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }
  async _existingEntitiesByText(entityStore, filters) {
    var _a2;
    const rowsByText = /* @__PURE__ */ new Map();
    let rows = [];
    try {
      const listed = await entityStore.list(filters, 1e4);
      rows = Array.isArray(listed) && Array.isArray(listed[0]) ? listed[0] : listed;
    } catch (e) {
      console.debug(
        `Exact entity lookup failed, falling back to semantic dedup: ${e}`
      );
      return rowsByText;
    }
    for (const row of rows) {
      const text = (_a2 = row.payload) == null ? void 0 : _a2.data;
      if (typeof text !== "string") continue;
      const key = this._normalizeEntityText(text);
      if (key && !rowsByText.has(key)) {
        rowsByText.set(key, row);
      }
    }
    return rowsByText;
  }
  /**
   * Remove `memoryId` from every entity record scoped to `filters`.
   * If an entity's `linkedMemoryIds` becomes empty after removal, the
   * entity record itself is deleted. Errors on individual entities are
   * swallowed so one bad record does not break the whole operation.
   *
   * No-op if the entity store has not been initialized yet.
   */
  async _removeMemoryFromEntityStore(memoryId, filters) {
    let entityStore;
    try {
      entityStore = await this.getEntityStore();
    } catch (e) {
      console.debug(`Entity store unavailable during cleanup: ${e}`);
      return;
    }
    let rows = [];
    try {
      const listed = await entityStore.list(filters, 1e4);
      rows = Array.isArray(listed) && Array.isArray(listed[0]) ? listed[0] : listed;
    } catch (e) {
      console.debug(`Entity store list failed during cleanup: ${e}`);
      return;
    }
    for (const row of rows) {
      try {
        const payload = row.payload || {};
        const linked = Array.isArray(payload.linkedMemoryIds) ? payload.linkedMemoryIds : [];
        if (!linked.includes(memoryId)) continue;
        const remaining = linked.filter((id) => id !== memoryId);
        if (remaining.length === 0) {
          try {
            await entityStore.delete(row.id);
          } catch (e) {
            console.debug(`Entity delete failed for id=${row.id}: ${e}`);
          }
        } else {
          const newPayload = { ...payload, linkedMemoryIds: remaining };
          const entityText = typeof payload.data === "string" ? payload.data : "";
          if (!entityText) {
            console.debug(
              `Entity id=${row.id} missing 'data'; skipping update during cleanup`
            );
            continue;
          }
          let vec;
          try {
            vec = await this.embedder.embed(entityText, "update");
          } catch (e) {
            console.debug(`Entity re-embed failed for '${entityText}': ${e}`);
            continue;
          }
          try {
            await entityStore.update(row.id, vec, newPayload);
          } catch (e) {
            console.debug(`Entity update failed for id=${row.id}: ${e}`);
          }
        }
      } catch (e) {
        console.debug(`Entity cleanup error for id=${row == null ? void 0 : row.id}: ${e}`);
      }
    }
  }
  /**
   * Extract entities from `text` and link them to `memoryId` in the
   * entity store, scoped to `filters` (user_id / agent_id / run_id).
   *
   * Simpler single-memory variant of Phase 7 in add(): no cross-memory
   * dedup, but still does per-entity "search for existing, update if
   * match >= 0.95 else insert new". Non-fatal errors are swallowed.
   */
  async _linkEntitiesForMemory(memoryId, text, filters) {
    var _a2;
    try {
      const entities = extractEntities(text);
      if (entities.length === 0) return;
      const entityStore = await this.getEntityStore();
      const exactMatches = await this._existingEntitiesByText(
        entityStore,
        filters
      );
      for (const entity of entities) {
        try {
          let entityVec;
          try {
            entityVec = await this.embedder.embed(entity.text, "add");
          } catch (e) {
            console.debug(`Entity embed failed for '${entity.text}': ${e}`);
            continue;
          }
          let matches = [];
          const exactMatch = exactMatches.get(
            this._normalizeEntityText(entity.text)
          );
          if (!exactMatch) {
            try {
              matches = await entityStore.search(entityVec, 1, filters);
            } catch (e) {
            }
          }
          const semanticMatch = matches.length > 0 && ((_a2 = matches[0].score) != null ? _a2 : 0) >= 0.95 ? matches[0] : void 0;
          const match = exactMatch != null ? exactMatch : semanticMatch;
          if (match) {
            const payload = match.payload || {};
            const linked = new Set(
              Array.isArray(payload.linkedMemoryIds) ? payload.linkedMemoryIds : []
            );
            linked.add(memoryId);
            payload.linkedMemoryIds = Array.from(linked).sort();
            try {
              await entityStore.update(match.id, entityVec, payload);
            } catch (e) {
              console.debug(`Entity update failed for '${entity.text}': ${e}`);
            }
          } else {
            const entityPayload = {
              data: entity.text,
              entityType: entity.type,
              linkedMemoryIds: [memoryId]
            };
            if (filters.user_id) entityPayload.user_id = filters.user_id;
            if (filters.agent_id) entityPayload.agent_id = filters.agent_id;
            if (filters.run_id) entityPayload.run_id = filters.run_id;
            try {
              await entityStore.insert(
                [entityVec],
                [uuidv45()],
                [entityPayload]
              );
            } catch (e) {
              console.debug(`Entity insert failed for '${entity.text}': ${e}`);
            }
          }
        } catch (e) {
          console.debug(`Entity link error for '${entity.text}': ${e}`);
        }
      }
    } catch (e) {
      console.warn(`Entity linking failed during update: ${e}`);
    }
  }
  escapeScopeValue(val) {
    return String(val).replace(/%/g, "%25").replace(/&/g, "%26").replace(/=/g, "%3D");
  }
  buildSessionScope(filters) {
    const parts = [];
    for (const key of ["agent_id", "run_id", "user_id"].sort()) {
      const val = filters[key];
      if (val) parts.push(`${key}=${this.escapeScopeValue(val)}`);
    }
    return parts.join("&");
  }
  async _initializeTelemetry() {
    return;
    try {
      await this._getTelemetryId();
      await captureClientEvent("init", this, {
        api_version: this.apiVersion,
        client_type: "Memory",
        collection_name: this.collectionName
      });
    } catch (error) {
    }
  }
  async _getTelemetryId() {
    try {
      if (!this.telemetryId || this.telemetryId === "anonymous" || this.telemetryId === "anonymous-supabase") {
        this.telemetryId = await getOrCreateMem0UserId() || await this.vectorStore.getUserId();
        try {
          await this.vectorStore.setUserId(this.telemetryId);
        } catch (e) {
        }
      }
      return this.telemetryId;
    } catch (error) {
      this.telemetryId = "anonymous";
      return this.telemetryId;
    }
  }
  async _captureEvent(methodName, additionalData = {}) {
    return;
    try {
      await this._getTelemetryId();
      await captureClientEvent(methodName, this, {
        ...additionalData,
        api_version: this.apiVersion,
        collection_name: this.collectionName
      });
    } catch (error) {
      console.error(`Failed to capture ${methodName} event:`, error);
    }
  }
  async _displayFirstRunNotice(triggerFunction) {
    return;
    try {
      await this._getTelemetryId();
      await displayFirstRunNotice(this, triggerFunction);
    } catch (e) {
    }
  }
  async _displayDecayUsageNotice(trigger) {
    try {
      await this._getTelemetryId();
      await displayDecayUsageNotice(this, trigger);
    } catch (e) {
    }
  }
  async _displayTemporalUsageNotice(trigger) {
    return;
    try {
      await this._getTelemetryId();
      await displayTemporalUsageNotice(this, trigger);
    } catch (e) {
    }
  }
  async _displayScaleThresholdNotice(trigger) {
    return;
    try {
      await this._getTelemetryId();
      await displayScaleThresholdNotice(this, trigger);
    } catch (e) {
    }
  }
  async _displayPerformanceSlowQueryNotice(trigger) {
    try {
      await this._getTelemetryId();
      await displayPerformanceSlowQueryNotice(this, trigger);
    } catch (e) {
    }
  }
  async _getNoticeTelemetryId() {
    try {
      if (!this.telemetryId || this.telemetryId === "anonymous" || this.telemetryId === "anonymous-supabase") {
        this.telemetryId = await getOrCreateMem0UserId() || "anonymous";
      }
      return this.telemetryId;
    } catch (e) {
      this.telemetryId = "anonymous";
      return this.telemetryId;
    }
  }
  static fromConfig(configDict) {
    try {
      const config = MemoryConfigSchema.parse(configDict);
      return new _Memory(config);
    } catch (e) {
      console.error("Configuration validation error:", e);
      throw e;
    }
  }
  async updateProject(options = {}) {
    if ((options == null ? void 0 : options.decay) === true) {
      await this._getNoticeTelemetryId();
      throw new Error(await getDecayFeatureErrorMessage(this));
    }
    throw new Error("Project updates are not supported by the OSS Memory SDK.");
  }
  async add(messages, config) {
    if ((config == null ? void 0 : config.timestamp) !== void 0) {
      await this._getNoticeTelemetryId();
      throw new Error(
        await getTemporalFeatureErrorMessage(this, {
          triggerFunction: "add",
          triggerParameter: "timestamp"
        })
      );
    }
    if (messages === void 0 || messages === null) {
      throw new Error(
        "messages is required and cannot be undefined or null. Provide a string or array of messages."
      );
    }
    if (Array.isArray(messages)) {
      if (messages.length === 0) {
        throw new Error(
          "messages array cannot be empty. Provide at least one message with non-empty content."
        );
      }
      const allBlank = messages.every(
        (m) => typeof m.content === "string" && m.content.trim() === ""
      );
      if (allBlank) {
        throw new Error(
          "messages array cannot contain only blank content. Provide at least one message with non-empty content."
        );
      }
    } else if (messages.trim() === "") {
      throw new Error(
        "messages string cannot be empty. Provide non-empty content."
      );
    }
    const temporalUsageNotice = detectTemporalUsageFromMetadata(
      config == null ? void 0 : config.metadata
    );
    await this._ensureInitialized();
    await this._captureEvent("add", {
      message_count: Array.isArray(messages) ? messages.length : 1,
      has_metadata: !!config.metadata,
      has_filters: !!config.filters,
      infer: config.infer
    });
    const { filters = {}, infer = true } = config;
    const metadata = stripIdentityKeys(config.metadata);
    const userId = validateAndTrimEntityId(config.userId, "userId");
    const agentId = validateAndTrimEntityId(config.agentId, "agentId");
    const runId = validateAndTrimEntityId(config.runId, "runId");
    if (userId) filters.user_id = metadata.user_id = userId;
    if (agentId) filters.agent_id = metadata.agent_id = agentId;
    if (runId) filters.run_id = metadata.run_id = runId;
    if (filters.user_id) metadata.user_id = filters.user_id;
    if (filters.agent_id) metadata.agent_id = filters.agent_id;
    if (filters.run_id) metadata.run_id = filters.run_id;
    if (config.expirationDate != null) {
      metadata.expiration_date = normalizeExpirationDate(config.expirationDate);
    }
    if (!filters.user_id && !filters.agent_id && !filters.run_id) {
      throw new Error(
        "One of the filters: userId, agentId or runId is required!"
      );
    }
    const parsedMessages = Array.isArray(messages) ? messages : [{ role: "user", content: messages }];
    const final_parsedMessages = await parse_vision_messages(parsedMessages);
    const vectorStoreResult = await this.addToVectorStore(
      final_parsedMessages,
      metadata,
      filters,
      infer
    );
    if (temporalUsageNotice) {
      await this._displayTemporalUsageNotice({
        triggerFunction: "add",
        triggerSource: temporalUsageNotice.triggerSource,
        triggerReason: temporalUsageNotice.triggerReason
      });
    } else {
      const scaleThresholdNotice = await detectScaleThresholdFromAddResult(
        this,
        vectorStoreResult
      );
      if (scaleThresholdNotice) {
        await this._displayScaleThresholdNotice({
          triggerFunction: "add",
          ...scaleThresholdNotice
        });
      } else {
        await this._displayFirstRunNotice("add");
      }
    }
    return {
      results: vectorStoreResult
    };
  }
  async addToVectorStore(messages, metadata, filters, infer) {
    var _a2, _b2, _c, _d, _e, _f, _g;
    if (!infer) {
      const returnedMemories = [];
      for (const message of messages) {
        if (message.role === "system") {
          continue;
        }
        const memoryId = await this.createMemory(
          message.content,
          {},
          metadata
        );
        returnedMemories.push({
          id: memoryId,
          memory: message.content,
          metadata: { event: "ADD" }
        });
      }
      return returnedMemories;
    }
    const sessionScope = this.buildSessionScope(filters);
    let lastMessages = [];
    if (typeof this.db.getLastMessages === "function") {
      try {
        lastMessages = await this.db.getLastMessages(sessionScope, 10);
      } catch (e) {
      }
    }
    const parsedMessages = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const queryEmbedding = await this.embedder.embed(parsedMessages, "search");
    const existingResults = await this.vectorStore.search(
      queryEmbedding,
      10,
      filters
    );
    const existingMemories = [];
    const uuidMapping = {};
    for (let idx = 0; idx < existingResults.length; idx++) {
      const mem = existingResults[idx];
      uuidMapping[String(idx)] = mem.id;
      existingMemories.push({
        id: String(idx),
        text: (_b2 = (_a2 = mem.payload) == null ? void 0 : _a2.data) != null ? _b2 : ""
      });
    }
    const isAgentScoped = !!filters.agent_id && !filters.user_id;
    let systemPrompt = ADDITIVE_EXTRACTION_PROMPT;
    if (isAgentScoped) {
      systemPrompt += AGENT_CONTEXT_SUFFIX;
    }
    const userPrompt = generateAdditiveExtractionPrompt({
      existingMemories,
      newMessages: parsedMessages,
      lastKMessages: lastMessages,
      customInstructions: this.customInstructions
    });
    let response;
    try {
      response = await this.llm.generateResponse(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { type: "json_object" }
      );
    } catch (e) {
      console.error("LLM extraction failed:", e);
      throw new LLMError(`LLM extraction failed: ${e}`, { cause: e });
    }
    let extractedMemories = [];
    try {
      const cleanResponse = extractJson(response);
      if (cleanResponse && cleanResponse.trim()) {
        try {
          const parsed = AdditiveExtractionSchema.parse(
            JSON.parse(cleanResponse)
          );
          extractedMemories = parsed.memory;
        } catch (e) {
          const fallbackJson = extractJson(cleanResponse);
          extractedMemories = (_d = (_c = JSON.parse(fallbackJson)) == null ? void 0 : _c.memory) != null ? _d : [];
        }
      }
    } catch (e) {
      console.error("Error parsing extraction response:", e);
      extractedMemories = [];
    }
    if (extractedMemories.length === 0) {
      if (typeof this.db.saveMessages === "function") {
        try {
          await this.db.saveMessages(
            messages.map((m) => ({
              role: m.role,
              content: m.content
            })),
            sessionScope
          );
        } catch (e) {
        }
      }
      return [];
    }
    const memTexts = extractedMemories.map((m) => {
      var _a3;
      return (_a3 = m.text) != null ? _a3 : "";
    }).filter((t) => t.length > 0);
    let embedMap = {};
    try {
      const memEmbeddingsList = await this.embedder.embedBatch(memTexts, "add");
      for (let i = 0; i < memTexts.length; i++) {
        embedMap[memTexts[i]] = memEmbeddingsList[i];
      }
    } catch (e) {
      for (const text of memTexts) {
        try {
          embedMap[text] = await this.embedder.embed(text, "add");
        } catch (e2) {
          console.warn(`Failed to embed memory text: ${e2}`);
        }
      }
    }
    const existingHashes = /* @__PURE__ */ new Set();
    for (const mem of existingResults) {
      const h = (_e = mem.payload) == null ? void 0 : _e.hash;
      if (h) existingHashes.add(h);
    }
    const records = [];
    const seenHashes = /* @__PURE__ */ new Set();
    for (const mem of extractedMemories) {
      const text = mem.text;
      if (!text || !Object.prototype.hasOwnProperty.call(embedMap, text))
        continue;
      const memHash = createHash2("md5").update(text).digest("hex");
      if (existingHashes.has(memHash) || seenHashes.has(memHash)) {
        continue;
      }
      seenHashes.add(memHash);
      const textLemmatized = lemmatizeForBm25(text);
      const memoryId = this.components.idFor ? this.components.idFor(metadata) : uuidv45();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const memPayload = {
        ...metadata,
        data: text,
        textLemmatized,
        hash: memHash,
        createdAt: now,
        updatedAt: now
      };
      if (mem.attributed_to) {
        memPayload.attributedTo = mem.attributed_to;
      }
      if (filters.user_id) memPayload.user_id = filters.user_id;
      if (filters.agent_id) memPayload.agent_id = filters.agent_id;
      if (filters.run_id) memPayload.run_id = filters.run_id;
      records.push({
        memoryId,
        text,
        embedding: embedMap[text],
        payload: memPayload
      });
    }
    if (records.length === 0) {
      if (typeof this.db.saveMessages === "function") {
        try {
          await this.db.saveMessages(
            messages.map((m) => ({
              role: m.role,
              content: m.content
            })),
            sessionScope
          );
        } catch (e) {
        }
      }
      return [];
    }
    const allVectors = records.map((r) => r.embedding);
    const allIds = records.map((r) => r.memoryId);
    const allPayloads = records.map((r) => r.payload);
    try {
      await this.vectorStore.insert(allVectors, allIds, allPayloads);
    } catch (e) {
      for (let i = 0; i < allIds.length; i++) {
        try {
          await this.vectorStore.insert(
            [allVectors[i]],
            [allIds[i]],
            [allPayloads[i]]
          );
        } catch (e2) {
          console.error(`Failed to insert memory ${allIds[i]}: ${e2}`);
        }
      }
    }
    const historyRecords = records.map((r) => ({
      memoryId: r.memoryId,
      previousValue: null,
      newValue: r.text,
      action: "ADD",
      createdAt: r.payload.createdAt,
      updatedAt: void 0,
      isDeleted: 0
    }));
    if (typeof this.db.batchAddHistory === "function") {
      try {
        await this.db.batchAddHistory(historyRecords);
      } catch (e) {
        for (const hr of historyRecords) {
          try {
            await this.db.addHistory(
              hr.memoryId,
              null,
              hr.newValue,
              "ADD",
              hr.createdAt
            );
          } catch (e2) {
            console.error(`Failed to add history for ${hr.memoryId}: ${e2}`);
          }
        }
      }
    } else {
      for (const hr of historyRecords) {
        try {
          await this.db.addHistory(
            hr.memoryId,
            null,
            hr.newValue,
            "ADD",
            hr.createdAt
          );
        } catch (e) {
          console.error(`Failed to add history for ${hr.memoryId}: ${e}`);
        }
      }
    }
    try {
      const allTexts = records.map((r) => r.text);
      const allEntities = extractEntitiesBatch(allTexts);
      const globalEntities = {};
      for (let idx = 0; idx < records.length; idx++) {
        const memoryId = records[idx].memoryId;
        const entities = idx < allEntities.length ? allEntities[idx] : [];
        for (const entity of entities) {
          const key = entity.text.trim().toLowerCase();
          if (key in globalEntities) {
            globalEntities[key].memoryIds.add(memoryId);
          } else {
            globalEntities[key] = {
              entityType: entity.type,
              entityText: entity.text,
              memoryIds: /* @__PURE__ */ new Set([memoryId])
            };
          }
        }
      }
      const orderedKeys = Object.keys(globalEntities);
      if (orderedKeys.length > 0) {
        const entityTexts = orderedKeys.map(
          (k) => globalEntities[k].entityText
        );
        let entityEmbeddings;
        try {
          entityEmbeddings = await this.embedder.embedBatch(entityTexts, "add");
        } catch (e) {
          entityEmbeddings = [];
          for (const t of entityTexts) {
            try {
              entityEmbeddings.push(await this.embedder.embed(t, "add"));
            } catch (e2) {
              entityEmbeddings.push(null);
            }
          }
        }
        const valid = [];
        for (let i = 0; i < orderedKeys.length; i++) {
          if (entityEmbeddings[i] !== null) {
            valid.push({ index: i, key: orderedKeys[i] });
          }
        }
        if (valid.length > 0) {
          const entityStore = await this.getEntityStore();
          const exactMatches = await this._existingEntitiesByText(
            entityStore,
            filters
          );
          const toInsertVectors = [];
          const toInsertIds = [];
          const toInsertPayloads = [];
          for (const { index: j, key } of valid) {
            const { entityType, entityText, memoryIds } = globalEntities[key];
            const entityVec = entityEmbeddings[j];
            let matches = [];
            const exactMatch = exactMatches.get(key);
            if (!exactMatch) {
              try {
                matches = await entityStore.search(entityVec, 1, filters);
              } catch (e) {
              }
            }
            const semanticMatch = matches.length > 0 && ((_f = matches[0].score) != null ? _f : 0) >= 0.95 ? matches[0] : void 0;
            const match = exactMatch != null ? exactMatch : semanticMatch;
            if (match) {
              const payload = match.payload || {};
              const linked = new Set((_g = payload.linkedMemoryIds) != null ? _g : []);
              for (const mid of memoryIds) linked.add(mid);
              payload.linkedMemoryIds = Array.from(linked).sort();
              try {
                await entityStore.update(match.id, entityVec, payload);
              } catch (e) {
                console.debug(`Entity update failed for '${entityText}': ${e}`);
              }
            } else {
              const entityPayload = {
                data: entityText,
                entityType,
                linkedMemoryIds: Array.from(memoryIds).sort()
              };
              if (filters.user_id) entityPayload.user_id = filters.user_id;
              if (filters.agent_id) entityPayload.agent_id = filters.agent_id;
              if (filters.run_id) entityPayload.run_id = filters.run_id;
              toInsertVectors.push(entityVec);
              toInsertIds.push(uuidv45());
              toInsertPayloads.push(entityPayload);
            }
          }
          if (toInsertVectors.length > 0) {
            try {
              await entityStore.insert(
                toInsertVectors,
                toInsertIds,
                toInsertPayloads
              );
            } catch (e) {
              console.warn(`Batch entity insert failed: ${e}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Batch entity linking failed: ${e}`);
    }
    if (typeof this.db.saveMessages === "function") {
      try {
        await this.db.saveMessages(
          messages.map((m) => ({
            role: m.role,
            content: m.content
          })),
          sessionScope
        );
      } catch (e) {
      }
    }
    return records.map((r) => ({
      id: r.memoryId,
      memory: r.text,
      metadata: { event: "ADD" }
    }));
  }
  async get(memoryId) {
    await this._ensureInitialized();
    const memory = await this.vectorStore.get(memoryId);
    if (!memory) {
      await this._displayFirstRunNotice("get");
      return null;
    }
    const filters = {
      ...memory.payload.user_id && { user_id: memory.payload.user_id },
      ...memory.payload.agent_id && { agent_id: memory.payload.agent_id },
      ...memory.payload.run_id && { run_id: memory.payload.run_id }
    };
    const memoryItem = {
      id: memory.id,
      memory: memory.payload.data,
      hash: memory.payload.hash,
      createdAt: memory.payload.createdAt,
      updatedAt: memory.payload.updatedAt,
      metadata: {}
    };
    for (const [key, value] of Object.entries(memory.payload)) {
      if (!PAYLOAD_METADATA_EXCLUDED_KEYS.has(key)) {
        memoryItem.metadata[key] = value;
      }
    }
    const result = {
      ...memoryItem,
      ...filters,
      ...memory.payload.attributedTo && {
        attributedTo: memory.payload.attributedTo
      }
    };
    await this._displayFirstRunNotice("get");
    return result;
  }
  async search(query, config) {
    var _a2, _b2, _c, _d, _e;
    if ((config == null ? void 0 : config.referenceDate) !== void 0) {
      await this._getNoticeTelemetryId();
      throw new Error(
        await getTemporalFeatureErrorMessage(this, {
          triggerFunction: "search",
          triggerParameter: "referenceDate"
        })
      );
    }
    const temporalUsageNotice = detectTemporalUsageFromSearch(
      query,
      config == null ? void 0 : config.filters
    );
    rejectTopLevelEntityParams(config, "search");
    validateSearchParams(config.threshold, config.topK);
    const normalizedFilters = config.filters ? Object.fromEntries(
      Object.entries({
        ...config.filters,
        user_id: validateAndTrimEntityId(config.filters.user_id, "user_id"),
        agent_id: validateAndTrimEntityId(
          config.filters.agent_id,
          "agent_id"
        ),
        run_id: validateAndTrimEntityId(config.filters.run_id, "run_id")
      }).filter(([, v]) => v !== void 0)
    ) : {};
    await this._ensureInitialized();
    const {
      topK = 20,
      threshold = 0.1,
      explain = false,
      showExpired = false
    } = config;
    await this._captureEvent("search", {
      query_length: query.length,
      topK,
      has_filters: !!config.filters
    });
    let effectiveFilters = { ...normalizedFilters };
    if (this._hasAdvancedOperators(effectiveFilters)) {
      const processedFilters = this._processMetadataFilters(effectiveFilters);
      for (const logicalKey of ["AND", "OR", "NOT"]) {
        delete effectiveFilters[logicalKey];
      }
      for (const fk of Object.keys(effectiveFilters)) {
        if (!["AND", "OR", "NOT", "user_id", "agent_id", "run_id"].includes(fk) && typeof effectiveFilters[fk] === "object" && effectiveFilters[fk] !== null) {
          delete effectiveFilters[fk];
        }
      }
      effectiveFilters = { ...effectiveFilters, ...processedFilters };
    }
    if (!effectiveFilters.user_id && !effectiveFilters.agent_id && !effectiveFilters.run_id) {
      throw new Error(
        "filters must contain at least one of: user_id, agent_id, run_id. Example: filters: { user_id: 'u1' }"
      );
    }
    const searchStartMs = Date.now();
    const queryLemmatized = lemmatizeForBm25(query);
    const queryEntities = extractEntities(query);
    const queryEmbedding = await this.embedder.embed(query, "search");
    const internalLimit = Math.max(topK * 4, 60);
    const semanticResults = await this.vectorStore.search(
      queryEmbedding,
      internalLimit,
      effectiveFilters
    );
    let keywordResults = null;
    if (typeof this.vectorStore.keywordSearch === "function") {
      try {
        keywordResults = (_a2 = await this.vectorStore.keywordSearch(
          queryLemmatized,
          internalLimit,
          effectiveFilters
        )) != null ? _a2 : null;
      } catch (e) {
        keywordResults = null;
      }
    }
    const bm25Scores = {};
    if (keywordResults) {
      const [midpoint, steepness] = getBm25Params(query, queryLemmatized);
      for (const mem of keywordResults) {
        const memId = String(mem.id);
        const rawScore = (_b2 = mem.score) != null ? _b2 : 0;
        if (rawScore > 0) {
          bm25Scores[memId] = normalizeBm25(rawScore, midpoint, steepness);
        }
      }
    }
    const entityBoosts = {};
    if (!this.components.disableEntityBoost && queryEntities.length > 0) {
      try {
        const seen = /* @__PURE__ */ new Set();
        const deduped = [];
        for (const entity of queryEntities.slice(0, 8)) {
          const key = entity.text.trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            deduped.push(entity);
          }
        }
        if (deduped.length > 0) {
          const entityStore = await this.getEntityStore();
          const entitySearchFilters = {};
          for (const k of ["user_id", "agent_id", "run_id"]) {
            if (effectiveFilters[k])
              entitySearchFilters[k] = effectiveFilters[k];
          }
          const entityTexts = deduped.map((e) => e.text);
          const embeddings = await this.embedder.embedBatch(
            entityTexts,
            "search"
          );
          if (embeddings.length !== entityTexts.length) {
            console.warn(
              `embedBatch returned ${embeddings.length} vectors for ${entityTexts.length} texts \u2014 skipping entity boost`
            );
          } else {
            const searchResults = await Promise.allSettled(
              deduped.map(
                (_, i) => entityStore.search(embeddings[i], 500, entitySearchFilters)
              )
            );
            for (const result2 of searchResults) {
              if (result2.status === "rejected") {
                console.warn(
                  "Entity boost search failed for one entity:",
                  result2.reason
                );
                continue;
              }
              for (const match of result2.value) {
                const similarity = (_c = match.score) != null ? _c : 0;
                if (similarity < 0.5) continue;
                const payload = match.payload || {};
                const linkedMemoryIds = (_d = payload.linkedMemoryIds) != null ? _d : [];
                if (!Array.isArray(linkedMemoryIds)) continue;
                const numLinked = Math.max(linkedMemoryIds.length, 1);
                const memoryCountWeight = 1 / (1 + 1e-3 * (numLinked - 1) ** 2);
                const boost = similarity * ENTITY_BOOST_WEIGHT * memoryCountWeight;
                for (const memoryId of linkedMemoryIds) {
                  if (memoryId) {
                    const memKey = String(memoryId);
                    entityBoosts[memKey] = Math.max(
                      (_e = entityBoosts[memKey]) != null ? _e : 0,
                      boost
                    );
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("Entity boost computation failed:", e);
      }
    }
    const candidates = semanticResults.filter((mem) => showExpired || !payloadIsExpired(mem.payload)).map((mem) => {
      var _a3;
      return {
        id: String(mem.id),
        score: (_a3 = mem.score) != null ? _a3 : 0,
        payload: mem.payload || {}
      };
    });
    const scoredResults = scoreAndRank(
      candidates,
      bm25Scores,
      entityBoosts,
      threshold != null ? threshold : 0.1,
      topK,
      explain
    );
    const results = scoredResults.filter((scored) => {
      var _a3;
      return (_a3 = scored.payload) == null ? void 0 : _a3.data;
    }).map((scored) => {
      const payload = scored.payload || {};
      return {
        id: scored.id,
        memory: payload.data,
        hash: payload.hash,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        score: scored.score,
        metadata: Object.entries(payload).filter(([key]) => !PAYLOAD_METADATA_EXCLUDED_KEYS.has(key)).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
        ...payload.user_id && { user_id: payload.user_id },
        ...payload.agent_id && { agent_id: payload.agent_id },
        ...payload.run_id && { run_id: payload.run_id },
        ...payload.attributedTo && { attributedTo: payload.attributedTo },
        ...scored.scoreDetails && { score_details: scored.scoreDetails }
      };
    });
    const invokeReranker = Boolean(
      config.rerank && this.reranker && results.length > 0
    );
    let finalResults = results;
    if (invokeReranker) {
      try {
        const ranked = await this.reranker.rerank(
          query,
          results.map((r) => r.memory),
          topK
        );
        finalResults = ranked.map((r) => ({
          ...results[r.index],
          rerankScore: r.rerankScore
        }));
      } catch (e) {
        console.warn(`Reranking failed, using original results: ${e}`);
      }
    }
    const result = {
      results: finalResults
    };
    const searchElapsedMs = Date.now() - searchStartMs;
    if (temporalUsageNotice) {
      await this._displayTemporalUsageNotice({
        triggerFunction: "search",
        triggerSource: temporalUsageNotice.triggerSource,
        triggerReason: temporalUsageNotice.triggerReason
      });
    } else {
      const scaleThresholdNotice = detectScaleThresholdFromTopK(topK);
      if (scaleThresholdNotice) {
        await this._displayScaleThresholdNotice({
          triggerFunction: "search",
          ...scaleThresholdNotice
        });
      } else {
        const performanceSlowQueryNotice = detectPerformanceSlowQuery(
          searchElapsedMs,
          topK,
          results.length
        );
        if (performanceSlowQueryNotice) {
          await this._displayPerformanceSlowQueryNotice({
            triggerFunction: "search",
            triggerReason: "slow_query",
            ...performanceSlowQueryNotice
          });
        } else {
          await this._displayFirstRunNotice("search");
        }
      }
    }
    return result;
  }
  async update(memoryId, config) {
    await this._ensureInitialized();
    await this._captureEvent("update", { memory_id: memoryId });
    const options = typeof config === "string" ? { text: config } : config;
    const { data, metadata, expirationDate } = options;
    let text = options.text;
    if (data != null) {
      logger.warn(
        "The `data` option of update() is deprecated and will be removed in the next major release. Use `text` instead."
      );
      if (text == null) {
        text = data;
      }
    }
    if (text == null && metadata == null && expirationDate === void 0) {
      throw new Error(
        "At least one of text, metadata, or expirationDate must be provided."
      );
    }
    const updateMetadata = { ...metadata };
    if (expirationDate !== void 0) {
      updateMetadata.expiration_date = expirationDate === null ? null : normalizeExpirationDate(expirationDate);
    }
    const existingEmbeddings = {};
    if (text != null) {
      existingEmbeddings[text] = await this.embedder.embed(text, "update");
    }
    await this.updateMemory(memoryId, text, existingEmbeddings, updateMetadata);
    const result = { message: "Memory updated successfully!" };
    await this._displayFirstRunNotice("update");
    return result;
  }
  async delete(memoryId) {
    await this._ensureInitialized();
    await this._captureEvent("delete", { memory_id: memoryId });
    await this.deleteMemory(memoryId);
    const result = { message: "Memory deleted successfully!" };
    const deleteCount = getDecayUsageDeleteCountAfterSuccess();
    if (isDecayUsageDeleteEligible(deleteCount)) {
      await this._displayDecayUsageNotice({
        triggerFunction: "delete",
        triggerSource: "delete_count",
        triggerReason: "repeated_deletes",
        deleteCount
      });
    } else {
      await this._displayFirstRunNotice("delete");
    }
    return result;
  }
  async deleteAll(config) {
    await this._ensureInitialized();
    await this._captureEvent("delete_all", {
      has_user_id: !!config.userId,
      has_agent_id: !!config.agentId,
      has_run_id: !!config.runId
    });
    const userId = validateAndTrimEntityId(config.userId, "userId");
    const agentId = validateAndTrimEntityId(config.agentId, "agentId");
    const runId = validateAndTrimEntityId(config.runId, "runId");
    const filters = {};
    if (userId) filters.user_id = userId;
    if (agentId) filters.agent_id = agentId;
    if (runId) filters.run_id = runId;
    if (!Object.keys(filters).length) {
      throw new Error(
        "At least one filter is required to delete all memories. If you want to delete all memories, use the `reset()` method."
      );
    }
    let deletedCount = 0;
    const seenBatches = /* @__PURE__ */ new Set();
    while (true) {
      const [batch] = await this.vectorStore.list(
        filters,
        DELETE_ALL_BATCH_SIZE
      );
      if (!batch.length) {
        break;
      }
      const batchKey = batch.map((memory) => String(memory.id)).sort().join(",");
      if (seenBatches.has(batchKey)) {
        logger.warn("Stopping deleteAll after a repeated memory batch");
        break;
      }
      seenBatches.add(batchKey);
      for (const memory of batch) {
        await this.deleteMemory(memory.id);
      }
      deletedCount += batch.length;
    }
    const result = { message: "Memories deleted successfully!" };
    if (deletedCount > 0) {
      await this._displayDecayUsageNotice({
        triggerFunction: "delete_all",
        triggerSource: "delete_all",
        triggerReason: "bulk_delete",
        deletedCount
      });
    } else {
      await this._displayFirstRunNotice("delete_all");
    }
    return result;
  }
  async history(memoryId) {
    await this._ensureInitialized();
    const result = await this.db.getHistory(memoryId);
    await this._displayFirstRunNotice("history");
    return result;
  }
  async reset() {
    await this._ensureInitialized();
    await this._captureEvent("reset");
    await this.db.reset();
    if (this.config.vectorStore.provider !== "langchain") {
      try {
        await this.vectorStore.deleteCol();
      } catch (e) {
        console.error(
          `Failed to delete collection for provider '${this.config.vectorStore.provider}':`,
          e
        );
      }
    } else {
      console.warn(
        "Memory.reset(): Skipping vector store collection deletion as 'langchain' provider is used. Underlying Langchain vector store data is not cleared by this operation."
      );
    }
    if (this._entityStore) {
      try {
        await this._entityStore.deleteCol();
      } catch (e) {
      }
      this._entityStore = void 0;
    }
    this.embedder = this.components?.embedder ?? EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config
    );
    this.llm = this.components?.llm ?? LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config
    );
    this._initError = void 0;
    this._initPromise = this._autoInitialize().catch((error) => {
      this._initError = error instanceof Error ? error : new Error(String(error));
      console.error(this._initError);
    });
    await this._initPromise;
    await this._displayFirstRunNotice("reset");
  }
  async getAll(config) {
    var _a2, _b2, _c;
    rejectTopLevelEntityParams(config, "getAll");
    validateSearchParams(void 0, config.topK);
    await this._ensureInitialized();
    const { topK = 20, showExpired = false } = config;
    const filters = Object.fromEntries(
      Object.entries({
        ...config.filters || {},
        user_id: validateAndTrimEntityId((_a2 = config.filters) == null ? void 0 : _a2.user_id, "user_id"),
        agent_id: validateAndTrimEntityId((_b2 = config.filters) == null ? void 0 : _b2.agent_id, "agent_id"),
        run_id: validateAndTrimEntityId((_c = config.filters) == null ? void 0 : _c.run_id, "run_id")
      }).filter(([, v]) => v !== void 0)
    );
    await this._captureEvent("get_all", {
      topK,
      has_user_id: !!filters.user_id,
      has_agent_id: !!filters.agent_id,
      has_run_id: !!filters.run_id
    });
    if (!filters.user_id && !filters.agent_id && !filters.run_id) {
      throw new Error(
        "filters must contain at least one of: user_id, agent_id, run_id. Example: filters: { user_id: 'u1' }"
      );
    }
    const fetchLimit = showExpired ? topK : Math.max(topK * 4, 60);
    const [memories] = await this.vectorStore.list(filters, fetchLimit);
    const visibleMemories = showExpired ? memories : memories.filter((mem) => !payloadIsExpired(mem.payload));
    const results = visibleMemories.slice(0, topK).map((mem) => ({
      id: mem.id,
      memory: mem.payload.data,
      hash: mem.payload.hash,
      createdAt: mem.payload.createdAt,
      updatedAt: mem.payload.updatedAt,
      metadata: Object.entries(mem.payload).filter(([key]) => !PAYLOAD_METADATA_EXCLUDED_KEYS.has(key)).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
      ...mem.payload.user_id && { user_id: mem.payload.user_id },
      ...mem.payload.agent_id && { agent_id: mem.payload.agent_id },
      ...mem.payload.run_id && { run_id: mem.payload.run_id },
      ...mem.payload.attributedTo && {
        attributedTo: mem.payload.attributedTo
      }
    }));
    const result = { results };
    const scaleThresholdNotice = detectScaleThresholdFromTopK(topK);
    if (scaleThresholdNotice) {
      await this._displayScaleThresholdNotice({
        triggerFunction: "get_all",
        ...scaleThresholdNotice
      });
    } else {
      await this._displayFirstRunNotice("get_all");
    }
    return result;
  }
  async createMemory(data, existingEmbeddings, metadata) {
    const memoryId = this.components.idFor ? this.components.idFor(metadata) : uuidv45();
    const embedding = Object.prototype.hasOwnProperty.call(
      existingEmbeddings,
      data
    ) ? existingEmbeddings[data] : await this.embedder.embed(data, "add");
    const memoryMetadata = {
      ...metadata,
      data,
      hash: createHash2("md5").update(data).digest("hex"),
      textLemmatized: lemmatizeForBm25(data),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.vectorStore.insert([embedding], [memoryId], [memoryMetadata]);
    await this.db.addHistory(
      memoryId,
      null,
      data,
      "ADD",
      memoryMetadata.createdAt
    );
    return memoryId;
  }
  async updateMemory(memoryId, data, existingEmbeddings, metadata = {}) {
    const existingMemory = await this.vectorStore.get(memoryId);
    if (!existingMemory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }
    const prevValue = existingMemory.payload.data;
    const newData = data != null ? data : prevValue;
    if (typeof newData !== "string") {
      throw new Error(
        `Memory with ID ${memoryId} does not have text content to update`
      );
    }
    const textChanged = newData !== prevValue;
    const embedding = Object.prototype.hasOwnProperty.call(
      existingEmbeddings,
      newData
    ) ? existingEmbeddings[newData] : await this.embedder.embed(newData, "update");
    const sanitizedMetadata = stripIdentityKeys(metadata);
    const newMetadata = {
      ...existingMemory.payload,
      ...sanitizedMetadata,
      data: newData,
      hash: createHash2("md5").update(newData).digest("hex"),
      textLemmatized: lemmatizeForBm25(newData),
      createdAt: existingMemory.payload.createdAt,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.vectorStore.update(memoryId, embedding, newMetadata);
    await this.db.addHistory(
      memoryId,
      prevValue,
      newData,
      "UPDATE",
      newMetadata.createdAt,
      newMetadata.updatedAt
    );
    if (textChanged) {
      try {
        const sessionFilters = this._sessionFiltersFromPayload(newMetadata);
        await this._removeMemoryFromEntityStore(memoryId, sessionFilters);
        await this._linkEntitiesForMemory(memoryId, newData, sessionFilters);
      } catch (e) {
        console.warn(`Entity store cleanup/link failed during update: ${e}`);
      }
    }
    return memoryId;
  }
  async deleteMemory(memoryId) {
    const existingMemory = await this.vectorStore.get(memoryId);
    if (!existingMemory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }
    const prevValue = existingMemory.payload.data;
    const sessionFilters = this._sessionFiltersFromPayload(
      existingMemory.payload || {}
    );
    await this.vectorStore.delete(memoryId);
    await this.db.addHistory(
      memoryId,
      prevValue,
      null,
      "DELETE",
      void 0,
      void 0,
      1
    );
    try {
      await this._removeMemoryFromEntityStore(memoryId, sessionFilters);
    } catch (e) {
      console.warn(`Entity store cleanup failed during delete: ${e}`);
    }
    return memoryId;
  }
  /**
   * Check if filters contain advanced operators that need special processing.
   */
  _hasAdvancedOperators(filters) {
    if (!filters || typeof filters !== "object") {
      return false;
    }
    for (const [key, value] of Object.entries(filters)) {
      if (key === "AND" || key === "OR" || key === "NOT") {
        return true;
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const op of Object.keys(value)) {
          if ([
            "eq",
            "ne",
            "gt",
            "gte",
            "lt",
            "lte",
            "in",
            "nin",
            "contains",
            "icontains"
          ].includes(op)) {
            return true;
          }
        }
      }
      if (value === "*") {
        return true;
      }
    }
    return false;
  }
  /**
   * Process enhanced metadata filters and convert them to vector store compatible format.
   * Converts AND/OR/NOT to $or/$not format that vector stores can interpret.
   */
  _processMetadataFilters(metadataFilters) {
    const processedFilters = {};
    const processCondition = (key, condition) => {
      if (typeof condition !== "object" || condition === null) {
        if (condition === "*") {
          return { [key]: "*" };
        }
        return { [key]: condition };
      }
      if (Array.isArray(condition)) {
        return { [key]: { in: condition } };
      }
      const result = {};
      const operatorMap = {
        eq: "eq",
        ne: "ne",
        gt: "gt",
        gte: "gte",
        lt: "lt",
        lte: "lte",
        in: "in",
        nin: "nin",
        contains: "contains",
        icontains: "icontains"
      };
      for (const [operator, value] of Object.entries(condition)) {
        if (operator in operatorMap) {
          if (!result[key]) {
            result[key] = {};
          }
          result[key][operatorMap[operator]] = value;
        } else {
          throw new Error(`Unsupported metadata filter operator: ${operator}`);
        }
      }
      return result;
    };
    for (const [key, value] of Object.entries(metadataFilters)) {
      if (key === "AND") {
        if (!Array.isArray(value)) {
          throw new Error("AND operator requires a list of conditions");
        }
        for (const condition of value) {
          for (const [subKey, subValue] of Object.entries(condition)) {
            Object.assign(processedFilters, processCondition(subKey, subValue));
          }
        }
      } else if (key === "OR") {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(
            "OR operator requires a non-empty list of conditions"
          );
        }
        processedFilters["$or"] = [];
        for (const condition of value) {
          const orCondition = {};
          for (const [subKey, subValue] of Object.entries(
            condition
          )) {
            Object.assign(orCondition, processCondition(subKey, subValue));
          }
          processedFilters["$or"].push(orCondition);
        }
      } else if (key === "NOT") {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(
            "NOT operator requires a non-empty list of conditions"
          );
        }
        processedFilters["$not"] = [];
        for (const condition of value) {
          const notCondition = {};
          for (const [subKey, subValue] of Object.entries(
            condition
          )) {
            Object.assign(notCondition, processCondition(subKey, subValue));
          }
          processedFilters["$not"].push(notCondition);
        }
      } else {
        Object.assign(processedFilters, processCondition(key, value));
      }
    }
    return processedFilters;
  }
};
export {
  AWSBedrockEmbedder,
  AWSBedrockLLM,
  AnthropicLLM,
  AzureAISearch,
  AzureMySQLDB,
  AzureOpenAIEmbedder,
  BaiduDB,
  CassandraDB,
  CohereReranker,
  CrossEncoderReranker,
  DatabricksVectorStore,
  ElasticsearchDB,
  EmbedderFactory,
  FastEmbedEmbedder,
  GoogleEmbedder,
  GoogleLLM,
  GroqLLM,
  HistoryManagerFactory,
  HuggingFaceEmbedder,
  LLMError,
  LLMFactory,
  LLMReranker,
  LMStudioEmbedder,
  LMStudioLLM,
  LangchainEmbedder,
  LangchainLLM,
  LangchainVectorStore,
  LiteLLM,
  Memory,
  MemoryConfigSchema,
  MemoryVectorStore,
  Milvus,
  MistralLLM,
  MongoDB,
  NeptuneAnalyticsVectorStore,
  OllamaEmbedder,
  OllamaLLM,
  OpenAIEmbedder,
  OpenAILLM,
  OpenAIStructuredLLM,
  OpenSearchDB,
  OracleAIVectorSearch,
  PGVector,
  PineconeDB,
  Qdrant,
  RedisDB,
  RerankerFactory,
  S3Vectors,
  SupabaseDB,
  TogetherEmbedder,
  TurbopufferDB,
  UpstashVector,
  ValkeyDB,
  VectorStoreFactory,
  VectorizeDB,
  VertexAIEmbedder,
  VertexAIVectorSearch,
  VllmLLM,
  WeaviateDB,
  ZeroEntropyReranker,
  buildFilterConditions,
  buildFilterGroup,
  buildRedisFilterExpr,
  buildWhereClause,
  extractProvider,
  quoteIdentifier
};
