/* eslint-disable prefer-const */
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber } from "@ethersproject/bignumber";
import { AaveStrategy, BentoBoxV1, CombineHarvester } from "../typechain";
import { customError } from "./Harness";

describe.skip("Aave Mainnet strategy", async function () {

  this.timeout(40000);

  let snapshotId;
  let aaveStrategy: AaveStrategy;
  let aaveStrategySecondary: AaveStrategy;
  let aaveStrategyWithHarvester: AaveStrategy;
  let bentoBox: BentoBoxV1;
  let harvester: CombineHarvester;
  let signer, usdc, aUsdc, weth, aave, stkAave, usdt, aUsdt;

  const _bentoBox = "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966";
  const _bentoBoxOwner = "0x19B3Eb3Af5D93b77a5619b047De0EED7115A19e7";
  const _lendingPool = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9";
  const _factory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
  const _weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const _aave = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
  const _stkAave = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
  const _usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const _aUsdc = "0xBcca60bB61934080951369a648Fb03DF4F96263C";
  const _incentiveController = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";
  const _usdt = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const _aUsdt = "0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811";

  const _1e18 = BigNumber.from("1000000000000000000");

  before(async () => {

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            blockNumber: 13500000,
          },
        },
      ],
    })

    await network.provider.request({ method: "hardhat_impersonateAccount", params: [_bentoBoxOwner] })
    signer = await ethers.getSigner(_bentoBoxOwner);
    await network.provider.send("hardhat_setBalance", [
      _bentoBoxOwner,
      "0x1000000000000000000",
    ]);

    const AaveStrategy = (await ethers.getContractFactory("AaveStrategyMainnet")).connect(signer);
    const Harvester = (await ethers.getContractFactory("CombineHarvester")).connect(signer);
    const BentoBox = (await ethers.getContractFactory("BentoBoxV1"));
    const Token = (await ethers.getContractFactory("ERC20Mock"));
    const stkAAVE = (await ethers.getContractFactory("stkAAVE"));

    usdc = await Token.attach(_usdc);
    usdt = await Token.attach(_usdt);
    weth = await Token.attach(_weth);
    aave = await Token.attach(_aave);
    stkAave = await stkAAVE.attach(_stkAave);
    aUsdc = await Token.attach(_aUsdc);
    aUsdt = await Token.attach(_aUsdt);

    aaveStrategy = (await AaveStrategy.deploy(
      _stkAave,
      _lendingPool,
      _incentiveController,
      [
        _usdc,
        _bentoBox,
        _bentoBoxOwner,
        _factory,
        [_aave, _weth, _usdc]
      ]
    )).connect(signer) as AaveStrategy;

    aaveStrategySecondary = (await AaveStrategy.deploy(
      _stkAave,
      _lendingPool,
      _incentiveController,
      [
        _usdt,
        _bentoBox,
        _bentoBoxOwner,
        _factory,
        [_aave, _weth, _usdt]
      ]
    )).connect(signer) as AaveStrategy;

    harvester = (await Harvester.deploy(_bentoBox)).connect(signer) as CombineHarvester;

    aaveStrategyWithHarvester = (await AaveStrategy.deploy(
      _stkAave,
      _lendingPool,
      _incentiveController,
      [
        _usdc,
        _bentoBox,
        harvester.address,
        _factory,
        [_aave, _weth, _usdc]
      ]
    )).connect(signer) as AaveStrategy;

    bentoBox = (await BentoBox.attach(_bentoBox)).connect(signer) as BentoBoxV1;

    await bentoBox.setStrategy(_usdc, aaveStrategy.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await bentoBox.setStrategy(_usdc, aaveStrategy.address);
    await bentoBox.setStrategyTargetPercentage(_usdc, 70);
    await aaveStrategy.safeHarvest(_1e18.mul(10000000000), true, 0, false); // rebalances into the strategy
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);

    snapshotId = await ethers.provider.send('evm_snapshot', []);
  })

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId]);
    snapshotId = await ethers.provider.send('evm_snapshot', []);
  })

  it("Strategy should report a profit", async function () {
    expect((await bentoBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

    const oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);

    const newAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
    const oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;
    await aaveStrategy.safeHarvest(0, false, 0, false);

    const newBentoBalance = (await bentoBox.totals(_usdc)).elastic;
    const diff = newAUsdcBalance.sub(oldAUsdcBalance);
    const balanceDiff = newBentoBalance.sub(oldBentoBalance);

    expect(diff.gt(0)).to.be.true;
    expect(balanceDiff.gt(0)).to.be.true;
  });

  it("Exits smoothly", async function () {
    const oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;

    await bentoBox.setStrategy(_usdc, aaveStrategyWithHarvester.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await bentoBox.setStrategy(_usdc, aaveStrategyWithHarvester.address);

    const newBentoBalance = (await bentoBox.totals(_usdc)).elastic;
    const newAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
    const balanceDiff = newBentoBalance.sub(oldBentoBalance);

    expect(balanceDiff.gt(0)).to.be.true;
    expect(newAUsdcBalance.eq(0)).to.be.true;
  });

  it("Should claim and redeem stkAave", async function () {
    const oldStkAaveBalance = (await stkAave.balanceOf(aaveStrategy.address));
    const oldAaveBalance = (await aave.balanceOf(aaveStrategy.address));

    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);
    await aaveStrategy.safeHarvest(0, true, 0, true);
    const newStkAaveBalance = (await stkAave.balanceOf(aaveStrategy.address));

    expect(oldStkAaveBalance.lt(newStkAaveBalance)).to.be.true;

    let cooldown = await stkAave.stakersCooldowns(aaveStrategy.address);

    // 950400 seconds is 11 days
    await ethers.provider.send("evm_increaseTime", [950400 / 2]);
    await ethers.provider.send("evm_mine", []);

    await aaveStrategy.safeHarvest(0, true, 0, true);
    expect((await stkAave.stakersCooldowns(aaveStrategy.address)).toString()).to.be.eq(cooldown.toString(), "Cooldown was reset by mistake");

    await ethers.provider.send("evm_increaseTime", [950400 / 2]);
    await ethers.provider.send("evm_mine", []);

    await aaveStrategy.safeHarvest(0, true, 0, true);
    const newAaveBalance = (await aave.balanceOf(aaveStrategy.address));

    cooldown = await stkAave.stakersCooldowns(aaveStrategy.address);

    expect(oldAaveBalance.lt(newAaveBalance)).to.be.true;
    expect(cooldown.toString()).to.be.eq("0");
  });

  /* it("Should sell rewards", async function () {
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await aaveStrategy.safeHarvest(0, true, 0, true);
    await ethers.provider.send("evm_increaseTime", [950400]);
    await ethers.provider.send("evm_mine", []);
    await aaveStrategy.safeHarvest(0, true, 0, true);

    const oldAaveBalance = (await aave.balanceOf(aaveStrategy.address));
    const oldUsdcBalance = (await usdc.balanceOf(aaveStrategy.address));

    await expect(aaveStrategy.swapExactTokensForUnderlying("380000000", 0)).to.be.revertedWith(customError("SlippageProtection"));
    await aaveStrategy.swapExactTokensForUnderlying("370000000", 0);

    const newUsdcBalance = (await usdc.balanceOf(aaveStrategy.address));
    const newAaveBalance = (await aave.balanceOf(aaveStrategy.address));

    expect(oldAaveBalance.gt(0)).to.be.true;
    expect(oldUsdcBalance.lt(newUsdcBalance)).to.be.true;
    expect(newAaveBalance.eq(0)).to.be.true;
  });

  it("Should use helper", async function () {
    await bentoBox.setStrategy(_usdc, aaveStrategyWithHarvester.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await bentoBox.setStrategy(_usdc, aaveStrategyWithHarvester.address);

    await expect(aaveStrategyWithHarvester.safeHarvest(_1e18.mul(10000000000), true, 0, false)).to.be.revertedWith(customError("OnlyExecutor"));
    expect(await harvester.executeSafeHarvestsManual(
      [aaveStrategyWithHarvester.address],
      [ethers.constants.MaxUint256],
      [true],
      [0],
      [false],
      [0]
    ));
    const oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);

    await ethers.provider.send("evm_increaseTime", [1210000]);
    await ethers.provider.send("evm_mine", []);

    const newAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
    expect(await harvester.executeSafeHarvests([aaveStrategyWithHarvester.address], [0], [false], [0]));
    const endAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
    expect(oldAUsdcBalance.lt(newAUsdcBalance)).to.be.true;
    expect(oldAUsdcBalance.eq(endAUsdcBalance)).to.be.true;
  });
 */
  it("Should reset cooldown", async function () {
    const oldStkAaveBalance = (await stkAave.balanceOf(aaveStrategy.address));

    await ethers.provider.send("evm_increaseTime", [1210000]);
    const tx1 = await aaveStrategy.safeHarvest(0, true, 0, true);
    const timestamp1 = (await ethers.provider.getBlock(tx1.blockNumber as number)).timestamp;
    const newStkAaveBalance = (await stkAave.balanceOf(aaveStrategy.address));

    expect(oldStkAaveBalance.lt(newStkAaveBalance)).to.be.true;

    const cooldown1 = await stkAave.stakersCooldowns(aaveStrategy.address);

    // 950400 seconds is 11 days
    await ethers.provider.send("evm_increaseTime", [950400 * 2]);

    const tx2 = await aaveStrategy.safeHarvest(0, true, 0, true);
    const timestamp2 = (await ethers.provider.getBlock(tx2.blockNumber as number)).timestamp;
    const cooldown2 = (await stkAave.stakersCooldowns(aaveStrategy.address)).toString()

    expect(cooldown1.toString()).to.be.eq(timestamp1.toString(), "cooldown wasn't set")
    expect(cooldown2.toString()).to.be.eq(timestamp2.toString(), "cooldown wasn't reset")
  });

  it("Sanity checks", async function () {

    const randomSigner = await ethers.getNamedSigner("carol");

    // expect(await aaveStrategy.bentoBox()).to.be.eq(_bentoBox, "didn't set correct bento box address");
    // expect(await aaveStrategy.strategyToken()).to.be.eq(_usdc, "didn't set correct token address");
    expect(await aaveStrategy.aToken()).to.be.eq(_aUsdc, "didn't set correct aToken address");
    // expect(await aaveStrategy.incentiveController()).to.be.eq(_incentiveController, "didn't set correct incentive controller address");

    await expect(aaveStrategy.connect(randomSigner).safeHarvest(0, false, 0, true)).to.be.revertedWith(customError("OnlyExecutor"));
    // await expect(harvester.connect(randomSigner).executeSafeHarvests([], [], [], [])).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(aaveStrategy.exit("1")).to.be.revertedWith(customError("OnlyBentoBox"));
    await expect(aaveStrategy.withdraw("1")).to.be.revertedWith(customError("OnlyBentoBox"));
    await expect(aaveStrategy.harvest("1", randomSigner.address)).to.be.revertedWith(customError("OnlyBentoBox"));
    // await expect(aaveStrategy.swapExactTokensForUnderlying(0, 1)).to.be.revertedWith("reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)");
  });

});