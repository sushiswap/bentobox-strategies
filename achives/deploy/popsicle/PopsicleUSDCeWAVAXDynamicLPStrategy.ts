import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, network } from "hardhat";
import { DynamicLPStrategy, DynamicSubLPStrategy } from "../typechain";

const DEGENBOX = "0xD825d06061fdc0585e4373F0A3F01a8C02b0e6A4";
const JOE_USDCe_WAVAX_LP = "0xA389f9430876455C36478DeEa9769B7Ca4E3DDB1";
const PNG_USDCe_WAVAX_LP = "0xbd918Ed441767fe7924e99F6a0E0B568ac1970D9";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("Popsicle_UsdceWavaxJLP_DynamicLPStrategy", {
    from: deployer,
    args: [
      JOE_USDCe_WAVAX_LP, // strategy token
      DEGENBOX,
      deployer,
    ],
    contract: "DynamicLPStrategy",
    log: true,
    deterministicDeployment: false,
  });

  const DynamicLPStrategy = await ethers.getContract<DynamicLPStrategy>("Popsicle_UsdceWavaxJLP_DynamicLPStrategy");

  // USDC.e/WAVAX jPL sub-strategy
  await deploy("Popsicle_UsdceWavaxJLP_DynamicSubLPStrategy", {
    from: deployer,
    args: [
      DEGENBOX,
      DynamicLPStrategy.address,
      JOE_USDCe_WAVAX_LP,
      JOE_USDCe_WAVAX_LP,
      "0x0E1eA2269D6e22DfEEbce7b0A4c6c3d415b5bC85", // USDC.e/WAVAX jLP oracle
      "0xd6a4F121CA35509aF06A0Be99093d08462f53052", // Joe MasterChefV2
      "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", // Joe Token
      39, // MasterChefV2 AVAX/USDC pool id
      false, // _usePairToken0 to false, JOE -> WAVAX -> jLP (USDC.e/WAVAX)

      // _strategyTokenInInfo
      {
        factory: "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10", // Joe Factory
        router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // Joe Router
        pairCodeHash: "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91", // pair hash code for TraderJoe
      },
      // _strategyTokenOutInfo - Same as _strategyTokenInInfo since token in is same as tokenOut
      {
        factory: "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10", // Joe Factory
        router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // Joe Router
        pairCodeHash: "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91", // pair hash code for TraderJoe
      },
    ],
    contract: "JoeDynamicSubLPStrategy",
    log: true,
    deterministicDeployment: false,
  });

  // USDC.e/WAVAX pLP sub-strategy
  await deploy("Popsicle_UsdceWavaxPLP_DynamicSubLPStrategy", {
    from: deployer,
    args: [
      DEGENBOX,
      DynamicLPStrategy.address,
      PNG_USDCe_WAVAX_LP,
      JOE_USDCe_WAVAX_LP,
      "0x1e21573cfc456f8aDd4C27ff16B50112e3adC7aC", // USDC.e/WAVAX Pangolin oracle
      "0x1f806f7C8dED893fd3caE279191ad7Aa3798E928", // Png MiniChefV2
      "0x60781C2586D68229fde47564546784ab3fACA982", // Png Token
      9, // MiniChefV2 AVAX/USDC pool id
      false, // _usePairToken0 to false, PNG -> WAVAX -> pLP (USDC.e/WAVAX)

      // _strategyTokenInInfo
      {
        factory: "0xefa94DE7a4656D787667C749f7E1223D71E9FD88", // Png Factory
        router: "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106", // Png Router
        pairCodeHash: "0x40231f6b438bce0797c9ada29b718a87ea0a5cea3fe9a771abdd76bd41a3e545", // pair hash code for Pangolin
      },
      // _strategyTokenOutInfo is Joe USDC.e/WAVAX jLP
      {
        factory: "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10", // Joe Factory
        router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // Joe Router
        pairCodeHash: "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91", // pair hash code for TraderJoe
      },
    ],
    contract: "PangolinDynamicSubLPStrategy",
    log: true,
    deterministicDeployment: false,
  });

  const JoeSubStrategy= await ethers.getContract<DynamicSubLPStrategy>("Popsicle_UsdceWavaxJLP_DynamicSubLPStrategy");
  const PngSubStrategy = await ethers.getContract<DynamicSubLPStrategy>("Popsicle_UsdceWavaxPLP_DynamicSubLPStrategy");

  await DynamicLPStrategy.addSubStrategy(JoeSubStrategy.address);
  await DynamicLPStrategy.addSubStrategy(PngSubStrategy.address);
};

export default deployFunction;

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

deployFunction.tags = ["PopsicleUSDCeWAVAXDynamicLPStrategy"];
deployFunction.dependencies = [];
