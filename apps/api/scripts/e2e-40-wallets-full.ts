/**
 * Full automated stack test on opBNB testnet:
 *  1) Create N wallets (default 40)
 *  2) Register one-by-one under a binary referral tree (T&C: valid on-chain sponsor)
 *  3) Activate entry package ($5) + API wallet signup
 *  4) Upgrade a subset to higher packages (trading limits)
 *  5) Buy / listHeld NFT cycles until appreciation + burn-threshold path is hit
 *  6) Print + save distribution / condition report
 *
 * Usage:
 *   cd apps/api && npx tsx scripts/e2e-40-wallets-full.ts
 *   WALLET_COUNT=40 API_BASE=http://127.0.0.1:4000 npx tsx scripts/e2e-40-wallets-full.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  maxUint256,
  parseAbi,
  parseUnits,
  publicActions,
  type Address,
  type Hex
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/shared/config/env.js";
import { PACKAGE_USD_BY_ID } from "../src/modules/packages/package-usd.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REQUESTED_WALLETS = Math.min(80, Math.max(2, Number(process.env.WALLET_COUNT ?? 40)));
const API_BASE = (process.env.API_BASE ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const OUT_DIR = join(__dirname, "output");
const MIN_GAS_PER_USER = parseUnits(process.env.MIN_GAS_PER_USER ?? "0.0008", 18);

const chain = defineChain({
  id: env.CHAIN_ID,
  name: "app-chain",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
});

const registrationAbi = parseAbi([
  "function register(address sponsor)",
  "function activate(uint8 packageId)",
  "function upgrade(uint8 newPackageId)",
  "function rootSponsor() view returns (address)",
  "function users(address) view returns (bool registered, bool activated, bool permanentlyInactive, address sponsor, uint8 packageId, uint256 tradingLimit, uint256 totalVolume, uint256 directCount, uint256 registeredAt)",
  "function packages(uint8) view returns (uint256 price, uint256 tradingLimit, bool active)",
  "function dailyVolume(address user, uint256 day) view returns (uint256)",
  "function currentDay() view returns (uint256)"
]);

const marketAbi = parseAbi([
  "function buy()",
  "function listHeld()",
  "function peekNext() view returns (uint256 tokenId, uint256 price)",
  "function nextListPrice() view returns (uint256)",
  "function burnThreshold() view returns (uint256)",
  "function heldTokenId(address) view returns (uint256)",
  "function queueLength() view returns (uint256)",
  "function setUserBot(address user, bool enabled)",
  "function botEnabled(address) view returns (bool)"
]);

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

type WalletRow = {
  index: number;
  address: Address;
  privateKey: Hex;
  sponsorIndex: number | null;
  sponsorAddress: Address;
  packageId: number;
  packageUsd: number;
  tradingLimitUsd: number;
  registrationTxHash?: string;
  activateTxHash?: string;
  apiStatus?: number;
  apiUserId?: string;
  buys: number;
  lists: number;
  volumeSpentUsd: number;
  burnsHit: number;
  errors: string[];
};

function pk(raw: string): Hex {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function clientFor(account: ReturnType<typeof privateKeyToAccount>) {
  return createWalletClient({
    account,
    chain,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);
}

async function waitTx(
  c: ReturnType<typeof clientFor>,
  hash: Hex,
  label: string
): Promise<void> {
  const receipt = await c.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${hash}`);
  }
}

/** Binary-heap referral tree: 0→root, i→floor((i-1)/2) */
function sponsorIndexFor(i: number): number | null {
  if (i <= 0) return null;
  return Math.floor((i - 1) / 2);
}

/** After entry activate(1), upgrade subset for higher daily NFT limits. */
function targetUpgradePackage(i: number): number | null {
  if (i >= 36) return 6; // $250 / limit $2500
  if (i >= 30) return 5; // $100 / limit $1000
  if (i >= 20) return 3; // $25 / limit $250
  if (i >= 10) return 2; // $10 / limit $100
  return null;
}

function usdtNeededForUser(packageId: number): bigint {
  const price = PACKAGE_USD_BY_ID[packageId] ?? 5;
  const limit = price * 10;
  // activation/upgrade + fill trading limit + buffer for ladder
  return parseUnits(String(price + limit + 500), 18);
}

async function main() {
  const reg = env.REGISTRATION_CONTRACT_ADDRESS as Address | undefined;
  const usdt = env.USDT_CONTRACT_ADDRESS as Address | undefined;
  const market = env.MARKETPLACE_CONTRACT_ADDRESS as Address | undefined;
  if (!reg || !usdt || !market) {
    throw new Error("Missing REGISTRATION / USDT / MARKETPLACE in env");
  }

  const funder = privateKeyToAccount(pk(env.CHAIN_PRIVATE_KEY));
  const funderClient = clientFor(funder);
  const root = await funderClient.readContract({
    address: reg,
    abi: registrationAbi,
    functionName: "rootSponsor"
  });
  const burnThreshold = await funderClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: "burnThreshold"
  });

  const funderBal = await funderClient.getBalance({ address: funder.address });
  const reserve = parseUnits(process.env.GAS_RESERVE ?? "0.0015", 18);
  const budget = funderBal > reserve ? funderBal - reserve : 0n;
  let walletCount = REQUESTED_WALLETS;
  while (walletCount > 2 && budget / BigInt(walletCount) < MIN_GAS_PER_USER) {
    walletCount -= 1;
  }
  const gasPerUser = budget / BigInt(Math.max(walletCount, 1));
  if (walletCount < 3 || gasPerUser < MIN_GAS_PER_USER) {
    throw new Error(
      `Funder tBNB too low: have ${formatEther(funderBal)} at ${funder.address}. ` +
        `Top up opBNB testnet tBNB (need ~0.05+ for 40 wallets), then re-run.`
    );
  }
  if (walletCount < REQUESTED_WALLETS) {
    console.warn(
      `⚠️ Only enough tBNB for ${walletCount}/${REQUESTED_WALLETS} wallets — top up funder to run full 40.`
    );
  }

  console.log("========== NFTAIX FULL-WALLET E2E ==========");
  console.log({
    chainId: env.CHAIN_ID,
    wallets: walletCount,
    requested: REQUESTED_WALLETS,
    funder: funder.address,
    funderTbnb: formatEther(funderBal),
    gasPerUser: formatEther(gasPerUser),
    root,
    reg,
    usdt,
    market,
    burnThresholdUsd: formatUnits(burnThreshold, 18),
    api: API_BASE
  });

  const rows: WalletRow[] = [];
  for (let i = 0; i < walletCount; i++) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const sIdx = sponsorIndexFor(i);
    rows.push({
      index: i,
      address: account.address,
      privateKey,
      sponsorIndex: sIdx,
      sponsorAddress: sIdx == null ? root : rows[sIdx]!.address,
      packageId: 1,
      packageUsd: 5,
      tradingLimitUsd: 50,
      buys: 0,
      lists: 0,
      volumeSpentUsd: 0,
      burnsHit: 0,
      errors: []
    });
  }

  // ---- Phase 1: fund gas + mint USDT ----
  console.log("\n—— Phase 1: fund gas + mint USDT ——");
  for (const row of rows) {
    const acct = privateKeyToAccount(row.privateKey);
    const userClient = clientFor(acct);
    const gasTx = await funderClient.sendTransaction({
      to: row.address,
      value: gasPerUser
    });
    await waitTx(funderClient, gasTx, `gas[${row.index}]`);

    const mintAmt = usdtNeededForUser(targetUpgradePackage(row.index) ?? 1);
    const mintTx = await userClient.writeContract({
      address: usdt,
      abi: erc20Abi,
      functionName: "mint",
      args: [row.address, mintAmt]
    });
    await waitTx(userClient, mintTx, `mint[${row.index}]`);
    if (row.index % 5 === 0 || row.index === walletCount - 1) {
      console.log(`  funded ${row.index + 1}/${walletCount}`);
    }
  }

  // ---- Phase 2+3: register → activate(1) → API (one-by-one, T&C sponsor) ----
  console.log("\n—— Phase 2/3: register + activate($5) + API signup (1-by-1) ——");
  for (const row of rows) {
    const acct = privateKeyToAccount(row.privateKey);
    const userClient = clientFor(acct);
    try {
      const regTx = await userClient.writeContract({
        address: reg,
        abi: registrationAbi,
        functionName: "register",
        args: [row.sponsorAddress]
      });
      await waitTx(userClient, regTx, `register[${row.index}]`);
      row.registrationTxHash = regTx;

      const appr = await userClient.writeContract({
        address: usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [reg, parseUnits("5", 18)]
      });
      await waitTx(userClient, appr, `approve-reg[${row.index}]`);

      const actTx = await userClient.writeContract({
        address: reg,
        abi: registrationAbi,
        functionName: "activate",
        args: [1]
      });
      await waitTx(userClient, actTx, `activate[${row.index}]`);
      row.activateTxHash = actTx;

      // Must pass on-chain sponsor (0x) so API referrer check matches register(sponsor)
      const sponsorReferralCode =
        row.sponsorIndex == null ? undefined : row.sponsorAddress;
      let apiRes: Response | null = null;
      let apiBody: { accessToken?: string; message?: string } = {};
      for (let attempt = 0; attempt < 6; attempt++) {
        const nonceRes = await fetch(`${API_BASE}/api/auth/wallet/nonce?address=${row.address}`);
        if (!nonceRes.ok) throw new Error(`nonce ${nonceRes.status}`);
        const { message } = (await nonceRes.json()) as { message: string };
        const signature = await acct.signMessage({ message });
        apiRes = await fetch(`${API_BASE}/api/auth/register/wallet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: row.address,
            message,
            signature,
            registrationTxHash: actTx,
            sponsorReferralCode
          })
        });
        apiBody = (await apiRes.json().catch(() => ({}))) as {
          accessToken?: string;
          message?: string;
        };
        if (apiRes.status !== 429) break;
        const waitMs = 2000 * (attempt + 1);
        console.log(`  ⏳ #${row.index} rate-limited, retry in ${waitMs}ms…`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
      row.apiStatus = apiRes?.status;
      if (!apiRes?.ok) {
        throw new Error(`API register ${apiRes?.status}: ${apiBody.message ?? ""}`);
      }
      if (apiBody.accessToken) {
        const mid = apiBody.accessToken.split(".")[1]!;
        const payload = JSON.parse(Buffer.from(mid, "base64url").toString("utf8")) as { sub?: string };
        row.apiUserId = payload.sub;
      }
      console.log(
        `  ✅ #${row.index} ${row.address.slice(0, 8)}… sponsor=${row.sponsorAddress.slice(0, 8)}… api=${row.apiStatus}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      row.errors.push(msg);
      console.log(`  ❌ #${row.index} ${msg}`);
    }
  }

  // ---- Phase 4: upgrade subset (higher trading limit) ----
  console.log("\n—— Phase 4: upgrade packages (terms: higher package price) ——");
  for (const row of rows) {
    const up = targetUpgradePackage(row.index);
    if (!up || row.errors.length) continue;
    const acct = privateKeyToAccount(row.privateKey);
    const userClient = clientFor(acct);
    try {
      const pkg = await userClient.readContract({
        address: reg,
        abi: registrationAbi,
        functionName: "packages",
        args: [up]
      });
      const price = pkg[0];
      const appr = await userClient.writeContract({
        address: usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [reg, price]
      });
      await waitTx(userClient, appr, `approve-up[${row.index}]`);
      const upTx = await userClient.writeContract({
        address: reg,
        abi: registrationAbi,
        functionName: "upgrade",
        args: [up]
      });
      await waitTx(userClient, upTx, `upgrade[${row.index}]`);
      row.packageId = up;
      row.packageUsd = PACKAGE_USD_BY_ID[up] ?? up;
      row.tradingLimitUsd = row.packageUsd * 10;
      console.log(`  ✅ #${row.index} upgraded → package ${up} ($${row.packageUsd}, limit $${row.tradingLimitUsd})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      row.errors.push(`upgrade: ${msg}`);
      console.log(`  ❌ #${row.index} upgrade ${msg}`);
    }
  }

  // Approve marketplace unlimited for all active users
  console.log("\n—— Phase 5a: marketplace USDT approve ——");
  for (const row of rows) {
    if (row.errors.some((e) => e.startsWith("API") || e.includes("activate") || e.includes("register"))) {
      continue;
    }
    const acct = privateKeyToAccount(row.privateKey);
    const userClient = clientFor(acct);
    try {
      const tx = await userClient.writeContract({
        address: usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [market, maxUint256]
      });
      await waitTx(userClient, tx, `approve-mkt[${row.index}]`);
    } catch (e) {
      row.errors.push(`mkt-approve: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- Phase 5b: buy / listHeld until burn path + package limits exercised ----
  console.log("\n—— Phase 5b: NFT buy/list series (appreciation → burn threshold) ——");
  const conditions = {
    primaryBuy: false,
    resaleBuy: false,
    listHeld: false,
    appreciationBump: false,
    burnSplit: false,
    packageLimitFill: false,
    multiUserVolume: false
  };

  let startPrice = await funderClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: "nextListPrice"
  });
  console.log("  start nextListPrice $", formatUnits(startPrice, 18));

  const maxRounds = Number(process.env.NFT_ROUNDS ?? 80);
  for (let round = 0; round < maxRounds; round++) {
    const buyer = rows[round % rows.length]!;
    if (!buyer.activateTxHash) continue;
    const acct = privateKeyToAccount(buyer.privateKey);
    const userClient = clientFor(acct);

    const peek = await userClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: "peekNext"
    });
    const price = peek[1];
    const qLen = await userClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: "queueLength"
    });

    const u = await userClient.readContract({
      address: reg,
      abi: registrationAbi,
      functionName: "users",
      args: [buyer.address]
    });
    const day = await userClient.readContract({
      address: reg,
      abi: registrationAbi,
      functionName: "currentDay"
    });
    const used = await userClient.readContract({
      address: reg,
      abi: registrationAbi,
      functionName: "dailyVolume",
      args: [buyer.address, day]
    });
    const limit = u[5];
    const bal = await userClient.readContract({
      address: usdt,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer.address]
    });

    if (used + price > limit || bal < price) {
      // try listHeld to free / move series if holding
      const held = await userClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "heldTokenId",
        args: [buyer.address]
      });
      if (held > 0n && price < burnThreshold) {
        try {
          const listTx = await userClient.writeContract({
            address: market,
            abi: marketAbi,
            functionName: "listHeld"
          });
          await waitTx(userClient, listTx, `list[${buyer.index}]`);
          buyer.lists += 1;
          conditions.listHeld = true;
          conditions.appreciationBump = true;
          console.log(`  📤 #${buyer.index} listHeld (round ${round})`);
        } catch {
          /* skip */
        }
      }
      continue;
    }

    try {
      const beforePrice = price;
      const buyTx = await userClient.writeContract({
        address: market,
        abi: marketAbi,
        functionName: "buy"
      });
      await waitTx(userClient, buyTx, `buy[${buyer.index}]`);
      buyer.buys += 1;
      buyer.volumeSpentUsd += Number(formatUnits(beforePrice, 18));
      if (qLen === 0n) conditions.primaryBuy = true;
      else conditions.resaleBuy = true;
      if (beforePrice >= burnThreshold) {
        buyer.burnsHit += 1;
        conditions.burnSplit = true;
        console.log(`  🔥 #${buyer.index} BUY @ $${formatUnits(beforePrice, 18)} BURN/SPLIT`);
      } else {
        console.log(
          `  🛒 #${buyer.index} buy @ $${formatUnits(beforePrice, 18)} (q=${qLen}, round ${round})`
        );
      }

      // buy() auto-enqueues into FIFO — verify + optional listHeld for rare holds
      const held = await userClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "heldTokenId",
        args: [buyer.address]
      });
      const qAfter = await userClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "queueLength"
      });
      const nextP = await userClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "nextListPrice"
      });
      if (held === 0n && qAfter > 0n && beforePrice < burnThreshold) {
        buyer.lists += 1;
        conditions.listHeld = true;
        if (nextP > startPrice) conditions.appreciationBump = true;
      } else if (held > 0n && nextP < burnThreshold) {
        try {
          const listTx = await userClient.writeContract({
            address: market,
            abi: marketAbi,
            functionName: "listHeld"
          });
          await waitTx(userClient, listTx, `list2[${buyer.index}]`);
          buyer.lists += 1;
          conditions.listHeld = true;
          if (nextP > startPrice) conditions.appreciationBump = true;
        } catch {
          /* skip */
        }
      }

      if (buyer.volumeSpentUsd >= buyer.tradingLimitUsd * 0.5) {
        conditions.packageLimitFill = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (round < 5 || round % 10 === 0) {
        console.log(`  ⚠️ round ${round} #${buyer.index}: ${msg.slice(0, 120)}`);
      }
    }

    if (conditions.burnSplit && conditions.listHeld && conditions.primaryBuy && round > 25) {
      console.log("  series conditions mostly satisfied — wrapping buy loop");
      break;
    }
  }

  const buyersWithVolume = rows.filter((r) => r.buys > 0).length;
  if (buyersWithVolume >= 5) conditions.multiUserVolume = true;

  const endPrice = await funderClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: "nextListPrice"
  });

  // ---- Phase 6: DB distribution snapshot ----
  console.log("\n—— Phase 6: distribution snapshot (DB) ——");
  const prisma = new PrismaClient();
  type DistRow = {
    address: string;
    userId: string | null;
    packageUsd: number;
    buys: number;
    lists: number;
    volumeSpentUsd: number;
    incomeTotal: number;
    rewardLines: number;
    tradingLogs: number;
  };
  const distribution: DistRow[] = [];
  try {
    for (const row of rows) {
      const wc = await prisma.walletConnection.findFirst({
        where: {
          OR: [
            { walletAddress: row.address },
            { walletAddress: row.address.toLowerCase() }
          ]
        },
        select: { userId: true }
      });
      let incomeTotal = 0;
      let rewardLines = 0;
      let tradingLogs = 0;
      if (wc?.userId) {
        const incomes = await prisma.incomeLedger.findMany({
          where: { userId: wc.userId },
          select: { amount: true }
        });
        rewardLines = incomes.length;
        incomeTotal = incomes.reduce((a, x) => a + Number(x.amount), 0);
        tradingLogs = await prisma.tradingLog.count({ where: { userId: wc.userId } });
      }
      distribution.push({
        address: row.address,
        userId: wc?.userId ?? row.apiUserId ?? null,
        packageUsd: row.packageUsd,
        buys: row.buys,
        lists: row.lists,
        volumeSpentUsd: Number(row.volumeSpentUsd.toFixed(4)),
        incomeTotal: Number(incomeTotal.toFixed(6)),
        rewardLines,
        tradingLogs
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  const registeredOk = rows.filter((r) => r.apiStatus === 201 || r.apiStatus === 200).length;
  const report = {
    at: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    walletCount,
    requestedWallets: REQUESTED_WALLETS,
    registeredOk,
    conditions,
    market: {
      startNextListPrice: formatUnits(startPrice, 18),
      endNextListPrice: formatUnits(endPrice, 18),
      burnThreshold: formatUnits(burnThreshold, 18)
    },
    totals: {
      buys: rows.reduce((a, r) => a + r.buys, 0),
      lists: rows.reduce((a, r) => a + r.lists, 0),
      burnsHit: rows.reduce((a, r) => a + r.burnsHit, 0),
      volumeUsd: Number(rows.reduce((a, r) => a + r.volumeSpentUsd, 0).toFixed(4)),
      incomeUsd: Number(distribution.reduce((a, d) => a + d.incomeTotal, 0).toFixed(6))
    },
    treeSample: rows.slice(0, 8).map((r) => ({
      i: r.index,
      address: r.address,
      sponsor: r.sponsorAddress,
      packageId: r.packageId
    })),
    distribution,
    errors: rows.filter((r) => r.errors.length).map((r) => ({ i: r.index, errors: r.errors })),
    wallets: rows.map(({ privateKey, ...safe }) => ({
      ...safe,
      privateKey: process.env.SAVE_PRIVATE_KEYS === "1" ? privateKey : undefined
    }))
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `e2e-40-report-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n========== RESULTS ==========");
  console.log("Registered OK:", registeredOk, "/", walletCount);
  console.log("Conditions:", conditions);
  console.log("Totals:", report.totals);
  console.log("Price ladder:", report.market);
  console.log("\nDistribution (top 10 by income):");
  [...distribution]
    .sort((a, b) => b.incomeTotal - a.incomeTotal)
    .slice(0, 10)
    .forEach((d, i) => {
      console.log(
        `  ${i + 1}. ${d.address.slice(0, 10)}… pkg$${d.packageUsd} buys=${d.buys} vol$${d.volumeSpentUsd} income$${d.incomeTotal} trades=${d.tradingLogs}`
      );
    });
  console.log("\nReport:", outPath);

  const criticalFail =
    registeredOk < walletCount ||
    !conditions.primaryBuy ||
    !conditions.listHeld ||
    report.totals.buys < 5;
  if (criticalFail) {
    console.error("\nE2E incomplete — see errors in report");
    process.exit(1);
  }
  console.log("\nE2E FULL STACK OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
