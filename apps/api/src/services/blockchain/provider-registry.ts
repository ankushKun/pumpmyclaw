/**
 * Blockchain provider registry
 *
 * Centralized registry for managing blockchain providers across different chains
 */

import { BlockchainProvider, Chain } from './types';
import { SolanaProvider } from './solana-provider';
import { MonadProvider } from './monad-provider';

export class BlockchainProviderRegistry {
  private providers = new Map<Chain, BlockchainProvider>();

  /**
   * Register a blockchain provider
   */
  register(provider: BlockchainProvider): void {
    this.providers.set(provider.chain, provider);
  }

  /**
   * Get a provider by chain
   * @throws Error if provider not found
   */
  get(chain: Chain): BlockchainProvider {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`No provider registered for chain: ${chain}`);
    }
    return provider;
  }

  /**
   * Check if a provider exists for a chain
   */
  has(chain: Chain): boolean {
    return this.providers.has(chain);
  }

  /**
   * Validate an address for a specific chain
   */
  validateAddress(chain: Chain, address: string): boolean {
    try {
      const provider = this.get(chain);
      return provider.validateAddress(address);
    } catch {
      return false;
    }
  }

  /**
   * Get all registered chains
   */
  getSupportedChains(): Chain[] {
    return Array.from(this.providers.keys());
  }
}

/**
 * Create and initialize the provider registry with environment configuration
 */
export function createProviderRegistry(env: {
  HELIUS_API_KEY: string;
  HELIUS_FALLBACK_KEYS?: string;
  ALCHEMY_API_KEY: string;
}): BlockchainProviderRegistry {
  const registry = new BlockchainProviderRegistry();

  // Register Solana provider
  const solanaProvider = new SolanaProvider(
    env.HELIUS_API_KEY,
    env.HELIUS_FALLBACK_KEYS?.split(',').filter(Boolean)
  );
  registry.register(solanaProvider);

  // Register Monad provider
  const monadProvider = new MonadProvider(env.ALCHEMY_API_KEY);
  registry.register(monadProvider);

  return registry;
}

// Export a singleton instance for convenience (optional)
let globalRegistry: BlockchainProviderRegistry | null = null;

export function getGlobalRegistry(): BlockchainProviderRegistry {
  if (!globalRegistry) {
    throw new Error('Global registry not initialized. Call initGlobalRegistry(env) first.');
  }
  return globalRegistry;
}

export function initGlobalRegistry(env: {
  HELIUS_API_KEY: string;
  HELIUS_FALLBACK_KEYS?: string;
  ALCHEMY_API_KEY: string;
}): void {
  globalRegistry = createProviderRegistry(env);
}
