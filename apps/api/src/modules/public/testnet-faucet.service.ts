import {
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../shared/config/env.js";
import { appChain, getPublicClient } from "../chain/chain-viem.js";
import { sponsorUserGas } from "./admin-gas-sponsor.service.js";

/** Chains where the public faucet is allowed (never mainnet). */
const FAUCET_CHAIN_IDS = new Set([97, 5611]);

const GAS_DRIP = parseUnits("0.005", 18);
const GAS_MIN = parseUnits("0.0005", 18);
/** Enough tBNB on opBNB testnet for approve + registerAndActivate. */
const REGISTRATION_GAS_MIN = parseUnits("0.0001", 18);
const USDT_MINT = parseUnits("100", 18);
const USDT_MIN = parseUnits("5", 18);
const USDT_COOLDOWN_MS = 45_000;

const lastUsdtMintAt = new Map<string, number>();

const mintAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)"
]);

function normalizePk(raw: string): Hex {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function funderKey(): Hex | null {
  const raw = env.CONTRACT_ADMIN_PRIVATE_KEY?.trim() || env.CHAIN_PRIVATE_KEY?.trim();
  return raw ? normalizePk(raw) : null;
}

export function isTestnetFaucetEnabled(): boolean {
  return FAUCET_CHAIN_IDS.has(env.CHAIN_ID) && Boolean(funderKey()) && Boolean(env.USDT_CONTRACT_ADDRESS);
}

export type FaucetResult = {
  ok: true;
  chainId: number;
  address: Address;
  gasTxHash: Hex | null;
  mintTxHash: Hex | null;
  nativeBalance: string;
  usdtBalanceHint: string;
};

/**
 * Testnet-only: drip tBNB for gas + mint MockUSDT so signup works without an external faucet.
 * Gas drip is never cooldown-blocked when the wallet is below GAS_MIN.
 */
export async function claimTestnetFaucet(rawAddress: string): Promise<FaucetResult> {
  if (!isTestnetFaucetEnabled()) {
    throw Object.assign(
      new Error("Testnet faucet is only available on opBNB/BSC testnet with admin key + USDT configured."),
      { status: 503 }
    );
  }
  if (!isAddress(rawAddress)) {
    throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  }

  const address = getAddress(rawAddress) as Address;
  const key = address.toLowerCase();
  const pk = funderKey()!;
  const account = privateKeyToAccount(pk);
  const publicClient = getPublicClient();
  const wallet = createWalletClient({
    account,
    chain: appChain,
    transport: http(env.CHAIN_RPC_URL)
  });

  const usdt = env.USDT_CONTRACT_ADDRESS as Address;
  let [nativeBal, usdtBal, funderBal] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: usdt, abi: mintAbi, functionName: "balanceOf", args: [address] }),
    publicClient.getBalance({ address: account.address })
  ]);

  let gasTxHash: Hex | null = null;
  let mintTxHash: Hex | null = null;

  // Drip gas whenever the wallet cannot pay registration txs (even if USDT is already funded).
  if (nativeBal < REGISTRATION_GAS_MIN) {
    try {
      const sponsored = await sponsorUserGas(address);
      if (sponsored.gasTxHash) {
        gasTxHash = sponsored.gasTxHash;
        nativeBal = parseUnits(sponsored.nativeBalance, 18);
      }
    } catch {
      if (funderBal < GAS_DRIP + parseUnits("0.001", 18)) {
        throw Object.assign(
          new Error(
            usdtBal >= USDT_MIN
              ? `Wallet ${address} has USDT but needs tBNB for gas. Top up at https://opbnb-testnet-faucet.bnbchain.org/ or retry when the server faucet is funded.`
              : `Wallet ${address} has no USDT yet. Import the pre-funded test wallet, or get tBNB from https://opbnb-testnet-faucet.bnbchain.org/`
          ),
          { status: 503 }
        );
      }
      gasTxHash = await wallet.sendTransaction({
        to: address,
        value: GAS_DRIP,
        chain: appChain,
        account
      });
      await publicClient.waitForTransactionReceipt({ hash: gasTxHash });
    }
  }

  if (usdtBal < USDT_MIN) {
    const prev = lastUsdtMintAt.get(key) ?? 0;
    if (Date.now() - prev < USDT_COOLDOWN_MS) {
      // Already minted recently — do not fail the whole claim if gas was the real need.
    } else {
      mintTxHash = await wallet.writeContract({
        address: usdt,
        abi: mintAbi,
        functionName: "mint",
        args: [address, USDT_MINT],
        chain: appChain,
        account
      });
      await publicClient.waitForTransactionReceipt({ hash: mintTxHash });
      lastUsdtMintAt.set(key, Date.now());
    }
  }

  const [nativeAfter, usdtAfter] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: usdt, abi: mintAbi, functionName: "balanceOf", args: [address] })
  ]);

  if (nativeAfter < REGISTRATION_GAS_MIN && usdtAfter < USDT_MIN) {
    throw Object.assign(new Error("Faucet could not fund tBNB gas. Try again in a few seconds."), {
      status: 503
    });
  }

  return {
    ok: true,
    chainId: env.CHAIN_ID,
    address,
    gasTxHash,
    mintTxHash,
    nativeBalance: formatEther(nativeAfter),
    usdtBalanceHint: formatEther(usdtAfter)
  };
}
