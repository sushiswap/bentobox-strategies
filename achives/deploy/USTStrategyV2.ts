import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network } from "hardhat";
import { wrappedDeploy } from "../utilities";
import { xMerlin } from "../test/constants";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const USTStrategyV2 = await wrappedDeploy("USTStrategyV2", {
    from: deployer,
    args: [xMerlin, xMerlin],
    log: true,
    deterministicDeployment: false,
  });

  if (network.name !== "hardhat") {
    if ((await USTStrategyV2.owner()) != xMerlin) {
      await USTStrategyV2.transferOwnership(xMerlin); 
    }
  }
};

export default deployFunction;

if (network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "1");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["USTStrategyV2"];
deployFunction.dependencies = [];
