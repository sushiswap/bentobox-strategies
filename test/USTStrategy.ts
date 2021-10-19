/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";

import {
  BentoBoxV1,
  IExchangeRateFeeder,
  USTMock,
  USTStrategy,
} from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";

const maybe = (process.env.ETHEREUM_RPC_URL || process.env.INFURA_API_KEY) ? describe : describe.skip;
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
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETHEREUM_RPC_URL || `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            blockNumber: 13430664,
          },
        },
      ],
    })

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

    const aUSTAmountToReceive = strategyUstBalance.mul(getBigNumber(1)).div(rateBefore) 

    // should always receive less aUST than UST
    expect(aUSTAmountToReceive).to.be.lt(strategyUstBalance);

    await simulateEthAnchorDeposit(aUST, USTStrategy.address, aUSTAmountToReceive);
    const rateAfter = await Feeder.exchangeRateOf(UST.address, true);
    expect(rateAfter.sub(rateBefore)).to.be.gt(0);
    expect((await BentoBox.strategyData(UST.address)).balance.gt(0)).to.be.true;

    // At this state, the strategy contains 14M UST worth of aUST
    snapshotId = await ethers.provider.send('evm_snapshot', []);
  });

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId]);
    snapshotId = await ethers.provider.send('evm_snapshot', []);
  })

  it("should report a profit", async function () {
    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    await advanceTime(1210000); // 2 weeks
    await USTStrategy.safeHarvest(0, false, 0, false);

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

  it("should withdraw the right amount when rebalancing", async() => {
    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    await advanceTime(1210000); // 2 weeks

    // Adjusting strategy allocation from 70% to 50%
    await BentoBox.setStrategyTargetPercentage(UST.address, 50);

    // Harvest with rebalance after reducing the strategy target percentage should
    // withdraw some UST.
    // The first safeHarvest call will initiate the ethAnchor redeem UST from aUST
    // and the subsequent call (once the UST is received), should withdraw some UST
    // to bento box.
    await USTStrategy.safeHarvest(0, true, 0, false);
    expect(await UST.balanceOf(USTStrategy.address)).to.eq(0);

    await simulateEthAnchorDeposit(UST, USTStrategy.address, getBigNumber(42));

    // Now that the UST has arrived, it should be withdrawn to bentobox
    await USTStrategy.safeHarvest(0, true, 0, false);
    const newBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    expect(newBentoBalance.sub(oldBentoBalance)).to.eq(getBigNumber(42));
  });

  it("should exit smoothly", async() => {
    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    const strategyDataBalance = (await BentoBox.strategyData(UST.address)).balance;

    await expect(BentoBox.setStrategy(UST.address, USTStrategy.address))
      .to.emit(BentoBox, "LogStrategyQueued")
      .withArgs(UST.address, USTStrategy.address);

    await advanceTime(1210000); // 2 weeks

    const profits = getBigNumber(42);

    // in a real scenario, the bentobox owner would have to make sure the UST
    // arrived before calling setStrategy the second time.
    await simulateEthAnchorDeposit(UST, USTStrategy.address, strategyDataBalance.add(profits));

    await expect(BentoBox.setStrategy(UST.address, USTStrategy.address))
      .to.emit(BentoBox, "LogStrategyProfit")
      .withArgs(UST.address, profits);

    let newBentoBalance = (await BentoBox.totals(UST.address)).elastic;

    // UST deposit hasn't arrived yet, bentobox is reporting a strategy loss
    expect(newBentoBalance.sub(oldBentoBalance)).to.eq(profits);
  });
});
