/**
 * Monad blockchain provider implementation
 *
 * Uses Alchemy SDK for EVM blockchain interactions
 */

import { Alchemy, Network } from 'alchemy-sdk';
import { ethers } from 'ethers';
import { BlockchainProvider, BlockchainTransaction } from './types';
import { NadFunClient } from './nadfun-client';

const NAD_FUN_BONDING_CURVE = '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE';
const NAD_FUN_ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';

export class MonadProvider implements BlockchainProvider {
  readonly chain = 'monad' as const;
  private alchemy: Alchemy;
  private provider: ethers.JsonRpcProvider;
  private apiKey: string;
  private nadFunClient: NadFunClient;
  private swapCache: Map<string, any> = new Map(); // Cache nad.fun swap data by tx hash

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    // Initialize Alchemy SDK with Monad Mainnet RPC
    const alchemyUrl = `https://monad-mainnet.g.alchemy.com/v2/${apiKey}`;

    this.alchemy = new Alchemy({
      apiKey,
      network: Network.ETH_MAINNET, // Use mainnet base
      url: alchemyUrl,
    });

    // Create ethers provider for contract calls
    this.provider = new ethers.JsonRpcProvider(alchemyUrl);

    // Initialize nad.fun API client for trade data
    this.nadFunClient = new NadFunClient();
  }

  async getSignaturesForAddress(
    address: string,
    options?: { limit?: number; before?: string }
  ): Promise<string[]> {
    console.log(`[MonadProvider] Getting signatures for ${address}`);
    try {
      // Use nad.fun Agent API to get trades for this wallet
      // This is much simpler and more reliable than parsing logs
      console.log(`[MonadProvider] Calling nad.fun API...`);
      const swaps = await this.nadFunClient.getAllTradesForWallet(
        address,
        options?.limit ?? 100
      );

      console.log(`[MonadProvider] nad.fun API returned ${swaps.length} trades for ${address}`);

      // Cache swap data by transaction hash for later use in getEnhancedTransactions
      for (const swap of swaps) {
        this.swapCache.set(swap.swap_info.transaction_hash, swap);
      }

      // Extract unique transaction hashes
      const hashes = swaps.map(swap => swap.swap_info.transaction_hash);
      const uniqueHashes = [...new Set(hashes)].slice(0, options?.limit ?? 50);
      console.log(`[MonadProvider] Returning ${uniqueHashes.length} unique transaction hashes`);
      return uniqueHashes;
    } catch (error) {
      console.error(`[MonadProvider] getSignaturesForAddress error:`, error);
      throw error; // Re-throw to see the actual error
    }
  }

  async getEnhancedTransaction(signature: string): Promise<BlockchainTransaction> {
    try {
      // Check if we have nad.fun swap data cached for this transaction
      const nadFunSwap = this.swapCache.get(signature);

      if (nadFunSwap) {
        console.log(`[MonadProvider] Using cached nad.fun swap for ${signature.slice(0, 10)}... created_at:`, nadFunSwap.swap_info?.created_at);

        // Use nad.fun API data directly - no need to fetch from blockchain
        return {
          signature,
          timestamp: nadFunSwap.swap_info.created_at,
          feePayer: nadFunSwap.account_info?.account_id ?? 'unknown',
          logs: [], // No logs needed - we have the swap data
          rawData: { nadFunSwap }, // Include nad.fun data for parser
        };
      }

      // Fallback: fetch from blockchain if not in cache
      // (This shouldn't happen in normal flow but provides a safety net)
      const [tx, receipt] = await Promise.all([
        this.provider.getTransaction(signature),
        this.provider.getTransactionReceipt(signature),
      ]);

      if (!tx) {
        throw new Error(`Transaction not found: ${signature}`);
      }

      // Get block to extract timestamp
      let timestamp = Math.floor(Date.now() / 1000);
      if (tx.blockNumber) {
        try {
          const block = await this.provider.getBlock(tx.blockNumber);
          if (block) {
            timestamp = block.timestamp;
          }
        } catch {
          // If block fetch fails, use current timestamp
        }
      }

      return {
        signature,
        timestamp,
        feePayer: tx.from,
        logs: receipt?.logs ?? [],
        rawData: { tx, receipt },
      };
    } catch (error) {
      console.error(`MonadProvider.getEnhancedTransaction(${signature}) error:`, error);
      throw error;
    }
  }

  async getEnhancedTransactions(signatures: string[]): Promise<BlockchainTransaction[]> {
    if (signatures.length === 0) return [];

    // Fetch all transactions in parallel (Alchemy supports batching)
    const results = await Promise.allSettled(
      signatures.map(sig => this.getEnhancedTransaction(sig))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<BlockchainTransaction> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  async addWalletToWebhook(walletAddress: string, webhookSecret: string): Promise<void> {
    try {
      // Alchemy webhooks need to be configured via dashboard or Notify API
      // For Monad (custom network), webhook setup may require manual configuration
      // This is a placeholder that logs the request

      // In production, you would:
      // 1. Use Alchemy's Notify SDK to create/update webhooks
      // 2. Configure webhook URL: https://api.pumpmyclaw.com/webhooks/alchemy
      // 3. Add address filters for the wallet and nad.fun contracts

      console.log(`MonadProvider: Webhook setup needed for wallet ${walletAddress}`);
      console.log(`  - Configure Alchemy webhook for address activity`);
      console.log(`  - Monitor addresses: ${walletAddress}, ${NAD_FUN_ROUTER}, ${NAD_FUN_BONDING_CURVE}`);
      console.log(`  - Webhook URL: https://api.pumpmyclaw.com/webhooks/alchemy`);
      console.log(`  - Secret: ${webhookSecret.slice(0, 8)}...`);

      // For now, rely on cron polling for Monad trades
      // Webhooks can be added later for real-time updates
    } catch (error) {
      console.error(`MonadProvider.addWalletToWebhook error:`, error);
      // Non-fatal - cron polling will still work
    }
  }

  validateAddress(address: string): boolean {
    // EVM addresses are 0x-prefixed hex strings (42 characters total)
    if (!address || address.length !== 42) {
      return false;
    }

    if (!address.startsWith('0x')) {
      return false;
    }

    // Check if the rest is valid hex
    const hexPart = address.slice(2);
    const hexRegex = /^[a-fA-F0-9]{40}$/;
    return hexRegex.test(hexPart);
  }
}
