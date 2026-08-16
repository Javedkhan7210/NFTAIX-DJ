/**
 * Step-by-step manual feature test.
 * Run: npx hardhat run scripts/manual-test.js
 *
 * Har step console pe clearly dikhega — pass/fail.
 */
const hre = require("hardhat");
const { ethers } = hre;

function ok(name, detail = "") {
  console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, err) {
  console.log(`  ❌ ${name} — ${err.message || err}`);
  throw err;
}
async function step(title, fn) {
  console.log(`\n—— ${title} ——`);
  try {
    await fn();
  } catch (e) {
    fail(title, e);
  }
}

async function main() {
  const [owner, creator, burn, liquidity, globalWallet, root, userA, userB, userC] =
    await ethers.getSigners();

  console.log("\n========== NFTAIX MANUAL TEST ==========");
  console.log("Owner:", owner.address);
  console.log("Root sponsor:", root.address);
  console.log("UserA:", userA.address);
  console.log("UserB:", userB.address);
  console.log("UserC:", userC.address);

  // ---- Deploy all ----
  const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
  await usdt.waitForDeployment();

  const treasury = await (
    await ethers.getContractFactory("Treasury")
  ).deploy(await usdt.getAddress(), burn.address);
  await treasury.waitForDeployment();

  const liquidityManager = await (
    await ethers.getContractFactory("LiquidityManager")
  ).deploy(await usdt.getAddress(), liquidity.address);
  await liquidityManager.waitForDeployment();

  const rewards = await (await ethers.getContractFactory("Rewards")).deploy(await usdt.getAddress());
  await rewards.waitForDeployment();

  const globalPool = await (
    await ethers.getContractFactory("GlobalPool")
  ).deploy(await usdt.getAddress());
  await globalPool.waitForDeployment();

  const registration = await (
    await ethers.getContractFactory("Registration")
  ).deploy(
    await usdt.getAddress(),
    creator.address,
    burn.address,
    liquidity.address,
    globalWallet.address,
    root.address
  );
  await registration.waitForDeployment();

  const nft = await (
    await ethers.getContractFactory("NFTMarketplace")
  ).deploy(await usdt.getAddress(), await registration.getAddress(), creator.address);
  await nft.waitForDeployment();

  const regAddr = await registration.getAddress();
  const nftAddr = await nft.getAddress();
  const rewardsAddr = await rewards.getAddress();
  const treasuryAddr = await treasury.getAddress();
  const liqAddr = await liquidityManager.getAddress();
  const gpAddr = await globalPool.getAddress();

  await registration.setModules(rewardsAddr, treasuryAddr, liqAddr, gpAddr);
  await rewards.setModules(regAddr, treasuryAddr);
  await globalPool.setModules(regAddr, treasuryAddr);
  await nft.setModules(rewardsAddr, treasuryAddr, liqAddr, gpAddr);

  await treasury.setOperator(regAddr, true);
  await treasury.setOperator(nftAddr, true);
  await treasury.setOperator(rewardsAddr, true);
  await treasury.setOperator(gpAddr, true);
  await liquidityManager.setOperator(regAddr, true);
  await liquidityManager.setOperator(nftAddr, true);
  await rewards.setCreditor(regAddr, true);
  await rewards.setCreditor(nftAddr, true);
  await globalPool.setCreditor(regAddr, true);
  await globalPool.setCreditor(nftAddr, true);
  await registration.setVolumeRecorder(nftAddr, true);

  const mintAmt = ethers.parseEther("100000");
  for (const u of [root, userA, userB, userC]) {
    await usdt.mint(u.address, mintAmt);
    await usdt.connect(u).approve(regAddr, mintAmt);
    await usdt.connect(u).approve(nftAddr, mintAmt);
  }

  console.log("\nDeployed:");
  console.log("  USDT:", await usdt.getAddress());
  console.log("  Registration:", regAddr);
  console.log("  NFT:", nftAddr);
  console.log("  Rewards:", rewardsAddr);
  console.log("  GlobalPool:", gpAddr);
  console.log("  Treasury:", treasuryAddr);
  console.log("  LiquidityManager:", liqAddr);

  // ========== 1. REGISTER ==========
  await step("1. Register UserA under Root", async () => {
    await registration.connect(userA).register(root.address);
    const u = await registration.users(userA.address);
    if (!u.registered) throw new Error("not registered");
    if (u.sponsor !== root.address) throw new Error("wrong sponsor");
    ok("UserA registered", `sponsor=${u.sponsor.slice(0, 8)}…`);
  });

  await step("1b. Register UserB under UserA", async () => {
    await registration.connect(userB).register(userA.address);
    const a = await registration.users(userA.address);
    if (a.directCount !== 1n) throw new Error("directCount should be 1");
    ok("UserB registered", `UserA directs=${a.directCount}`);
  });

  await step("1c. Register UserC under UserB", async () => {
    await registration.connect(userC).register(userB.address);
    ok("UserC registered under UserB");
  });

  // ========== 2. ACTIVATE ==========
  await step("2. Activate package $5 (id=1) for UserA", async () => {
    const rootBefore = await usdt.balanceOf(root.address);
    const creatorBefore = await usdt.balanceOf(creator.address);
    const burnBefore = await usdt.balanceOf(burn.address);
    const liqBefore = await liquidityManager.totalReceived();
    const gpBefore = await globalPool.dayPool(await registration.currentDay());

    await registration.connect(userA).activate(1);

    const u = await registration.users(userA.address);
    if (!u.activated) throw new Error("not activated");
    if (u.packageId !== 1n && u.packageId !== 1) throw new Error("packageId != 1");
    if (u.tradingLimit !== ethers.parseEther("50")) throw new Error("limit != 50");

    const price = ethers.parseEther("5");
    // Root: 20% direct + 2% network L1 (1 direct unlock)
    const rootGain = (await usdt.balanceOf(root.address)) - rootBefore;
    // With Rewards module, income goes to Rewards pending, not wallet!
    // So check Rewards pending instead
    const day = await registration.currentDay();
    const rootPending = await rewards.pending(root.address, day);
    const expectedDirectNet = price / 5n + (price * 2n) / 100n; // 20% + 2%
    if (rootPending !== expectedDirectNet) {
      throw new Error(`root pending ${rootPending} != ${expectedDirectNet}`);
    }

    const creatorGain = (await usdt.balanceOf(creator.address)) - creatorBefore;
    if (creatorGain !== price / 10n) throw new Error("creator 10% wrong");

    const liqGain = (await liquidityManager.totalReceived()) - liqBefore;
    if (liqGain !== price / 20n) throw new Error("liquidity 5% wrong");

    const gpGain = (await globalPool.dayPool(day)) - gpBefore;
    if (gpGain !== price / 20n) throw new Error("global 5% wrong");

    ok("Activated", `limit=$50, root pending=${ethers.formatEther(rootPending)} USDT`);
    ok("Creator got 10%", ethers.formatEther(creatorGain));
    ok("LiquidityManager got 5%", ethers.formatEther(liqGain));
    ok("GlobalPool got 5%", ethers.formatEther(gpGain));
    ok("Burn got fixed+leftover", `burn wallet delta=${ethers.formatEther((await usdt.balanceOf(burn.address)) - burnBefore)}`);
  });

  // ========== 3. UPGRADE ==========
  await step("3. Upgrade UserA $5 → $10 (full price)", async () => {
    await registration.connect(userA).upgrade(2);
    const u = await registration.users(userA.address);
    if (Number(u.packageId) !== 2) throw new Error("package not 2");
    if (u.tradingLimit !== ethers.parseEther("100")) throw new Error("limit not 100");
    ok("Upgraded", `package=2, limit=$100`);
  });

  // ========== 4. LEVEL UNLOCK TABLE ==========
  await step("4. Level unlock tables", async () => {
    const checks = [
      [1, 1, 2],
      [2, 2, 4],
      [3, 6, 6],
      [5, 10, 10],
      [10, 20, 20],
    ];
    for (const [d, act, nftLv] of checks) {
      const a = await registration.levelsForDirects(d);
      const n = await registration.nftLevelsForDirects(d);
      if (a !== BigInt(act) || n !== BigInt(nftLv)) {
        throw new Error(`directs=${d} got act=${a} nft=${n}`);
      }
    }
    ok("Activation + NFT unlock tables match spec");
  });

  // ========== 5. NETWORK INCOME ON DOWNLINE ACTIVATE ==========
  await step("5. UserB + UserC activate — network income", async () => {
    await registration.connect(userB).activate(1);
    const day = await registration.currentDay();
    const bPendingBefore = await rewards.pending(userB.address, day);

    await registration.connect(userC).activate(1);

    // B = direct of C → 20% + L1 2% into Rewards
    const price = ethers.parseEther("5");
    const expected = price / 5n + (price * 2n) / 100n;
    const bPending = await rewards.pending(userB.address, day);
    const gained = bPending - bPendingBefore;
    if (gained !== expected) throw new Error(`B gain ${gained} != ${expected}`);
    ok("UserB got Direct 20% + Network L1 2%", ethers.formatEther(gained));
  });

  // ========== 6. NFT BUY (auto-lists into FIFO) ==========
  await step("6. NFT buy auto-lists @ +10% (first mint @ $11)", async () => {
    const nextBefore = await nft.nextListPrice();
    if (nextBefore !== ethers.parseEther("11")) throw new Error(`nextList=${nextBefore}`);

    await nft.connect(userA).buy();

    if ((await nft.heldTokenId(userA.address)) !== 0n) throw new Error("should not hold after auto-list");
    if ((await nft.queueLength()) !== 1n) throw new Error("queue not 1 after buy");
    const peek = await nft.peekNext();
    if (peek.price !== ethers.parseEther("12.1")) throw new Error(`peek ${peek.price}`);
    if ((await nft.ownerOf(peek.tokenId)) !== (await nft.getAddress())) {
      throw new Error("listed NFT must stay on marketplace");
    }

    const next = await nft.nextListPrice();
    if (next !== ethers.parseEther("13.31")) throw new Error(`next should 13.31 got ${next}`);

    const day = await registration.currentDay();
    const vol = await registration.dailyVolume(userA.address, day);
    if (vol !== ethers.parseEther("11")) throw new Error(`volume ${vol}`);

    ok("Bought + auto-listed", `tokenId=${peek.tokenId}, ask=$12.1, nextPrice=$13.31, volume=$11`);
  });

  // ========== 7. BUY FROM QUEUE (also auto-lists) ==========
  await step("7. UserB buys from FIFO (auto-lists again)", async () => {
    await registration.connect(userB).upgrade(2); // $10 → limit 100
    await nft.connect(userB).buy();
    if ((await nft.heldTokenId(userB.address)) !== 0n) throw new Error("B should not hold");
    if ((await nft.queueLength()) !== 1n) throw new Error("queue should still have B's auto-list");
    const peek = await nft.peekNext();
    if (peek.price !== ethers.parseEther("13.31")) throw new Error(`peek after B ${peek.price}`);
    ok("UserB bought + auto-listed", `ask=$${ethers.formatEther(peek.price)}`);
  });

  // ========== 9. LIQUIDITY MANAGER ==========
  await step("9. LiquidityManager received funds", async () => {
    const total = await liquidityManager.totalReceived();
    if (total === 0n) throw new Error("no liquidity received");
    ok("LiquidityManager.totalReceived", `${ethers.formatEther(total)} USDT`);

    const bal = await usdt.balanceOf(liqAddr);
    await liquidityManager.forwardAll();
    const walletBal = await usdt.balanceOf(liquidity.address);
    if (walletBal === 0n && bal > 0n) throw new Error("forward failed");
    ok("forwardAll → liquidity wallet", `wallet=${ethers.formatEther(await usdt.balanceOf(liquidity.address))}`);
  });

  // ========== 10. GLOBAL POOL CREDIT ==========
  await step("10. GlobalPool has day balance", async () => {
    const day = await registration.currentDay();
    const pool = await globalPool.dayPool(day);
    if (pool === 0n) throw new Error("global pool empty");
    ok(`GlobalPool day ${day}`, `${ethers.formatEther(pool)} USDT (distribute next day via admin)`);
  });

  // ========== 11. REWARDS PENDING / CLAIM NEED COMPLIANCE ==========
  await step("11. Rewards pending (claim needs 50% volume)", async () => {
    const day = await registration.currentDay();
    const pendingRoot = await rewards.pending(root.address, day);
    const pendingB = await rewards.pending(userB.address, day);
    ok("Root pending", ethers.formatEther(pendingRoot));
    ok("UserB pending", ethers.formatEther(pendingB));

    const reqA = await registration.requiredDailyVolume(userA.address);
    const volA = await registration.dailyVolume(userA.address, day);
    const compliantA = await registration.isCompliant(userA.address, day);
    ok(
      "UserA compliance",
      `vol=${ethers.formatEther(volA)} / required=${ethers.formatEther(reqA)} → compliant=${compliantA}`
    );
  });

  // ========== 12. BOT OPT-IN ==========
  await step("12. Bot buy with allowance", async () => {
    await nft.connect(userA).setUserBot(userA.address, true);
    // A already listed; market may mint fresh again
    const volBefore = await registration.dailyVolume(userA.address, await registration.currentDay());
    await nft.connect(owner).botBuy(userA.address);
    const volAfter = await registration.dailyVolume(userA.address, await registration.currentDay());
    if (volAfter <= volBefore) throw new Error("volume not increased");
    ok("botBuy worked", `volume ${ethers.formatEther(volBefore)} → ${ethers.formatEther(volAfter)}`);
  });

  console.log("\n========== ALL MANUAL STEPS PASSED ==========\n");
  console.log("Next (optional, Hardhat console):");
  console.log("  npx hardhat console");
  console.log("  // phir contracts attach karke alag commands try karo");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
