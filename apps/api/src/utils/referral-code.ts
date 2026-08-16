import { randomBytes } from "crypto";

/** Short alphanumeric referral code (uppercase hex slice). */
export function generateReferralCodeCandidate(): string {
  return randomBytes(5).toString("hex").slice(0, 10).toUpperCase();
}
