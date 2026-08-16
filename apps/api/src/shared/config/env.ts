import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

/** `apps/api` root — works regardless of PM2/systemd cwd (often monorepo root). */
const apiPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** `override: true` so apps/api/.env wins over stale shell exports (e.g. old USDT_ADDRESS). */
dotenv.config({ path: path.join(apiPackageRoot, ".env"), override: true });
/** Optional extra overrides when cwd is intentionally `apps/api`. */
dotenv.config({ override: true });

const emptyToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

/** Comma-separated origins for multiple frontends (user app + admin app). */
const corsOrigins = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string" || !v.trim()) return undefined;
    const parts = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return parts;
  },
  z.union([z.string(), z.array(z.string())]).optional()
);

const optionalAddress = z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional());

/** Integer env vars: empty or non-numeric uses default (avoids `z.coerce.number()` → NaN on typos like `160f`). */
function coercedIntEnv(min: number, max: number, defaultVal: number) {
  return z.preprocess((v) => {
    if (v === undefined || v === null) return defaultVal;
    if (typeof v === "string" && v.trim() === "") return defaultVal;
    const n = Number(v);
    if (!Number.isFinite(n)) return defaultVal;
    return n;
  }, z.number().int().min(min).max(max));
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  CORS_ORIGIN: corsOrigins,
  REDIS_URL: z.string().optional(),
  /** Optional system user id (cuid) that receives activation “creator” allocation (10%). */
  PROJECT_CREATOR_USER_ID: z.string().optional(),
  CHAIN_RPC_URL: z.string().url(),
  CHAIN_PRIVATE_KEY: z.string().min(16),
  /** Optional. Owner key for Registration / GlobalPool / Treasury admin ops. */
  CONTRACT_ADMIN_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  /**
   * Optional. Marketplace owner key for setBot / runBot. Defaults to CHAIN_PRIVATE_KEY
   * (must equal on-chain marketplace `owner()`).
   */
  MARKETPLACE_OWNER_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  /**
   * When false (default): registration does not credit DB "USDT" or auto-activate the entry tier; users must pay on-chain.
   * Set to true for legacy custodial demo (REGISTRATION_USDT_CREDIT + POST /packages/activate).
   */
  CUSTODIAL_USDT_ENABLED: z.preprocess(
    (v) => v === true || v === "true" || v === "1",
    z.boolean()
  ).default(false),
  /** USDT credited to custodial balance on wallet registration (only if CUSTODIAL_USDT_ENABLED). */
  REGISTRATION_USDT_CREDIT: z.coerce.number().nonnegative().default(100),
  CHAIN_ID: z.coerce.number().int().default(97),
  /** Match deployed MockUSDT / USDT (default 18 on testnet script). */
  USDT_DECIMALS: z.coerce.number().int().min(6).max(18).default(18),
  /** Mock USDT / USDT token users approve for Registration / Marketplace. */
  USDT_CONTRACT_ADDRESS: optionalAddress,
  /**
   * When > 0 and `USDT_CONTRACT_ADDRESS` is set, `GET /api/income/wallet` includes an approximate sum of USDT
   * `Transfer` events **to** the user’s primary wallet over this many blocks (chunked RPC). 0 disables the scan.
   */
  INCOME_USDT_INBOUND_LOOKBACK_BLOCKS: z.coerce.number().int().min(0).max(500_000).default(80_000),
  /**
   * Max milliseconds to wait for the optional USDT `Transfer` scan in `GET /api/income/wallet` before returning
   * with `chainInboundUsdtApprox: null` (RPC work may continue in the background — not cancelled). 0 = wait until done.
   * Default caps slow RPC from blocking the Income page.
   */
  INCOME_WALLET_CHAIN_INBOUND_TIMEOUT_MS: z.coerce.number().int().min(0).max(120_000).default(4_000),
  /** Registration (register / activate / upgrade). */
  REGISTRATION_CONTRACT_ADDRESS: optionalAddress,
  /** NFTAIX platform ERC20 (1M supply; distributed on register/upgrade). */
  NFTAIX_TOKEN_ADDRESS: optionalAddress,
  /** NFTMarketplace (buy / listHeld / bot). */
  MARKETPLACE_CONTRACT_ADDRESS: optionalAddress,
  /** Rewards (daily income escrow). */
  REWARDS_CONTRACT_ADDRESS: optionalAddress,
  /** GlobalPool. */
  GLOBAL_POOL_CONTRACT_ADDRESS: optionalAddress,
  /** Treasury (burn). */
  TREASURY_CONTRACT_ADDRESS: optionalAddress,
  /** LiquidityManager. */
  LIQUIDITY_MANAGER_CONTRACT_ADDRESS: optionalAddress,
  /** Optional sponsor EOA if rootSponsor resolution fails. */
  REGISTRATION_REFERRER_FALLBACK: optionalAddress,
  CHAIN_START_BLOCK: z.preprocess(emptyToUndefined, z.coerce.bigint().optional()),
  /**
   * Max blocks per `eth_getLogs` request (public opBNB RPC often rejects >~100).
   * Catch-up/backfill halves automatically on "limit exceeded".
   */
  CHAIN_GET_LOGS_MAX_BLOCK_RANGE: z.coerce.number().int().min(1).max(10_000).default(80),
  /** Prefix for ipfs:// CIDs when fetching NFT metadata/images (no trailing slash). */
  NFT_IPFS_GATEWAY: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /**
   * How many queue slots the API scans for secondary listings (each candidate may trigger RPC + metadata fetch).
   * Override per request with `GET /api/market/listings?maxScan=…` (capped 20–300).
   */
  MARKET_NFT_QUEUE_MAX_SCAN: coercedIntEnv(20, 300, 160),
  /**
   * Optional. Signs marketplace bot txs (gas only). User funds move via USDT allowance.
   * When set, `main.ts` schedules the bot on each `TRADING_PERIOD_HOURS` boundary (default 15h).
   */
  AUTO_TRADE_EXECUTOR_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  /**
   * Rolling window (hours) for daily trading allowance reset. Default 15. Clamped 1–168.
   * Auto-trade bot aligns to the same period boundaries when `AUTO_TRADE_KEEPER_INTERVAL_HOURS` is unset.
   */
  TRADING_PERIOD_HOURS: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 15;
    const n = Number(v);
    if (!Number.isFinite(n)) return 15;
    return Math.min(168, Math.max(1, Math.floor(n)));
  }, z.number().int()),
  /**
   * Hours between sequential bot runs. Default: same as `TRADING_PERIOD_HOURS`. Clamped 1–168.
   */
  AUTO_TRADE_KEEPER_INTERVAL_HOURS: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 15;
    const n = Number(v);
    if (!Number.isFinite(n)) return 15;
    return Math.min(168, Math.max(1, Math.floor(n)));
  }, z.number().int()),
  /**
   * UTC hour (0–23) — legacy; exposed in `/auto-trade-status` only. Scheduling uses `TRADING_PERIOD_HOURS` boundaries.
   */
  AUTO_TRADE_KEEPER_UTC_HOUR: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(23, Math.max(0, Math.floor(n)));
  }, z.number().int()),
  /**
   * UTC minute (0–59) anchor within each hour for the first keeper run. Default 0.
   */
  AUTO_TRADE_KEEPER_UTC_MINUTE: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(59, Math.max(0, Math.floor(n)));
  }, z.number().int()),
  /**
   * When true, sequential resale bot may fall back to primary buy if no queued resale fits.
   * Default true.
   */
  BOT_SEQUENTIAL_PRIMARY_FALLBACK: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return true;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }, z.boolean()),
  /**
   * Max NFT purchases per user per sequential bot run.
   * Default 50. Clamped 1–200.
   */
  BOT_SEQUENTIAL_MAX_PURCHASES_PER_USER: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 50;
    const n = Number(v);
    if (!Number.isFinite(n)) return 50;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }, z.number().int()),
  /**
   * Max successful primary buys per keeper run. `0` disables new NFT mints (resale-only bot).
   * Default 24. Clamped 0–100.
   */
  AUTO_TRADE_MAX_PRIMARY_BUYS_PER_RUN: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 24;
    const n = Number(v);
    if (!Number.isFinite(n)) return 24;
    return Math.min(100, Math.max(0, Math.floor(n)));
  }, z.number().int()),
  /**
   * Max successful secondary trades per keeper run.
   * Default 24. Clamped 1–100.
   */
  AUTO_TRADE_MAX_SECONDARY_TRADES_PER_RUN: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 24;
    const n = Number(v);
    if (!Number.isFinite(n)) return 24;
    return Math.min(100, Math.max(1, Math.floor(n)));
  }, z.number().int()),
  /**
   * When true, daily job also runs legacy keeper paths (unused on new stack).
   * Default false — NFTMarketplace `runBot` is the primary path.
   */
  LEGACY_AUTO_TRADE_KEEPER: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return false;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }, z.boolean()),
  /** Max NFT purchases per admin "Trade Now" click (package-limit fill loop). Default 50. */
  ADMIN_MANUAL_TRADE_MAX_PURCHASES: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return 50;
    const n = Number(v);
    if (!Number.isFinite(n)) return 50;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }, z.number().int()),
  /**
   * Admin Trade Now: primary buy when no FIFO resale ≤ wallet.
   * Default true. Set false for resale-only admin trades.
   */
  ADMIN_MANUAL_TRADE_PRIMARY_FALLBACK: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return true;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }, z.boolean()),
  /** Optional. Treasury wallet for `POST /api/admin/airdrop/execute` ERC20 `transfer` batch. */
  AIRDROP_SIGNER_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  /**
   * First line of the wallet sign-in message (`personal_sign`). Shown in the wallet signature prompt.
   * Single line only (newlines are stripped). Default: NFTAix branding + chain hint.
   */
  WALLET_SIGN_MESSAGE_TITLE: z.preprocess((v) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      return "NFTAix / opBNB sign-in";
    }
    const s = String(v).trim().replace(/\r?\n/g, " ");
    return s.length > 120 ? s.slice(0, 120) : s;
  }, z.string().min(1).max(120)),
  /**
   * When true, after daily global pool ledger run, call GlobalPool.distributeDay on-chain.
   */
  GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED: z.preprocess(
    (v) => v === true || v === "true" || v === "1",
    z.boolean()
  ).default(false),
  /** GlobalPool `owner()` key — must match on-chain owner. */
  GLOBAL_POOL_PAYOUT_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  /**
   * `global_pool` (default): USDT paid via GlobalPool.distributeDay.
   * `wallet`: payout key sends ERC20 transfer from its own USDT balance.
   */
  GLOBAL_POOL_PAYOUT_SOURCE: z.preprocess((v) => {
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (s === "wallet") return "wallet";
    return "global_pool";
  }, z.enum(["global_pool", "wallet"])).default("global_pool"),
  /**
   * USDT destination for global-pool burns (optional override).
   * Defaults to TREASURY_CONTRACT_ADDRESS.
   */
  GLOBAL_POOL_BURN_WALLET_ADDRESS: optionalAddress
}).superRefine((val, ctx) => {
  if (val.NODE_ENV !== "production") return;
  const requiredProdAddresses: Array<keyof typeof val> = [
    "USDT_CONTRACT_ADDRESS",
    "REGISTRATION_CONTRACT_ADDRESS",
    "MARKETPLACE_CONTRACT_ADDRESS",
    "REWARDS_CONTRACT_ADDRESS",
    "GLOBAL_POOL_CONTRACT_ADDRESS",
    "TREASURY_CONTRACT_ADDRESS",
    "LIQUIDITY_MANAGER_CONTRACT_ADDRESS"
  ];
  for (const key of requiredProdAddresses) {
    if (!val[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${String(key)} is required in production.`,
        path: [key]
      });
    }
  }
  if (!val.GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED must be true in production (global pool is on-chain only).",
      path: ["GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED"]
    });
  }
  const poolPayoutKey =
    val.GLOBAL_POOL_PAYOUT_PRIVATE_KEY?.trim() ||
    val.CONTRACT_ADMIN_PRIVATE_KEY?.trim() ||
    val.CHAIN_PRIVATE_KEY?.trim();
  if (val.GLOBAL_POOL_ONCHAIN_PAYOUT_ENABLED && !poolPayoutKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "GLOBAL_POOL_PAYOUT_PRIVATE_KEY or CONTRACT_ADMIN_PRIVATE_KEY is required when global pool on-chain payout is enabled.",
      path: ["GLOBAL_POOL_PAYOUT_PRIVATE_KEY"]
    });
  }
});

export const env = envSchema.parse(process.env);
