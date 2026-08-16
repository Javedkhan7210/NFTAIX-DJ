import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { parseAbi, verifyMessage, zeroAddress } from "viem";
import type { PrismaClient } from "@prisma/client";
import { env } from "../../shared/config/env.js";
import { getRedis } from "../../shared/redis.js";
import { generateReferralCodeCandidate } from "../../utils/referral-code.js";
import { getPublicClient } from "../chain/chain-viem.js";
import { ReferralService } from "../referral/referral.service.js";
import { ensureActivationFromRegistrationTx } from "../rewards/activation-reward-mirror.service.js";
import { RewardEngineService } from "../rewards/reward-engine.service.js";
import { registrationAbi } from "../chain/registration-abi.js";
import { verifyPaidRegistrationTx } from "./registration-tx-verify.js";

// Session policy: maximum session time is 1 hour.
// Access + refresh are both capped to 1 hour to prevent silent long-lived sessions.
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_MS = 60 * 60 * 1000;
const NONCE_TTL_SEC = 600;
const WALLET_CHAIN = "opbnb";

type Role = "user" | "admin" | "superadmin";

function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
}

function registrationAddress(): `0x${string}` | null {
  const a = env.REGISTRATION_CONTRACT_ADDRESS;
  return a ? (a as `0x${string}`) : null;
}

function buildSignMessage(nonce: string, address: string): string {
  return `${env.WALLET_SIGN_MESSAGE_TITLE}\nNonce: ${nonce}\nAddress: ${address}`;
}

export class AuthService {
  private readonly referrals: ReferralService;

  constructor(private readonly prisma: PrismaClient) {
    this.referrals = new ReferralService(prisma);
  }

  private async ensureUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = generateReferralCodeCandidate();
      const clash = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!clash) return code;
    }
    throw new Error("Could not allocate referral code");
  }

  /**
   * Registration requires `users(sponsor).registered`.
   * Prefer `rootSponsor()`, then env fallback, then `owner()`.
   */
  private async resolvePlatformRegistrationReferrer(
    registration: `0x${string}`,
    client: ReturnType<typeof getPublicClient>
  ): Promise<`0x${string}`> {
    const code = await client.getBytecode({ address: registration });
    if (!code || code === "0x") {
      throw Object.assign(
        new Error(
          `No contract bytecode at ${registration} via CHAIN_RPC_URL (CHAIN_ID=${env.CHAIN_ID}). Wrong REGISTRATION_CONTRACT_ADDRESS or RPC network.`
        ),
        { status: 500 }
      );
    }

    const isRegistered = async (a: `0x${string}`) => {
      const u = await client.readContract({
        address: registration,
        abi: registrationAbi,
        functionName: "users",
        args: [a]
      });
      return Boolean(u[0]);
    };

    try {
      const root = (await client.readContract({
        address: registration,
        abi: registrationAbi,
        functionName: "rootSponsor"
      })) as `0x${string}`;
      if (await isRegistered(root)) return root;
    } catch {
      /* not new Registration ABI */
    }

    const fb = env.REGISTRATION_REFERRER_FALLBACK;
    if (fb) {
      const a = normalizeWalletAddress(fb) as `0x${string}`;
      if (await isRegistered(a)) return a;
    }

    try {
      const own = (await client.readContract({
        address: registration,
        abi: registrationAbi,
        functionName: "owner"
      })) as `0x${string}`;
      if (await isRegistered(own)) return own;
    } catch {
      /* ignore */
    }

    throw Object.assign(
      new Error(
        `Registration has no valid sponsor on ${registration}. Ensure rootSponsor is registered (constructor seeds it). Set REGISTRATION_REFERRER_FALLBACK if needed. CHAIN_ID=${env.CHAIN_ID}.`
      ),
      { status: 500 }
    );
  }

  /**
   * Registration `register(sponsor)` requires `users(sponsor).registered`.
   * Tries DB-linked sponsor wallets, then pasted 0x referral, then platform rootSponsor.
   */
  private async resolveRegistrationReferrer(
    sponsorId: string | null,
    sponsorReferralCode?: string | null
  ): Promise<{
    onChainReferrer: `0x${string}`;
    sponsorNotOnChain: boolean;
  }> {
    const registrationAddr = env.REGISTRATION_CONTRACT_ADDRESS;
    if (!registrationAddr) {
      throw Object.assign(new Error("REGISTRATION_CONTRACT_ADDRESS is not configured"), { status: 500 });
    }
    const registration = registrationAddr as `0x${string}`;
    const client = getPublicClient();

    const isRegistered = async (w: `0x${string}`) => {
      const u = await client.readContract({
        address: registration,
        abi: registrationAbi,
        functionName: "users",
        args: [w]
      });
      return Boolean(u[0]);
    };

    if (!sponsorId) {
      const onChainReferrer = await this.resolvePlatformRegistrationReferrer(registration, client);
      return { onChainReferrer, sponsorNotOnChain: false };
    }

    const wallets = await this.prisma.walletConnection.findMany({
      where: { userId: sponsorId },
      select: { walletAddress: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { connectedAt: "asc" }]
    });
    if (!wallets.length) {
      throw Object.assign(
        new Error("Sponsor must have a wallet linked for verified on-chain registration."),
        { status: 400 }
      );
    }

    for (const row of wallets) {
      const w = normalizeWalletAddress(row.walletAddress) as `0x${string}`;
      if (await isRegistered(w)) {
        return { onChainReferrer: w, sponsorNotOnChain: false };
      }
    }

    const raw = sponsorReferralCode?.trim();
    if (raw && /^0x[a-fA-F0-9]{40}$/.test(raw)) {
      const pasted = normalizeWalletAddress(raw) as `0x${string}`;
      if (await isRegistered(pasted)) {
        return { onChainReferrer: pasted, sponsorNotOnChain: false };
      }
    }

    const onChainReferrer = await this.resolvePlatformRegistrationReferrer(registration, client);
    return { onChainReferrer, sponsorNotOnChain: true };
  }

  private async resolveSponsorId(sponsorReferralCode?: string | null): Promise<string | null> {
    if (!sponsorReferralCode?.trim()) return null;
    const raw = sponsorReferralCode.trim();
    const code = raw.includes("0x") ? normalizeWalletAddress(raw) : raw;

    const asNum = Number.parseInt(code, 10);
    if (!Number.isNaN(asNum) && String(asNum) === code) {
      const byPublic = await this.prisma.user.findUnique({ where: { publicUserNumber: asNum } });
      if (byPublic) return byPublic.id;
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(raw)) {
      const addr = normalizeWalletAddress(raw);
      const wc = await this.prisma.walletConnection.findFirst({
        where: { walletAddress: { equals: addr, mode: "insensitive" } },
        select: { userId: true }
      });
      if (wc) return wc.userId;
    }

    const sponsor = await this.prisma.user.findFirst({
      where: {
        OR: [{ referralCode: raw }, { referralCode: code }, { id: raw }, { id: code }]
      }
    });
    if (!sponsor) {
      throw Object.assign(new Error("Invalid sponsor referral code"), { status: 400 });
    }
    return sponsor.id;
  }

  async loginWithPublicUserNumber(publicUserNumber: number) {
    if (!Number.isInteger(publicUserNumber) || publicUserNumber < 1) {
      throw Object.assign(new Error("Invalid user ID"), { status: 400 });
    }
    const user = await this.prisma.user.findUnique({ where: { publicUserNumber } });
    if (!user) {
      throw Object.assign(
        new Error(`No account for user ID ${publicUserNumber}. Create an account with your wallet first.`),
        { status: 404 }
      );
    }
    if (!user.isActive) {
      throw Object.assign(new Error("Account inactive"), { status: 403 });
    }
    return this.issueTokenPair(user.id, user.role as Role, false);
  }

  /** Public view-only login: accepts a numeric user ID or `0x` wallet address. */
  async loginWithPublicIdentifier(identifierInput: string) {
    const raw = identifierInput.trim();
    if (!raw) {
      throw Object.assign(new Error("User ID or wallet address is required"), { status: 400 });
    }
    if (/^0x[a-fA-F0-9]{40}$/i.test(raw)) {
      return this.loginWithPublicWalletAddress(raw);
    }
    const asNum = Number.parseInt(raw, 10);
    if (Number.isInteger(asNum) && asNum >= 1 && String(asNum) === raw) {
      return this.loginWithPublicUserNumber(asNum);
    }
    throw Object.assign(new Error("Enter a valid user ID or wallet address (0x…)"), { status: 400 });
  }

  /**
   * Same trust model as {@link loginWithPublicUserNumber}: anyone who knows the wallet can open a read-only-style session
   * (`walletSession: false`). Does not create users or recover from chain-only registrations.
   */
  async loginWithPublicWalletAddress(walletAddressInput: string) {
    const address = normalizeWalletAddress(walletAddressInput);
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
    }
    const wallet = await this.prisma.walletConnection.findUnique({
      where: { walletAddress: address },
      include: { user: true }
    });
    if (!wallet) {
      throw Object.assign(new Error("Wallet not found"), { status: 404 });
    }
    if (wallet.blocked) {
      throw Object.assign(new Error("Wallet blocked"), { status: 403 });
    }
    if (wallet.user.blockedReason) {
      throw Object.assign(new Error(wallet.user.blockedReason), { status: 403 });
    }
    if (!wallet.user.isActive) {
      throw Object.assign(new Error("Account inactive"), { status: 403 });
    }
    return this.issueTokenPair(wallet.userId, wallet.user.role as Role, false);
  }

  async loginAdminWithEmailPassword(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password.trim()) {
      throw Object.assign(new Error("Email and password are required"), { status: 400 });
    }
    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail }
    });
    if (!user || !user.passwordHash) {
      throw Object.assign(new Error("Invalid credentials"), { status: 401 });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw Object.assign(new Error("Invalid credentials"), { status: 401 });
    }
    if (user.role !== "admin" && user.role !== "superadmin") {
      throw Object.assign(new Error("Admin access required"), { status: 403 });
    }
    if (!user.isActive) {
      throw Object.assign(new Error("Account inactive"), { status: 403 });
    }
    if (user.blockedReason) {
      throw Object.assign(new Error(user.blockedReason), { status: 403 });
    }
    return this.issueTokenPair(user.id, user.role as Role, false);
  }

  async issueWalletNonce(walletAddress: string) {
    const address = normalizeWalletAddress(walletAddress);
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
    }
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    const message = buildSignMessage(nonce, address);

    const redis = getRedis();
    if (redis) {
      await redis.set(`wallet:nonce:${address}`, nonce, "EX", NONCE_TTL_SEC);
    } else {
      await this.prisma.walletAuthNonce.deleteMany({ where: { address } });
      await this.prisma.walletAuthNonce.create({
        data: { address, nonce, expiresAt: new Date(Date.now() + NONCE_TTL_SEC * 1000) }
      });
    }

    return { message, nonce, expiresInSec: NONCE_TTL_SEC };
  }

  private async consumeWalletNonce(address: string, nonce: string): Promise<boolean> {
    const redis = getRedis();
    if (redis) {
      const key = `wallet:nonce:${address}`;
      const current = await redis.get(key);
      if (!current || current !== nonce) return false;
      await redis.del(key);
      return true;
    }
    const row = await this.prisma.walletAuthNonce.findFirst({
      where: { address, nonce, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" }
    });
    if (!row) return false;
    await this.prisma.walletAuthNonce.delete({ where: { id: row.id } });
    return true;
  }

  private async verifyWalletSignature(address: string, message: string, signature: `0x${string}`) {
    const ok = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature
    });
    if (!ok) {
      throw Object.assign(new Error("Invalid signature"), { status: 401 });
    }
  }

  async getRegistrationContext(sponsorReferralCode?: string | null) {
    const registrationAddr = env.REGISTRATION_CONTRACT_ADDRESS;
    if (env.CUSTODIAL_USDT_ENABLED || !registrationAddr) {
      return {
        onChainRegistrationRequired: false,
        chainId: env.CHAIN_ID,
        usdt: env.USDT_CONTRACT_ADDRESS ?? null,
        registrationHub: null as string | null,
        registrationFeeWei: null as string | null,
        usdtDecimals: env.USDT_DECIMALS,
        sponsorWallet: null as string | null,
        defaultReferrerWallet: null as string | null,
        onChainReferrerWallet: null as string | null,
        sponsorNotOnChain: false
      };
    }

    let sponsorWallet: string | null = null;
    let sponsorId: string | null = null;
    if (sponsorReferralCode?.trim()) {
      sponsorId = await this.resolveSponsorId(sponsorReferralCode);
      if (sponsorId) {
        const wc = await this.prisma.walletConnection.findFirst({
          where: { userId: sponsorId },
          select: { walletAddress: true },
          orderBy: [{ isPrimary: "desc" }, { connectedAt: "asc" }]
        });
        sponsorWallet = wc?.walletAddress ?? null;
        if (!sponsorWallet) {
          throw Object.assign(
            new Error(
              "This sponsor has no wallet linked yet. Use another sponsor or leave sponsor empty to register without a direct bonus wallet."
            ),
            { status: 400 }
          );
        }
      }
    }

    if (!env.USDT_CONTRACT_ADDRESS) {
      throw Object.assign(new Error("USDT_CONTRACT_ADDRESS is required for on-chain registration."), { status: 500 });
    }

    const client = getPublicClient();
    const pkg = await client.readContract({
      address: registrationAddr as `0x${string}`,
      abi: registrationAbi,
      functionName: "packages",
      args: [1]
    });
    const fee = pkg[0];

    let defaultReferrerWallet: string;
    try {
      defaultReferrerWallet = (await client.readContract({
        address: registrationAddr as `0x${string}`,
        abi: registrationAbi,
        functionName: "rootSponsor"
      })) as string;
    } catch {
      defaultReferrerWallet = (await client.readContract({
        address: registrationAddr as `0x${string}`,
        abi: parseAbi(["function owner() view returns (address)"]),
        functionName: "owner"
      })) as string;
    }

    const { onChainReferrer, sponsorNotOnChain } = await this.resolveRegistrationReferrer(
      sponsorId,
      sponsorReferralCode
    );

    return {
      onChainRegistrationRequired: true,
      chainId: env.CHAIN_ID,
      usdt: env.USDT_CONTRACT_ADDRESS,
      registrationHub: registrationAddr,
      registrationFeeWei: fee.toString(),
      usdtDecimals: env.USDT_DECIMALS,
      sponsorWallet,
      defaultReferrerWallet,
      onChainReferrerWallet: onChainReferrer as string,
      sponsorNotOnChain
    };
  }

  async registerWithWallet(input: {
    walletAddress: string;
    message: string;
    signature: `0x${string}`;
    sponsorReferralCode?: string | null;
    registrationTxHash?: string | null;
  }) {
    const address = normalizeWalletAddress(input.walletAddress);
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
    }

    const nonceMatch = input.message.match(/Nonce:\s*([^\n]+)/);
    const nonce = nonceMatch?.[1]?.trim();
    if (!nonce) {
      throw Object.assign(new Error("Invalid message format"), { status: 400 });
    }
    const consumed = await this.consumeWalletNonce(address, nonce);
    if (!consumed) {
      throw Object.assign(new Error("Invalid or expired nonce"), { status: 401 });
    }

    await this.verifyWalletSignature(address as `0x${string}`, input.message, input.signature);

    const existingWallet = await this.prisma.walletConnection.findUnique({
      where: { walletAddress: address },
      include: { user: true }
    });
    if (existingWallet) {
      if (existingWallet.blocked) {
        throw Object.assign(new Error("Wallet blocked"), { status: 403 });
      }
      if (existingWallet.user.blockedReason) {
        throw Object.assign(new Error(existingWallet.user.blockedReason), { status: 403 });
      }
      if (!existingWallet.user.isActive) {
        throw Object.assign(new Error("Account inactive"), { status: 403 });
      }
      await this.prisma.walletConnection.update({
        where: { id: existingWallet.id },
        data: { lastSignatureAt: new Date() }
      });
      return this.issueTokenPair(existingWallet.userId, existingWallet.user.role as Role, true);
    }

    const sponsorId = await this.resolveSponsorId(input.sponsorReferralCode);
    const referralCode = await this.ensureUniqueReferralCode();

    if (!env.CUSTODIAL_USDT_ENABLED) {
      const registrationForReg = env.REGISTRATION_CONTRACT_ADDRESS;
      if (registrationForReg) {
        const rawTx = input.registrationTxHash?.trim();
        if (!rawTx || !/^0x[a-fA-F0-9]{64}$/.test(rawTx)) {
          throw Object.assign(
            new Error(
              "On-chain registration is required: call Registration.register(sponsor) then activate(1) with USDT, then sign up with the activate transaction hash."
            ),
            { status: 400 }
          );
        }
        const txHash = rawTx as `0x${string}`;
        const { onChainReferrer } = await this.resolveRegistrationReferrer(
          sponsorId,
          input.sponsorReferralCode
        );
        await verifyPaidRegistrationTx({
          txHash,
          expectedUser: address as `0x${string}`,
          expectedOnChainReferrer: onChainReferrer
        });
        const dup = await this.prisma.user.findFirst({ where: { registrationTxHash: txHash } });
        if (dup) {
          throw Object.assign(new Error("This registration transaction was already used."), { status: 409 });
        }
        const user = await this.prisma.$transaction(async (tx) => {
          return tx.user.create({
            data: {
              email: null,
              passwordHash: null,
              referralCode,
              sponsorId,
              custodialUsdtBalance: 0,
              registrationTxHash: txHash,
              walletConnections: {
                create: { chain: WALLET_CHAIN, walletAddress: address, isPrimary: true, lastSignatureAt: new Date() }
              }
            }
          });
        });
        await this.referrals.attachNewUserToTree(user.id, sponsorId);
        await ensureActivationFromRegistrationTx(this.prisma, user.id, txHash);
        return this.issueTokenPair(user.id, user.role as Role, true);
      }

      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: null,
            passwordHash: null,
            referralCode,
            sponsorId,
            custodialUsdtBalance: 0,
            walletConnections: {
              create: { chain: WALLET_CHAIN, walletAddress: address, isPrimary: true, lastSignatureAt: new Date() }
            }
          }
        });
        return created;
      });

      await this.referrals.attachNewUserToTree(user.id, sponsorId);
      return this.issueTokenPair(user.id, user.role as Role, true);
    }

    const credit = env.REGISTRATION_USDT_CREDIT;
    const { user, activationId, activationAmount } = await this.prisma.$transaction(async (tx) => {
      const baseTier = await tx.packageTier.findFirst({
        where: { isActive: true, isBaseEntry: true }
      });
      if (!baseTier) {
        throw Object.assign(
          new Error("Registration tier (base entry / isBaseEntry) is not configured in PackageTier seed."),
          { status: 500 }
        );
      }
      const price = Number(baseTier.activationAmount);
      if (credit < price) {
        throw Object.assign(
          new Error(
            `REGISTRATION_USDT_CREDIT (${credit}) must be at least the entry package price ($${price}). Update server configuration.`
          ),
          { status: 500 }
        );
      }

      const created = await tx.user.create({
        data: {
          email: null,
          passwordHash: null,
          referralCode,
          sponsorId,
          custodialUsdtBalance: credit - price,
          walletConnections: {
            create: { chain: WALLET_CHAIN, walletAddress: address, isPrimary: true, lastSignatureAt: new Date() }
          },
          packageActivations: {
            create: { tierId: baseTier.id, isCurrent: true }
          }
        }
      });

      const activation = await tx.packageActivation.findFirstOrThrow({
        where: { userId: created.id, isCurrent: true }
      });

      const ledgerRows: { userId: string; amount: number; reason: string }[] = [];
      if (credit > 0) {
        ledgerRows.push({ userId: created.id, amount: credit, reason: "registration_usdt_credit" });
      }
      ledgerRows.push({
        userId: created.id,
        amount: -price,
        reason: `subscription_activation_$${price}_registration`
      });
      await tx.usdtLedger.createMany({
        data: ledgerRows.map((r) => ({
          userId: r.userId,
          amount: r.amount,
          reason: r.reason
        }))
      });

      return { user: created, activationId: activation.id, activationAmount: price };
    });

    await this.referrals.attachNewUserToTree(user.id, sponsorId);

    const rewardEngine = new RewardEngineService(this.prisma);
    await rewardEngine.processActivationDistribution(
      user.id,
      activationId,
      activationAmount,
      sponsorId ?? undefined
    );

    return this.issueTokenPair(user.id, user.role as Role, true);
  }

  async loginWithWallet(input: { walletAddress: string; message: string; signature: `0x${string}` }) {
    const address = normalizeWalletAddress(input.walletAddress);
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
    }

    const nonceMatch = input.message.match(/Nonce:\s*([^\n]+)/);
    const nonce = nonceMatch?.[1]?.trim();
    if (!nonce) {
      throw Object.assign(new Error("Invalid message format"), { status: 400 });
    }
    const consumed = await this.consumeWalletNonce(address, nonce);
    if (!consumed) {
      throw Object.assign(new Error("Invalid or expired nonce"), { status: 401 });
    }

    await this.verifyWalletSignature(address as `0x${string}`, input.message, input.signature);

    const wallet = await this.prisma.walletConnection.findUnique({
      where: { walletAddress: address },
      include: { user: true }
    });
    if (!wallet) {
      // Recovery path: wallet already registered on-chain but DB row was never created.
      const registration = registrationAddress();
      if (!registration) {
        throw Object.assign(
          new Error("No account for this wallet. Create an account (register + activate) first."),
          { status: 404 }
        );
      }

      const client = getPublicClient();

      let registered = false;
      let sponsorWalletOnChain = "";
      try {
        const onChainUser = await client.readContract({
          address: registration,
          abi: registrationAbi,
          functionName: "users",
          args: [address as `0x${string}`]
        });
        registered = Boolean(onChainUser[0]);
        sponsorWalletOnChain = String(onChainUser[3] ?? "").toLowerCase();
      } catch {
        throw Object.assign(
          new Error(
            "Could not verify wallet on-chain. Check API CHAIN_RPC_URL / REGISTRATION_CONTRACT_ADDRESS (opBNB testnet 5611)."
          ),
          { status: 502 }
        );
      }

      if (!registered) {
        throw Object.assign(
          new Error("No account for this wallet. Create an account (register + activate on-chain) first."),
          { status: 404 }
        );
      }

      // Best-effort sponsor linking: map on-chain sponsor wallet → existing userId if present.
      let sponsorId: string | null = null;
      if (/^0x[a-f0-9]{40}$/.test(sponsorWalletOnChain)) {
        const sponsorWallet = await this.prisma.walletConnection.findUnique({
          where: { walletAddress: sponsorWalletOnChain },
          select: { userId: true }
        });
        sponsorId = sponsorWallet?.userId ?? null;
      }

      const referralCode = await this.ensureUniqueReferralCode();
      const user = await this.prisma.$transaction(async (tx) => {
        return tx.user.create({
          data: {
            email: null,
            passwordHash: null,
            referralCode,
            sponsorId,
            custodialUsdtBalance: 0,
            walletConnections: {
              create: { chain: WALLET_CHAIN, walletAddress: address, isPrimary: true, lastSignatureAt: new Date() }
            }
          }
        });
      });

      await this.referrals.attachNewUserToTree(user.id, sponsorId);
      return this.issueTokenPair(user.id, user.role as Role, true);
    }
    if (wallet.blocked) {
      throw Object.assign(new Error("Wallet blocked"), { status: 403 });
    }
    if (wallet.user.blockedReason) {
      throw Object.assign(new Error(wallet.user.blockedReason), { status: 403 });
    }
    if (!wallet.user.isActive) {
      throw Object.assign(new Error("Account inactive"), { status: 403 });
    }

    await this.prisma.walletConnection.update({
      where: { id: wallet.id },
      data: { lastSignatureAt: new Date() }
    });

    return this.issueTokenPair(wallet.userId, wallet.user.role as Role, true);
  }

  async linkWalletForUser(
    userId: string,
    input: { walletAddress: string; message: string; signature: `0x${string}` }
  ) {
    const address = normalizeWalletAddress(input.walletAddress);
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
    }

    const nonceMatch = input.message.match(/Nonce:\s*([^\n]+)/);
    const nonce = nonceMatch?.[1]?.trim();
    if (!nonce) {
      throw Object.assign(new Error("Invalid message format"), { status: 400 });
    }
    const consumed = await this.consumeWalletNonce(address, nonce);
    if (!consumed) {
      throw Object.assign(new Error("Invalid or expired nonce"), { status: 401 });
    }

    await this.verifyWalletSignature(address as `0x${string}`, input.message, input.signature);

    const existing = await this.prisma.walletConnection.findUnique({
      where: { walletAddress: address },
      include: { user: true }
    });
    if (existing && existing.userId !== userId) {
      throw Object.assign(new Error("Wallet already registered"), { status: 409 });
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.isActive) {
      throw Object.assign(new Error("Account inactive"), { status: 403 });
    }
    if (user.blockedReason) {
      throw Object.assign(new Error(user.blockedReason), { status: 403 });
    }

    if (existing?.blocked) {
      throw Object.assign(new Error("Wallet blocked"), { status: 403 });
    }

    if (existing) {
      await this.prisma.walletConnection.update({
        where: { id: existing.id },
        data: { lastSignatureAt: new Date() }
      });
    } else {
      const count = await this.prisma.walletConnection.count({ where: { userId } });
      await this.prisma.walletConnection.create({
        data: {
          userId,
          chain: WALLET_CHAIN,
          walletAddress: address,
          isPrimary: count === 0,
          lastSignatureAt: new Date()
        }
      });
    }

    return this.issueTokenPair(user.id, user.role as Role, true);
  }

  private async issueTokenPair(userId: string, role: Role, walletSession: boolean) {
    const accessToken = jwt.sign({ sub: userId, role, walletSession }, env.JWT_ACCESS_SECRET, {
      expiresIn: ACCESS_TTL_SEC
    });
    const refreshToken = jwt.sign({ sub: userId, walletSession }, env.JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TTL_MS / 1000
    });
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) }
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC };
  }

  async refreshTokens(refreshToken: string) {
    let payload: { sub: string; walletSession?: boolean };
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; walletSession?: boolean };
    } catch {
      throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
    }

    const walletSession = typeof payload.walletSession === "boolean" ? payload.walletSession : true;

    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } }
    });

    let matchedId: string | null = null;
    for (const t of tokens) {
      if (await bcrypt.compare(refreshToken, t.tokenHash)) {
        matchedId = t.id;
        break;
      }
    }
    if (!matchedId) {
      throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    if (!user.isActive) {
      throw Object.assign(new Error("Account inactive"), { status: 403 });
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedId },
      data: { revokedAt: new Date() }
    });

    const accessToken = jwt.sign(
      { sub: user.id, role: user.role, walletSession },
      env.JWT_ACCESS_SECRET,
      { expiresIn: ACCESS_TTL_SEC }
    );
    const newRefresh = jwt.sign({ sub: user.id, walletSession }, env.JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TTL_MS / 1000
    });
    const tokenHash = await bcrypt.hash(newRefresh, 10);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) }
    });

    return { accessToken, refreshToken: newRefresh, expiresIn: ACCESS_TTL_SEC };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
}
