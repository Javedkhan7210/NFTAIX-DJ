/**
 * Deploy full stack to Hardhat node and save addresses.
 * Run: npx hardhat run scripts/deploy-local-save.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const mock = await (await hre.ethers.getContractFactory("MockUSDT")).deploy();
  await mock.waitForDeployment();
  const usdtAddress = await mock.getAddress();

  const creator = deployer.address;
  const burn = deployer.address;
  const liquidity = deployer.address;
  const globalWallet = deployer.address;
  const rootSponsor = deployer.address;

  const treasury = await (await hre.ethers.getContractFactory("Treasury")).deploy(usdtAddress, burn);
  await treasury.waitForDeployment();
  const liquidityManager = await (
    await hre.ethers.getContractFactory("LiquidityManager")
  ).deploy(usdtAddress, liquidity);
  await liquidityManager.waitForDeployment();
  const rewards = await (await hre.ethers.getContractFactory("Rewards")).deploy(usdtAddress);
  await rewards.waitForDeployment();
  const globalPool = await (await hre.ethers.getContractFactory("GlobalPool")).deploy(usdtAddress);
  await globalPool.waitForDeployment();
  const registration = await (
    await hre.ethers.getContractFactory("Registration")
  ).deploy(usdtAddress, creator, burn, liquidity, globalWallet, rootSponsor);
  await registration.waitForDeployment();
  const nft = await (
    await hre.ethers.getContractFactory("NFTMarketplace")
  ).deploy(usdtAddress, await registration.getAddress(), creator);
  await nft.waitForDeployment();

  const regAddr = await registration.getAddress();
  const nftAddr = await nft.getAddress();
  const rewardsAddr = await rewards.getAddress();
  const treasuryAddr = await treasury.getAddress();
  const liqAddr = await liquidityManager.getAddress();
  const gpAddr = await globalPool.getAddress();

  await (await registration.setModules(rewardsAddr, treasuryAddr, liqAddr, gpAddr)).wait();
  await (await rewards.setModules(regAddr, treasuryAddr)).wait();
  await (await globalPool.setModules(regAddr, treasuryAddr)).wait();
  await (await nft.setModules(rewardsAddr, treasuryAddr, liqAddr, gpAddr)).wait();
  await (await treasury.setOperator(regAddr, true)).wait();
  await (await treasury.setOperator(nftAddr, true)).wait();
  await (await treasury.setOperator(rewardsAddr, true)).wait();
  await (await treasury.setOperator(gpAddr, true)).wait();
  await (await liquidityManager.setOperator(regAddr, true)).wait();
  await (await liquidityManager.setOperator(nftAddr, true)).wait();
  await (await rewards.setCreditor(regAddr, true)).wait();
  await (await rewards.setCreditor(nftAddr, true)).wait();
  await (await globalPool.setCreditor(regAddr, true)).wait();
  await (await globalPool.setCreditor(nftAddr, true)).wait();
  await (await registration.setVolumeRecorder(nftAddr, true)).wait();
  await (await registration.setAuthorizer(deployer.address, true)).wait();

  const out = {
    network: "localhost",
    chainId: 31337,
    deployer: deployer.address,
    usdt: usdtAddress,
    registration: regAddr,
    marketplace: nftAddr,
    rewards: rewardsAddr,
    globalPool: gpAddr,
    treasury: treasuryAddr,
    liquidityManager: liqAddr
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "localhost-nftaix-stack.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Saved", file);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
