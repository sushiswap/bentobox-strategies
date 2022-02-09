/* eslint-disable prefer-const */
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber } from "@ethersproject/bignumber";
import { AaveStrategy, BentoBoxV1, CombineHarvester } from "../typechain";
import { customError } from "./Harness";
import { BENTOBOX_ADDRESS, ChainId } from "@sushiswap/core-sdk";
import exp from "constants";

describe("Aave Avalanche strategy", async function () {

    this.timeout(60000);

    let snapshotId;
    let aaveStrategy1: AaveStrategy;
    let aaveStrategy2: AaveStrategy;
    let bentoBox: BentoBoxV1;
    let harvester: CombineHarvester;
    let signer;
    let usdc;
    let aUsdc;
    let wavax;

    const _bentoBox = BENTOBOX_ADDRESS[ChainId.AVALANCHE];
    const _bentoBoxOwner = "0x09842Ce338647906B686aBB3B648A6457fbB25DA";
    const _lendingPool = "0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C";
    const _factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
    const _wavax = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
    const _weth = "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab";
    const _usdc = "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664";
    const _aUsdc = "0x46A51127C3ce23fb7AB1DE06226147F446e4a857";
    const _incentiveController = "0x01D83Fe6A10D2f2B7AF17034343746188272cAc9";
    const _1e18 = BigNumber.from("1000000000000000000");

    before(async () => {

        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: `https://api.avax.network/ext/bc/C/rpc`
                    },
                },
            ],
        })

        await network.provider.request({ method: "hardhat_impersonateAccount", params: [_bentoBoxOwner] })
        signer = await ethers.getSigner(_bentoBoxOwner);

        await network.provider.send("hardhat_setBalance", [
            _bentoBoxOwner,
            "0x100000000000000000000",
        ]);

        const AaveStrategy = (await ethers.getContractFactory("AaveStrategy")).connect(signer);
        const CombineHarvester = (await ethers.getContractFactory("CombineHarvester")).connect(signer);
        const BentoBox = (await ethers.getContractFactory("BentoBoxV1"));
        const Token = (await ethers.getContractFactory("ERC20Mock"));

        usdc = await Token.attach(_usdc);
        wavax = await Token.attach(_wavax);
        aUsdc = await Token.attach(_aUsdc);

        aaveStrategy1 = (await AaveStrategy.deploy(
            _lendingPool,
            _incentiveController,
            [
                _usdc, // strategy token
                _bentoBox, // bentobox address
                _bentoBoxOwner, // strategy executioner (current signer)
                _factory // uni v2 factory
            ]
        )).connect(signer) as AaveStrategy;

        harvester = (await CombineHarvester.deploy(_bentoBox)).connect(signer) as CombineHarvester;

        aaveStrategy2 = (await AaveStrategy.deploy(
            _lendingPool,
            _incentiveController,
            [
                _usdc,
                _bentoBox,
                harvester.address,
                _factory,
            ]
        )).connect(signer) as AaveStrategy;

        bentoBox = (await BentoBox.attach(_bentoBox)).connect(signer) as BentoBoxV1;

        await bentoBox.setStrategy(_usdc, aaveStrategy1.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await bentoBox.setStrategy(_usdc, aaveStrategy1.address);
        await bentoBox.setStrategyTargetPercentage(_usdc, 70);
        await bentoBox.harvest(usdc.address, true, 0);

        snapshotId = await ethers.provider.send('evm_snapshot', []);
    })

    afterEach(async () => {
        await network.provider.send('evm_revert', [snapshotId]);
        snapshotId = await ethers.provider.send('evm_snapshot', []);
    })

    it("Should be setup correctly", async () => {

        const targetPercentage = (await bentoBox.strategyData(usdc.address)).targetPercentage;
        expect(targetPercentage.eq(70)).to.be.true;
        const bentoBalance = await usdc.balanceOf(bentoBox.address);
        const strategyABalance = await aUsdc.balanceOf(aaveStrategy1.address);
        expect(bentoBalance.gt(0)).to.be.true;
        expect(strategyABalance.gt(0)).to.be.true;
        const fullAmount = (await bentoBox.totals(usdc.address)).elastic;
        expect(aboutTheSame(fullAmount, bentoBalance.add(strategyABalance))).to.be.true;

    });

    it("Should produce yield", async () => {

        const elasticOld = (await bentoBox.totals(usdc.address)).elastic
        const bentoBalanceOld = await usdc.balanceOf(bentoBox.address);
        const strategyABalanceOld = await aUsdc.balanceOf(aaveStrategy1.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await ethers.provider.send("evm_mine", []);
        const strategyABalanceNew = await aUsdc.balanceOf(aaveStrategy1.address);
        const diff = strategyABalanceNew.sub(strategyABalanceOld); // 1 unit of aToken is 1 unit of token
        expect(diff.gt(0)).to.be.true;
        await aaveStrategy1.safeHarvest((await bentoBox.totals(usdc.address)).elastic, false, 0, false);
        const elasticNew = (await bentoBox.totals(usdc.address)).elastic
        const bentoBalanceNew = await usdc.balanceOf(bentoBox.address);
        expect(aboutTheSame(bentoBalanceNew, bentoBalanceOld.add(diff))).to.be.true;
        expect(aboutTheSame(elasticNew, elasticOld.add(diff))).to.be.true;

        await bentoBox.harvest(usdc.address, true, 0); // rebalance back into strategy
        const bentoBalanceNewer = await usdc.balanceOf(bentoBox.address);
        expect(bentoBalanceNewer.lt(bentoBalanceNew)).to.be.true;
        expect(bentoBalanceNewer.gt(bentoBalanceOld)).to.be.true;
    });

    it("Should harvest rewards", async () => {
        const strategyRewardBalanceOld = await wavax.balanceOf(aaveStrategy1.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await ethers.provider.send("evm_mine", []);
        await aaveStrategy1.safeHarvest((await bentoBox.totals(usdc.address)).elastic, false, 0, true)
        const strategyRewardBalanceNew = await wavax.balanceOf(aaveStrategy1.address);
        expect(strategyRewardBalanceOld.lt(strategyRewardBalanceNew)).to.be.true;
        await expect(aaveStrategy1.swapExactTokens(wavax.address, 0)).to.revertedWith(customError("NoSwapPath"));
        await aaveStrategy1.setSwapPath(wavax.address, usdc.address);
        await aaveStrategy1.swapExactTokens(wavax.address, 1);
        const strategyBalanceNew = await usdc.balanceOf(aaveStrategy1.address);
        expect(strategyBalanceNew.gt(strategyRewardBalanceOld)).to.be.true;
    })

    it("Should replace strategy", async () => {
        await bentoBox.setStrategy(_usdc, aaveStrategy1.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await bentoBox.setStrategy(_usdc, aaveStrategy1.address);
        await ethers.provider.send("evm_increaseTime", [1210000]); // should go through without fail
        await bentoBox.setStrategy(_usdc, aaveStrategy2.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await bentoBox.setStrategy(_usdc, aaveStrategy2.address);
        const aBalanceOfOldStrategy = await aUsdc.balanceOf(aaveStrategy1.address);
        const balanceOfOldStrategy = await usdc.balanceOf(aaveStrategy1.address);
        expect(aBalanceOfOldStrategy.eq(0)).to.be.true;
        expect(balanceOfOldStrategy.eq(0)).to.be.true;
        await harvester.executeSafeHarvestsManual([{
            strategy: aaveStrategy2.address,
            maxBalance: (await bentoBox.totals(usdc.address)).elastic,
            maxChangeAmount: 0,
            swapToken: ethers.constants.AddressZero,
            minOutAmount: 0,
            rebalance: true,
            harvestReward: false
        }]);
        const aBalance = await aUsdc.balanceOf(aaveStrategy2.address);
        expect(aBalance.gt(0)).to.be.true;
    })

    it("Should prevent sandwiches", async () => {
        const elasticOld = (await bentoBox.totals(usdc.address)).elastic;
        await aaveStrategy1.safeHarvest(elasticOld.sub(1), true, 0, false);
        const elasticNew = (await bentoBox.totals(usdc.address)).elastic;
        expect(elasticOld.eq(elasticNew)).to.be.true;
        await aaveStrategy1.safeHarvest(elasticNew, true, 0, false);
        const elasticNewer = (await bentoBox.totals(usdc.address)).elastic;
        expect(elasticNewer.gt(elasticNew)).to.be.true;
    })

    function aboutTheSame(a: BigNumber, b: BigNumber, precision = 10000) {
        return a.mul(precision).div(b).eq(precision);
    }

});