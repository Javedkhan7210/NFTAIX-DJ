/**
 * W5 buys FIFO NFT; snapshot USDT before/after for upline chain.
 * cd apps/api && npx tsx scripts/test-w5-nft-buy-referral.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createWalletClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  publicActions,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../src/shared/config/env.js";
import { sponsorUserGas } from "../src/modules/public/admin-gas-sponsor.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REG = readFileSync(join(__dirname, "output/test-wallets-5-new-registered.json"), "utf8");
const data = JSON.parse(REG) as {
  referralChain: { chain: string[] };
  wallets: Array<{ index: number; address: string; privateKey: string }>;
};

const W5 = data.wallets.find((w) => w.index === 5)!;
const CHAIN = data.referralChain.chain;

const chain = {
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
};

const marketAbi = parseAbi([
  "function buy()",
  "function nextListPrice() view returns (uint256)",
  "function queueLength() view returns (uint256)",
  "function queueAt(uint256 index) view returns (uint256 tokenId, uint256 price, address seller)"
]);

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

async function usdtBal(client: ReturnType<typeof createWalletClient> & { extend: typeof publicActions }, addr: string) {
  return client.readContract({
    address: env.USDT_CONTRACT_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(addr)]
  });
}

async function main() {
  const buyer = privateKeyToAccount(W5.privateKey as Hex);
  const rpc = http(env.CHAIN_RPC_URL);
  const publicClient = createWalletClient({ chain, transport: rpc }).extend(publicActions);
  const buyerClient = createWalletClient({ account: buyer, chain, transport: rpc }).extend(publicActions);

  const market = env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}`;
  const usdt = env.USDT_CONTRACT_ADDRESS as `0x${string}`;

  let bnb = await publicClient.getBalance({ address: buyer.address });
  console.log("W5", buyer.address, "tBNB", formatEther(bnb));
  if (bnb < parseUnits("0.00008", 18)) {
    try {
      const sp = await sponsorUserGas(buyer.address);
      console.log("Gas sponsor:", sp.message, sp.gasTxHash ?? "");
      bnb = await publicClient.getBalance({ address: buyer.address });
    } catch (e) {
      const funder = privateKeyToAccount(
        "0xfb38506cbd3137ba90bcbafdd36e0e1eb05d9c729feac7438efa6f78d593e8e1" as Hex
      );
      const funderClient = createWalletClient({ account: funder, chain, transport: rpc }).extend(publicActions);
      const hash = await funderClient.sendTransaction({
        to: buyer.address,
        value: parseUnits("0.0001", 18),
        chain,
        account: funder
      });
      await funderClient.waitForTransactionReceipt({ hash });
      console.log("Gas drip from 0623:", hash);
    }
  }

  const price = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "nextListPrice" });
  const qLen = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "queueLength" });
  console.log("Market price $", formatUnits(price, 18), "| queue", qLen.toString());
  if (qLen > 0n) {
    const head = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "queueAt", args: [0n] });
    console.log("FIFO head token", head[0].toString(), "seller", head[2]);
  }

  const watch = [...CHAIN];
  const before: Record<string, string> = {};
  for (const a of watch) {
    before[a] = formatUnits(await usdtBal(publicClient, a), 18);
  }
  console.log("\nUSDT BEFORE:");
  for (const a of watch) console.log(`  ${a.slice(0, 10)}… ${before[a]}`);

  const approveHash = await buyerClient.writeContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "approve",
    args: [market, price],
    chain,
    account: buyer
  });
  await buyerClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("\napprove tx", approveHash);

  const buyHash = await buyerClient.writeContract({
    address: market,
    abi: marketAbi,
    functionName: "buy",
    chain,
    account: buyer
  });
  const receipt = await buyerClient.waitForTransactionReceipt({ hash: buyHash });
  console.log("buy tx", buyHash, "status", receipt.status);

  const after: Record<string, string> = {};
  const delta: Record<string, string> = {};
  for (const a of watch) {
    after[a] = formatUnits(await usdtBal(publicClient, a), 18);
    delta[a] = (Number(after[a]) - Number(before[a])).toFixed(6);
  }

  console.log("\nUSDT AFTER / DELTA:");
  for (const a of watch) {
    console.log(`  ${a.slice(0, 10)}… ${after[a]} (${Number(delta[a]) >= 0 ? "+" : ""}${delta[a]})`);
  }

  const w5After = after[W5.address];
  console.log("\nW5 spent ~$", (Number(before[W5.address]) - Number(w5After)).toFixed(2));
  console.log("Expected team/upline: ~$0.11 per unlocked level (20% pool / 20 levels)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
