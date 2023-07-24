import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("StakeToken", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const LimeToken = await ethers.getContractFactory("LimeToken");
    const StakeToken = await ethers.getContractFactory("StakeToken");
    const limeToken = await LimeToken.deploy();
    const stakeToken = await StakeToken.deploy(limeToken.address);

    const stakeAmount = ethers.BigNumber.from("1000000000000000000000");

    await limeToken.transfer(alice.address, stakeAmount.mul(100));
    await limeToken.transfer(bob.address, stakeAmount.mul(100));
    await limeToken.transfer(stakeToken.address, stakeAmount.mul(10));

    return { limeToken, stakeToken, owner, alice, bob, stakeAmount };
  }

  describe("General", function () {
    it("Should set the right owner", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      expect(await stakeToken.owner()).to.equal(owner.address);
    });

    it("Constructor", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      expect(await stakeToken.limeToken()).to.equal(limeToken.address);
      expect(await stakeToken.planDuration()).to.equal(2592000);
      expect(await stakeToken.interestRate()).to.equal(32);
      expect(await stakeToken.totalStakers()).to.equal(0);
    });

    it("Allowance", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);

      expect(await limeToken.allowance(alice.address, stakeToken.address)).to.equal(stakeAmount);
    });

    it("Transfer token", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      const bobsBalanceBefore = await limeToken.balanceOf(bob.address);

      const transferAmount = 1000;
      await stakeToken.transferToken(bob.address, transferAmount);

      const bobsBalanceAfter = await limeToken.balanceOf(bob.address);

      await expect(bobsBalanceAfter).to.equal(bobsBalanceBefore.add(transferAmount));
    });

    it("Token expiry", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.connect(alice).stakeToken(stakeAmount);

      const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
      const planDuration = await stakeToken.planDuration();

      expect(await stakeToken.connect(alice).getTokenExpiry()).to.equal(planDuration.add(block.timestamp));
    });
  });

  describe("Staking", function () {
    it("Stake", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);

      const balanceBeforeStakeContract = await limeToken.balanceOf(stakeToken.address);
      const stakerBalanceBefore = await limeToken.balanceOf(alice.address);

      await stakeToken.connect(alice).stakeToken(stakeAmount);

      const balanceAfterStakeContract = await limeToken.balanceOf(stakeToken.address);
      const stakerBalanceAfter = await limeToken.balanceOf(alice.address);

      const [startTS, endTS, amount, claimed] = await stakeToken.stakeInfos(alice.address);

      const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());

      expect(startTS).to.equal(block.timestamp);
      expect(endTS).to.equal(ethers.BigNumber.from(block.timestamp).add(await stakeToken.planDuration()));
      expect(amount).to.equal(stakeAmount);
      expect(claimed).to.equal(0);
      expect(balanceBeforeStakeContract.add(stakeAmount)).to.equal(balanceAfterStakeContract);
      expect(stakerBalanceBefore.sub(stakeAmount)).to.equal(stakerBalanceAfter);
      expect(await stakeToken.totalStakers()).to.equal(1);
      expect(await stakeToken.addressStaked(alice.address)).to.equal(true);
    });

    it("Stake revert when 0 stake amount", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);

      await expect(stakeToken.connect(alice).stakeToken(0)).to.be.revertedWith("Stake amount should be correct");
    });

    it("Stake revert when plan expired", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);

      const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());

      // evm_increaseTime increases the time with the given number of seconds
      // foundry 'warp' function sets the timestamp to the given number of seconds
      await network.provider.send("evm_increaseTime", [(await stakeToken.planExpired()).toNumber() - block.timestamp]);

      await expect(stakeToken.connect(alice).stakeToken(stakeAmount)).to.be.revertedWith("Plan Expired");
    });

    it("Stake revert when already participated", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);

      await stakeToken.connect(alice).stakeToken(stakeAmount);

      await expect(stakeToken.connect(alice).stakeToken(stakeAmount)).to.be.revertedWith("You already participated");
    });

    it("Stake revert when insufficient balance", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);

      const newStakeAmount = stakeAmount.mul(100).add(100);

      await expect(stakeToken.connect(alice).stakeToken(newStakeAmount)).to.be.revertedWith("Insufficient Balance");
    });
  });

  describe("Claiming", function () {

    it("Claim", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.connect(alice).stakeToken(stakeAmount);

      const stakerBalanceBefore = await limeToken.balanceOf(alice.address);

      const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
      await network.provider.send("evm_increaseTime", [(await stakeToken.planExpired()).toNumber() - block.timestamp]);

      await stakeToken.connect(alice).claimReward();

      const stakerBalanceAfter = limeToken.balanceOf(alice.address);

      const interestRate = ethers.BigNumber.from(await stakeToken.interestRate());
      const accumulatedInterest = (stakeAmount.mul(interestRate)).div(100);

      const expectedStakerBalanceAfter = 
        stakerBalanceBefore
          .add(stakeAmount)
          .add(accumulatedInterest);

      expect(expectedStakerBalanceAfter).to.equal(await stakerBalanceAfter);
    });

    it("Claim revert when not participated", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.connect(alice).stakeToken(stakeAmount);

      await expect(stakeToken.connect(bob).claimReward()).to.revertedWith("You are not participated");
    });

    it("Claim revert when too early", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.connect(alice).stakeToken(stakeAmount);

      await expect(stakeToken.connect(alice).claimReward()).to.revertedWith("Stake Time is not over yet");
    });

    it("Claim revert when already claimed", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.connect(alice).stakeToken(stakeAmount);

      const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
      await network.provider.send("evm_increaseTime", [(await stakeToken.planExpired()).toNumber() - block.timestamp]);

      await stakeToken.connect(alice).claimReward();
      await expect(stakeToken.connect(alice).claimReward()).to.revertedWith("Already claimed");
    });
  });

  describe("Pausing", function () {

    it("Pause", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.pause();

      await expect(stakeToken.connect(alice).stakeToken(stakeAmount)).to.revertedWith("Pausable: paused");
    });

    it("Unpause", async function () {
      const { limeToken, stakeToken, owner, alice, bob, stakeAmount } = await loadFixture(deployFixture);

      await limeToken.connect(alice).approve(stakeToken.address, stakeAmount);
      await stakeToken.pause();

      await expect(stakeToken.connect(alice).stakeToken(stakeAmount)).to.revertedWith("Pausable: paused");

      await stakeToken.unpause();

      await expect(stakeToken.connect(alice).stakeToken(stakeAmount)).to.not.be.reverted;
    });

  });
});
