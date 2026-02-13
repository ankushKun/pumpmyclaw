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
    const signatures = await this.heliusClient.getSignaturesForAddress(address, options);
    // Helius returns an array of objects with { signature: string, ... }
    // Extract just the signature strings
    return signatures.map((sig: any) => sig.signature || sig);
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

    // Helius supports max 100 signatures per batch
    const transactions: any[] = [];
    for (let i = 0; i < signatures.length; i += 100) {
      const batch = signatures.slice(i, i + 100);
      const results = await this.heliusClient.getEnhancedTransactions(batch);
      transactions.push(...results);
    }

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
