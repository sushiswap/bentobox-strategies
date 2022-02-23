import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const strategyToken = "0x6f86e65b255c9111109d2D2325ca2dFc82456efc";   // FTM/MIM
  const degenBox = "0x74A0BcA2eeEdf8883cb91E37e9ff49430f20a616";
  const factory = "0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3"; // Spooky Factory
  const bridgeToken = ethers.constants.AddressZero;
  const executor = deployer;
  const masterChef = "0x2b2929E785374c651a81A63878Ab22742656DcDd"; // Spooky MasterChef
  const pid = 24; // MasterChef pool id
  const router = "0xF491e7B69E4244ad4002BC14e878a34207E38c29"; // Spooky Router
  const rewardToken = "0x841FAD6EAe12c286d1Fd18d1d525DFfA75C7EFFE"; // Spooky Token
  const usePairToken0 = true; // Swap Spooky rewards to FTM to provide FTM/MIM liquidity. token0 is FTM, token1 is MIM
  const pairHashCode = "0xcdf2deca40a0bd56de8e3ce5c7df6727e5b1bf2ac96f283fa9c4b3e6b42ea9d2"; // pair hash code for Spooky

  await deploy("MIMFtmSpookyStrategy", {
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
          resolve(chainId !== "250");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["MIMFtmSpookyStrategy"];
deployFunction.dependencies = [];
