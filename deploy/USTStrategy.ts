import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";
import { USTStrategy, DegenBox } from "../typechain";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";

  await deploy("USTStrategy", {
    from: deployer,
    args: [deployer],
    log: true,
    deterministicDeployment: false,
  })

  if (network.name == "hardhat") {
    const USTStrategy = await ethers.getContract<USTStrategy>("USTStrategy");
    await USTStrategy.setStrategyExecutor(deployer, false);
    await USTStrategy.setStrategyExecutor(degenBoxOwner, true);
    await USTStrategy.transferOwnership(degenBoxOwner);
  }
};

export default deployFunction;

if(network.name !== "hardhat") {
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

deployFunction.tags = ["USTStrategy"];
deployFunction.dependencies = ["EthereumHarvester"];
