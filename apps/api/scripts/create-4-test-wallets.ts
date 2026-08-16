/**
 * Generate 4 fresh test wallets, mint 200 USDT each, drip tBNB for gas.
 * cd apps/api && npx tsx scripts/create-4-test-wallets.ts
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
const OUT = join(__dirname, "output", "test-wallets-4.json");

const chain = {
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
};

function pk(raw: string): Hex {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function main() {
  const funder = privateKeyToAccount(pk(env.CHAIN_PRIVATE_KEY));
  const client = createWalletClient({
    account: funder,
    chain,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);

  const usdt = env.USDT_CONTRACT_ADDRESS as `0x${string}`;
  const abi = parseAbi([
    "function mint(address to, uint256 amount)",
    "function balanceOf(address) view returns (uint256)"
  ]);
  const GAS = parseUnits("0.00018", 18);
  const USDT = parseUnits("200", 18);

  const wallets = Array.from({ length: 4 }, (_, i) => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { index: i + 1, address: account.address, privateKey };
  });

  console.log("Funding from", funder.address);
  const funderBal = await client.getBalance({ address: funder.address });
  console.log("Funder tBNB before:", formatEther(funderBal));

  for (const w of wallets) {
    const gasHash = await client.sendTransaction({
      to: w.address,
      value: GAS,
      chain,
      account: funder
    });
    await client.waitForTransactionReceipt({ hash: gasHash });

    const mintHash = await client.writeContract({
      address: usdt,
      abi,
      functionName: "mint",
      args: [w.address, USDT],
      chain,
      account: funder
    });
    await client.waitForTransactionReceipt({ hash: mintHash });

    const [bnb, usdtBal] = await Promise.all([
      client.getBalance({ address: w.address }),
      client.readContract({ address: usdt, abi, functionName: "balanceOf", args: [w.address] })
    ]);

    Object.assign(w, { bnb: formatEther(bnb), usdt: formatUnits(usdtBal, 18) });
    console.log(`Wallet ${w.index}: ${w.address} | tBNB ${w.bnb} | USDT ${w.usdt}`);
  }

  mkdirSync(join(__dirname, "output"), { recursive: true });
  const out = {
    network: "opBNB Testnet",
    chainId: 5611,
    rootSponsor: "0x1F4Ee796287bd1d6c5336F18bFaE81d02aAa252f",
    usdt,
    registration: env.REGISTRATION_CONTRACT_ADDRESS,
    marketplace: env.MARKETPLACE_CONTRACT_ADDRESS,
    wallets
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log("\nSaved", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
