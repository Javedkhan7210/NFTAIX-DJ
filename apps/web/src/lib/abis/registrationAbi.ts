import { parseAbi } from "viem";

/** NFTAIX Registration contract (register → activate / upgrade). */
export const registrationAbi = parseAbi([
  "function users(address account) view returns (bool registered, bool activated, bool permanentlyInactive, address sponsor, uint8 packageId, uint256 tradingLimit, uint256 activatedAt, uint256 lastUpgradeAt, uint256 directCount)",
  "function packages(uint8 packageId) view returns (uint256 price, uint256 tradingLimit, bool exists)",
  "function currentDay() view returns (uint256)",
  "function dailyVolume(address user, uint256 day) view returns (uint256)",
  "function rootSponsor() view returns (address)",
  "function owner() view returns (address)",
  "function usdt() view returns (address)",
  "function register(address sponsor)",
  "function registerAndActivate(address sponsor, uint8 packageId)",
  "function activate(uint8 packageId)",
  "function upgrade(uint8 newPackageId)",
  "function adminRegisterAndActivate(address user, address sponsor, uint8 packageId)",
  "function adminUpgrade(address user, uint8 newPackageId)",
  "event Registered(address indexed user, address indexed sponsor)",
  "event Activated(address indexed user, uint8 indexed packageId, uint256 price, uint256 tradingLimit)",
  "event Upgraded(address indexed user, uint8 indexed oldPackageId, uint8 indexed newPackageId, uint256 price, uint256 tradingLimit)"
]);

/** Package IDs match on-chain Registration defaults ($5 = 1 … $10k = 11). */
export const PACKAGE_USD = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

export const ENTRY_PACKAGE_ID = 1;
