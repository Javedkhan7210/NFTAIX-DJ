import { parseAbi, parseAbiItem } from "viem";

/** NFTAIX Rewards (daily income escrow) ABI. */
export const rewardsAbi = parseAbi([
  "function usdt() view returns (address)",
  "function registration() view returns (address)",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
  "function currentDay() view returns (uint256)",
  "function pending(address user, uint256 day) view returns (uint256)",
  "function settled(address user, uint256 day) view returns (bool)",
  "function isCreditor(address account) view returns (bool)",
  "function creditIncome(address user, uint256 amount)",
  "function claim(uint256 day)",
  "function settle(address user, uint256 day)"
]);

export const incomeCreditedEvent = parseAbiItem(
  "event IncomeCredited(address indexed user, uint256 indexed day, uint256 amount)"
);
