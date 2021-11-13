import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  console.log("Running CombineHarvester deploy script");

  const { deployer } = await getNamedAccounts()

  const chainId = await getChainId();

  let bentoBox;

  if (chainId == "137") {
    bentoBox = "0x0319000133d3AdA02600f0875d2cf03D442C3367";
  } else if (chainId == "1") {
    bentoBox = "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966";
  } else if (chainId == "42") {
    bentoBox = "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966";
  } else {
    throw Error("Trying to deploy Harvester strategy on a different network than Mainnet / Polygon");
  }

  const { address } = await deployments.deploy("CombineHarvester", {
    from: deployer,
    args: [bentoBox],
    log: false,
    deterministicDeployment: false,
  });

  console.log(`Harvester deployed at ${address}`);
};

export default deployFunction;

deployFunction.tags = ["CombineHarvester"];