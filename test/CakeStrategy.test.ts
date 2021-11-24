/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";

import { BentoBoxV1, IERC20, IExchangeRateFeeder, IMasterChef, IUniswapV2Pair, LPStrategy, USTMock, USTStrategy } from "../typechain";
import { advanceTime, blockNumber, getBigNumber, impersonate } from "../utilities";

const degenBox = "0x090185f2135308bad17527004364ebcc2d37e5f6";
const degenBoxOwner = "0xfddfE525054efaAD204600d00CA86ADb1Cc2ea8a";
const cakeToken = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const masterChef = "0x73feaa1eE314F8c655E354234017bE2193C9E24E";

describe("Cake DegenBox Strategy", async () => {
  let snapshotId;
  let Strategy: LPStrategy;
  let BentoBox: BentoBoxV1;
  let CakeToken: IERC20;
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
            jsonRpcUrl: ``,
            blockNumber: 12763953,
          },
        },
      ],
    });

    await deployments.fixture(["CakeStrategy"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(degenBoxOwner);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract("CakeStrategy");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);
    MasterChef = await ethers.getContractAt<IMasterChef>("IMasterChef", masterChef);
    CakeToken = await ethers.getContractAt<IERC20>("ERC20Mock", cakeToken);

    // Transfer LPs from a holder to alice
    const lpHolder = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
    await impersonate(lpHolder);
    const lpHolderSigner = await ethers.getSigner(lpHolder);
    await CakeToken.connect(lpHolderSigner).transfer(alice, await CakeToken.balanceOf(lpHolder));

    const aliceLpAmount = await CakeToken.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);

    // Deposit into DegenBox
    //await Pair.connect(deployerSigner).approve(BentoBox.address, amountUSTDeposit);
    await CakeToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(CakeToken.address, alice, alice, aliceLpAmount, 0);
    expect((await BentoBox.totals(CakeToken.address)).elastic).to.equal(aliceLpAmount);

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(CakeToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(CakeToken.address, Strategy.address);
    await BentoBox.setStrategyTargetPercentage(CakeToken.address, 70);

    // Initial Rebalance, calling skim to deposit to masterchef
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await CakeToken.balanceOf(Strategy.address)).to.equal(0);

    // Should get Cake tokens from initial deposit
    expect(await CakeToken.balanceOf(Strategy.address)).to.eq(0);

    // verify if the lp has been deposited to masterchef
    const { amount } = await MasterChef.userInfo(0, Strategy.address);
    initialStakedLpAmount = aliceLpAmount.mul(70).div(100);
    expect(amount).to.eq(initialStakedLpAmount);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should be able to change the fee collector only my the owner", async () => {
    expect(await Strategy.feeCollector()).to.eq(await Strategy.owner());

    await expect(Strategy.connect(aliceSigner).setFeeCollector(aliceSigner.address)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployerSigner).setFeeCollector(aliceSigner.address));

    expect(await Strategy.feeCollector()).to.eq(aliceSigner.address);
  });

  it("should harvest and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(CakeToken.address)).elastic;

    await advanceTime(1210000);

    // harvest cake, report lp profit to bentobox
    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    const newBentoBalance = (await BentoBox.totals(CakeToken.address)).elastic;
    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should rebalance and withdraw CAKE to degenbox", async () => {
    const oldBentoBalance = await CakeToken.balanceOf(BentoBox.address);
    await BentoBox.setStrategyTargetPercentage(CakeToken.address, 50);
    await expect(Strategy.safeHarvest(0, true, 0, false)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await CakeToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should exit the strategy properly", async () => {
    const oldBentoBalance = await CakeToken.balanceOf(BentoBox.address);

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false); // harvest joe

    await expect(BentoBox.setStrategy(CakeToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(CakeToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await CakeToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await CakeToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
