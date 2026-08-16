/**
 * Redeploy Registration + NFTMarketplace + NFTAIXToken on opBNB testnet.
 * Keeps existing USDT / Rewards / GlobalPool / Treasury / LiquidityManager.
 *
 * PRIVATE_KEY=0x... npx hardhat run scripts/redeploy-reg-market-token-opbnb-testnet.js --network opbnbTestnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", "opbnb-testnet-nftaix-stack.json");
  const prev = JSON.parse(fs.readFileSync(file, "utf8"));
  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "tBNB");
  if (bal < hre.ethers.parseEther("0.0002")) {
    throw new Error("tBNB too low — top up deployer before redeploy");
  }

  const usdt = prev.usdt;
  const creator = deployer.address;
  const burn = deployer.address;
  const liquidity = deployer.address;
  const globalWallet = deployer.address;
  const rootSponsor = deployer.address;

  console.log("\n1) Deploy NFTAIXToken (1M supply)…");
  const token = await (await hre.ethers.getContractFactory("NFTAIXToken")).deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("   NFTAIXToken:", tokenAddr);

  console.log("\n2) Deploy Registration…");
  const registration = await (
    await hre.ethers.getContractFactory("Registration")
  ).deploy(usdt, creator, burn, liquidity, globalWallet, rootSponsor);
  await registration.waitForDeployment();
  const regAddr = await registration.getAddress();
  console.log("   Registration:", regAddr);

  console.log("\n3) Deploy NFTMarketplace…");
  const nft = await (
    await hre.ethers.getContractFactory("NFTMarketplace")
  ).deploy(usdt, regAddr, creator);
  await nft.waitForDeployment();
  const nftAddr = await nft.getAddress();
  console.log("   Marketplace:", nftAddr);

  const rewards = await hre.ethers.getContractAt("Rewards", prev.rewards);
  const treasury = await hre.ethers.getContractAt("Treasury", prev.treasury);
  const liquidityManager = await hre.ethers.getContractAt("LiquidityManager", prev.liquidityManager);
  const globalPool = await hre.ethers.getContractAt("GlobalPool", prev.globalPool);

  console.log("\n4) Wire modules…");
  await (await registration.setModules(prev.rewards, prev.treasury, prev.liquidityManager, prev.globalPool)).wait();
  await (await rewards.setModules(regAddr, prev.treasury)).wait();
  await (await globalPool.setModules(regAddr, prev.treasury)).wait();
  await (await nft.setModules(prev.rewards, prev.treasury, prev.liquidityManager, prev.globalPool)).wait();

  await (await treasury.setOperator(regAddr, true)).wait();
  await (await treasury.setOperator(nftAddr, true)).wait();
  await (await liquidityManager.setOperator(regAddr, true)).wait();
  await (await liquidityManager.setOperator(nftAddr, true)).wait();
  await (await rewards.setCreditor(regAddr, true)).wait();
  await (await rewards.setCreditor(nftAddr, true)).wait();
  await (await globalPool.setCreditor(regAddr, true)).wait();
  await (await globalPool.setCreditor(nftAddr, true)).wait();
  await (await registration.setVolumeRecorder(nftAddr, true)).wait();
  await (await registration.setAuthorizer(deployer.address, true)).wait();

  console.log("\n5) Link platform token…");
  await (await token.setDistributor(regAddr, true)).wait();
  await (await registration.setPlatformToken(tokenAddr)).wait();

  console.log("\n6) Seed FIFO with 5 admin mints @ $11…");
  await (await nft.adminMintToQueue(5)).wait();
  console.log("   queueLength:", (await nft.queueLength()).toString());

  const supply = await token.totalSupply();
  const treasuryBal = await token.balanceOf(tokenAddr);
  console.log("\nToken supply:", hre.ethers.formatEther(supply));
  console.log("Token treasury:", hre.ethers.formatEther(treasuryBal));

  const out = {
    ...prev,
    registration: regAddr,
    registrationPrev: prev.registration,
    marketplace: nftAddr,
    marketplacePrev: prev.marketplace,
    nftaixToken: tokenAddr,
    redeployedAt: new Date().toISOString(),
    notes:
      (prev.notes || "") +
      "; Registration+Marketplace+NFTAIXToken (1M, 2/USDT) with hold rules + registerAndActivate"
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\nSaved", file);
  console.log(JSON.stringify(out, null, 2));
  console.log("\nUpdate apps/api/.env:");
  console.log(`REGISTRATION_CONTRACT_ADDRESS=${regAddr}`);
  console.log(`MARKETPLACE_CONTRACT_ADDRESS=${nftAddr}`);
  console.log(`NFTAIX_TOKEN_ADDRESS=${tokenAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
