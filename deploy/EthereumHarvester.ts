import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { network, ethers } from "hardhat";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  let { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  const degenBox = "0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce";
  const degenBoxOwner = "0xb4EfdA6DAf5ef75D08869A0f9C0213278fb43b6C";

  if (network.name == "hardhat") {
    deployer = degenBoxOwner;
  }

  await deployments.deploy("CombineHarvester", {
    from: deployer,
    args: [degenBox],
    log: false,
    deterministicDeployment: false,
  });
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

deployFunction.tags = ["EthereumHarvester"];
