# Blockchain Provider Abstraction

This directory contains the chain-agnostic blockchain provider abstraction layer.

## Files

- `types.ts` - Core interfaces (BlockchainProvider, Chain)
- `solana-provider.ts` - Solana implementation (wraps HeliusClient)
- `monad-provider.ts` - Monad implementation (uses Alchemy SDK)
- `provider-registry.ts` - Provider registry and initialization
- `monad-swap-parser.ts` - nad.fun contract event parser

## TODO: Phase 9 Completion

The MonadProvider currently has placeholder implementations that need to be completed once `alchemy-sdk` and `ethers` are installed:

### Required Package Installation
```bash
cd apps/api
pnpm add alchemy-sdk ethers@6
```

### MonadProvider Methods to Implement

1. **getSignaturesForAddress()**
   - Use `alchemy.core.getAssetTransfers()` to find transactions
   - Filter for nad.fun contract interactions
   - Return unique transaction hashes

2. **getEnhancedTransaction()**
   - Use `alchemy.core.getTransaction()` + `getTransactionReceipt()`
   - Normalize to BlockchainTransaction format
   - Include logs for event parsing

3. **addWalletToWebhook()**
   - Use Alchemy Notify API to create/update webhook
   - POST to `https://dashboard.alchemy.com/api/create-webhook`
   - Monitor address activity for nad.fun contract

### Token Metadata Resolution (EVM)

The `token-resolver.ts` file has basic multi-chain support but needs full EVM implementation:

1. **fetchMonadTokenInfo()** in `token-resolver.ts`:
   ```typescript
   // Use ethers.js to call ERC-20 contract methods:
   // - name()
   // - symbol()
   // - decimals()
   ```

2. **Fallback chain**:
   - Try direct contract calls first
   - Fall back to DexScreener API
   - Cache results in DB

### Testing Checklist

- [ ] Install dependencies (`alchemy-sdk`, `ethers@6`)
- [ ] Implement MonadProvider methods
- [ ] Test Monad wallet registration
- [ ] Test nad.fun trade ingestion
- [ ] Test EVM token metadata resolution
- [ ] Verify webhook integration
- [ ] Test cron polling for Monad wallets
