import { ChainId, WNATIVE } from "@sushiswap/core-sdk";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  console.log("Running BentoBox deploy script");

  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = Number(await getChainId());

  let wethAddress;

  if (chainId === 31337) {
    // bentoBoxV1Address = (await ethers.getContract("BentoBoxV1")).address;
    wethAddress = (await ethers.getContract("ERC20Mock")).address;
  } else {
    if (!(chainId in WNATIVE)) {
      throw Error(`No WETH on chain #${chainId}!`);
    }
    wethAddress = WNATIVE[chainId as ChainId].address;
  }

  const { address } = await deploy("BentoBoxV1", {
    from: deployer,
    args: [wethAddress],
    deterministicDeployment: false,
  });

  console.log("BentoBoxV1 deployed at ", address);
};

export default deployFunction;

deployFunction.tags = ["BentoBoxV1"];
deployFunction.skip = async () => true;
