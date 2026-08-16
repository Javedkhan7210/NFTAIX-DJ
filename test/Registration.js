const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Registration", function () {
  async function deployFixture() {
    const [owner, creator, burn, liquidity, globalPool, root, userA, userB, userC] =
      await ethers.getSigners();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();

    const Registration = await ethers.getContractFactory("Registration");
    const reg = await Registration.deploy(
      await usdt.getAddress(),
      creator.address,
      burn.address,
      liquidity.address,
      globalPool.address,
      root.address
    );

    const mintAmt = ethers.parseEther("100000");
    for (const u of [userA, userB, userC, root]) {
      await usdt.mint(u.address, mintAmt);
      await usdt.connect(u).approve(await reg.getAddress(), mintAmt);
    }

    return { usdt, reg, owner, creator, burn, liquidity, globalPool, root, userA, userB, userC };
  }

  it("registers with sponsor and tracks directs", async function () {
    const { reg, root, userA, userB } = await deployFixture();

    await reg.connect(userA).register(root.address);
    await reg.connect(userB).register(userA.address);

    const a = await reg.users(userA.address);
    const b = await reg.users(userB.address);
    expect(a.registered).to.equal(true);
    expect(a.sponsor).to.equal(root.address);
    expect(b.sponsor).to.equal(userA.address);
    expect((await reg.users(userA.address)).directCount).to.equal(1n);
  });

  it("activates package and pays direct + fixed splits", async function () {
    const { usdt, reg, creator, burn, liquidity, globalPool, root, userA } = await deployFixture();

    await reg.connect(userA).register(root.address);

    const price = ethers.parseEther("5");
    const burnBefore = await usdt.balanceOf(burn.address);
    const creatorBefore = await usdt.balanceOf(creator.address);
    const liqBefore = await usdt.balanceOf(liquidity.address);
    const rootBefore = await usdt.balanceOf(root.address);
    const globalBefore = await usdt.balanceOf(globalPool.address);

    await reg.connect(userA).activate(1);

    const user = await reg.users(userA.address);
    expect(user.activated).to.equal(true);
    expect(user.packageId).to.equal(1);
    expect(user.tradingLimit).to.equal(ethers.parseEther("50"));

    const direct = price / 5n;
    const levelPay = (price * 2n) / 100n;
    expect((await usdt.balanceOf(root.address)) - rootBefore).to.equal(direct + levelPay);
    expect((await usdt.balanceOf(creator.address)) - creatorBefore).to.equal(price / 10n);
    expect((await usdt.balanceOf(liquidity.address)) - liqBefore).to.equal(price / 20n);
    expect((await usdt.balanceOf(globalPool.address)) - globalBefore).to.equal(price / 20n);
    expect((await usdt.balanceOf(burn.address)) - burnBefore).to.equal((price * 58n) / 100n);
  });

  it("pays network 2% to unlocked uplines", async function () {
    const { usdt, reg, root, userA, userB, userC } = await deployFixture();

    await reg.connect(userA).register(root.address);
    await reg.connect(userB).register(userA.address);
    await reg.connect(userC).register(userB.address);

    await reg.connect(userA).activate(1);
    await reg.connect(userB).activate(1);

    const price = ethers.parseEther("5");
    const aBefore = await usdt.balanceOf(userA.address);
    const bBefore = await usdt.balanceOf(userB.address);

    await reg.connect(userC).activate(1);

    const direct = price / 5n;
    const levelPay = (price * 2n) / 100n;
    expect((await usdt.balanceOf(userB.address)) - bBefore).to.equal(direct + levelPay);
    expect((await usdt.balanceOf(userA.address)) - aBefore).to.equal(0n);
  });

  it("upgrades with full package price", async function () {
    const { reg, root, userA } = await deployFixture();
    await reg.connect(userA).register(root.address);
    await reg.connect(userA).activate(1);
    await reg.connect(userA).upgrade(2);

    const user = await reg.users(userA.address);
    expect(user.packageId).to.equal(2);
    expect(user.tradingLimit).to.equal(ethers.parseEther("100"));
  });

  it("levelsForDirects matches unlock table", async function () {
    const { reg } = await deployFixture();
    expect(await reg.levelsForDirects(1)).to.equal(1n);
    expect(await reg.levelsForDirects(2)).to.equal(2n);
    expect(await reg.levelsForDirects(3)).to.equal(6n);
    expect(await reg.levelsForDirects(5)).to.equal(10n);
    expect(await reg.levelsForDirects(7)).to.equal(14n);
    expect(await reg.levelsForDirects(10)).to.equal(20n);
  });

  it("nftLevelsForDirects matches NFT unlock table", async function () {
    const { reg } = await deployFixture();
    expect(await reg.nftLevelsForDirects(1)).to.equal(2n);
    expect(await reg.nftLevelsForDirects(2)).to.equal(4n);
    expect(await reg.nftLevelsForDirects(5)).to.equal(10n);
    expect(await reg.nftLevelsForDirects(10)).to.equal(20n);
  });
});
