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
const xJoeToken = "0x57319d41F71E81F3c65F2a47CA4e001EbAFd4F33";
const pid = 24;

describe("xJOE DegenBox Strategy", async () => {
  let snapshotId;
  let Strategy: LPStrategy;
  let BentoBox: BentoBoxV1;
  let xJOE: IERC20;
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
            blockNumber: 6431700,
          },
        },
      ],
    });

    await deployments.fixture(["XJOEStrategy"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(degenBoxOwner);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract("XJOEStrategy");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);
    MasterChef = await ethers.getContractAt<IMasterChef>("IMasterChef", masterChef);
    xJOE = await ethers.getContractAt<IERC20>("ERC20Mock", xJoeToken);
    JoeToken = await ethers.getContractAt<IERC20>("ERC20Mock", joeToken);

    expect((await BentoBox.totals(xJOE.address)).elastic).to.equal(0);

    // Transfer LPs from a holder to alice
    const lpHolder = "0xf3537ac805e1ce18AA9F61A4b1DCD04F10a007E9";
    await impersonate(lpHolder);
    const lpHolderSigner = await ethers.getSigner(lpHolder);
    await xJOE.connect(lpHolderSigner).transfer(alice, await xJOE.balanceOf(lpHolder));

    const aliceLpAmount = await xJOE.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);

    // Deposit into DegenBox
    //await Pair.connect(deployerSigner).approve(BentoBox.address, amountUSTDeposit);
    await xJOE.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(xJOE.address, alice, alice, aliceLpAmount, 0);
    expect((await BentoBox.totals(xJOE.address)).elastic).to.equal(aliceLpAmount);

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(xJOE.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(xJOE.address, Strategy.address);
    await BentoBox.setStrategyTargetPercentage(xJOE.address, 70);

    // Initial Rebalance, calling skim to deposit to masterchef
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await xJOE.balanceOf(Strategy.address)).to.equal(0);

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

  it("should be able to change the fee collector only my the owner", async () => {
    expect(await Strategy.feeCollector()).to.eq(await Strategy.owner());

    await expect(Strategy.connect(aliceSigner).setFeeCollector(aliceSigner.address)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployerSigner).setFeeCollector(aliceSigner.address));

    expect(await Strategy.feeCollector()).to.eq(aliceSigner.address);
  });

  it("should harvest harvest, mint lp and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(xJOE.address)).elastic;

    await advanceTime(1210000);

    // harvest joe, report lp profit to bentobox
    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    const newBentoBalance = (await BentoBox.totals(xJOE.address)).elastic;
    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should rebalance and withdraw lp to degenbox", async () => {
    const oldBentoBalance = await xJOE.balanceOf(BentoBox.address);
    await BentoBox.setStrategyTargetPercentage(xJOE.address, 50);
    await expect(Strategy.safeHarvest(0, true, 0, false)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await xJOE.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should exit the strategy properly", async () => {
    const oldBentoBalance = await xJOE.balanceOf(BentoBox.address);

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false); // harvest joe

    await expect(BentoBox.setStrategy(xJOE.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(xJOE.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await xJOE.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await xJOE.balanceOf(Strategy.address)).to.eq(0);
  });
});
