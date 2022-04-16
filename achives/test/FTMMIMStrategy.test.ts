/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { BentoBoxV1, ERC20Mock, IERC20, ISpiritSwapGauge, SpiritSwapLPStrategy } from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";
import { Constants } from "./constants";

const degenBox = Constants.fantom.degenBox;
const degenBoxOwner = Constants.fantom.degenBoxOwner;
const spiritToken = Constants.fantom.spîrit;
const gauge = Constants.fantom.spiritFtmMimGauge;
const ftmMimPair = Constants.fantom.spiritFtmMimPair;
const ftmMimPairWhale = "0x9E05295a9a88FeFa61dE90422a708fF63878Cd6B";

describe("FTM/MIM LP DegenBox Strategy", async () => {
  let snapshotId;
  let Strategy: SpiritSwapLPStrategy;
  let BentoBox: BentoBoxV1;
  let LpToken: IERC20;
  let SpiritToken: ERC20Mock;
  let Gauge: ISpiritSwapGauge;
  let deployerSigner;
  let gaugeProxySigner;
  let aliceSigner;
  let spiritTokenOwnerSigner;

  const distributeReward = async (amount) => {
    await SpiritToken.connect(spiritTokenOwnerSigner).mint(Constants.fantom.spiritGaugeProxy, amount);
    await SpiritToken.connect(gaugeProxySigner).approve(Gauge.address, 0);
    await SpiritToken.connect(gaugeProxySigner).approve(Gauge.address, amount);
    await Gauge.connect(gaugeProxySigner).notifyRewardAmount(amount);
  };

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            enabled: true,
            jsonRpcUrl: `https://rpc.ftm.tools/`,
            blockNumber: 35300198,
          },
        },
      ],
    });

    await deployments.fixture(["FTMMIMSpiritSwapLPStrategy"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(degenBoxOwner);
    await impersonate(Constants.fantom.spiritGaugeProxy);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    gaugeProxySigner = await ethers.getSigner(Constants.fantom.spiritGaugeProxy);

    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract("FTMMIMSpiritSwapLPStrategy");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);
    Gauge = await ethers.getContractAt<ISpiritSwapGauge>("ISpiritSwapGauge", gauge);
    LpToken = await ethers.getContractAt<IERC20>("ERC20Mock", ftmMimPair);
    SpiritToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", spiritToken);

    const spiritTokenOwner = await SpiritToken.owner();
    await impersonate(spiritTokenOwner);
    spiritTokenOwnerSigner = await ethers.getSigner(spiritTokenOwner);

    // Transfer LPs from a holder to alice
    await impersonate(ftmMimPairWhale);
    const lpHolderSigner = await ethers.getSigner(ftmMimPairWhale);
    await LpToken.connect(lpHolderSigner).transfer(alice, await LpToken.balanceOf(ftmMimPairWhale));

    const aliceLpAmount = await LpToken.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);

    // Deposit into DegenBox
    await LpToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(LpToken.address, alice, alice, aliceLpAmount, 0);

    const lpAmount = (await BentoBox.totals(LpToken.address)).elastic;

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 70);

    // Initial Rebalance, calling skim to deposit to the gauge
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await LpToken.balanceOf(Strategy.address)).to.equal(0);
    expect(await SpiritToken.balanceOf(Strategy.address)).to.eq(0);

    // verify if the lp has been deposited to the gauge
    const amountStaked = await Gauge.balanceOf(Strategy.address);
    expect(amountStaked).to.eq(lpAmount.mul(70).div(100));

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should farm spirit rewards", async () => {
    let previousAmount = await SpiritToken.balanceOf(Strategy.address);

    for (let i = 0; i < 10; i++) {
      await distributeReward(getBigNumber(9999));
      await Strategy.safeHarvest(ethers.constants.MaxUint256, false, 0, false);
      const amount = await SpiritToken.balanceOf(Strategy.address);

      expect(amount).to.be.gt(previousAmount);
      previousAmount = amount;
    }
  });

  it("should be able to change the fee collector only by the owner", async () => {
    const [deployer, alice] = await ethers.getSigners();
    await expect(Strategy.connect(alice).setFeeParameters(alice.address, 10)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployer).setFeeParameters(alice.address, 10));

    expect(await Strategy.feeCollector()).to.eq(alice.address);
  });

  it("should mint lp from spirit rewards and take 10%", async () => {
    const { deployer } = await getNamedAccounts();
    await Strategy.setFeeParameters(deployer, 10);

    await distributeReward(getBigNumber(9999));
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

  it("should avoid front running when minting lp", async () => {
    await distributeReward(getBigNumber(9999));
    await Strategy.safeHarvest(0, false, 0, false);
    await expect(Strategy.swapToLP(getBigNumber(2, 14))).to.revertedWith("InsufficientAmountOut");
  });

  it("should harvest harvest, mint lp and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;

    await distributeReward(getBigNumber(9999));
    await Strategy.safeHarvest(0, false, 0, false); // harvest spirit
    await Strategy.swapToLP(0); // mint new ftm/mimlp from harvest spirit

    // harvest spirit, report lp profit to bentobox
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
    await distributeReward(getBigNumber(1));
    await Strategy.safeHarvest(0, false, 0, false); // harvest spirit
    await Strategy.swapToLP(0); // mint new ftm/mimlp from harvest spirit

    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await LpToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
