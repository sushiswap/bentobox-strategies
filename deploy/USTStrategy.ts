import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  let { deployer } = await getNamedAccounts();
  const harvester = await ethers.getContract("CombineHarvester");

  const degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";

  if (network.name == "hardhat") {
    deployer = degenBoxOwner;
  }

  await deploy("USTStrategy", {
    from: deployer,
    args: [harvester.address],
    log: true,
    deterministicDeployment: false,
  })
};

export default deployFunction;

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

deployFunction.tags = ["USTStrategy"];
deployFunction.dependencies = ["EthereumHarvester"];
