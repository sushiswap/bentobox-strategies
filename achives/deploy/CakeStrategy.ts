import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";
import { CakeStrategy, XJOEStrategy } from "../typechain";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const strategyToken = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"; // CAKE
  const degenBox = "0x090185f2135308bad17527004364ebcc2d37e5f6";
  const factory = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"; // Cake Factory
  const bridgeToken = ethers.constants.AddressZero;
  const xMerlin = "0xfddfE525054efaAD204600d00CA86ADb1Cc2ea8a"; // 0xMerlin.eth
  const masterChef = "0x73feaa1eE314F8c655E354234017bE2193C9E24E"; // Cake MasterChef
  const pairHashCode = "0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5"; // pair hash code for Pancake

  await deploy("CakeStrategy", {
    from: deployer,
    args: [
      strategyToken,
      degenBox,
      factory,
      bridgeToken,
      network.name === "hardhat" ? deployer : xMerlin,
      masterChef,
      pairHashCode,
    ],
    log: true,
    deterministicDeployment: false,
    contract: "CakeStrategy",
  });

  if (network.name !== "hardhat") {
    const CakeStrategy = await ethers.getContract<CakeStrategy>("CakeStrategy");
    if ((await CakeStrategy.feeCollector()) != xMerlin) {
      await CakeStrategy.setFeeCollector(xMerlin);
    }
    if ((await CakeStrategy.owner()) != xMerlin) {
      await CakeStrategy.transferOwnership(xMerlin); 
    }
  }
};

export default deployFunction;

// Deploy on Avalanche only
if (network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "56");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["CakeStrategy"];
deployFunction.dependencies = [];
