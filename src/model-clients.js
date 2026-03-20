import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

const DEFAULT_CHAT_MODEL = "hf.co/qwen/qwen2.5-coder-3b-instruct-gguf:q4_k_m";
const DEFAULT_EMBEDDING_MODEL = "ai/embeddinggemma:latest";
const DEFAULT_MODEL_RUNNER_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1/";

function parseModelOption(rawValue, fallback) {
  const parsed = Number.parseFloat(String(rawValue ?? fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createChatModel() {
  return new ChatOpenAI({
    model: process.env.MODEL_RUNNER_LLM_CHAT || DEFAULT_CHAT_MODEL,
    apiKey: "",
    configuration: {
      baseURL: process.env.MODEL_RUNNER_BASE_URL || DEFAULT_MODEL_RUNNER_BASE_URL,
    },
    temperature: parseModelOption(process.env.OPTION_TEMPERATURE, 0.0),
    top_p: parseModelOption(process.env.OPTION_TOP_P, 0.5),
    presencePenalty: parseModelOption(process.env.OPTION_PRESENCE_PENALTY, 2.2),
  });
}

export function createEmbeddingsModel() {
  return new OpenAIEmbeddings({
    model: process.env.MODEL_RUNNER_LLM_EMBEDDING || DEFAULT_EMBEDDING_MODEL,
    configuration: {
      baseURL: process.env.MODEL_RUNNER_BASE_URL || DEFAULT_MODEL_RUNNER_BASE_URL,
      apiKey: "",
    },
  });
}
