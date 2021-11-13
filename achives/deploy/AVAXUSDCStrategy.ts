import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const strategyToken = "0xa389f9430876455c36478deea9769b7ca4e3ddb1";   // AVAX/USDC
  const degenBox = "0x1fC83f75499b7620d53757f0b01E2ae626aAE530";
  const factory = "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10"; // Joe Factory
  const bridgeToken = ethers.constants.AddressZero;
  const executor = deployer;
  const masterChef = "0xd6a4F121CA35509aF06A0Be99093d08462f53052"; // Joe MasterChefV2
  const pid = 39; // MasterChefV2 AVAX/USDC pool id
  const router = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4"; // Joe Router
  const rewardToken = "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd"; // Joe Token
  const usePairToken0 = false; // Swap Joe rewards to AVAX to provide AVAX/USDC liquidity. token0 is USDC, token1 is AVAX
  const pairHashCode = "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91"; // pair hash code for TraderJoe

  await deploy("AVAXUSDCStrategy", {
    from: deployer,
    args: [
      strategyToken,
      degenBox,
      factory,
      bridgeToken,
      executor,
      masterChef,
      pid,
      router,
      rewardToken,
      usePairToken0,
      pairHashCode
    ],
    log: true,
    deterministicDeployment: false,
    contract: "LPStrategy"
  })
};

export default deployFunction;

// Deploy on Avalanche only
if(network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "43114");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["AVAXUSDCStrategy"];
deployFunction.dependencies = [];
