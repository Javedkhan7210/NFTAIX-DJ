import { parseAbi, parseAbiItem } from "viem";

/** NFTAIX GlobalPool ABI. */
export const globalPoolAbi = parseAbi([
  "function usdt() view returns (address)",
  "function registration() view returns (address)",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
  "function currentDay() view returns (uint256)",
  "function dayPool(uint256 day) view returns (uint256)",
  "function dayDistributed(uint256 day) view returns (bool)",
  "function isCreditor(address account) view returns (bool)",
  "function credit(uint256 amount)",
  "function distributeDay(uint256 day, address[] prime, address[] elite, address[] royal, address[] director, address[] crown)"
]);

export const creditedEvent = parseAbiItem("event Credited(uint256 indexed day, uint256 amount)");

export const distributedEvent = parseAbiItem("event Distributed(uint256 indexed day, uint256 total)");
