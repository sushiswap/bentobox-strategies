/* eslint-disable prefer-const */
import { ethers, network, deployments } from "hardhat";
import { expect } from "chai";
import { BigNumber } from "ethers";

import {
  BentoBoxV1,
  CombineHarvester,
  IERC20,
  USTStrategy,
} from "../typechain";

describe("Ethereum UST DegenBox Strategy", async () => {
  let USTStrategy: USTStrategy;
  let BentoBox: BentoBoxV1;
  let Harvester: CombineHarvester;
  let UST;
  let aUST;
  let signer;

  const _degenBox = "0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce";
  const _degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";
  const _1e18 = BigNumber.from("1000000000000000000");

  beforeEach(async () => {
    await deployments.fixture();

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl:
              process.env.RPC_URL ||
              `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
            blockNumber: 13420305,
          },
        },
      ],
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [_degenBoxOwner],
    });

    signer = await ethers.getSigner(_degenBoxOwner);
    await network.provider.send("hardhat_setBalance", [
      _degenBoxOwner,
      "0x1000000000000000000",
    ]);

    USTStrategy = await ethers.getContract("USTStrategy")
    Harvester = await ethers.getContract("CombineHarvester")
  
    USTStrategy = USTStrategy.connect(signer);
    Harvester = Harvester.connect(signer);

    BentoBox = (await ethers.getContractAt<BentoBoxV1>(
      "BentoBoxV1",
      _degenBox
    )).connect(signer);

    UST = await ethers.getContractAt<IERC20>(
      "IERC20",
      "0xa47c8bf37f92aBed4A126BDA807A7b7498661acD"
    );
    aUST = await ethers.getContractAt<IERC20>(
      "IERC20",
      "0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab"
    );

    await BentoBox.setStrategy(UST.address, USTStrategy.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await BentoBox.setStrategyTargetPercentage(UST.address, 70);
    await USTStrategy.safeHarvest(_1e18.mul(10000000000), true, 0, false); // rebalances into the strategy
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);
  });

  it("Strategy should report a profit", async function () {
    expect((await BentoBox.strategyData(UST.address)).balance.gt(0)).to.be.true;

    const oldaUSTBalance = await aUST.balanceOf(USTStrategy.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);

    const newaUSTBalance = await aUST.balanceOf(USTStrategy.address);
    const oldBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    await USTStrategy.safeHarvest(0, false, 0, false);

    const newBentoBalance = (await BentoBox.totals(UST.address)).elastic;
    const diff = newaUSTBalance.sub(oldaUSTBalance);
    const balanceDiff = newBentoBalance.sub(oldBentoBalance);

    expect(diff.gt(0)).to.be.true;
    expect(balanceDiff.gt(0)).to.be.true;
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
