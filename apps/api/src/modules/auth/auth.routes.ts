import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../shared/db/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { requireAuth, AuthRequest } from "./auth.middleware.js";
import { AuthService } from "./auth.service.js";

const service = new AuthService(prisma);

const loginUserIdSchema = z.object({
  publicUserNumber: z.number().int().positive()
});

const loginWalletAddressSchema = z.object({
  walletAddress: z.string().min(16)
});

const loginPublicSchema = z.object({
  identifier: z.string().min(1)
});

const walletRegisterSchema = z.object({
  walletAddress: z.string().min(16),
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  sponsorReferralCode: z.string().optional(),
  registrationTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()
});

const walletLoginSchema = z.object({
  walletAddress: z.string().min(16),
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/)
});

const adminDashboardLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

authRouter.post(
  "/login/user-id",
  asyncHandler(async (req, res) => {
    const body = loginUserIdSchema.parse(req.body);
    const tokens = await service.loginWithPublicUserNumber(body.publicUserNumber);
    return res.json(tokens);
  })
);

authRouter.post(
  "/login/wallet-address",
  asyncHandler(async (req, res) => {
    const body = loginWalletAddressSchema.parse(req.body);
    const tokens = await service.loginWithPublicWalletAddress(body.walletAddress);
    return res.json(tokens);
  })
);

authRouter.post(
  "/login/public",
  asyncHandler(async (req, res) => {
    const body = loginPublicSchema.parse(req.body);
    const tokens = await service.loginWithPublicIdentifier(body.identifier);
    return res.json(tokens);
  })
);

authRouter.post(
  "/login/admin",
  asyncHandler(async (req, res) => {
    const body = adminDashboardLoginSchema.parse(req.body);
    const tokens = await service.loginAdminWithEmailPassword(body.email, body.password);
    return res.json(tokens);
  })
);

authRouter.get(
  "/wallet/nonce",
  asyncHandler(async (req, res) => {
    const address = z.string().min(16).parse(req.query.address);
    const out = await service.issueWalletNonce(address);
    return res.json(out);
  })
);

authRouter.get(
  "/registration-context",
  asyncHandler(async (req, res) => {
    const refRaw = req.query.ref ?? req.query.sponsorReferralCode;
    const ref = refRaw === undefined || refRaw === "" ? undefined : z.string().min(1).parse(String(refRaw));
    const out = await service.getRegistrationContext(ref);
    return res.json(out);
  })
);

authRouter.post(
  "/register/wallet",
  asyncHandler(async (req, res) => {
    const body = walletRegisterSchema.parse(req.body);
    const tokens = await service.registerWithWallet({
      ...body,
      signature: body.signature as `0x${string}`,
      registrationTxHash: body.registrationTxHash
    });
    return res.status(201).json(tokens);
  })
);

authRouter.post(
  "/login/wallet",
  asyncHandler(async (req, res) => {
    const body = walletLoginSchema.parse(req.body);
    const tokens = await service.loginWithWallet({
      ...body,
      signature: body.signature as `0x${string}`
    });
    return res.json(tokens);
  })
);

authRouter.post(
  "/wallet/link",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = walletLoginSchema.parse(req.body);
    const tokens = await service.linkWalletForUser(req.user!.sub, {
      ...body,
      signature: body.signature as `0x${string}`
    });
    return res.json(tokens);
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = z.string().min(1).parse(req.body.refreshToken);
    const tokens = await service.refreshTokens(refreshToken);
    return res.json(tokens);
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    await service.logoutAll(req.user!.sub);
    return res.json({ ok: true });
  })
);
