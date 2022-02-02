import { BENTOBOX_ADDRESS } from "@sushiswap/core-sdk";
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

  const bentoBoxAddress = BENTOBOX_ADDRESS[chainId];

  if (!bentoBoxAddress) throw Error("BentoBox not fouond");

  const { address } = await deployments.deploy("CombineHarvester", {
    from: deployer,
    args: [bentoBoxAddress],
    log: false,
    deterministicDeployment: false,
  });

  console.log(`Harvester deployed at ${address}`);
};

export default deployFunction;

deployFunction.tags = ["CombineHarvester"];