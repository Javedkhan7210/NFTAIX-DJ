import { parseAbi, parseAbiItem } from "viem";

export const marketplaceAbi = parseAbi([
  "function buy()",
  "function botBuy(address user)",
  "function runBot(address user, uint256 maxTrades)",
  "function adminMintToQueue(uint256 quantity)",
  "function adminBurnToken(uint256 tokenId)",
  "function listHeld()",
  "function setUserBot(address user, bool enabled)",
  "function setBot(address bot, bool allowed)",
  "function botEnabled(address user) view returns (bool)",
  "function isBot(address account) view returns (bool)",
  "function peekNext() view returns (uint256 tokenId, uint256 price)",
  "function queueLength() view returns (uint256)",
  "function queueAt(uint256 index) view returns (uint256 tokenId, uint256 price, address seller)",
  "function sellerOf(uint256 tokenId) view returns (address)",
  "function nextListPrice() view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function appreciationBps() view returns (uint16)",
  "function sellerBps() view returns (uint16)",
  "function teamBps() view returns (uint16)",
  "function burnThreshold() view returns (uint256)",
  "function heldTokenId(address user) view returns (uint256)",
  "function listPrice(uint256 tokenId) view returns (uint256)",
  "function listed(uint256 tokenId) view returns (bool)",
  "function usdt() view returns (address)",
  "function registration() view returns (address)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)"
]);

export const purchasedEvent = parseAbiItem(
  "event Purchased(address indexed buyer, uint256 indexed tokenId, uint256 price)"
);

export const listedEvent = parseAbiItem("event Listed(uint256 indexed tokenId, uint256 price)");
