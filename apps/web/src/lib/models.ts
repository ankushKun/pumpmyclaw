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
    id: "openrouter/openai/gpt-oss-120b:free",
    name: "GPT-OSS 120B",
    desc: "Free OpenAI open-source model. May have rate limits.",
    free: true,
    provider: "openrouter",
  },
  // ── OpenAI Codex models (ChatGPT subscription via OAuth) ─────
  {
    id: "openai-codex/gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    desc: "Latest Codex model, 266k context",
    provider: "openai-codex",
    badge: "Recommended",
  },
  {
    id: "openai-codex/gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    desc: "Previous-gen Codex, 266k context",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-5.2",
    name: "GPT-5.2",
    desc: "General-purpose, 266k context",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    desc: "Max-capability Codex, 266k context",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    desc: "Lighter Codex variant, 266k context",
    provider: "openai-codex",
  },
  {
    id: "openai-codex/gpt-5.1",
    name: "GPT-5.1",
    desc: "General-purpose, 266k context",
    provider: "openai-codex",
  },
];

/** Sentinel value for the "enter your own model" option */
export const CUSTOM_MODEL_ID = "__custom__";

/** Get models filtered by provider */
export function getModelsForProvider(provider: LlmProvider): readonly ModelDef[] {
  return MODELS.filter((m) => m.provider === provider);
}

export const DEFAULT_MODEL = MODELS[0].id;
export const DEFAULT_OPENAI_MODEL = "openai-codex/gpt-5.3-codex";

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
