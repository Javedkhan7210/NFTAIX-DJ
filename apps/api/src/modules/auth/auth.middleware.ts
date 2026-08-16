import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../shared/db/prisma.js";
import { env } from "../../shared/config/env.js";

export type Role = "user" | "admin" | "superadmin";
export type JwtPayload = { sub: string; role: Role; walletSession?: boolean };

/** User role needs an explicit wallet-signed session for mutating routes; legacy tokens omit walletSession and count as full access. */
export function hasFullWalletAccess(payload: JwtPayload): boolean {
  if (payload.role !== "user") return true;
  return payload.walletSession !== false;
}

export type AuthRequest = Request & { user?: JwtPayload };

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Missing token" });
  try {
    req.user = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    if (req.user.role === "user") {
      const u = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { isActive: true, blockedReason: true }
      });
      if (!u?.isActive) {
        return res.status(403).json({ message: "Account inactive" });
      }
      if (u.blockedReason) {
        return res.status(403).json({ message: u.blockedReason });
      }
    }
    next();
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ message: "Invalid token" });
    }
    next(e);
  }
};

export const requireFullAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !hasFullWalletAccess(req.user)) {
    return res.status(403).json({ message: "Wallet not connected" });
  }
  return next();
};

export const requireRole = (roles: Role[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: "Forbidden" });
  return next();
};
