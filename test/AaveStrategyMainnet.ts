/* eslint-disable prefer-const */
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber } from "@ethersproject/bignumber";
import { AaveStrategy, BentoBoxV1, CombineHarvester } from "../typechain";

describe("Aave Mainnet strategy", async function () {

  this.timeout(40000);

  let snapshotId;
  let aaveStrategy: AaveStrategy;
  let aaveStrategySecondary: AaveStrategy;
  let aaveStrategyWithHarvester: AaveStrategy;
  let bentoBox: BentoBoxV1;
  let harvester: CombineHarvester;
  let signer, usdc, aUsdc, weth, aave, stkAave;

  const _bentoBox = "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966";
  const _bentoBoxOwner = "0x19B3Eb3Af5D93b77a5619b047De0EED7115A19e7";
  const _lendingPool = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9";
  const _factory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
  const _weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const _aave = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
  const _stkAave = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
  const _usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const _aUsdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const _incentiveController = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";

  const _1e18 = BigNumber.from("1000000000000000000");

  before(async () => {

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
            blockNumber: 13500000,
            hardfork: process.env.CODE_COVERAGE ? "berlin" : "london"
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

    const AaveStrategy = (await ethers.getContractFactory("AaveStrategy")).connect(signer);
    const Harvester = (await ethers.getContractFactory("CombineHarvester")).connect(signer);
    const BentoBox = (await ethers.getContractFactory("BentoBoxV1"));
    const Token = (await ethers.getContractFactory("ERC20Mock"));

    usdc = await Token.attach(_usdc);
    weth = await Token.attach(_weth);
    aave = await Token.attach(_aave);
    stkAave = await Token.attach(_stkAave);
    aUsdc = await Token.attach(_aUsdc);

    aaveStrategy = (await AaveStrategy.deploy(
      _lendingPool,
      _incentiveController,
      _usdc,
      _bentoBox,
      _bentoBoxOwner,
      _factory,
      [_aave, _weth, _usdc]
    )).connect(signer) as AaveStrategy;

    aaveStrategySecondary = (await AaveStrategy.deploy(
      _lendingPool,
      _incentiveController,
      _usdc,
      _bentoBox,
      _bentoBoxOwner,
      _factory,
      [_weth, _usdc]
    )).connect(signer) as AaveStrategy;

    harvester = (await Harvester.deploy(_bentoBox)).connect(signer) as CombineHarvester;

    aaveStrategyWithHarvester = (await AaveStrategy.deploy(
      _lendingPool,
      _incentiveController,
      _usdc,
      _bentoBox,
      harvester.address,
      _factory,
      [_weth, _usdc]
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

    await bentoBox.setStrategy(_usdc, aaveStrategySecondary.address);
    await ethers.provider.send("evm_increaseTime", [1210000]);
    await bentoBox.setStrategy(_usdc, aaveStrategySecondary.address);

    const newBentoBalance = (await bentoBox.totals(_usdc)).elastic;
    const newAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
    const balanceDiff = newBentoBalance.sub(oldBentoBalance);

    expect(balanceDiff.gt(0)).to.be.true;
    expect(newAUsdcBalance.eq(0)).to.be.true;
  });

  it("Should claim stkAave", async function () {
    const oldStkAaveBalance = (await stkAave.balanceOf(aaveStrategy.address));

    const newStkAaveBalance = (await stkAave.balanceOf(aaveStrategy.address));
    expect(oldStkAaveBalance.lt(newStkAaveBalance)).to.be.true;
  });

  it("Sanity checks", async function () {

    const randomSigner = await ethers.getNamedSigner("carol");

    expect(await aaveStrategy.bentoBox()).to.be.eq(_bentoBox, "didn't set correct bento box address");
    expect(await aaveStrategy.strategyToken()).to.be.eq(_usdc, "didn't set correct token address");
    expect(await aaveStrategy.aToken()).to.be.eq(_aUsdc, "didn't set correct aToken address");
    expect(await aaveStrategy.incentiveController()).to.be.eq(_incentiveController, "didn't set correct incentive controller address");

    await expect(aaveStrategy.connect(randomSigner).safeHarvest(0, false, 0, true)).to.be.revertedWith("BentoBox Strategy: only Executors");
    await expect(harvester.connect(randomSigner).executeSafeHarvests([], [], [], [], [], [], [])).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(aaveStrategy.exit("1")).to.be.revertedWith("BentoBox Strategy: only BentoBox");
    await expect(aaveStrategy.withdraw("1")).to.be.revertedWith("BentoBox Strategy: only BentoBox");
    await expect(aaveStrategy.harvest("1", randomSigner.address)).to.be.revertedWith("BentoBox Strategy: only BentoBox");
  });

});