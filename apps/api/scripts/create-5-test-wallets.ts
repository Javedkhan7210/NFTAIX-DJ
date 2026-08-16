/**
 * Generate 5 fresh test wallets, drip tBNB for gas, each self-mints 200 MockUSDT.
 * cd apps/api && npx tsx scripts/create-5-test-wallets.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  publicActions,
  type Hex
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { env } from "../src/shared/config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "output", "test-wallets-5-batch2.json");

/** Fallback gas funders (testnet only). */
const GAS_FUNDER_PKS: Hex[] = [
  "0xef9612283e638ac0c63398562de793f3f47e8fd862ee855f7a46b1eaf967464c",
  "0x4a35c4683f51dafaf3ee18928c7246d8ee865372927e44986ff0bda335d5a152",
  "0xfb38506cbd3137ba90bcbafdd36e0e1eb05d9c729feac7438efa6f78d593e8e1",
  "0x9dca4a7a6bc42a6f93a6fb3a7a69ad81925f0bcdbd6990b7fa26f0a0938d6276",
  ...(env.CONTRACT_ADMIN_PRIVATE_KEY
    ? [((env.CONTRACT_ADMIN_PRIVATE_KEY.startsWith("0x")
        ? env.CONTRACT_ADMIN_PRIVATE_KEY
        : `0x${env.CONTRACT_ADMIN_PRIVATE_KEY}`) as Hex)]
    : [])
];

const chain = {
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
};

function pk(raw: string): Hex {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function pickGasFunder(
  publicClient: ReturnType<typeof createWalletClient> & { extend: typeof publicActions },
  need: bigint
) {
  for (const raw of GAS_FUNDER_PKS) {
    const account = privateKeyToAccount(raw);
    const bal = await publicClient.getBalance({ address: account.address });
    if (bal >= need) {
      console.log("Gas funder", account.address, "tBNB", formatEther(bal));
      return account;
    }
  }
  throw new Error("All gas funders low on tBNB — top up at https://opbnb-testnet-faucet.bnbchain.org/");
}

async function main() {
  const rpc = http(env.CHAIN_RPC_URL);
  const publicClient = createWalletClient({ chain, transport: rpc }).extend(publicActions);

  const usdt = env.USDT_CONTRACT_ADDRESS as `0x${string}`;
  const erc20Abi = parseAbi([
    "function mint(address to, uint256 amount)",
    "function balanceOf(address) view returns (uint256)"
  ]);
  const GAS_DRIP = parseUnits("0.000035", 18);
  const USDT = parseUnits("200", 18);
  const COUNT = 5;

  const wallets = Array.from({ length: COUNT }, (_, i) => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { index: i + 1, address: account.address, privateKey };
  });

  let gasFunder = await pickGasFunder(publicClient, GAS_DRIP * 2n);

  for (const w of wallets) {
    let funderBal = await publicClient.getBalance({ address: gasFunder.address });
    if (funderBal < GAS_DRIP * 2n) {
      gasFunder = await pickGasFunder(publicClient, GAS_DRIP * 2n);
    }

    const activeGasClient = createWalletClient({
      account: gasFunder,
      chain,
      transport: rpc
    }).extend(publicActions);

    const gasHash = await activeGasClient.sendTransaction({
      to: w.address,
      value: GAS_DRIP,
      chain,
      account: gasFunder
    });
    await publicClient.waitForTransactionReceipt({ hash: gasHash });

    const account = privateKeyToAccount(w.privateKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: rpc
    }).extend(publicActions);

    const mintHash = await walletClient.writeContract({
      address: usdt,
      abi: erc20Abi,
      functionName: "mint",
      args: [w.address, USDT],
      chain,
      account
    });
    await walletClient.waitForTransactionReceipt({ hash: mintHash });

    const [bnb, usdtBal] = await Promise.all([
      publicClient.getBalance({ address: w.address }),
      publicClient.readContract({
        address: usdt,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [w.address]
      })
    ]);

    Object.assign(w, { bnb: formatEther(bnb), usdt: formatUnits(usdtBal, 18) });
    console.log(`Wallet ${w.index}: ${w.address}`);
    console.log(`  pk: ${w.privateKey}`);
    console.log(`  tBNB ${w.bnb} | USDT ${w.usdt}`);
  }

  mkdirSync(join(__dirname, "output"), { recursive: true });
  const out = {
    network: "opBNB Testnet",
    chainId: 5611,
    rootSponsor: "0x1F4Ee796287bd1d6c5336F18bFaE81d02aAa252f",
    usdt,
    registration: env.REGISTRATION_CONTRACT_ADDRESS,
    marketplace: env.MARKETPLACE_CONTRACT_ADDRESS,
    notes: "Fresh batch-2 — 5 wallets, 200 USDT each",
    wallets
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log("\nSaved", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
