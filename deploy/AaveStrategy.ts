import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  console.log("Running Aave strategy deploy script");

  const chainId = await getChainId();

  if (chainId != "137") return console.log(`Skipping Aave strategy deployments on ${chainId}`);

  const aaveTokens = [
    {
      address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // weth
    }, {
      address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // usdc
      bridge: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"
    }, {
      address: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // wbtc
      bridge: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"
    }, {
      address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // wmatic
    }, {
      address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // usdt
      bridge: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"
    }, {
      address: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // dai
      bridge: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"
    }, {
      address: "0xd6df932a45c0f255f85145f286ea0b292b21c90b", // aave
      bridge: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"
    }
  ]
};