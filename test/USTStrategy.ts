/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumberish, BigNumber } from "ethers";

import {
  BentoBoxV1,
  IExchangeRateFeeder,
  USTMock,
  USTStrategy,
} from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";

const maybe = process.env.FORKING ? describe : describe.skip;
const degenBox = "0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce";
const degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";

const mintToken = async (token: USTMock, account: string, amount: BigNumberish) => {
  const owner = await token.owner();
  await impersonate(owner);
  const ownerSigner = await ethers.getSigner(owner);
  await token.connect(ownerSigner).mint(account, amount);
};

const simulateEthAnchorDeposit = async (
  token: USTMock,
  account: string,
  amount: BigNumberish) => {

  // advance 15 minutes
  await advanceTime(15 * 60 * 60);
  await mintToken(token, account, amount);

  // sanity check
  expect(await token.balanceOf(account)).to.equal(amount);
};

maybe("Ethereum UST DegenBox Strategy", async () => {
  let snapshotId;
  let USTStrategy: USTStrategy;
  let BentoBox: BentoBoxV1;
  let UST: USTMock;
  let aUST: USTMock;
  let Feeder: IExchangeRateFeeder;
  let signer;

  before(async () => {
    await deployments.fixture();
    const {deployer} = await getNamedAccounts();

    await impersonate(degenBoxOwner);

    const deployerSigner = await ethers.getSigner(deployer);
    signer = await ethers.getSigner(degenBoxOwner);

    await network.provider.send("hardhat_setBalance", [
      degenBoxOwner,
      "0x1000000000000000000",
    ]);

    USTStrategy = await ethers.getContract("USTStrategy")
    USTStrategy = USTStrategy.connect(signer);

    BentoBox = await ethers.getContractAt<BentoBoxV1>(
      "BentoBoxV1",
      degenBox
    );
    
    Feeder = await ethers.getContractAt<IExchangeRateFeeder>(
      (await artifacts.readArtifact("contracts/interfaces/IExchangeRateFeeder.sol:IExchangeRateFeeder")).abi,
      "0xB12B8247bD1749CC271c55Bb93f6BD2B485C94A7"
    );

    UST = await ethers.getContractAt<USTMock>(
      "USTMock",
      "0xa47c8bf37f92aBed4A126BDA807A7b7498661acD"
    );
    aUST = await ethers.getContractAt<USTMock>(
      "USTMock",
      "0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab"
    );

    // Transfer UST into BentoBox
    const amountUSTDeposit = getBigNumber(20_000_000);
    await mintToken(UST, deployer, amountUSTDeposit);
    await UST.connect(deployerSigner).approve(BentoBox.address, amountUSTDeposit);
    await BentoBox.connect(deployerSigner).deposit(
      UST.address,
      deployer,
      deployer,
      amountUSTDeposit,
      0
    );
    expect((await BentoBox.totals(UST.address)).elastic).to.equal(amountUSTDeposit);
    const strategyUstBalance = amountUSTDeposit.mul(70).div(100);

    BentoBox = BentoBox.connect(signer);
    await BentoBox.setStrategy(UST.address, USTStrategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(UST.address, USTStrategy.address);

    await BentoBox.setStrategyTargetPercentage(UST.address, 70);
    await USTStrategy.safeHarvest(getBigNumber(10_000_000_000), true, 0, false); // rebalances into the strategy
    expect(await UST.balanceOf(USTStrategy.address)).to.equal(0);

    const rateBefore = await Feeder.exchangeRateOf(UST.address, true);
    const aUSTAmountToReceive = await USTStrategy.toAUST(strategyUstBalance);

    // should always receive less aUST than UST
    expect(aUSTAmountToReceive).to.be.lt(strategyUstBalance);

    await simulateEthAnchorDeposit(aUST, USTStrategy.address, aUSTAmountToReceive);
    const rateAfter = await Feeder.exchangeRateOf(UST.address, true);
    expect(rateAfter.sub(rateBefore)).to.be.gt(0);

    snapshotId = await ethers.provider.send('evm_snapshot', []);
  });

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId]);
    snapshotId = await ethers.provider.send('evm_snapshot', []);
  })

  it("Strategy should report a profit", async function () {
    expect((await BentoBox.strategyData(UST.address)).balance.gt(0)).to.be.true;

    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    await advanceTime(1210000); // 2 weeks
    await USTStrategy.safeHarvest(0, false, 0, false);
    await advanceTime(60 * 15); // 15 minutes

    // because redeeming UST from aUST is async, BentoBox harvest call
    // will not transfer the profit this time in BentoBox so a subsequent safeHarvest
    // call has to be done later on.
    const afterHarvestBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    expect(afterHarvestBentoBalance.sub(oldBentoBalance)).to.eq(0);
    const ustProfits = getBigNumber(100_000);
    await simulateEthAnchorDeposit(UST, USTStrategy.address, ustProfits);
    const oldUSTBalance = await UST.balanceOf(USTStrategy.address);

    // Harvest again, some small amount is going to be withdrawn again but the first batch would
    // have been bridged back to the strategy contract.
    await USTStrategy.safeHarvest(0, false, 0, false);

    const newUSTBalance = await UST.balanceOf(USTStrategy.address);
    const newBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    const diff = oldUSTBalance.sub(newUSTBalance);
    expect(diff.gt(0)).to.be.true;

    expect(newBentoBalance.sub(oldBentoBalance)).to.eq(ustProfits);
  });
/*
  it("Exits smoothly", async function () {
    expect((await degenBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

    const oldBentoBalance = (await degenBox.totals(_usdc)).elastic;

    await degenBox.setStrategy(_usdc, aaveStrategySecondary.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await degenBox.setStrategy(_usdc, aaveStrategySecondary.address);

    const newBentoBalance = (await degenBox.totals(_usdc)).elastic;
    const newAUsdcBalance = await aUsdc.balanceOf(ustStrategy.address);
    const balanceDiff = newBentoBalance.sub(oldBentoBalance);

    expect(balanceDiff.gt(0)).to.be.true;
    expect(newAUsdcBalance.eq(0)).to.be.true;
  });

  it("Sells rewards", async function () {
    expect((await degenBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

    await ustStrategy.safeHarvest(0, true, 0, true);

    const wmaticBalance = await wmatic.balanceOf(ustStrategy.address);
    const oldUsdcbalance = await usdc.balanceOf(ustStrategy.address);
    await ustStrategy.swapExactTokensForUnderlying(0, _wmatic);

    const usdcbalance = await usdc.balanceOf(ustStrategy.address);
    await ustStrategy.safeHarvest(0, false, 0, true);

    const newUsdcbalance = await usdc.balanceOf(ustStrategy.address);

    expect(wmaticBalance.gt(0)).to.be.true;
    expect(oldUsdcbalance.eq(0)).to.be.true;
    expect(usdcbalance.gt(0)).to.be.true;
    expect(newUsdcbalance.eq(0)).to.be.true;
  });

  it("Executes through combine harvester", async function () {
    expect((await degenBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

    let oldBentoBalance = (await degenBox.totals(_usdc)).elastic;

    await degenBox.setStrategy(_usdc, aaveStrategyHarvester.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await degenBox.setStrategy(_usdc, aaveStrategyHarvester.address);

    let newBentoBalance = (await degenBox.totals(_usdc)).elastic;
    let newAUsdcBalance = await aUsdc.balanceOf(ustStrategy.address);
    let bentoDiff = newBentoBalance.sub(oldBentoBalance);

    expect(bentoDiff.gt(0)).to.be.true;
    expect(newAUsdcBalance.eq(0)).to.be.true;

    await harvester.executeSafeHarvests(
      [aaveStrategyHarvester.address],
      [true],
      [ethers.constants.MaxUint256],
      [true],
      [0],
      [false],
      [0]
    );

    let oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategyHarvester.address);
    oldBentoBalance = (await degenBox.totals(_usdc)).elastic;

    await expect(
      aaveStrategyHarvester.safeHarvest(0, false, 0, true)
    ).to.be.revertedWith("BentoBox Strategy: only Executors");

    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);

    await harvester.executeSafeHarvests(
      [aaveStrategyHarvester.address],
      [false],
      [0],
      [true],
      [0],
      [true],
      [0]
    );

    newAUsdcBalance = await aUsdc.balanceOf(aaveStrategyHarvester.address);
    let newWmaticBalance = await wmatic.balanceOf(
      aaveStrategyHarvester.address
    );
    let newerBentoBalance = (await degenBox.totals(_usdc)).elastic;
    let aTokenDiff = newAUsdcBalance.sub(oldAUsdcBalance);
    let newBalanceDiff = newerBentoBalance.sub(newBentoBalance);

    expect(aTokenDiff.lt(10)).to.be.true; // shouldn't skim the profits since we won't be out of the +-3% target

    oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategyHarvester.address);
    oldBentoBalance = (await degenBox.totals(_usdc)).elastic;

    await harvester.executeSafeHarvests(
      [aaveStrategyHarvester.address],
      [true],
      [0],
      [true],
      [0],
      [true],
      [0]
    );

    newAUsdcBalance = await aUsdc.balanceOf(aaveStrategyHarvester.address);
    newWmaticBalance = await wmatic.balanceOf(aaveStrategyHarvester.address);

    newerBentoBalance = (await degenBox.totals(_usdc)).elastic;
    aTokenDiff = newAUsdcBalance.sub(oldAUsdcBalance);
    newBalanceDiff = newerBentoBalance.sub(newBentoBalance);

    expect(aTokenDiff.gt(0)).to.be.true;
    expect(newBalanceDiff.gt(0)).to.be.true;
    expect(newWmaticBalance.gt(0)).to.be.true;

    let oldUsdcBalance = await usdc.balanceOf(aaveStrategyHarvester.address);

    await harvester.executeSafeHarvests(
      [aaveStrategyHarvester.address],
      [false],
      [0],
      [true],
      [0],
      [true],
      [1]
    );

    let newUsdcBalance = await aUsdc.balanceOf(aaveStrategyHarvester.address);
    newWmaticBalance = await wmatic.balanceOf(aaveStrategyHarvester.address);

    expect(newUsdcBalance.gt(oldUsdcBalance)).to.be.true;
    expect(newWmaticBalance.eq(0)).to.be.true;
  });

  it("Sanity checks", async function () {
    const randomSigner = await ethers.getNamedSigner("carol");

    expect(await ustStrategy.bentoBox()).to.be.eq(
      _bentoBox,
      "didn't set correct bento box address"
    );
    expect(await ustStrategy.strategyToken()).to.be.eq(
      _usdc,
      "didn't set correct token address"
    );
    expect(await ustStrategy.aToken()).to.be.eq(
      _aUsdc,
      "didn't set correct aToken address"
    );
    expect(await ustStrategy.incentiveController()).to.be.eq(
      _incentiveController,
      "didn't set correct incentive controller address"
    );

    await expect(
      ustStrategy.connect(randomSigner).safeHarvest(0, false, 0, true)
    ).to.be.revertedWith("BentoBox Strategy: only Executors");
    await expect(
      harvester
        .connect(randomSigner)
        .executeSafeHarvests([], [], [], [], [], [], [])
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(ustStrategy.exit("1")).to.be.revertedWith(
      "BentoBox Strategy: only BentoBox"
    );
    await expect(ustStrategy.withdraw("1")).to.be.revertedWith(
      "BentoBox Strategy: only BentoBox"
    );
    await expect(
      ustStrategy.harvest("1", randomSigner.address)
    ).to.be.revertedWith("BentoBox Strategy: only BentoBox");
  });*/
});
