/**
 * Redeploy NFTMarketplace (auto-list + queueAt) on opBNB testnet against existing stack.
 * PRIVATE_KEY must be the stack deployer / Registration owner.
 *
 * PRIVATE_KEY=0x... npx hardhat run scripts/redeploy-marketplace-opbnb-testnet.js --network opbnbTestnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", "opbnb-testnet-nftaix-stack.json");
  const prev = JSON.parse(fs.readFileSync(file, "utf8"));
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "tBNB");

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
  console.log("New marketplace:", nftAddr);

  await (await nft.setModules(prev.rewards, prev.treasury, prev.liquidityManager, prev.globalPool)).wait();
  await (await treasury.setOperator(nftAddr, true)).wait();
  await (await liquidityManager.setOperator(nftAddr, true)).wait();
  await (await rewards.setCreditor(nftAddr, true)).wait();
  await (await globalPool.setCreditor(nftAddr, true)).wait();
  await (await registration.setVolumeRecorder(nftAddr, true)).wait();

  console.log("\nSeed FIFO queue (5 NFTs @ ~$11)…");
  await (await nft.adminMintToQueue(5)).wait();
  console.log("queueLength:", (await nft.queueLength()).toString());

  const out = {
    ...prev,
    marketplace: nftAddr,
    marketplacePrev: prev.marketplace,
    redeployedAt: new Date().toISOString(),
    notes:
      (prev.notes || "") +
      "; marketplace redeployed — appreciation-only profit split (+10% slice); seller gets cost back + profit share"
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  const readFile = path.join(__dirname, "..", "deployments", "opbnb-testnet-read-contracts.json");
  if (fs.existsSync(readFile)) {
    const read = JSON.parse(fs.readFileSync(readFile, "utf8"));
    if (read.addresses) read.addresses.marketplace = nftAddr;
    read.updatedAt = new Date().toISOString();
    fs.writeFileSync(readFile, JSON.stringify(read, null, 2));
  }

  const envApi = path.join(__dirname, "..", "apps", "api", ".env");
  if (fs.existsSync(envApi)) {
    let env = fs.readFileSync(envApi, "utf8");
    env = env.replace(
      /MARKETPLACE_CONTRACT_ADDRESS=.*/,
      `MARKETPLACE_CONTRACT_ADDRESS=${nftAddr}`
    );
    fs.writeFileSync(envApi, env);
    console.log("Updated apps/api/.env MARKETPLACE_CONTRACT_ADDRESS");
  }

  console.log(JSON.stringify({ marketplace: nftAddr, marketplacePrev: prev.marketplace }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
