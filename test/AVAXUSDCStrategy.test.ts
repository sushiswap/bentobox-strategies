/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";

import { BentoBoxV1, IERC20, IExchangeRateFeeder, IMasterChef, IUniswapV2Pair, LPStrategy, USTMock, USTStrategy } from "../typechain";
import { advanceTime, blockNumber, getBigNumber, impersonate } from "../utilities";

const degenBox = "0x1fC83f75499b7620d53757f0b01E2ae626aAE530";
const degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";
const joeToken = "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd";
const masterChef = "0xd6a4F121CA35509aF06A0Be99093d08462f53052";
const avaxUsdcPair = "0xA389f9430876455C36478DeEa9769B7Ca4E3DDB1";
const pid = 39; // MasterChefV2 AVAX/USDC pool id

describe("AVAX/USDC LP DegenBox Strategy", async () => {
  let snapshotId;
  let Strategy: LPStrategy;
  let BentoBox: BentoBoxV1;
  let LpToken: IERC20;
  let JoeToken: IERC20;
  let MasterChef: IMasterChef;
  let initialStakedLpAmount;
  let deployerSigner;
  let aliceSigner;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            enabled: true,
            jsonRpcUrl: `https://api.avax.network/ext/bc/C/rpc`,
            blockNumber: 5886381,
          },
        },
      ],
    });

    await deployments.fixture(["AVAXUSDCStrategy"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(degenBoxOwner);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract("AVAXUSDCStrategy");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);
    MasterChef = await ethers.getContractAt<IMasterChef>("IMasterChef", masterChef);
    LpToken = await ethers.getContractAt<IERC20>("ERC20Mock", avaxUsdcPair);
    JoeToken = await ethers.getContractAt<IERC20>("ERC20Mock", joeToken);

    expect((await BentoBox.totals(LpToken.address)).elastic).to.equal(0);

    // Transfer LPs from a holder to alice
    const lpHolder = "0xd6137678698f5304bEf86262332Be671618d5d08";
    await impersonate(lpHolder);
    const lpHolderSigner = await ethers.getSigner(lpHolder);
    await LpToken.connect(lpHolderSigner).transfer(alice, await LpToken.balanceOf(lpHolder));

    const aliceLpAmount = await LpToken.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);

    // Deposit into DegenBox
    //await Pair.connect(deployerSigner).approve(BentoBox.address, amountUSTDeposit);
    await LpToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(LpToken.address, alice, alice, aliceLpAmount, 0);
    expect((await BentoBox.totals(LpToken.address)).elastic).to.equal(aliceLpAmount);

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 70);

    // Initial Rebalance, calling skim to deposit to masterchef
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await LpToken.balanceOf(Strategy.address)).to.equal(0);

    // Should get JOE tokens from initial deposit
    expect(await JoeToken.balanceOf(Strategy.address)).to.eq(0);

    // verify if the lp has been deposited to masterchef
    const { amount } = await MasterChef.userInfo(pid, Strategy.address);
    initialStakedLpAmount = aliceLpAmount.mul(70).div(100);
    expect(amount).to.eq(initialStakedLpAmount);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should farm joe rewards", async () => {
    let previousAmount = await JoeToken.balanceOf(Strategy.address);

    for (let i = 0; i < 10; i++) {
      await advanceTime(1210000);
      await Strategy.safeHarvest(ethers.constants.MaxUint256, false, 0, false);
      const amount = await JoeToken.balanceOf(Strategy.address);

      expect(amount).to.be.gt(previousAmount);
      previousAmount = amount;
    }
  });

  it("should mint lp from joe rewards and take 10%", async () => {
    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false);

    const feeCollector = await Strategy.feeCollector();
    const balanceFeeCollectorBefore = await LpToken.balanceOf(feeCollector);
    const balanceBefore = await LpToken.balanceOf(Strategy.address);
    const tx = await Strategy.swapToLP(0);
    const balanceAfter = await LpToken.balanceOf(Strategy.address);
    const balanceFeeCollectorAfter = await LpToken.balanceOf(feeCollector);

    // Strategy should now have more LP
    expect(balanceAfter.sub(balanceBefore)).to.be.gt(0);

    // FeeCollector should have received some LP
    expect(balanceFeeCollectorAfter.sub(balanceFeeCollectorBefore)).to.be.gt(0);

    await expect(tx).to.emit(Strategy, "LpMinted");
  });

  it("should be able to change the fee collector only my the owner", async () => {
    expect(await Strategy.feeCollector()).to.eq(await Strategy.owner());

    await expect(Strategy.connect(aliceSigner).setFeeCollector(aliceSigner.address)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployerSigner).setFeeCollector(aliceSigner.address));

    expect(await Strategy.feeCollector()).to.eq(aliceSigner.address);
  });

  it("should avoid front running when minting lp", async () => {
    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false);

    // expected amount out should be around 11e13 so adding extra decimals to
    // simulate a front running situation.
    await expect(Strategy.swapToLP(getBigNumber(2, 14))).to.revertedWith("LPStrategy: SLIPPAGE_TOO_HIGH");
  });

  it("should harvest harvest, mint lp and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false); // harvest joe
    await Strategy.swapToLP(0); // mint new usdc/avax lp from harvest joe

    // harvest joe, report lp profit to bentobox
    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    const newBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;
    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should rebalance and withdraw lp to degenbox", async () => {
    const oldBentoBalance = await LpToken.balanceOf(BentoBox.address);
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 50);
    await expect(Strategy.safeHarvest(0, true, 0, false)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should exit the strategy properly", async () => {
    const oldBentoBalance = await LpToken.balanceOf(BentoBox.address);

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false); // harvest joe
    await Strategy.swapToLP(0); // mint new usdc/avax lp from harvest joe

    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await LpToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
