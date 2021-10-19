import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  /*
  console.log("Running CombineHarvester deploy script");

  const { deployer } = await getNamedAccounts()

  const chainId = await getChainId();

  if (chainId != "137") throw Error("Trying to deploy Harvester strategy on a different network than Polygon");

  const bentoBox = "0x0319000133d3AdA02600f0875d2cf03D442C3367";
  const executioner = "0x1008EAC341da6452384EBadDE7655cB418447B4d";


  const { address } = await deployments.deploy("CombineHarvester", {
    from: deployer,
    args: [bentoBox],
    log: false,
    deterministicDeployment: false,
  });

  console.log(`Harvester deployed at ${address}`);

  const strategyFactory = await ethers.getContractFactory("CombineHarvester");

  const strategy = strategyFactory.attach(address);
  await strategy.transferOwnership(executioner);
  */

};

export default deployFunction;

deployFunction.skip = ({ getChainId }) =>
  new Promise((resolve, reject) => {
    try {
      getChainId().then(chainId => {
        resolve(chainId !== "137");
      });
    } catch (error) {
      reject(error);
    }
  });

deployFunction.skip = async () => true; // temporary
deployFunction.tags = ["CombineHarvester"];