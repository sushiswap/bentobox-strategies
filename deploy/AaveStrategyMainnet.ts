import { BENTOBOX_ADDRESS } from "@sushiswap/core-sdk";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts
}: HardhatRuntimeEnvironment) {
  console.log("Running Aave strategy deploy script");

  const { deployer } = await getNamedAccounts()

  // const harvester = await ethers.getContract("CombineHarvester");
  const executioner = "0x866151F295Ee4279Fcf3ae2fB483a803400CA491"; // harvester.address;

  const lendingPool = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9";
  const incentiveControler = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";
  const bentoBox = "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966";
  const factory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
  const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const stkAave = "0x4da27a545c0c5B758a6BA100e3a049001de870f5";
  const aave = "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9";
  const multisig = "0x19B3Eb3Af5D93b77a5619b047De0EED7115A19e7";
  const tokens = [
    /* {
      symbol: "WETH",
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    }, {
      symbol: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    }, {
      symbol: "WBTC",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    }, */ {
      symbol: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    }, {
      symbol: "DAI",
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    }/* , {
      symbol: "FEI",
      address: "0x956F47F50A910163D8BF957Cf5846D573E7f87CA",
    }, {
      symbol: "CRV",
      address: "0xD533a949740bb3306d119CC777fa900bA034cd52"
    } */
  ]

  const deployedAddress: string[] = [];

  for (const token of tokens) {

    const strategy = await deployments.deploy("AaveStrategyMainnet", {
      from: deployer,
      args: [
        stkAave,
        lendingPool,
        incentiveControler,
        [
          token.address,
          bentoBox,
          executioner,
          factory,
          token.symbol == "WETH" ? [aave, weth] : [aave, weth, token.address]
        ]
      ],
      log: false,
      deterministicDeployment: false,
    });

    console.log(`${token.symbol} Aave strategy deployed at ${strategy.address}`);
    deployedAddress.push(strategy.address);

  }

  /* const strategyFactory = await ethers.getContractFactory("AaveStrategy");

  for (const address of deployedAddress) {
    const strategy = strategyFactory.attach(address);
    await strategy.transferOwnership(multisig);
  } */

};

export default deployFunction;

deployFunction.tags = ["AaveStrategy"];
deployFunction.dependencies = ["CombineHarvester"];
deployFunction.skip = ({ getChainId }) =>
  new Promise((resolve) => {
    getChainId().then(chainId => {
      console.log(chainId);
      return resolve(chainId !== "1")
    })
  });