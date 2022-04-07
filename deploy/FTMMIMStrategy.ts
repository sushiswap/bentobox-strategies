import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network } from "hardhat";
import { Constants, xMerlin } from "../test/constants";
import { wrappedDeploy } from "../utilities";
import { SpiritSwapLPStrategy } from "../typechain";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  const executor = deployer;
  const usePairToken0 = true; // Swap Spirit rewards to FTM to provide FTM/MIM liquidity

  const Strategy = await wrappedDeploy<SpiritSwapLPStrategy>("FTMMIMSpiritSwapLPStrategy", {
    from: deployer,
    args: [
      Constants.fantom.spiritFtmMimPair,
      Constants.fantom.degenBox,
      Constants.fantom.spiritFactory,
      executor,
      Constants.fantom.spiritFtmMimGauge,
      Constants.fantom.spîrit,
      usePairToken0
    ],
    log: true,
    deterministicDeployment: false,
    contract: "SpiritSwapLPStrategy"
  })

  if (network.name !== "hardhat") {
    await Strategy.transferOwnership(xMerlin);
    await Strategy.setFeeParameters(xMerlin, 10);
  }
};

export default deployFunction;

// Deploy on Avalanche only
if(network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "250");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["FTMMIMSpiritSwapLPStrategy"];
deployFunction.dependencies = [];
