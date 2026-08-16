/**
 * Fresh-DB + testnet smoke: admin login, free on-chain register, wallet API login,
 * packages/market/trading/team, free upgrade, NFTAIX token check.
 *
 * cd apps/api && npx tsx scripts/e2e-api-smoke-fresh.ts
 */
import { createWalletClient, formatEther, http, parseAbi, publicActions } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { env } from "../src/shared/config/env.js";

const API = process.env.API_URL?.replace(/\/$/, "") || "http://127.0.0.1:4000";
const ROOT = "0x1F4Ee796287bd1d6c5336F18bFaE81d02aAa252f" as const;

const chain = defineChain({
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
});

const tokAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)"
]);
const regAbi = parseAbi([
  "function users(address) view returns (bool,bool,bool,address,uint8,uint256,uint256,uint256,uint256)",
  "function rootSponsor() view returns (address)"
]);

type Step = { name: string; ok: boolean; detail?: string };

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, json, text };
}

function pass(steps: Step[], name: string, detail?: string) {
  steps.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(steps: Step[], name: string, detail?: string) {
  steps.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const steps: Step[] = [];
  console.log("========== NFTAIX API SMOKE (fresh) ==========");
  console.log({ API, reg: env.REGISTRATION_CONTRACT_ADDRESS, mp: env.MARKETPLACE_CONTRACT_ADDRESS, token: env.NFTAIX_TOKEN_ADDRESS });

  // 1) Health + chain
  {
    const h = await api("/health");
    if (h.status === 200 && h.json?.ok) pass(steps, "GET /health");
    else fail(steps, "GET /health", `${h.status} ${h.text.slice(0, 120)}`);

    const c = await api("/api/chain/status");
    const regOk = c.json?.registration?.toLowerCase() === env.REGISTRATION_CONTRACT_ADDRESS?.toLowerCase();
    const mpOk = c.json?.marketplace?.toLowerCase() === env.MARKETPLACE_CONTRACT_ADDRESS?.toLowerCase();
    if (c.status === 200 && regOk && mpOk) {
      pass(steps, "GET /api/chain/status", `queue=${c.json?.marketplaceEconomics?.queueLength}`);
    } else {
      fail(steps, "GET /api/chain/status", `${c.status} reg=${c.json?.registration}`);
    }
  }

  // 2) Admin login
  let adminToken = "";
  {
    const r = await api("/api/auth/login/admin", {
      body: { email: "admin@nftaix.local", password: "Admin@12345" }
    });
    if (r.status === 200 && r.json?.accessToken) {
      adminToken = r.json.accessToken;
      pass(steps, "POST /api/auth/login/admin");
    } else {
      fail(steps, "POST /api/auth/login/admin", `${r.status} ${r.text.slice(0, 200)}`);
      console.log("\nAborting — no admin token");
      process.exit(1);
    }
  }

  // 3) Admin stats / packages / market listings
  {
    const s = await api("/api/admin/stats", { token: adminToken });
    if (s.status === 200) pass(steps, "GET /api/admin/stats", `users=${s.json?.totalUsers}`);
    else fail(steps, "GET /api/admin/stats", `${s.status}`);

    const nets = await api("/api/admin/networks-overview", { token: adminToken });
    if (nets.status === 200 && Array.isArray(nets.json?.networks)) {
      pass(steps, "GET /api/admin/networks-overview", `active=${nets.json.activeChainId}`);
    } else fail(steps, "GET /api/admin/networks-overview", `${nets.status}`);
  }

  const publicClient = createWalletClient({
    account: privateKeyToAccount(
      (env.CHAIN_PRIVATE_KEY.startsWith("0x")
        ? env.CHAIN_PRIVATE_KEY
        : `0x${env.CHAIN_PRIVATE_KEY}`) as `0x${string}`
    ),
    chain,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);

  const rootOnChain = await publicClient.readContract({
    address: env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}`,
    abi: regAbi,
    functionName: "rootSponsor"
  });
  console.log("rootSponsor", rootOnChain);

  // 4) Free register user A (package 1 = $5 → 10 NFTAIX)
  const userAPk = generatePrivateKey();
  const userA = privateKeyToAccount(userAPk);
  console.log("\nUser A", userA.address);

  {
    const r = await api("/api/admin/chain/free-register-activate", {
      token: adminToken,
      body: {
        userWallet: userA.address,
        sponsorWallet: rootOnChain,
        packageId: 1
      }
    });
    if (r.status === 200 && r.json?.txHash) {
      pass(steps, "POST free-register-activate (A)", r.json.txHash);
    } else {
      fail(steps, "POST free-register-activate (A)", `${r.status} ${r.text.slice(0, 300)}`);
    }
  }

  // On-chain user + token
  {
    const u = await publicClient.readContract({
      address: env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}`,
      abi: regAbi,
      functionName: "users",
      args: [userA.address]
    });
    if (u[0] && u[1] && Number(u[4]) === 1) {
      pass(steps, "On-chain A registered+activated pkg1");
    } else {
      fail(steps, "On-chain A state", JSON.stringify(u.slice(0, 6)));
    }

    if (env.NFTAIX_TOKEN_ADDRESS) {
      const bal = await publicClient.readContract({
        address: env.NFTAIX_TOKEN_ADDRESS as `0x${string}`,
        abi: tokAbi,
        functionName: "balanceOf",
        args: [userA.address]
      });
      const n = Number(formatEther(bal));
      if (n === 10) pass(steps, "NFTAIX token A = 10", formatEther(bal));
      else fail(steps, "NFTAIX token A expected 10", formatEther(bal));
    } else {
      fail(steps, "NFTAIX_TOKEN_ADDRESS missing in env");
    }
  }

  // 5) Backfill DB user from chain
  {
    const r = await api("/api/admin/users/backfill-from-chain", {
      token: adminToken,
      body: { walletAddress: userA.address }
    });
    if (r.status === 200 || r.status === 201) {
      pass(steps, "POST backfill-from-chain (A)", `userId=${r.json?.user?.id ?? r.json?.id ?? "?"}`);
    } else {
      fail(steps, "POST backfill-from-chain (A)", `${r.status} ${r.text.slice(0, 250)}`);
    }
  }

  // 6) Wallet login for A
  let userToken = "";
  {
    const nonce = await api(`/api/auth/wallet/nonce?address=${userA.address}`);
    if (nonce.status !== 200 || !nonce.json?.message) {
      fail(steps, "GET wallet/nonce", `${nonce.status}`);
    } else {
      const message = nonce.json.message as string;
      const signature = await userA.signMessage({ message });
      const login = await api("/api/auth/login/wallet", {
        body: { walletAddress: userA.address, message, signature }
      });
      if (login.status === 200 && login.json?.accessToken) {
        userToken = login.json.accessToken;
        pass(steps, "POST /api/auth/login/wallet (A)");
      } else {
        // try register/wallet if login fails (no password path)
        const reg = await api("/api/auth/register/wallet", {
          body: { walletAddress: userA.address, message, signature }
        });
        if ((reg.status === 200 || reg.status === 201) && reg.json?.accessToken) {
          userToken = reg.json.accessToken;
          pass(steps, "POST /api/auth/register/wallet (A) fallback");
        } else {
          fail(steps, "wallet login/register A", `${login.status}/${reg.status} ${reg.text.slice(0, 200)}`);
        }
      }
    }
  }

  // 7) User APIs
  if (userToken) {
    const checks: Array<[string, string]> = [
      ["/api/user/profile", "GET /api/user/profile"],
      ["/api/packages/tiers", "GET /api/packages/tiers"],
      ["/api/packages/subscription-view", "GET /api/packages/subscription-view"],
      ["/api/trading/dashboard", "GET /api/trading/dashboard"],
      ["/api/market/listings", "GET /api/market/listings"],
      ["/api/user/referrals", "GET /api/user/referrals"],
      ["/api/user/team", "GET /api/user/team"],
      ["/api/income/wallet", "GET /api/income/wallet"],
      ["/api/income/registration-reward-summary", "GET /api/income/registration-reward-summary"]
    ];
    for (const [path, label] of checks) {
      const r = await api(path, { token: userToken });
      if (r.status >= 200 && r.status < 300) {
        const extra =
          path.includes("listings")
            ? `count=${Array.isArray(r.json) ? r.json.length : r.json?.items?.length ?? r.json?.listings?.length ?? "?"}`
            : path.includes("dashboard")
              ? `remaining=${r.json?.remainingTradingLimit ?? "?"}`
              : undefined;
        pass(steps, label, extra);
      } else {
        fail(steps, label, `${r.status} ${r.text.slice(0, 180)}`);
      }
    }
  }

  // 8) Free upgrade A to package 3 ($25 → +50 tokens → total 60)
  {
    const r = await api("/api/admin/chain/free-upgrade", {
      token: adminToken,
      body: { userWallet: userA.address, packageId: 3 }
    });
    if (r.status === 200 && r.json?.txHash) {
      pass(steps, "POST free-upgrade A → pkg3", r.json.txHash);
      if (env.NFTAIX_TOKEN_ADDRESS) {
        const bal = await publicClient.readContract({
          address: env.NFTAIX_TOKEN_ADDRESS as `0x${string}`,
          abi: tokAbi,
          functionName: "balanceOf",
          args: [userA.address]
        });
        const n = Number(formatEther(bal));
        // $5 + $25 = 10 + 50 = 60
        if (n === 60) pass(steps, "NFTAIX token A after upgrade = 60", formatEther(bal));
        else fail(steps, "NFTAIX token A after upgrade expected 60", formatEther(bal));
      }
    } else {
      fail(steps, "POST free-upgrade", `${r.status} ${r.text.slice(0, 250)}`);
    }
  }

  // 9) Free register user B under A (sponsor = A), then team APIs for A
  const userBPk = generatePrivateKey();
  const userB = privateKeyToAccount(userBPk);
  console.log("\nUser B", userB.address);
  {
    const r = await api("/api/admin/chain/free-register-activate", {
      token: adminToken,
      body: {
        userWallet: userB.address,
        sponsorWallet: userA.address,
        packageId: 1
      }
    });
    if (r.status === 200 && r.json?.txHash) {
      pass(steps, "POST free-register-activate (B under A)", r.json.txHash);
    } else {
      fail(steps, "POST free-register-activate (B)", `${r.status} ${r.text.slice(0, 250)}`);
    }

    const bf = await api("/api/admin/users/backfill-from-chain", {
      token: adminToken,
      body: { walletAddress: userB.address }
    });
    if (bf.status === 200 || bf.status === 201) pass(steps, "backfill B");
    else fail(steps, "backfill B", `${bf.status} ${bf.text.slice(0, 200)}`);

    if (userToken) {
      const refs = await api("/api/user/referrals", { token: userToken });
      const team = await api("/api/user/team", { token: userToken });
      const refCount = Array.isArray(refs.json) ? refs.json.length : 0;
      const edgeCount = team.json?.edges?.length ?? 0;
      if (refs.status === 200 && refCount >= 1) {
        const row = refs.json[0];
        pass(
          steps,
          "A referrals includes B + todayTradingActive",
          `n=${refCount} todayActive=${row?.todayTradingActive}`
        );
      } else fail(steps, "A referrals", `${refs.status} n=${refCount}`);
      if (team.status === 200) pass(steps, "A team edges", `n=${edgeCount}`);
      else fail(steps, "A team", `${team.status}`);
    }
  }

  // 10) Admin NFT mint defaults + market on-chain listings
  {
    const d = await api("/api/admin/nft/on-chain-mint/defaults", { token: adminToken });
    if (d.status === 200) pass(steps, "GET on-chain-mint/defaults");
    else fail(steps, "GET on-chain-mint/defaults", `${d.status}`);

    const m = await api("/api/market/listings");
    if (m.status === 200) {
      const n = m.json?.listings?.length ?? 0;
      const src = m.json?.source ?? "?";
      pass(steps, "GET /api/market/listings", `source=${src} n=${n}`);
    } else fail(steps, "GET /api/market/listings", `${m.status}`);
  }

  // 11) Users search
  {
    const r = await api("/api/admin/users/search?take=10", { token: adminToken });
    if (r.status === 200 && (r.json?.total ?? 0) >= 2) {
      pass(steps, "GET admin/users/search", `total=${r.json.total}`);
    } else fail(steps, "GET admin/users/search", `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }

  const ok = steps.filter((s) => s.ok).length;
  const bad = steps.filter((s) => !s.ok);
  console.log("\n========== SUMMARY ==========");
  console.log(`${ok}/${steps.length} passed`);
  if (bad.length) {
    console.log("Failures:");
    for (const b of bad) console.log(` - ${b.name}: ${b.detail ?? ""}`);
    process.exitCode = 1;
  } else {
    console.log("All smoke checks passed.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
