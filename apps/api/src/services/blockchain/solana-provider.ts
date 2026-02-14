/**
 * Solana blockchain provider implementation
 *
 * Wraps HeliusClient to implement the BlockchainProvider interface
 */

import { BlockchainProvider, BlockchainTransaction } from './types';
import { HeliusClient } from '../helius-client';

export class SolanaProvider implements BlockchainProvider {
  readonly chain = 'solana' as const;
  private heliusClient: HeliusClient;

  constructor(apiKey: string, fallbackKeys?: string[]) {
    this.heliusClient = new HeliusClient(apiKey, fallbackKeys);
  }

  async getSignaturesForAddress(
    address: string,
    options?: { limit?: number; before?: string }
  ): Promise<string[]> {
    console.log(`[SolanaProvider] Getting signatures for ${address}`);
    const signatures = await this.heliusClient.getSignaturesForAddress(address, options);
    console.log(`[SolanaProvider] Helius returned ${signatures.length} signatures for ${address}`);
    // Helius returns an array of objects with { signature: string, ... }
    // Extract just the signature strings
    const sigStrings = signatures.map((sig: any) => sig.signature || sig);
    console.log(`[SolanaProvider] Returning ${sigStrings.length} signature strings`);
    return sigStrings;
  }

  async getEnhancedTransaction(signature: string): Promise<BlockchainTransaction> {
    const tx = await this.heliusClient.getEnhancedTransaction(signature);

    if (!tx) {
      throw new Error(`Transaction not found: ${signature}`);
    }

    return this.normalizeTransaction(tx);
  }

  async getEnhancedTransactions(signatures: string[]): Promise<BlockchainTransaction[]> {
    if (signatures.length === 0) return [];

    // Fetch in smaller batches to avoid rate limits (5 sigs per batch with 500ms delay)
    // Helius free tier is very strict on /v0/transactions endpoint
    const BATCH_SIZE = 5;
    const DELAY_MS = 500;
    const transactions: any[] = [];

    console.log(`[SolanaProvider] Fetching ${signatures.length} transactions in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
      const batch = signatures.slice(i, i + BATCH_SIZE);
      const results = await this.heliusClient.getEnhancedTransactions(batch);
      transactions.push(...results);

      console.log(`[SolanaProvider] Fetched batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(signatures.length / BATCH_SIZE)} (${results.length} txs)`);

      // Add delay between batches to avoid hitting rate limits
      if (i + BATCH_SIZE < signatures.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    console.log(`[SolanaProvider] Successfully fetched ${transactions.length}/${signatures.length} transactions`);
    return transactions.filter(Boolean).map(tx => this.normalizeTransaction(tx));
  }

  async addWalletToWebhook(walletAddress: string, webhookSecret: string): Promise<void> {
    await this.heliusClient.addWalletToWebhook(walletAddress, webhookSecret);
  }

  validateAddress(address: string): boolean {
    // Solana addresses are base58-encoded and typically 32-44 characters
    if (!address || address.length < 32 || address.length > 44) {
      return false;
    }

    // Basic base58 character set validation
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(address);
  }

  /**
   * Normalize Helius transaction format to our standard BlockchainTransaction interface
   */
  private normalizeTransaction(tx: any): BlockchainTransaction {
    return {
      signature: tx.signature,
      timestamp: tx.timestamp ?? tx.blockTime ?? Math.floor(Date.now() / 1000),
      feePayer: tx.feePayer,
      logs: tx.logs,
      rawData: tx,
    };
  }
}
