const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  let usdtAddress = process.env.USDT_ADDRESS;
  if (!usdtAddress) {
    const mock = await (await hre.ethers.getContractFactory("MockUSDT")).deploy();
    await mock.waitForDeployment();
    usdtAddress = await mock.getAddress();
    console.log("MockUSDT:", usdtAddress);
  }

  const creator = process.env.CREATOR_WALLET || deployer.address;
  const burn = process.env.BURN_WALLET || deployer.address;
  const liquidity = process.env.LIQUIDITY_WALLET || deployer.address;
  const globalWallet = process.env.GLOBAL_POOL_WALLET || deployer.address;
  const rootSponsor = process.env.ROOT_SPONSOR || deployer.address;

  const treasury = await (
    await hre.ethers.getContractFactory("Treasury")
  ).deploy(usdtAddress, burn);
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

  console.log("\n=== 6 Contracts ===");
  console.log("1 Registration:", regAddr);
  console.log("2 NFTMarketplace:", nftAddr);
  console.log("3 Rewards:", rewardsAddr);
  console.log("4 GlobalPool:", gpAddr);
  console.log("5 Treasury (burn):", treasuryAddr);
  console.log("6 LiquidityManager:", liqAddr);
  console.log("USDT:", usdtAddress);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
