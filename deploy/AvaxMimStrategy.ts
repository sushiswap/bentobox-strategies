import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";
import { LPStrategy } from "../typechain";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const strategyToken = "0x781655d802670bbA3c89aeBaaEa59D3182fD755D"; // MIM/AVAX
  const degenBox = "0x1fC83f75499b7620d53757f0b01E2ae626aAE530";
  const factory = "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10"; // Joe Factory
  const bridgeToken = ethers.constants.AddressZero;
  const xMerlin = "0xfddfE525054efaAD204600d00CA86ADb1Cc2ea8a"; // 0xMerlin.eth
  const masterChef = "0xd6a4F121CA35509aF06A0Be99093d08462f53052"; // Joe MasterChefV2
  const pid = 43; // MasterChefV2 MIM/AVAX pool id
  const router = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4"; // Joe Router
  const rewardToken = "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd"; // Joe Token
  const usePairToken0 = false; // Swap Joe rewards to AVAX to provide MIM/AVAX liquidity. token0 is MIM, token1 is AVAX
  const pairHashCode = "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91"; // pair hash code for TraderJoe

  await deploy("AVAXMIMStrategy", {
    from: deployer,
    args: [
      strategyToken,
      degenBox,
      factory,
      bridgeToken,
      network.name === "hardhat" ? deployer : xMerlin,
      masterChef,
      pid,
      router,
      rewardToken,
      usePairToken0,
      pairHashCode,
    ],
    log: true,
    deterministicDeployment: false,
    contract: "LPStrategy",
  });

  if (network.name !== "hardhat") {
    const AVAXMIMStrategy = await ethers.getContract<LPStrategy>("AVAXMIMStrategy");
    await AVAXMIMStrategy.transferOwnership(xMerlin);
  }
};

export default deployFunction;

// Deploy on Avalanche only
if (network.name !== "hardhat") {
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

deployFunction.tags = ["AVAXMIMStrategy"];
deployFunction.dependencies = [];
