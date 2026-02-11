/**
 * Available AI models for OpenClaw instances.
 */
export const MODELS: readonly {
  id: string;
  name: string;
  desc: string;
  free?: boolean;
  badge?: string;
}[] = [
  {
    id: "openrouter/moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    desc: "Great quality at a low cost",
    free: false,
    badge: "Recommended - Best Value",
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    desc: "Top-tier performance, best results",
    free: false,
    badge: "Recommended - Best Performance",
  },
  {
    id: "openrouter/qwen/qwen3-coder:free",
    name: "Qwen3 Coder",
    desc: "Solid free option, 262k context. May have rate limits.",
    free: true,
  },
];

/** Sentinel value for the "enter your own model" option */
export const CUSTOM_MODEL_ID = "__custom__";

export const DEFAULT_MODEL = MODELS[0].id;

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
