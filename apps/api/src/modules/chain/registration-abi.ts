import { parseAbi, parseAbiItem } from "viem";

/** NFTAIX Registration contract ABI (shared with web). */
export const registrationAbi = parseAbi([
  "function users(address account) view returns (bool registered, bool activated, bool permanentlyInactive, address sponsor, uint8 packageId, uint256 tradingLimit, uint256 activatedAt, uint256 lastUpgradeAt, uint256 directCount)",
  "function packages(uint8 packageId) view returns (uint256 price, uint256 tradingLimit, bool exists)",
  "function rootSponsor() view returns (address)",
  "function owner() view returns (address)",
  "function usdt() view returns (address)",
  "function register(address sponsor)",
  "function registerAndActivate(address sponsor, uint8 packageId)",
  "function activate(uint8 packageId)",
  "function upgrade(uint8 newPackageId)",
  "function adminRegisterAndActivate(address user, address sponsor, uint8 packageId)",
  "function adminUpgrade(address user, uint8 newPackageId)",
  "function isAuthorizer(address account) view returns (bool)",
  "function setPlatformToken(address token)",
  "function nftLevelsForDirects(uint256 directs) view returns (uint256)"
]);

export const registeredEvent = parseAbiItem(
  "event Registered(address indexed user, address indexed sponsor)"
);

export const activatedEvent = parseAbiItem(
  "event Activated(address indexed user, uint8 indexed packageId, uint256 price, uint256 tradingLimit)"
);

export const upgradedEvent = parseAbiItem(
  "event Upgraded(address indexed user, uint8 indexed oldPackageId, uint8 indexed newPackageId, uint256 price, uint256 tradingLimit)"
);

export const ENTRY_PACKAGE_ID = 1;
