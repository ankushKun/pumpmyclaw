/**
 * LLM provider types.
 */
export type LlmProvider = "openrouter" | "openai-codex";

/**
 * Model definition.
 */
export interface ModelDef {
  id: string;
  name: string;
  desc: string;
  free?: boolean;
  badge?: string;
  provider: LlmProvider;
}

/**
 * Available AI models for OpenClaw instances.
 */
export const MODELS: readonly ModelDef[] = [
  // ── OpenRouter models ─────────────────────────────────────────
  {
    id: "openrouter/moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    desc: "Great quality at a low cost",
    free: false,
    badge: "Recommended - Best Value",
    provider: "openrouter",
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    desc: "Top-tier performance, best results",
    free: false,
    badge: "Recommended - Best Performance",
    provider: "openrouter",
  },
  {
    id: "openrouter/qwen/qwen3-coder:free",
    name: "Qwen3 Coder",
    desc: "Solid free option, 262k context. May have rate limits.",
    free: true,
    provider: "openrouter",
  },
  // ── OpenAI Codex models ───────────────────────────────────────
  {
    id: "openai-codex/o4-mini",
    name: "o4-mini",
    desc: "Fast reasoning, great value",
    provider: "openai-codex",
    badge: "Recommended",
  },
  {
    id: "openai-codex/o3",
    name: "o3",
    desc: "Most capable reasoning model",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-4.1",
    name: "GPT-4.1",
    desc: "Best for coding, 1M context",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    desc: "Fast coding model, low cost",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    desc: "Fastest, lowest cost",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/o4-mini-high",
    name: "o4-mini (high)",
    desc: "o4-mini with high reasoning effort",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/codex-mini-latest",
    name: "Codex Mini",
    desc: "Optimized for Codex CLI tasks",
    provider: "openai-codex",
    badge: "Codex",
  },
];

/** Sentinel value for the "enter your own model" option */
export const CUSTOM_MODEL_ID = "__custom__";

/** Get models filtered by provider */
export function getModelsForProvider(provider: LlmProvider): readonly ModelDef[] {
  return MODELS.filter((m) => m.provider === provider);
}

export const DEFAULT_MODEL = MODELS[0].id;
export const DEFAULT_OPENAI_MODEL = "openai-codex/o4-mini";

/**
 * Get the display name for a model ID.
 */
export function getModelName(id: string): string {
  const model = MODELS.find((m) => m.id === id);
  return model?.name || id;
}

/**
 * Check if a model is free.
 */
export function isModelFree(id: string): boolean {
  const model = MODELS.find((m) => m.id === id);
  return model?.free ?? false;
}
