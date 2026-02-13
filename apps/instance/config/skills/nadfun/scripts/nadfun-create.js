#!/usr/bin/env node
'use strict';

// Create a new token on nad.fun
// Usage: nadfun-create.js [name] [symbol] [description] [image_path] [initial_buy_mon]
//
// Steps:
// 1. Upload image to nad.fun API
// 2. Upload metadata to nad.fun API
// 3. Mine salt via nad.fun API
// 4. Call BondingCurveRouter.create() on-chain

const path = require('path');
const fs = require('fs');
const {
  viem, MONAD_CONFIG, monadChain,
  getPublicClient, getWalletClient, getAccount,
  bondingCurveRouterAbi, curveAbi, lensAbi,
  nadFunApiRequest,
} = require(path.join(__dirname, '..', '..', 'monad', 'scripts', 'monad-common.js'));

// Default token details (random generation)
function randomName() {
  const prefixes = ['Moon', 'Degen', 'Based', 'Turbo', 'Mega', 'Ultra', 'Hyper', 'Super', 'Giga', 'Chad'];
  const suffixes = ['Cat', 'Dog', 'Frog', 'Ape', 'Bull', 'Bear', 'Pepe', 'Wojak', 'Moon', 'Rocket'];
  return prefixes[Math.floor(Math.random() * prefixes.length)] + suffixes[Math.floor(Math.random() * suffixes.length)];
}

function randomSymbol(name) {
  return '$' + name.replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 5);
}

function generatePlaceholderImage() {
  // Generate a simple 64x64 PNG with random color
  // This creates a minimal valid PNG
  const r = Math.floor(Math.random() * 200 + 55);
  const g = Math.floor(Math.random() * 200 + 55);
  const b = Math.floor(Math.random() * 200 + 55);

  // Create raw pixel data (RGBA, 64x64)
  const width = 64, height = 64;
  const rawData = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Simple gradient pattern
      rawData[i] = Math.min(255, r + Math.floor(x * 2));
      rawData[i + 1] = Math.min(255, g + Math.floor(y * 2));
      rawData[i + 2] = b;
      rawData[i + 3] = 255;
    }
  }

  // We'll just return raw RGBA — the API likely accepts raw image buffers
  // For simplicity, generate inline with a small canvas-less approach
  return null; // Skip image for now, let nad.fun use default
}

async function main() {
  const args = process.argv.slice(2);

  const name = args[0] || randomName();
  const symbol = args[1] || randomSymbol(name);
  const description = args[2] || `${name} - a token on nad.fun, created by PumpMyClaw bot`;
  const imagePath = args[3] || '';
  const initialBuyMon = parseFloat(args[4]) || 0;

  const account = getAccount();
  const publicClient = getPublicClient();
  const { client: walletClient } = getWalletClient();

  console.error(`[nadfun-create] Creating token: ${name} (${symbol})`);
  console.error(`[nadfun-create] Creator: ${account.address}`);

  try {
    // Step 1: Upload image
    let imageUri = '';
    if (imagePath && fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/webp';

      const imgRes = await nadFunApiRequest('/agent/token/image', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: imageBuffer,
      });

      if (imgRes.status !== 200 || !imgRes.data.image_uri) {
        console.log(JSON.stringify({ error: 'Failed to upload image', response: imgRes.data }));
        process.exit(1);
      }
      imageUri = imgRes.data.image_uri;
      console.error(`[nadfun-create] Image uploaded: ${imageUri}`);
    } else {
      // Use a simple placeholder - nad.fun will use a default
      console.error('[nadfun-create] No image provided, creating without custom image');
      // Create a minimal 1x1 PNG
      const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      const imgRes = await nadFunApiRequest('/agent/token/image', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png1x1,
      });
      if (imgRes.status === 200 && imgRes.data.image_uri) {
        imageUri = imgRes.data.image_uri;
      }
    }

    // Step 2: Upload metadata
    const metaBody = {
      name,
      symbol,
      description,
    };
    if (imageUri) metaBody.image_uri = imageUri;

    const metaRes = await nadFunApiRequest('/agent/token/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaBody),
    });

    if (metaRes.status !== 200 || !metaRes.data.metadata_uri) {
      console.log(JSON.stringify({ error: 'Failed to upload metadata', response: metaRes.data }));
      process.exit(1);
    }
    const metadataUri = metaRes.data.metadata_uri;
    console.error(`[nadfun-create] Metadata uploaded: ${metadataUri}`);

    // Step 3: Mine salt
    const saltRes = await nadFunApiRequest('/agent/salt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator: account.address,
        name,
        symbol,
        metadata_uri: metadataUri,
      }),
    });

    if (saltRes.status !== 200 || !saltRes.data.salt) {
      console.log(JSON.stringify({ error: 'Failed to mine salt', response: saltRes.data }));
      process.exit(1);
    }
    const salt = saltRes.data.salt;
    const predictedAddress = saltRes.data.address;
    console.error(`[nadfun-create] Salt mined. Predicted address: ${predictedAddress}`);

    // Step 4: Get deploy fee
    const feeConfig = await publicClient.readContract({
      address: MONAD_CONFIG.CURVE,
      abi: curveAbi,
      functionName: 'feeConfig',
    });
    const deployFeeAmount = feeConfig[0];
    console.error(`[nadfun-create] Deploy fee: ${viem.formatEther(deployFeeAmount)} MON`);

    // Calculate initial buy value and min tokens
    let initialBuyValue = 0n;
    let minTokens = 0n;
    if (initialBuyMon > 0) {
      initialBuyValue = viem.parseEther(initialBuyMon.toString());
      minTokens = await publicClient.readContract({
        address: MONAD_CONFIG.LENS,
        abi: lensAbi,
        functionName: 'getInitialBuyAmountOut',
        args: [initialBuyValue],
      });
      // Apply 5% slippage to min tokens
      minTokens = (minTokens * 95n) / 100n;
    }

    const totalValue = deployFeeAmount + initialBuyValue;

    // Check balance
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < totalValue) {
      console.log(JSON.stringify({
        error: 'Insufficient balance for token creation',
        balance: viem.formatEther(balance),
        required: viem.formatEther(totalValue),
      }));
      process.exit(1);
    }

    // Create token on-chain
    const createArgs = {
      name,
      symbol,
      tokenURI: metadataUri,
      amountOut: minTokens,
      salt: salt,
      actionId: 1,
    };

    // Estimate gas
    const estimatedGas = await publicClient.estimateContractGas({
      address: MONAD_CONFIG.BONDING_CURVE_ROUTER,
      abi: bondingCurveRouterAbi,
      functionName: 'create',
      args: [createArgs],
      account: account.address,
      value: totalValue,
    });

    const hash = await walletClient.writeContract({
      address: MONAD_CONFIG.BONDING_CURVE_ROUTER,
      abi: bondingCurveRouterAbi,
      functionName: 'create',
      args: [createArgs],
      account,
      chain: monadChain,
      value: totalValue,
      gas: estimatedGas + estimatedGas / 10n,
    });

    console.error(`[nadfun-create] Transaction sent: ${hash}`);

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
      console.log(JSON.stringify({ error: 'Token creation transaction reverted', txHash: hash }));
      process.exit(1);
    }

    // Parse CurveCreate event to get token address
    let tokenAddress = predictedAddress;
    let poolAddress = '';
    for (const log of receipt.logs) {
      try {
        const event = viem.decodeEventLog({
          abi: curveAbi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === 'CurveCreate') {
          tokenAddress = event.args.token;
          poolAddress = event.args.pool;
          break;
        }
      } catch {}
    }

    console.log(JSON.stringify({
      success: true,
      name,
      symbol,
      tokenAddress,
      poolAddress,
      metadataUri,
      imageUri,
      txHash: hash,
      initialBuyMon: initialBuyMon || 0,
      deployFee: viem.formatEther(deployFeeAmount),
      nadFunUrl: `https://nad.fun/token/${tokenAddress}`,
    }));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
