/**
 * Local Hardhat only: impersonate a DB user wallet, mint USDT, buy next marketplace NFT.
 * Usage: npx hardhat run scripts/fund-user-buy-nft.js --network localhost
 * Env: BUYER_WALLET=0x... (default: first WalletConnection publicUserNumber=1 via optional BUYER)
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const stackPath = path.join(__dirname, "..", "deployments", "localhost-nftaix-stack.json");
  const stack = JSON.parse(fs.readFileSync(stackPath, "utf8"));
  const buyer = (process.env.BUYER_WALLET || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(buyer)) {
    throw new Error("Set BUYER_WALLET=0x... (the My NFTs account)");
  }

  const [deployer] = await hre.ethers.getSigners();
  const usdt = await hre.ethers.getContractAt("MockUSDT", stack.usdt);
  const market = await hre.ethers.getContractAt("NFTMarketplace", stack.marketplace);
  const reg = await hre.ethers.getContractAt("Registration", stack.registration);

  // e2e may have drained Hardhat #0 — top up deployer + buyer
  await hre.network.provider.send("hardhat_setBalance", [
    deployer.address,
    "0x56BC75E2D63100000"
  ]);
  await hre.network.provider.send("hardhat_setBalance", [
    buyer,
    "0x56BC75E2D63100000" // 100 ETH
  ]);
  await hre.network.provider.send("hardhat_impersonateAccount", [buyer]);
  const buyerSigner = await hre.ethers.getSigner(buyer);

  const user = await reg.users(buyer);
  if (!user.activated) {
    throw new Error(`Buyer ${buyer} is not activated on Registration`);
  }

  const mintAmt = hre.ethers.parseEther("20000");
  await (await usdt.connect(deployer).mint(buyer, mintAmt)).wait();
  await (await usdt.connect(buyerSigner).approve(stack.registration, mintAmt)).wait();
  await (await usdt.connect(buyerSigner).approve(stack.marketplace, mintAmt)).wait();

  // Roll calendar day so Registration dailyVolume limit resets
  await hre.network.provider.send("evm_increaseTime", [24 * 60 * 60 + 10]);
  await hre.network.provider.send("evm_mine", []);

  const peek = await market.peekNext();
  const price = peek[1];
  console.log("peek", peek[0].toString(), hre.ethers.formatEther(price));

  // Entry package limit is $50 — upgrade if next NFT costs more
  let tradingLimit = (await reg.users(buyer)).tradingLimit;
  if (tradingLimit < price) {
    // package 5 = $100 / limit $1000
    console.log("upgrading to package 5 for trading room…");
    await (await reg.connect(buyerSigner).upgrade(5)).wait();
    tradingLimit = (await reg.users(buyer)).tradingLimit;
    console.log("tradingLimit", hre.ethers.formatEther(tradingLimit));
  }

  const tx = await market.connect(buyerSigner).buy();
  const receipt = await tx.wait();
  console.log("buy tx", receipt.hash);

  const held = await market.heldTokenId(buyer);
  const qLen = await market.queueLength();
  const after = await market.peekNext();
  const listedId = after.tokenId ?? after[0];
  console.log("heldTokenId", held.toString(), "queueLength", qLen.toString(), "peek", listedId.toString());
  if (held !== 0n) {
    console.log("OK — rare hold (near burn threshold); My NFTs may show token", held.toString());
  } else if (qLen === 0n) {
    throw new Error("buy succeeded but no hold and empty queue");
  } else {
    console.log("OK — buy auto-listed into FIFO; Market NFT tab should show token", listedId.toString());
  }

  await hre.network.provider.send("hardhat_stopImpersonatingAccount", [buyer]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
