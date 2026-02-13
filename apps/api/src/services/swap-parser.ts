import type { Chain } from './blockchain/types';
import { parseMonadSwap as parseMonadSwapImpl } from './blockchain/monad-swap-parser';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Chain-agnostic unified interface
export interface ParsedSwap {
  signature: string;
  blockTime: Date;
  platform: string;
  walletAddress: string;
  tradeType: 'buy' | 'sell';
  // New chain-agnostic fields
  tokenInAddress: string;
  tokenInAmount: string;
  tokenOutAddress: string;
  tokenOutAmount: string;
  baseAssetAmount: string; // SOL or MON amount
  isBuyback: boolean;
  // DEPRECATED: Solana-specific (kept for backward compatibility)
  tokenInMint?: string;
  tokenOutMint?: string;
  solAmount?: string;
}

/**
 * Chain-agnostic swap parser
 * Delegates to chain-specific parsers based on chain parameter
 */
export function parseSwapPayload(
  tx: any,
  chain: Chain,
  agentWallet: string,
  agentTokenAddress: string | null,
): ParsedSwap | null {
  switch (chain) {
    case 'solana':
      return parseSolanaSwap(tx, agentWallet, agentTokenAddress ?? '');
    case 'monad':
      return parseMonadSwap(tx, agentWallet, agentTokenAddress);
    default:
      console.error(`Unknown chain: ${chain}`);
      return null;
  }
}

/**
 * Parse Monad transaction (wraps monad-swap-parser)
 */
function parseMonadSwap(
  tx: any,
  agentWallet: string,
  agentTokenAddress: string | null,
): ParsedSwap | null {
  return parseMonadSwapImpl(tx, agentWallet, agentTokenAddress);
}

/**
 * Unified Solana swap parser — handles BOTH formats:
 * 1. Webhook format: events.swap with nativeInput/tokenOutputs (Helius webhooks)
 * 2. API format: accountData with tokenBalanceChanges + nativeBalanceChange (Helius enhanced tx API)
 */
export function parseSolanaSwap(
  tx: any,
  agentWallet: string,
  agentTokenMint: string,
): ParsedSwap | null {
  // Skip failed transactions
  if (tx.transactionError) return null;

  const signature = tx.signature;
  const blockTime = new Date((tx.timestamp ?? 0) * 1000);
  const platform =
    tx.events?.swap?.innerSwaps?.[0]?.programInfo?.source ??
    tx.source ??
    'UNKNOWN';

  // Try webhook format first (events.swap populated by Helius webhooks)
  const swap = tx.events?.swap;
  if (
    swap &&
    (swap.nativeInput ||
      swap.nativeOutput ||
      swap.tokenInputs?.length ||
      swap.tokenOutputs?.length)
  ) {
    return parseWebhookFormat(
      swap,
      signature,
      blockTime,
      platform,
      agentWallet,
      agentTokenMint,
    );
  }

  // Fallback: parse from accountData + tokenTransfers (API format)
  return parseApiFormat(
    tx,
    signature,
    blockTime,
    platform,
    agentWallet,
    agentTokenMint,
  );
}

/** Parse webhook-format swap (events.swap with nativeInput/tokenOutputs) */
function parseWebhookFormat(
  swap: any,
  signature: string,
  blockTime: Date,
  platform: string,
  agentWallet: string,
  agentTokenMint: string,
): ParsedSwap | null {
  const nativeIn = swap.nativeInput;
  const nativeOut = swap.nativeOutput;
  const tokenIns: any[] = swap.tokenInputs ?? [];
  const tokenOuts: any[] = swap.tokenOutputs ?? [];

  let tokenInMint: string;
  let tokenInAmount: string;
  let tokenOutMint: string;
  let tokenOutAmount: string;
  let solAmount = '0';
  let tradeType: 'buy' | 'sell';

  if (nativeIn && tokenOuts.length > 0) {
    // SOL -> Token (buy)
    tokenInMint = SOL_MINT;
    tokenInAmount = nativeIn.amount;
    tokenOutMint = tokenOuts[0].mint;
    tokenOutAmount = tokenOuts[0].rawTokenAmount.tokenAmount;
    solAmount = nativeIn.amount;
    tradeType = 'buy';
  } else if (tokenIns.length > 0 && nativeOut) {
    // Token -> SOL (sell)
    tokenInMint = tokenIns[0].mint;
    tokenInAmount = tokenIns[0].rawTokenAmount.tokenAmount;
    tokenOutMint = SOL_MINT;
    tokenOutAmount = nativeOut.amount;
    solAmount = nativeOut.amount;
    tradeType = 'sell';
  } else if (tokenIns.length > 0 && tokenOuts.length > 0) {
    // Token -> Token (acquiring output token)
    tokenInMint = tokenIns[0].mint;
    tokenInAmount = tokenIns[0].rawTokenAmount.tokenAmount;
    tokenOutMint = tokenOuts[0].mint;
    tokenOutAmount = tokenOuts[0].rawTokenAmount.tokenAmount;
    solAmount = '0';
    tradeType = 'buy';
  } else {
    return null;
  }

  const isBuyback = tokenOutMint === agentTokenMint;

  return {
    signature,
    blockTime,
    platform,
    walletAddress: agentWallet,
    tradeType,
    // New chain-agnostic fields
    tokenInAddress: tokenInMint,
    tokenInAmount,
    tokenOutAddress: tokenOutMint,
    tokenOutAmount,
    baseAssetAmount: solAmount,
    isBuyback,
    // DEPRECATED: Solana-specific (kept for backward compatibility)
    tokenInMint,
    tokenOutMint,
    solAmount,
  };
}

/**
 * Parse API-format swap (accountData with tokenBalanceChanges + nativeBalanceChange).
 * Used when Helius enhanced tx API returns events: {} (common for pump.fun swaps).
 */
function parseApiFormat(
  tx: any,
  signature: string,
  blockTime: Date,
  platform: string,
  agentWallet: string,
  agentTokenMint: string,
): ParsedSwap | null {
  const accountData: any[] = tx.accountData ?? [];
  const tokenTransfers: any[] = tx.tokenTransfers ?? [];

  // Find our wallet's native SOL balance change
  const ourAccount = accountData.find((a: any) => a.account === agentWallet);
  const solDelta = ourAccount?.nativeBalanceChange ?? 0; // in lamports

  // Find token balance changes for our wallet
  const ourTokenChanges: Array<{
    mint: string;
    amount: string;
    delta: number;
  }> = [];

  for (const acct of accountData) {
    for (const change of acct.tokenBalanceChanges ?? []) {
      if (change.userAccount === agentWallet) {
        const rawAmount = change.rawTokenAmount?.tokenAmount ?? '0';
        ourTokenChanges.push({
          mint: change.mint,
          amount: rawAmount.replace('-', ''),
          delta: parseInt(rawAmount, 10),
        });
      }
    }
  }

  // Fallback: check tokenTransfers if no balance changes found
  if (ourTokenChanges.length === 0) {
    for (const transfer of tokenTransfers) {
      if (transfer.fromUserAccount === agentWallet) {
        const rawAmount = Math.floor(
          transfer.tokenAmount * Math.pow(10, 6),
        ).toString();
        ourTokenChanges.push({
          mint: transfer.mint,
          amount: rawAmount,
          delta: -Math.abs(parseInt(rawAmount, 10)),
        });
      } else if (transfer.toUserAccount === agentWallet) {
        const rawAmount = Math.floor(
          transfer.tokenAmount * Math.pow(10, 6),
        ).toString();
        ourTokenChanges.push({
          mint: transfer.mint,
          amount: rawAmount,
          delta: Math.abs(parseInt(rawAmount, 10)),
        });
      }
    }
  }

  if (ourTokenChanges.length === 0 && solDelta === 0) return null;

  // Determine trade direction from balance changes
  let tradeType: 'buy' | 'sell';
  let tokenInMint: string;
  let tokenInAmount: string;
  let tokenOutMint: string;
  let tokenOutAmount: string;
  let solAmount = '0';

  const tokensSent = ourTokenChanges.filter((c) => c.delta < 0);
  const tokensReceived = ourTokenChanges.filter((c) => c.delta > 0);

  if (solDelta > 0 && tokensSent.length > 0) {
    // Received SOL, sent tokens → SELL
    tradeType = 'sell';
    tokenInMint = tokensSent[0].mint;
    tokenInAmount = tokensSent[0].amount;
    tokenOutMint = SOL_MINT;
    tokenOutAmount = Math.abs(solDelta).toString();
    solAmount = Math.abs(solDelta).toString();
  } else if (solDelta < 0 && tokensReceived.length > 0) {
    // Sent SOL, received tokens → BUY
    tradeType = 'buy';
    tokenInMint = SOL_MINT;
    tokenInAmount = Math.abs(solDelta).toString();
    tokenOutMint = tokensReceived[0].mint;
    tokenOutAmount = tokensReceived[0].amount;
    solAmount = Math.abs(solDelta).toString();
  } else if (tokensSent.length > 0 && tokensReceived.length > 0) {
    // Token-to-token swap
    tradeType = 'buy';
    tokenInMint = tokensSent[0].mint;
    tokenInAmount = tokensSent[0].amount;
    tokenOutMint = tokensReceived[0].mint;
    tokenOutAmount = tokensReceived[0].amount;
    solAmount = '0';
  } else if (tokensSent.length > 0 && solDelta > 0) {
    // Pump.fun sell: sent token, gained SOL (duplicate check for edge case)
    tradeType = 'sell';
    tokenInMint = tokensSent[0].mint;
    tokenInAmount = tokensSent[0].amount;
    tokenOutMint = SOL_MINT;
    tokenOutAmount = Math.abs(solDelta).toString();
    solAmount = Math.abs(solDelta).toString();
  } else {
    return null;
  }

  const isBuyback = tokenOutMint === agentTokenMint;

  return {
    signature,
    blockTime,
    platform,
    walletAddress: agentWallet,
    tradeType,
    // New chain-agnostic fields
    tokenInAddress: tokenInMint,
    tokenInAmount,
    tokenOutAddress: tokenOutMint,
    tokenOutAmount,
    baseAssetAmount: solAmount,
    isBuyback,
    // DEPRECATED: Solana-specific (kept for backward compatibility)
    tokenInMint,
    tokenOutMint,
    solAmount,
  };
}
