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

  /*it("Exits smoothly", async function () {
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
  });*/
});
