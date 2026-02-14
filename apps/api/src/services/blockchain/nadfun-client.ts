/**
 * nad.fun Agent API client for fetching Monad trades
 * Docs: https://nad.fun/agent-api.md
 */

const API_URL = 'https://api.nadapp.net';

export interface NadFunSwap {
  account_info?: {
    account_id: string;
    nickname: string;
    bio: string;
    image_uri: string;
  };
  swap_info: {
    event_type: 'BUY' | 'SELL';
    transaction_hash: string;
    created_at: number; // Unix timestamp in seconds
    token_id?: string; // Token address (may be missing in API response)
    native_amount: string; // MON amount in wei
    token_amount: string;
    native_price: string;
    value: string;
  };
}

export interface NadFunHolding {
  token_info: {
    token_id: string;
    name: string;
    symbol: string;
    image_uri: string;
    is_graduated: boolean;
  };
  balance_info: {
    balance: string;
  };
}

export interface NadFunCreatedToken {
  token_info: {
    token_id: string;
    name: string;
    symbol: string;
    image_uri: string;
    is_graduated: boolean;
  };
}

export class NadFunClient {
  /**
   * Get all tokens a wallet holds
   */
  async getHoldings(walletAddress: string): Promise<NadFunHolding[]> {
    try {
      const response = await fetch(
        `${API_URL}/agent/holdings/${walletAddress}?limit=100`
      );

      if (!response.ok) {
        console.error(`nad.fun holdings error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.tokens || [];
    } catch (error) {
      console.error('nad.fun getHoldings error:', error);
      return [];
    }
  }

  /**
   * Get all tokens a wallet created
   */
  async getCreatedTokens(walletAddress: string): Promise<NadFunCreatedToken[]> {
    try {
      const response = await fetch(
        `${API_URL}/agent/token/created/${walletAddress}?limit=100`
      );

      if (!response.ok) {
        console.error(`nad.fun created tokens error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.tokens || [];
    } catch (error) {
      console.error('nad.fun getCreatedTokens error:', error);
      return [];
    }
  }

  /**
   * Get swap history for a specific token, optionally filtered by wallet
   */
  async getSwapHistory(
    tokenAddress: string,
    walletAddress?: string,
    limit = 100
  ): Promise<NadFunSwap[]> {
    try {
      // nad.fun API has max limit of 100
      const cappedLimit = Math.min(limit, 100);
      let url = `${API_URL}/agent/swap-history/${tokenAddress}?limit=${cappedLimit}&trade_type=ALL`;
      if (walletAddress) {
        url += `&account_id=${walletAddress}`;
      }

      console.log(`nad.fun: Fetching ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`nad.fun swap-history error: ${response.status} - ${errorText}`);
        console.error(`URL: ${url}`);
        return [];
      }

      const data = await response.json();
      const swaps = data.swaps || [];

      // Add token_id to each swap since it's not included in the API response
      const swapsWithToken = swaps.map((swap: NadFunSwap) => ({
        ...swap,
        swap_info: {
          ...swap.swap_info,
          token_id: tokenAddress,
        },
      }));

      // Debug: log first swap structure
      if (swapsWithToken.length > 0) {
        console.log('[NadFunClient] First swap structure:', JSON.stringify(swapsWithToken[0]).slice(0, 300));
      }

      return swapsWithToken;
    } catch (error) {
      console.error('nad.fun getSwapHistory error:', error);
      return [];
    }
  }

  /**
   * Get all trades for a wallet across all their tokens
   */
  async getAllTradesForWallet(walletAddress: string, limit = 50): Promise<NadFunSwap[]> {
    console.log(`[NadFunClient] getAllTradesForWallet called for ${walletAddress}`);
    try {
      // Get tokens the wallet holds AND tokens they created
      console.log(`[NadFunClient] Fetching holdings and created tokens...`);
      const [holdings, createdTokens] = await Promise.all([
        this.getHoldings(walletAddress),
        this.getCreatedTokens(walletAddress),
      ]);

      // Combine and deduplicate token addresses
      const tokenAddresses = new Set<string>();
      holdings.forEach(h => tokenAddresses.add(h.token_info.token_id));
      createdTokens.forEach(t => tokenAddresses.add(t.token_info.token_id));

      if (tokenAddresses.size === 0) {
        console.log(`[NadFunClient] No holdings or created tokens found for ${walletAddress}`);
        return [];
      }

      console.log(`[NadFunClient] Found ${tokenAddresses.size} unique tokens (${holdings.length} holdings + ${createdTokens.length} created) for ${walletAddress}`);

      // nad.fun API has max limit of 100 per token
      const cappedLimit = Math.min(limit, 100);

      // Get swap history for each token
      const swapPromises = Array.from(tokenAddresses).map((tokenAddress) =>
        this.getSwapHistory(tokenAddress, walletAddress, cappedLimit)
      );

      const swapArrays = await Promise.all(swapPromises);
      const allSwaps = swapArrays.flat();

      // Sort by created_at descending (most recent first)
      allSwaps.sort((a, b) =>
        b.swap_info.created_at - a.swap_info.created_at
      );

      return allSwaps.slice(0, limit);
    } catch (error) {
      console.error('nad.fun getAllTradesForWallet error:', error);
      return [];
    }
  }
}
