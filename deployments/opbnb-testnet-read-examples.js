/**
 * NFTAIX opBNB Testnet — READ-ONLY examples (no wallet / no write).
 * Run: node deployments/opbnb-testnet-read-examples.js
 */
const { ethers } = require("ethers");

const RPC = "https://opbnb-testnet-rpc.bnbchain.org";
const ADDR = {
  usdt: "0xCFBd8863f4DdB18bAeF44F3f1feE65F37C97bb8a",
  registration: "0xEBab599718b730f8570B0996212121d84f212bA8",
  marketplace: "0x6c7E9EeC9fD5C6D0BD44f53107bB222BfD210e06",
  nftaixToken: "0xA53d4e9849425b3c0878759C4CE77AeE3f52554F",
  rewards: "0xEF0421Cb6c949b8ADDb668c3fE211f939101528F",
  globalPool: "0x68c459D3Dd172919e8401d17F95f064a2a826d03",
  treasury: "0xDA1d895bbEA1c43032Ac3325794CaD893beEB711",
  liquidityManager: "0xA2f59CB5b13565a78F775D5A50b1883C1Ec15a50"
};

const ROOT = "0x1F4Ee796287bd1d6c5336F18bFaE81d02aAa252f";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);

  const reg = new ethers.Contract(ADDR.registration, [
    "function users(address) view returns (bool,bool,bool,address,uint8,uint256,uint256,uint256,uint256)",
    "function packages(uint8) view returns (uint256,uint256,bool)",
    "function currentDay() view returns (uint256)",
    "function platformToken() view returns (address)",
    "function rootSponsor() view returns (address)"
  ], provider);

  const mp = new ethers.Contract(ADDR.marketplace, [
    "function queueLength() view returns (uint256)",
    "function peekNext() view returns (uint256,uint256)",
    "function queueAt(uint256) view returns (uint256,uint256,address)",
    "function nextListPrice() view returns (uint256)",
    "function mintPrice() view returns (uint256)",
    "function burnThreshold() view returns (uint256)"
  ], provider);

  const tok = new ethers.Contract(ADDR.nftaixToken, [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function symbol() view returns (string)"
  ], provider);

  const usdt = new ethers.Contract(ADDR.usdt, [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ], provider);

  console.log("=== NFTAIX Read Contract Examples ===\n");

  const pkg1 = await reg.packages(1);
  console.log("Entry package #1:", {
    priceUsdt: ethers.formatEther(pkg1[0]),
    tradingLimitUsdt: ethers.formatEther(pkg1[1]),
    exists: pkg1[2]
  });

  const queueLen = await mp.queueLength();
  console.log("\nMarketplace queue length:", queueLen.toString());

  const peek = await mp.peekNext();
  console.log("Next in queue:", {
    tokenId: peek[0].toString(),
    priceUsdt: ethers.formatEther(peek[1])
  });

  for (let i = 0; i < Number(queueLen); i++) {
    const row = await mp.queueAt(i);
    console.log(`  queue[${i}]:`, {
      tokenId: row[0].toString(),
      priceUsdt: ethers.formatEther(row[1]),
      seller: row[2]
    });
  }

  console.log("\nMarket economics:", {
    mintPrice: ethers.formatEther(await mp.mintPrice()),
    nextListPrice: ethers.formatEther(await mp.nextListPrice()),
    burnThreshold: ethers.formatEther(await mp.burnThreshold())
  });

  console.log("\nToken:", {
    symbol: await tok.symbol(),
    totalSupply: ethers.formatEther(await tok.totalSupply())
  });

  const rootUser = await reg.users(ROOT);
  console.log("\nRoot sponsor state:", {
    registered: rootUser[0],
    activated: rootUser[1],
    packageId: Number(rootUser[4])
  });

  const day = await reg.currentDay();
  console.log("\nCurrent day index:", day.toString());

  console.log("\nPlatform token linked:", await reg.platformToken());
  console.log("Root sponsor:", await reg.rootSponsor());
}

main().catch(console.error);
