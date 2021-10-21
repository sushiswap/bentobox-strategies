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
const avaxUsdcPair = "0xa389f9430876455c36478deea9769b7ca4e3ddb1";
const pid = 39; // MasterChefV2 AVAX/USDC pool id

describe("AVAX/USDC LP DegenBox Strategy", async () => {
  let snapshotId;
  let Strategy: LPStrategy;
  let BentoBox: BentoBoxV1;
  let LpToken: IERC20;
  let JoeToken: IERC20;
  let MasterChef: IMasterChef;
  let initialStakedLpAmount;

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

    const deployerSigner = await ethers.getSigner(deployer);
    const aliceSigner = await ethers.getSigner(alice);
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
    expect(amount).to.eq(initialStakedLpAmount)
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should farm joe rewards, mint lp and deposit back", async() => {
    await advanceTime(1210000);
    await Strategy.safeHarvest(ethers.constants.MaxUint256, false, 0, false);
  });
});
