/**
 * TEMPORARY — testnet-only: admin pays native gas when a user wallet is short on tBNB.
 * Remove or gate behind env before mainnet.
 */
import {
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../shared/config/env.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";

const TESTNET_CHAIN_IDS = new Set([97, 5611]);

/** Target drip — enough for approve + buy on opBNB testnet. */
const TARGET_GAS_DRIP = parseUnits("0.00006", 18);
const MIN_USER_GAS = parseUnits("0.00006", 18);
const ADMIN_RESERVE = parseUnits("0.000006", 18);
const MIN_SEND = parseUnits("0.00002", 18);
const COOLDOWN_MS = 20_000;

/**
 * Built-in testnet fallbacks when deployer is empty.
 * Prefer batch-1 W2–W5 (W1/deployer are often drained after redeploys).
 */
const TESTNET_FALLBACK_FUNDER_PKS: Hex[] = [
  // batch-1 W2–W5 (see apps/api/scripts/output/test-wallets-5-new.json)
  "0x02a6d791b5cc66075090c9d370e317586305d5fcdcc94ea5f99088f06a2228b3",
  "0xd8e07a15f8c9b3598eb75f067d7738466bccbb7bf4f11667cc2bf4b714f76677",
  "0xa93d3d321179d98eae5a9e349110a5b4097bd44ba98131f1b7d9f1b000f27a85",
  "0x4a35c4683f51dafaf3ee18928c7246d8ee865372927e44986ff0bda335d5a152",
  // batch-2 W3–W5 (see apps/api/scripts/output/test-wallets-5-batch2.json)
  "0xfb35ea4bbb9aaa9d4b5d0dec110b9a336f049a6d33dc2e3ece9011cf655bf0f8",
  "0x6ffc205924f3a2a06c2d730fefa353ccb0ce5356d777ba5f85d367e9b399affc",
  "0x1f28963102cd34aa5e36a0f8193d13f3b53a37b8579b887d4964949189e93ab0",
  // legacy fallbacks (may be empty)
  "0xef9612283e638ac0c63398562de793f3f47e8fd862ee855f7a46b1eaf967464c",
  "0xbe7c2c8aa7f66286e52c89b6f3a2d5e98bb504d9c1fadbe274c8648b8f4ef8e8",
  "0xfb38506cbd3137ba90bcbafdd36e0e1eb05d9c729feac7438efa6f78d593e8e1"
];

const lastSponsorAt = new Map<string, number>();

function normalizePk(raw: string): Hex {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function sponsorKeys(): Hex[] {
  const seen = new Set<string>();
  const keys: Hex[] = [];
  const push = (raw?: string | null) => {
    if (!raw?.trim()) return;
    const pk = normalizePk(raw.trim());
    const id = pk.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(pk);
  };

  push(env.CONTRACT_ADMIN_PRIVATE_KEY);
  push(env.CHAIN_PRIVATE_KEY);
  if (env.CHAIN_ID === 5611) {
    for (const pk of TESTNET_FALLBACK_FUNDER_PKS) push(pk);
  }
  return keys;
}

export function isAdminGasSponsorEnabled(): boolean {
  if (!TESTNET_CHAIN_IDS.has(env.CHAIN_ID)) return false;
  return sponsorKeys().length > 0;
}

export type AdminGasSponsorResult = {
  ok: true;
  chainId: number;
  address: Address;
  gasTxHash: Hex | null;
  nativeBalance: string;
  sponsored: boolean;
  message: string;
};

export async function sponsorUserGas(rawAddress: string): Promise<AdminGasSponsorResult> {
  if (!isAdminGasSponsorEnabled()) {
    throw Object.assign(new Error("Admin gas sponsor is only enabled on testnet."), { status: 503 });
  }
  if (!isAddress(rawAddress)) {
    throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  }

  const address = getAddress(rawAddress) as Address;
  const key = address.toLowerCase();
  const publicClient = getPublicClient();

  const userBal = await publicClient.getBalance({ address });

  if (userBal >= MIN_USER_GAS) {
    return {
      ok: true,
      chainId: env.CHAIN_ID,
      address,
      gasTxHash: null,
      nativeBalance: formatEther(userBal),
      sponsored: false,
      message: "Wallet already has enough tBNB for gas."
    };
  }

  const prev = lastSponsorAt.get(key) ?? 0;
  if (Date.now() - prev < COOLDOWN_MS) {
    throw Object.assign(
      new Error("Gas sponsor was requested recently. Wait ~20s and try again."),
      { status: 429 }
    );
  }

  const funders = sponsorKeys();
  if (funders.length === 0) {
    throw Object.assign(new Error("No gas sponsor keys configured."), { status: 503 });
  }

  let gasTxHash: Hex | null = null;
  let send = 0n;
  let funderAddr = "";

  for (const pk of funders) {
    const account = privateKeyToAccount(pk);
    const adminBal = await publicClient.getBalance({ address: account.address });
    const available = adminBal > ADMIN_RESERVE ? adminBal - ADMIN_RESERVE : 0n;
    const candidate = available >= TARGET_GAS_DRIP ? TARGET_GAS_DRIP : available;
    if (candidate < MIN_SEND) continue;

    const wallet = createWalletClient({
      account,
      chain: appChain,
      transport: http(env.CHAIN_RPC_URL)
    });

    gasTxHash = await wallet.sendTransaction({
      to: address,
      value: candidate,
      chain: appChain,
      account
    });
    await publicClient.waitForTransactionReceipt({ hash: gasTxHash });
    send = candidate;
    funderAddr = account.address;
    break;
  }

  if (!gasTxHash || send === 0n) {
    throw Object.assign(
      new Error(
        "Admin gas wallets are empty. Top up deployer 0x1F4Ee796287bd1d6c5336F18bFaE81d02aAa252f at https://opbnb-testnet-faucet.bnbchain.org/ or drip tBNB to your MetaMask wallet directly, then retry."
      ),
      { status: 503 }
    );
  }

  lastSponsorAt.set(key, Date.now());

  const nativeAfter = await publicClient.getBalance({ address });

  return {
    ok: true,
    chainId: env.CHAIN_ID,
    address,
    gasTxHash,
    nativeBalance: formatEther(nativeAfter),
    sponsored: true,
    message: `Gas funder ${funderAddr.slice(0, 10)}… sent ${formatEther(send)} tBNB for gas.`
  };
}
