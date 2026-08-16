/**
 * Share link for onboarding: `ref` may be `0x` wallet (preferred), referral code, or numeric user id (same as sponsor field).
 * Example: `/ref/0xabc…`, `/ref/ABC12`, `/ref/42`.
 */
export function getReferralUrl(ref: string): string {
  if (typeof window === "undefined") {
    return `https://nftaix.app/ref/${ref}`;
  }
  return `${window.location.origin}/ref/${ref}`;
}
