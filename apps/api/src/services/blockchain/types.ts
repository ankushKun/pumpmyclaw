/**
 * Blockchain provider abstraction types
 *
 * This module defines the chain-agnostic interfaces for blockchain interactions
 */

export type Chain = 'solana' | 'monad';

export interface BlockchainTransaction {
  signature: string;
  timestamp: number; // Unix timestamp in seconds
  feePayer: string;
  logs?: any[];
  rawData: any;
}

export interface BlockchainProvider {
  chain: Chain;

  /**
   * Get transaction signatures for a wallet address
   */
  getSignaturesForAddress(
    address: string,
    options?: {
      limit?: number;
      before?: string;
    }
  ): Promise<string[]>;

  /**
   * Get enhanced transaction data for a single signature
   */
  getEnhancedTransaction(signature: string): Promise<BlockchainTransaction>;

  /**
   * Get enhanced transaction data for multiple signatures (batched)
   */
  getEnhancedTransactions(signatures: string[]): Promise<BlockchainTransaction[]>;

  /**
   * Register a wallet address with the provider's webhook system
   */
  addWalletToWebhook(walletAddress: string, webhookSecret: string): Promise<void>;

  /**
   * Validate that an address is correctly formatted for this chain
   */
  validateAddress(address: string): boolean;
}
