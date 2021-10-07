import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  console.log("Running Aave strategy deploy script");

  const { deployer } = await getNamedAccounts()

  const chainId = await getChainId();

  if (chainId != "137") throw Error("Trying to deploy Aave strategy on a different network than Polygon");

  const harvester = await ethers.getContract("CombineHarvester");

  const incentiveToken = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
  const lendingPool = "0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf";
  const incentiveControler = "0x357D51124f59836DeD84c8a1730D72B749d8BC23";
  const bentoBox = "0x0319000133d3AdA02600f0875d2cf03D442C3367";
  const factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
  const bridgeToken = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
  const zero = "0x0000000000000000000000000000000000000000";
  const executioner = harvester.address;
  const polygonMultisig = "0x2B23D9B02FffA1F5441Ef951B4B95c09faa57EBA";

  const aaveTokens = [
    {
      symbol: "WETH",
      address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      addFactory: true,
      bridgeToken: zero
    }, {
      symbol: "USDC",
      address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
      addFactory: true,
      bridgeToken
    }, {
      symbol: "WBTC",
      address: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
      addFactory: true,
      bridgeToken
    }, {
      symbol: "WMATIC",
      address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
      addFactory: false,
      bridgeToken: zero
    }, {
      symbol: "USDT",
      address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      addFactory: true,
      bridgeToken
    }, {
      symbol: "DAI",
      address: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
      addFactory: true,
      bridgeToken
    }, {
      symbol: "AAVE",
      address: "0xd6df932a45c0f255f85145f286ea0b292b21c90b",
      addFactory: true,
      bridgeToken
    }
  ]

  const deployedAddress: string[] = [];

  for (const token of aaveTokens) {

    const strategy = await deployments.deploy("AaveStrategy", {
      from: deployer,
      args: [
        lendingPool,
        incentiveControler,
        token.address,
        bentoBox,
        executioner,
        token.addFactory ? factory : zero,
        token.bridgeToken
      ],
      log: false,
      deterministicDeployment: false,
    });

    console.log(`${token.symbol} Aave strategy deployed at ${strategy.address}`);
    deployedAddress.push(strategy.address);

  }

  const strategyFactory = await ethers.getContractFactory("AaveStrategy");

  for (const address of deployedAddress) {
    const strategy = strategyFactory.attach(address);
    await strategy.transferOwnership(polygonMultisig);
  }

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

deployFunction.tags = ["AaveStrategy"];
deployFunction.dependencies = ["CombineHarvester"];
deployFunction.skip = async () => true; // temporary