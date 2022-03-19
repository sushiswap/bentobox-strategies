/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts, artifacts } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";

import { BentoBoxV1, USTMiddleLayer, USTMock, USTStrategy } from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";

describe("USTMiddleLayer", async () => {
  let snapshotId;
  let USTStrategy: USTStrategy;
  let BentoBox: BentoBoxV1;
  let USTMiddleLayer: USTMiddleLayer;
  let UST: USTMock;
  let aUST: USTMock;
  let ustStrategyOwnerSigner;
  let deployerSigner;
  let ustOwnerSigner;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
            blockNumber: 14410835,
          },
        },
      ],
    });

    await deployments.fixture(["USTMiddleLayer"]);
    const { deployer } = await getNamedAccounts();

    USTStrategy = await ethers.getContractAt<USTStrategy>("USTStrategy", "0xE6191aA754F9a881e0a73F2028eDF324242F39E2");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", "0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce");
    USTMiddleLayer = await ethers.getContract<USTMiddleLayer>("USTMiddleLayer");

    const ustStrategyOwner = await USTStrategy.owner();
    await impersonate(ustStrategyOwner);

    ustStrategyOwnerSigner = await ethers.getSigner(ustStrategyOwner);
    deployerSigner = await ethers.getSigner(deployer);

    await USTStrategy.connect(ustStrategyOwnerSigner).setStrategyExecutor(USTMiddleLayer.address, true);
    UST = await ethers.getContractAt<USTMock>("USTMock", "0xa47c8bf37f92aBed4A126BDA807A7b7498661acD");
    aUST = await ethers.getContractAt<USTMock>("USTMock", "0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab");

    const ustOwner = await UST.owner();
    await impersonate(ustOwner);
    ustOwnerSigner = await ethers.getSigner(ustOwner);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should not be able to redeem if the profit isn't the minimum required", async function () {
    await expect(USTMiddleLayer.accountEarnings()).to.be.revertedWith("YieldNotHighEnough()");
    await UST.connect(ustOwnerSigner).mint(USTStrategy.address, getBigNumber(101));
    await expect(USTMiddleLayer.accountEarnings()).to.not.reverted;
  });

  it("should account earnings without reverting", async function () {
    // at block 14410835, the total - balanceToKeep is around 516783 UST
    await expect(USTMiddleLayer.redeemEarningsImproved()).to.not.reverted;
  });
});
