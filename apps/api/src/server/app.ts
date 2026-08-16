import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { authStrictLimiter, globalLimiter } from "../middleware/rate-limit.js";
import { chainRouter } from "../modules/chain/chain.routes.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { publicRouter } from "../modules/public/public.routes.js";
import { incomeRouter } from "../modules/income/income.routes.js";
import { marketRouter } from "../modules/market/market.routes.js";
import { nftRouter } from "../modules/nft/nft.routes.js";
import { packageRouter } from "../modules/packages/package.routes.js";
import { rankRouter } from "../modules/ranks/rank.routes.js";
import { rewardRouter } from "../modules/rewards/reward.routes.js";
import { tradingRouter } from "../modules/trading/trading.routes.js";
import { userRouter } from "../modules/user/user.routes.js";
import { walletRouter } from "../modules/wallet/wallet.routes.js";
import { env } from "../shared/config/env.js";
import { errorHandler } from "./error-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const marketNftStatic = path.join(__dirname, "../../public/market-nfts");
const dashboardAssetStatic = path.join(__dirname, "../../public/dashboard-assets");

export const createApp = () => {
  const app = express();
  // Behind nginx/ALB/etc. `X-Forwarded-For` is set; express-rate-limit requires trust proxy not stay false.
  // One hop matches a single reverse proxy in front of Node (do not use `true` — rate-limit rejects it).
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors(env.CORS_ORIGIN ? { origin: env.CORS_ORIGIN, credentials: true } : {}));
  app.use(express.json({ limit: "20mb" }));
  app.use(globalLimiter);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/public", publicRouter);

  app.use("/market-nfts", (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  });
  app.use("/market-nfts", express.static(marketNftStatic));
  app.use("/dashboard-assets", express.static(dashboardAssetStatic));

  app.use("/api/chain", chainRouter);

  app.use("/api/auth", authStrictLimiter, authRouter);

  app.use("/api/user", userRouter);
  app.use("/api/packages", packageRouter);
  app.use("/api/trading", tradingRouter);
  app.use("/api/rewards", rewardRouter);
  app.use("/api/income", incomeRouter);
  app.use("/api/market", marketRouter);
  app.use("/api/nfts", nftRouter);
  app.use("/api/ranks", rankRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/admin", adminRouter);
  app.use(errorHandler);
  return app;
};
