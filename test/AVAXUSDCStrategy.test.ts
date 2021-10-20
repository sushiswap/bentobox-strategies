/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";

import {
  BentoBoxV1,
  IERC20,
  IExchangeRateFeeder,
  IUniswapV2Pair,
  LPStrategy,
  USTMock,
  USTStrategy,
} from "../typechain";
import { advanceTime, blockNumber, getBigNumber, impersonate } from "../utilities";

const degenBox = "0x1fC83f75499b7620d53757f0b01E2ae626aAE530";
const degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";
const joeToken = "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd";
const masterChef = "0xd6a4F121CA35509aF06A0Be99093d08462f53052";
const avaxUsdcPair = "0xa389f9430876455c36478deea9769b7ca4e3ddb1";

describe("AVAX/USDC LP DegenBox Strategy", async () => {
  let snapshotId;
  let Strategy: LPStrategy;
  let BentoBox: BentoBoxV1;
  let Pair: IERC20;
  let signer;

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
    })

    await deployments.fixture(['AVAXUSDCStrategy']);
    const {deployer} = await getNamedAccounts();

    await impersonate(degenBoxOwner);

    const deployerSigner = await ethers.getSigner(deployer);
    
    signer = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract("AVAXUSDCStrategy")

    BentoBox = await ethers.getContractAt<BentoBoxV1>(
      "BentoBoxV1",
      degenBox
    );

    Pair = await ethers.getContractAt<IERC20>(
      "ERC20Mock",
      avaxUsdcPair
    );

    
    BentoBox = BentoBox.connect(signer);

    expect((await BentoBox.totals(Pair.address)).elastic).to.equal(0);
    await BentoBox.setStrategy(Pair.address, Strategy.address);
    await BentoBox.setStrategyTargetPercentage(Pair.address, 70);
    snapshotId = await ethers.provider.send('evm_snapshot', []);
  });

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId]);
    snapshotId = await ethers.provider.send('evm_snapshot', []);
  })

  it("should", async function () {
    
  });
});
