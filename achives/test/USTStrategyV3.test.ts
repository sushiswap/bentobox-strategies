/* eslint-disable prefer-const */
import { ethers, network, deployments, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish } from "ethers";
import { xMerlin } from "./constants";

import { BentoBoxV1, IExchangeRateFeeder, USTMock, USTStrategyV3 } from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";

const degenBox = "0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce";

let snapshotId;
let OldUSTStrategy: USTStrategyV3;
let NewUSTStrategy: USTStrategyV3;
let BentoBox: BentoBoxV1;
let UST: USTMock;
let aUST: USTMock;
let Feeder: IExchangeRateFeeder;
let xMerlinSigner;
let degenBoxOwnerSigner;
let ustOwnerSigner;
let exchangeRate;
let fee;

const mintToken = async (token: USTMock, account: string, amount: BigNumberish) => {
  const owner = await token.owner();
  await impersonate(owner);
  const ownerSigner = await ethers.getSigner(owner);
  await token.connect(ownerSigner).mint(account, amount);
};

const simulateEthAnchorDeposit = async (token: USTMock, account: string, amount: BigNumberish) => {
  // advance 15 minutes
  await advanceTime(15 * 60 * 60);
  await mintToken(token, account, amount);

  // sanity check
  expect(await token.balanceOf(account)).to.equal(amount);
};

const simulateSafeWithdrawAll = async () => {
  let aUSTBalance = await aUST.balanceOf(OldUSTStrategy.address);
  let ustBalance = await OldUSTStrategy.toUST(aUSTBalance, exchangeRate);

  await OldUSTStrategy.connect(xMerlinSigner).safeWithdraw(ustBalance);
  aUSTBalance = await aUST.balanceOf(OldUSTStrategy.address);

  expect(await aUST.balanceOf(OldUSTStrategy.address)).to.be.closeTo(BigNumber.from(0), 10);
  await UST.connect(ustOwnerSigner).mint(OldUSTStrategy.address, ustBalance);
  expect(await UST.balanceOf(OldUSTStrategy.address)).to.be.eq(ustBalance);
};

const substractFee = (amount: BigNumber) => {
  return amount.sub(amount.mul(fee).div(100));
}

describe("USTStrategyV3", async () => {
  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETHEREUM_RPC_URL || `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
            blockNumber: 14598742,
          },
        },
      ],
    });

    await deployments.fixture([]);
    await impersonate(xMerlin);

    xMerlinSigner = await ethers.getSigner(xMerlin);

    OldUSTStrategy = await ethers.getContractAt<USTStrategyV3>("USTStrategyV3", "0xE0C29b1A278D4B5EAE5016A7bC9bfee6c663D146");
    NewUSTStrategy = await ethers.getContractAt<USTStrategyV3>("USTStrategyV3", "0x9CD243E5200B290F10d74D93E0CA6C9e51B3d664");

    fee = await NewUSTStrategy.fee();
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);

    const degenBoxOwner = await BentoBox.owner();
    await impersonate(degenBoxOwner);
    degenBoxOwnerSigner = await ethers.getSigner(degenBoxOwner);

    Feeder = await ethers.getContractAt<IExchangeRateFeeder>(
      (
        await artifacts.readArtifact("contracts/interfaces/IExchangeRateFeeder.sol:IExchangeRateFeeder")
      ).abi,
      "0x24a76073Ab9131b25693F3b75dD1ce996fd3116c"
    );

    UST = await ethers.getContractAt<USTMock>("USTMock", "0xa47c8bf37f92aBed4A126BDA807A7b7498661acD");
    aUST = await ethers.getContractAt<USTMock>("USTMock", "0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab");

    exchangeRate = await Feeder.exchangeRateOf(UST.address, true);
    const ustOwner = await UST.owner();
    await impersonate(ustOwner);
    ustOwnerSigner = await ethers.getSigner(ustOwner);

    BentoBox = BentoBox.connect(degenBoxOwnerSigner);

    // Exit V2 Strategy siumulation
    const amountUSTDepositBefore = (await BentoBox.totals(UST.address)).elastic;
    await simulateSafeWithdrawAll();
    await BentoBox.setStrategyTargetPercentage(UST.address, 0);

    const executor = "0xA2fCdA2dD82B7Ab6B0C6CF116b6546E57499FAD9";
    await impersonate(executor);
    const executorSigner = await ethers.getSigner(executor);

    await expect(
      OldUSTStrategy.connect(executorSigner).safeHarvest(ethers.constants.MaxUint256, true, ethers.constants.MaxUint256, false)
    ).to.emit(BentoBox, "LogStrategyProfit");
    const amountUSTDeposit = (await BentoBox.totals(UST.address)).elastic;

    // should report a profit on UST
    expect(amountUSTDeposit.sub(amountUSTDepositBefore)).to.be.gt(0);

    await BentoBox.setStrategy(UST.address, NewUSTStrategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(UST.address, NewUSTStrategy.address);

    await BentoBox.setStrategyTargetPercentage(UST.address, 70);
    expect(await aUST.balanceOf(NewUSTStrategy.address)).to.equal(0);
    await NewUSTStrategy.connect(xMerlinSigner).safeHarvest(ethers.constants.MaxUint256, true, ethers.constants.MaxUint256, false); // rebalances into the strategy
    expect(await UST.balanceOf(NewUSTStrategy.address)).to.equal(0);

    expect(await aUST.balanceOf(NewUSTStrategy.address)).to.equal(0);

    exchangeRate = await Feeder.exchangeRateOf(UST.address, true);

    const strategyUstBalance = amountUSTDeposit.mul(70).div(100);
    const aUSTAmountToReceive = await NewUSTStrategy.toAUST(strategyUstBalance, exchangeRate);

    // should always receive less aUST than UST
    expect(aUSTAmountToReceive).to.be.lt(strategyUstBalance);

    await simulateEthAnchorDeposit(aUST, NewUSTStrategy.address, aUSTAmountToReceive);
    expect((await BentoBox.strategyData(UST.address)).balance).to.be.gt(0);

    // At this state, the strategy contains 14M UST worth of aUST
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should report a profit", async function () {
    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    await advanceTime(1210000); // 2 weeks
    // redeem profits
    await NewUSTStrategy.connect(xMerlinSigner).redeemEarnings();

    // because redeeming UST from aUST is async, BentoBox harvest call
    // will not transfer the profit this time in BentoBox so a subsequent safeHarvest
    // call has to be done later on.
    const afterHarvestBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    expect(afterHarvestBentoBalance.sub(oldBentoBalance)).to.eq(0);
    const ustProfits = getBigNumber(100_000);
    await simulateEthAnchorDeposit(UST, NewUSTStrategy.address, ustProfits);
    const oldUSTBalance = await UST.balanceOf(NewUSTStrategy.address);

    // Harvest again, the earnings redeemed before should go to BentoBox
    await NewUSTStrategy.connect(xMerlinSigner).safeHarvest(0, false, 0, false);

    const newUSTBalance = await UST.balanceOf(NewUSTStrategy.address);
    const newBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    const diff = oldUSTBalance.sub(newUSTBalance);
    expect(diff.gt(0)).to.be.true;

    expect(newBentoBalance.sub(oldBentoBalance)).to.eq(getBigNumber(90_000));
  });

  it("should exit smoothly", async () => {
    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    const strategyDataBalance = (await BentoBox.strategyData(UST.address)).balance;

    await expect(BentoBox.setStrategy(UST.address, NewUSTStrategy.address))
      .to.emit(BentoBox, "LogStrategyQueued")
      .withArgs(UST.address, NewUSTStrategy.address);

    await advanceTime(1210000); // 2 weeks

    const profits = substractFee(getBigNumber(42));

    // in a real scenario, the bentobox owner would have to make sure the UST
    // arrived before calling setStrategy the second time.
    await simulateEthAnchorDeposit(UST, NewUSTStrategy.address, strategyDataBalance.add(profits));

    await expect(BentoBox.setStrategy(UST.address, NewUSTStrategy.address)).to.emit(BentoBox, "LogStrategyProfit").withArgs(UST.address, profits);

    let newBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    // UST deposit hasn't arrived yet, bentobox is reporting a strategy loss
    expect(newBentoBalance.sub(oldBentoBalance)).to.eq(profits);
  });
});
