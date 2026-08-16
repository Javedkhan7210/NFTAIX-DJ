import rateLimit from "express-rate-limit";

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});

export const authStrictLimiter = rateLimit({
  windowMs: 60_000,
  // Dev/e2e needs many wallet signups; keep production tight.
  max: process.env.NODE_ENV === "production" ? 15 : 200,
  standardHeaders: true,
  legacyHeaders: false
});
