import { BENTOBOX_ADDRESS, ChainId } from "@sushiswap/core-sdk";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts
}: HardhatRuntimeEnvironment) {
  console.log("Running Aave strategy deploy script (avax)");

  const { deployer } = await getNamedAccounts()

  const harvester = await ethers.getContract("CombineHarvester");
  const lendingPool = "0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C";
  const factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
  const wavax = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
  const incentiveController = "0x01D83Fe6A10D2f2B7AF17034343746188272cAc9";
  const bentoBox = BENTOBOX_ADDRESS[ChainId.AVALANCHE];
  const multisig = "0x09842Ce338647906B686aBB3B648A6457fbB25DA";

  const tokens = [
    {
      symbol: "WETH",
      address: "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab",
    }, {
      symbol: "USDC",
      address: "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664",
    }, {
      symbol: "WBTC",
      address: "0x50b7545627a5162f82a992c33b87adc75187b218",
    }, {
      symbol: "USDT",
      address: "0xc7198437980c041c805a1edcba50c1ce5db95118",
    }, {
      symbol: "DAI",
      address: "0xd586e7f844cea2f87f50152665bcbc2c279d8d70",
    }, {
      symbol: "WAVAX",
      address: wavax,
    }
  ]

  const strategyFactory = await ethers.getContractFactory("AaveStrategy");

  for (const token of tokens) {

    const _strategy = await deployments.deploy("AaveStrategy", {
      from: deployer,
      args: [
        lendingPool,
        incentiveController,
        [
          token.address,
          bentoBox,
          harvester.address,
          factory,
        ]
      ]
    });

    console.log(`${token.symbol} Aave strategy deployed at ${_strategy.address}`);

    const strategy = strategyFactory.attach(_strategy.address);
    if (token.address != wavax) await strategy.setSwapPath(wavax, token.address);
    await strategy.transferOwnership(multisig);

  }

};

export default deployFunction;

deployFunction.tags = ["AaveStrategy"];
deployFunction.dependencies = ["CombineHarvester"];
deployFunction.skip = ({ getChainId }) =>
  new Promise((resolve) => {
    getChainId().then(chainId => {
      return resolve(chainId !== ChainId.AVALANCHE.toString())
    })
  });