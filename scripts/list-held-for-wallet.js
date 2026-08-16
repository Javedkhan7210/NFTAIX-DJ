/**
 * Local Hardhat: listHeld() for a buyer so NFT tab shows a resale.
 * BUYER_WALLET=0x... npx hardhat run scripts/list-held-for-wallet.js --network localhost
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const stack = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "localhost-nftaix-stack.json"), "utf8")
  );
  const buyer = (process.env.BUYER_WALLET || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(buyer)) throw new Error("BUYER_WALLET required");

  const market = await hre.ethers.getContractAt("NFTMarketplace", stack.marketplace);
  await hre.network.provider.send("hardhat_setBalance", [buyer, "0x56BC75E2D63100000"]);
  await hre.network.provider.send("hardhat_impersonateAccount", [buyer]);
  const signer = await hre.ethers.getSigner(buyer);

  const held = await market.heldTokenId(buyer);
  console.log("held", held.toString());
  if (held === 0n) throw new Error("wallet has no held NFT");

  const tx = await market.connect(signer).listHeld();
  const receipt = await tx.wait();
  console.log("listHeld", receipt.hash);

  const peek = await market.peekNext();
  const q = await market.queueLength();
  console.log("queue", q.toString(), "next", peek[0].toString(), hre.ethers.formatEther(peek[1]));
  await hre.network.provider.send("hardhat_stopImpersonatingAccount", [buyer]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
