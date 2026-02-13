/**
 * Monad blockchain provider implementation
 *
 * Uses Alchemy SDK for EVM blockchain interactions
 *
 * Dependencies to install:
 * - alchemy-sdk
 * - ethers (v6)
 */

import { BlockchainProvider, BlockchainTransaction } from './types';

// These will be installed later
// import { Alchemy, Network, AlchemySettings } from 'alchemy-sdk';
// For now, use type-only imports to avoid errors
type Alchemy = any;
type AlchemySettings = any;

const NAD_FUN_BONDING_CURVE = '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE';
const NAD_FUN_ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';

export class MonadProvider implements BlockchainProvider {
  readonly chain = 'monad' as const;
  private alchemy: Alchemy;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    // TODO: Initialize Alchemy SDK once installed
    // const settings: AlchemySettings = {
    //   apiKey,
    //   network: 'monad-mainnet', // Custom network config needed
    // };
    // this.alchemy = new Alchemy(settings);

    console.warn('MonadProvider: Alchemy SDK not yet initialized (needs installation)');
  }

  async getSignaturesForAddress(
    address: string,
    options?: { limit?: number; before?: string }
  ): Promise<string[]> {
    // Use Alchemy's getAssetTransfers to find transactions
    // Filter for interactions with nad.fun contracts

    // TODO: Implement with Alchemy SDK
    // const transfers = await this.alchemy.core.getAssetTransfers({
    //   fromAddress: address,
    //   toAddress: NAD_FUN_ROUTER,
    //   category: ['external', 'erc20', 'internal'],
    //   maxCount: options?.limit ?? 50,
    //   pageKey: options?.before,
    // });
    //
    // // Extract unique transaction hashes
    // const hashes = new Set<string>();
    // for (const transfer of transfers.transfers) {
    //   if (transfer.hash) {
    //     hashes.add(transfer.hash);
    //   }
    // }
    //
    // return Array.from(hashes);

    console.warn(`MonadProvider.getSignaturesForAddress(${address}) - not yet implemented`);
    return [];
  }

  async getEnhancedTransaction(signature: string): Promise<BlockchainTransaction> {
    // Fetch transaction + receipt with logs

    // TODO: Implement with Alchemy SDK
    // const [tx, receipt] = await Promise.all([
    //   this.alchemy.core.getTransaction(signature),
    //   this.alchemy.core.getTransactionReceipt(signature),
    // ]);
    //
    // if (!tx) {
    //   throw new Error(`Transaction not found: ${signature}`);
    // }
    //
    // return {
    //   signature,
    //   timestamp: tx.timestamp ?? Math.floor(Date.now() / 1000),
    //   feePayer: tx.from,
    //   logs: receipt?.logs ?? [],
    //   rawData: { tx, receipt },
    // };

    throw new Error(`MonadProvider.getEnhancedTransaction(${signature}) - not yet implemented`);
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
    // Set up Alchemy webhook for address monitoring
    // Use Alchemy's Notify API to create webhook

    // TODO: Implement with Alchemy Notify API
    // const webhookUrl = 'https://api.pumpmyclaw.com/webhooks/alchemy';
    //
    // // Alchemy webhook creation via REST API
    // const res = await fetch(`https://dashboard.alchemy.com/api/create-webhook`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-Alchemy-Token': this.apiKey,
    //   },
    //   body: JSON.stringify({
    //     network: 'MONAD_MAINNET',
    //     webhook_type: 'ADDRESS_ACTIVITY',
    //     webhook_url: webhookUrl,
    //     addresses: [walletAddress, NAD_FUN_ROUTER],
    //   }),
    // });
    //
    // if (!res.ok) {
    //   throw new Error(`Alchemy webhook creation failed: ${res.status}`);
    // }

    console.warn(`MonadProvider.addWalletToWebhook(${walletAddress}) - not yet implemented`);
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
