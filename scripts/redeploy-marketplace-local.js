/**
 * Redeploy NFTMarketplace only (auto-list buy) against existing localhost stack.
 * Run: npx hardhat run scripts/redeploy-marketplace-local.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", "localhost-nftaix-stack.json");
  const prev = JSON.parse(fs.readFileSync(file, "utf8"));
  const [deployer] = await hre.ethers.getSigners();

  const registration = await hre.ethers.getContractAt("Registration", prev.registration);
  const rewards = await hre.ethers.getContractAt("Rewards", prev.rewards);
  const treasury = await hre.ethers.getContractAt("Treasury", prev.treasury);
  const liquidityManager = await hre.ethers.getContractAt("LiquidityManager", prev.liquidityManager);
  const globalPool = await hre.ethers.getContractAt("GlobalPool", prev.globalPool);

  const nft = await (
    await hre.ethers.getContractFactory("NFTMarketplace")
  ).deploy(prev.usdt, prev.registration, deployer.address);
  await nft.waitForDeployment();
  const nftAddr = await nft.getAddress();

  await (await nft.setModules(prev.rewards, prev.treasury, prev.liquidityManager, prev.globalPool)).wait();
  await (await treasury.setOperator(nftAddr, true)).wait();
  await (await liquidityManager.setOperator(nftAddr, true)).wait();
  await (await rewards.setCreditor(nftAddr, true)).wait();
  await (await globalPool.setCreditor(nftAddr, true)).wait();
  await (await registration.setVolumeRecorder(nftAddr, true)).wait();

  const out = { ...prev, marketplace: nftAddr, marketplacePrev: prev.marketplace, redeployedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
