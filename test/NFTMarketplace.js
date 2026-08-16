const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  async function deployFixture() {
    const [owner, creator, burn, liquidity, globalWallet, root, userA, userB] =
      await ethers.getSigners();

    const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    const reg = await (
      await ethers.getContractFactory("Registration")
    ).deploy(
      await usdt.getAddress(),
      creator.address,
      burn.address,
      liquidity.address,
      globalWallet.address,
      root.address
    );

    const treasury = await (
      await ethers.getContractFactory("Treasury")
    ).deploy(await usdt.getAddress(), burn.address);

    const liquidityManager = await (
      await ethers.getContractFactory("LiquidityManager")
    ).deploy(await usdt.getAddress(), liquidity.address);

    const nft = await (
      await ethers.getContractFactory("NFTMarketplace")
    ).deploy(await usdt.getAddress(), await reg.getAddress(), creator.address);

    await treasury.setOperator(await nft.getAddress(), true);
    await liquidityManager.setOperator(await nft.getAddress(), true);
    await reg.setVolumeRecorder(await nft.getAddress(), true);
    await nft.setModules(
      ethers.ZeroAddress,
      await treasury.getAddress(),
      await liquidityManager.getAddress(),
      ethers.ZeroAddress
    );

    const mintAmt = ethers.parseEther("100000");
    for (const u of [userA, userB, root]) {
      await usdt.mint(u.address, mintAmt);
      await usdt.connect(u).approve(await reg.getAddress(), mintAmt);
      await usdt.connect(u).approve(await nft.getAddress(), mintAmt);
    }

    return { usdt, reg, nft, treasury, liquidityManager: liquidityManager, owner, creator, burn, root, userA, userB };
  }

  async function activatePkg(reg, user, root, packageId) {
    await reg.connect(user).register(root.address);
    await reg.connect(user).activate(packageId);
  }

  it("$5 package: buy auto-lists into FIFO at +10% (no hold)", async function () {
    const { nft, reg, userA, root } = await deployFixture();
    await activatePkg(reg, userA, root, 1); // $5

    await nft.connect(userA).buy();

    expect(await nft.heldTokenId(userA.address)).to.equal(0n);
    expect(await nft.queueLength()).to.equal(1n);
    const peek = await nft.peekNext();
    expect(peek.price).to.equal(ethers.parseEther("12.1"));
  });

  it("$25 package: first buy holds; second buy lists first at +10%", async function () {
    const { nft, reg, userA, root, owner } = await deployFixture();
    await activatePkg(reg, userA, root, 3); // $25
    await nft.connect(owner).adminMintToQueue(2);

    await nft.connect(userA).buy(); // pay $11, hold #1
    const held1 = await nft.heldTokenId(userA.address);
    expect(held1).to.be.gt(0n);
    expect(await nft.ownerOf(held1)).to.equal(userA.address);
    expect(await nft.queueLength()).to.equal(1n); // one left in queue

    await nft.connect(userA).buy(); // pay $11, list previous at $12.1, hold new
    const held2 = await nft.heldTokenId(userA.address);
    expect(held2).to.be.gt(0n);
    expect(held2).to.not.equal(held1);
    expect(await nft.queueLength()).to.equal(1n); // previous listed
    const listed = await nft.queueAt(0);
    expect(listed.tokenId).to.equal(held1);
    expect(listed.price).to.equal(ethers.parseEther("12.1"));
    expect(listed.seller).to.equal(userA.address);
  });

  it("registerAndActivate is one step", async function () {
    const { usdt, reg, userA, root } = await deployFixture();
    await usdt.connect(userA).approve(await reg.getAddress(), ethers.parseEther("5"));
    await reg.connect(userA).registerAndActivate(root.address, 1);
    const u = await reg.users(userA.address);
    expect(u.registered).to.equal(true);
    expect(u.activated).to.equal(true);
    expect(u.packageId).to.equal(1n);
  });

  it("adminRegisterAndActivate free (no USDT pull)", async function () {
    const { usdt, reg, owner, userB, root } = await deployFixture();
    await reg.connect(owner).setAuthorizer(owner.address, true);
    const balBefore = await usdt.balanceOf(userB.address);
    await reg.connect(owner).adminRegisterAndActivate(userB.address, root.address, 2);
    expect(await usdt.balanceOf(userB.address)).to.equal(balBefore);
    const u = await reg.users(userB.address);
    expect(u.activated).to.equal(true);
    expect(u.packageId).to.equal(2n);
  });

  it("owner adminMintToQueue seeds FIFO at mint+$10% each", async function () {
    const { nft, reg, owner, userA, root } = await deployFixture();
    await activatePkg(reg, userA, root, 1);
    await nft.connect(owner).adminMintToQueue(2);
    expect(await nft.queueLength()).to.equal(2n);
    const first = await nft.queueAt(0);
    const second = await nft.queueAt(1);
    expect(first.price).to.equal(ethers.parseEther("11"));
    expect(second.price).to.equal(ethers.parseEther("11"));
  });

  it("resale splits appreciation only ($11 → $12.10)", async function () {
    const { usdt, nft, reg, owner, userA, userB, root } = await deployFixture();
    await activatePkg(reg, userA, root, 1);
    await activatePkg(reg, userB, root, 1);
    await nft.connect(owner).adminMintToQueue(1);

    const balA0 = await usdt.balanceOf(userA.address);
    await nft.connect(userA).buy();
    const balA1 = await usdt.balanceOf(userA.address);
    expect(balA0 - balA1).to.equal(ethers.parseEther("11"));

    const listed = await nft.queueAt(0);
    expect(listed.price).to.equal(ethers.parseEther("12.1"));
    expect(listed.seller).to.equal(userA.address);

    const balB0 = await usdt.balanceOf(userB.address);

    await nft.connect(userB).buy();

    expect(balB0 - (await usdt.balanceOf(userB.address))).to.equal(ethers.parseEther("12.1"));
    expect((await usdt.balanceOf(userA.address)) - balA1).to.equal(ethers.parseEther("11.33"));
  });
});
