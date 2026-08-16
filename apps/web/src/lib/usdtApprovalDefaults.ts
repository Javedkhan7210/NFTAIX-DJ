/**
 * Default USDT allowance cap for recurring on-chain spend (auto-trade, marketplace pull).
 * Using a large finite value instead of `type(uint256).max` avoids Trust Wallet and similar
 * wallets rejecting the tx with policy / simulation errors on `approve`.
 */
export const DEFAULT_RECURRING_USDT_APPROVE_CAP = "250000";
