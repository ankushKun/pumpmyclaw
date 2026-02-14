/**
 * Monad swap parser for nad.fun contract events
 *
 * Parses CurveBuy and CurveSell events from nad.fun bonding curve contract
 *
 * Dependencies to install:
 * - ethers (v6)
 */

// TODO: Install ethers package
// import { Interface, LogDescription } from 'ethers';

// Temporary type placeholders until ethers is installed
type Interface = any;
type LogDescription = any;

export interface ParsedSwap {
  signature: string;
  blockTime: Date;
  platform: string;
  walletAddress: string;
  tradeType: 'buy' | 'sell';
  tokenInAddress: string;
  tokenInAmount: string;
  tokenOutAddress: string;
  tokenOutAmount: string;
  baseAssetAmount: string; // MON amount in wei
  isBuyback: boolean;
  // DEPRECATED: Solana-specific (optional for Monad)
  tokenInMint?: string;
  tokenOutMint?: string;
  solAmount?: string;
}

// Nad.fun contract addresses
const NAD_FUN_BONDING_CURVE = '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE';
const NAD_FUN_ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';
const WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'; // Wrapped MON

// ABI for nad.fun bonding curve events
const NADFUN_ABI = [
  'event CurveBuy(address indexed to, address indexed token, uint256 actualAmountIn, uint256 effectiveAmountOut)',
  'event CurveSell(address indexed to, address indexed token, uint256 actualAmountIn, uint256 effectiveAmountOut)',
  'event CurveCreate(address indexed creator, address indexed token, address pool, string name, string symbol, string tokenURI, uint256 virtualMonReserve, uint256 virtualTokenReserve, uint256 targetTokenAmount)',
];

// TODO: Initialize once ethers is installed
// const iface = new Interface(NADFUN_ABI);
let iface: Interface | null = null;

function getInterface(): Interface {
  if (iface) return iface;

  // This will fail until ethers is installed
  // iface = new Interface(NADFUN_ABI);
  // return iface;

  throw new Error('Ethers.js not installed - cannot parse EVM events');
}

/**
 * Parse a Monad transaction for nad.fun swap events
 */
export function parseMonadSwap(
  tx: any,
  agentWallet: string,
  agentTokenAddress: string | null
): ParsedSwap | null {
  try {
    // Check if we have nad.fun API data (preferred path)
    const nadFunSwap = tx.rawData?.nadFunSwap;
    if (nadFunSwap) {
      return parseNadFunApiData(nadFunSwap, agentWallet, agentTokenAddress);
    }

    // Fallback: parse blockchain logs (requires ethers.js)
    const logs = tx.logs ?? tx.rawData?.receipt?.logs ?? [];

    if (logs.length === 0) {
      return null;
    }

    const parsedLog = findNadFunSwapEvent(logs, agentWallet);
    if (!parsedLog) {
      return null;
    }

    const signature = tx.signature ?? tx.hash ?? tx.transactionHash;
    const blockTime = tx.timestamp
      ? new Date(tx.timestamp * 1000)
      : new Date();

    // CurveBuy: User sends MON, receives tokens
    if (parsedLog.name === 'CurveBuy') {
      const monAmountIn = parsedLog.args.actualAmountIn.toString();
      const tokenAmountOut = parsedLog.args.effectiveAmountOut.toString();
      const tokenAddress = parsedLog.args.token;

      return {
        signature,
        blockTime,
        platform: 'nad.fun',
        walletAddress: agentWallet,
        tradeType: 'buy',
        tokenInAddress: WMON_ADDRESS,
        tokenInAmount: monAmountIn,
        tokenOutAddress: tokenAddress,
        tokenOutAmount: tokenAmountOut,
        baseAssetAmount: monAmountIn,
        isBuyback: agentTokenAddress
          ? tokenAddress.toLowerCase() === agentTokenAddress.toLowerCase()
          : false,
      };
    }

    // CurveSell: User sends tokens, receives MON
    if (parsedLog.name === 'CurveSell') {
      const tokenAmountIn = parsedLog.args.actualAmountIn.toString();
      const monAmountOut = parsedLog.args.effectiveAmountOut.toString();
      const tokenAddress = parsedLog.args.token;

      return {
        signature,
        blockTime,
        platform: 'nad.fun',
        walletAddress: agentWallet,
        tradeType: 'sell',
        tokenInAddress: tokenAddress,
        tokenInAmount: tokenAmountIn,
        tokenOutAddress: WMON_ADDRESS,
        tokenOutAmount: monAmountOut,
        baseAssetAmount: monAmountOut,
        isBuyback: false, // Selling can't be a buyback
      };
    }

    return null;
  } catch (err) {
    console.error('Failed to parse Monad swap:', err);
    return null;
  }
}

/**
 * Parse nad.fun API swap data directly (no blockchain parsing needed)
 */
function parseNadFunApiData(
  nadFunSwap: any,
  agentWallet: string,
  agentTokenAddress: string | null
): ParsedSwap | null {
  try {
    const swapInfo = nadFunSwap.swap_info;

    if (!swapInfo) {
      console.error('nad.fun swap missing swap_info:', JSON.stringify(nadFunSwap).slice(0, 200));
      return null;
    }

    const isBuy = swapInfo.event_type === 'BUY';

    // Convert MON amount from string (in wei) - nad.fun returns wei amounts as strings
    const monAmount = swapInfo.native_amount; // Already in wei as string
    const tokenAmount = swapInfo.token_amount; // Token amount as string
    const tokenAddress = swapInfo.token_id;

    if (!tokenAddress) {
      console.error(`Missing token_id in swap_info for tx ${swapInfo.transaction_hash}`);
      return null;
    }

    // Verify this swap is for the correct wallet (if account_id is present)
    // Note: nad.fun API omits account_id when filtering by wallet, so it's not always present
    if (swapInfo.account_id && swapInfo.account_id.toLowerCase() !== agentWallet.toLowerCase()) {
      return null;
    }

    const signature = swapInfo.transaction_hash;

    // Validate created_at (Unix timestamp in seconds)
    if (!swapInfo.created_at || typeof swapInfo.created_at !== 'number') {
      console.error(`Invalid created_at timestamp for tx ${signature}:`, swapInfo.created_at);
      return null;
    }

    const blockTime = new Date(swapInfo.created_at * 1000);

    if (isBuy) {
      // BUY: MON → Token
      return {
        signature,
        blockTime,
        platform: 'nad.fun',
        walletAddress: agentWallet,
        tradeType: 'buy',
        tokenInAddress: WMON_ADDRESS,
        tokenInAmount: monAmount,
        tokenOutAddress: tokenAddress,
        tokenOutAmount: tokenAmount,
        baseAssetAmount: monAmount,
        isBuyback: agentTokenAddress
          ? tokenAddress.toLowerCase() === agentTokenAddress.toLowerCase()
          : false,
      };
    } else {
      // SELL: Token → MON
      return {
        signature,
        blockTime,
        platform: 'nad.fun',
        walletAddress: agentWallet,
        tradeType: 'sell',
        tokenInAddress: tokenAddress,
        tokenInAmount: tokenAmount,
        tokenOutAddress: WMON_ADDRESS,
        tokenOutAmount: monAmount,
        baseAssetAmount: monAmount,
        isBuyback: false, // Selling can't be a buyback
      };
    }
  } catch (err) {
    console.error('Failed to parse nad.fun API data:', err);
    return null;
  }
}

/**
 * Find and parse nad.fun swap event from transaction logs
 */
function findNadFunSwapEvent(
  logs: any[],
  agentWallet: string
): LogDescription | null {
  const iface = getInterface();

  for (const log of logs) {
    try {
      // Check if log is from nad.fun contract
      const logAddress = log.address?.toLowerCase();
      if (
        logAddress !== NAD_FUN_BONDING_CURVE.toLowerCase() &&
        logAddress !== NAD_FUN_ROUTER.toLowerCase()
      ) {
        continue;
      }

      // Parse the log
      const parsed = iface.parseLog({
        topics: log.topics,
        data: log.data,
      });

      if (!parsed) continue;

      // Check if it's a Buy or Sell event
      if (parsed.name !== 'CurveBuy' && parsed.name !== 'CurveSell') {
        continue;
      }

      // Check if the 'to' address matches the agent wallet
      const recipientAddress = parsed.args.to?.toLowerCase();
      if (recipientAddress !== agentWallet.toLowerCase()) {
        continue;
      }

      return parsed;
    } catch {
      // Failed to parse this log, continue to next
      continue;
    }
  }

  return null;
}

/**
 * Validate if a transaction contains nad.fun activity
 */
export function isNadFunTransaction(tx: any): boolean {
  const logs = tx.logs ?? tx.rawData?.receipt?.logs ?? [];

  for (const log of logs) {
    const logAddress = log.address?.toLowerCase();
    if (
      logAddress === NAD_FUN_BONDING_CURVE.toLowerCase() ||
      logAddress === NAD_FUN_ROUTER.toLowerCase()
    ) {
      return true;
    }
  }

  return false;
}
