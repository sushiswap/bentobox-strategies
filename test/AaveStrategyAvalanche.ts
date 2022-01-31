/* eslint-disable prefer-const */
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber } from "@ethersproject/bignumber";
import { AaveStrategy, BentoBoxV1, CombineHarvester } from "../typechain";
import { customError } from "./Utils";
import { BENTOBOX_ADDRESS, ChainId } from "@sushiswap/core-sdk";

describe("Aave Avalanche strategy", async function () {

    this.timeout(60000);

    let snapshotId;
    let aaveStrategy: AaveStrategy;
    let aaveStrategySecondary: AaveStrategy;
    let aaveStrategyWithHarvester: AaveStrategy;
    let bentoBox: BentoBoxV1;
    let harvester: CombineHarvester;
    let signer;
    let usdc;
    let aUsdc;
    let wmatic;

    const _bentoBox = BENTOBOX_ADDRESS[ChainId.AVALANCHE];
    const _bentoBoxOwner = "0x0711B6026068f736bae6B213031fCE978D48E026";
    const _lendingPool = "0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C";
    const _factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
    const _wavax = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
    const _weth = "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab";
    const _usdc = "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664";
    
    const _aUsdc = "0x1a13F4Ca1d028320A707D99520AbFefca3998b7F";
    const _incentiveController = "0x357D51124f59836DeD84c8a1730D72B749d8BC23";
    const _1e18 = BigNumber.from("1000000000000000000");

    before(async () => {

        await network.provider.request({
            method: "hardhat_reset",
            params: [{ forking: { jsonRpcUrl: `https://api.avax.network/ext/bc/C/rpc` } }]
        })

        await network.provider.request({ method: "hardhat_impersonateAccount", params: [_bentoBoxOwner] })
        signer = await ethers.getSigner(_bentoBoxOwner);

        await network.provider.send("hardhat_setBalance", [
            _bentoBoxOwner,
            "0x1000000000000000000",
        ]);

        const AaveStrategy = (await ethers.getContractFactory("AaveStrategy")).connect(signer);
        const Harvester = (await ethers.getContractFactory("CombineHarvester")).connect(signer);
        const BentoBox = (await ethers.getContractFactory("BentoBoxV1"));
        const Token = (await ethers.getContractFactory("ERC20Mock"));

        usdc = await Token.attach(_usdc);
        wmatic = await Token.attach(_wmatic);
        aUsdc = await Token.attach(_aUsdc);

        aaveStrategy = (await AaveStrategy.deploy(
            _lendingPool,
            _incentiveController,
            [
                _usdc,
                _bentoBox,
                _bentoBoxOwner,
                _factory,
                [_wmatic, _usdc]
            ]
        )).connect(signer) as AaveStrategy;

        aaveStrategySecondary = (await AaveStrategy.deploy(
            _lendingPool,
            _incentiveController,
            [
                _usdc,
                _bentoBox,
                _bentoBoxOwner,
                _factory,
                [_wmatic, _usdc]
            ]
        )).connect(signer) as AaveStrategy;

        harvester = (await Harvester.deploy(_bentoBox)).connect(signer) as CombineHarvester;

        aaveStrategyWithHarvester = (await AaveStrategy.deploy(
            _lendingPool,
            _incentiveController,
            [
                _usdc,
                _bentoBox,
                harvester.address,
                _factory,
                [_wmatic, _usdc]
            ]
        )).connect(signer) as AaveStrategy;

        bentoBox = (await BentoBox.attach(_bentoBox)).connect(signer) as BentoBoxV1;

        await bentoBox.setStrategy(_usdc, aaveStrategy.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await bentoBox.setStrategy(_usdc, aaveStrategy.address);
        await bentoBox.setStrategyTargetPercentage(_usdc, 70);
        await aaveStrategy.safeHarvest(_1e18.mul(10000000000), true, 0, false); // rebalances into the strategy
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await ethers.provider.send("evm_mine", []);

        snapshotId = await ethers.provider.send('evm_snapshot', []);
    })

    afterEach(async () => {
        await network.provider.send('evm_revert', [snapshotId]);
        snapshotId = await ethers.provider.send('evm_snapshot', []);
    })

    it("Strategy should report a profit", async function () {
        expect((await bentoBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

        const oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await ethers.provider.send("evm_mine", []);

        const newAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
        const oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;
        await aaveStrategy.safeHarvest(0, false, 0, false);

        const newBentoBalance = (await bentoBox.totals(_usdc)).elastic;
        const diff = newAUsdcBalance.sub(oldAUsdcBalance);
        const balanceDiff = newBentoBalance.sub(oldBentoBalance);

        expect(diff.gt(0)).to.be.true;
        expect(balanceDiff.gt(0)).to.be.true;
    });

    it("Exits smoothly", async function () {
        expect((await bentoBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

        const oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;

        await bentoBox.setStrategy(_usdc, aaveStrategySecondary.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await bentoBox.setStrategy(_usdc, aaveStrategySecondary.address);

        const newBentoBalance = (await bentoBox.totals(_usdc)).elastic;
        const newAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
        const balanceDiff = newBentoBalance.sub(oldBentoBalance);

        expect(balanceDiff.gt(0)).to.be.true;
        expect(newAUsdcBalance.eq(0)).to.be.true;
    });

    it("Sells rewards", async function () {
        expect((await bentoBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

        await aaveStrategy.safeHarvest(0, true, 0, true);

        const wmaticBalance = await wmatic.balanceOf(aaveStrategy.address);
        const oldUsdcbalance = await usdc.balanceOf(aaveStrategy.address);
        await aaveStrategy.swapExactTokensForUnderlying(0, 0);

        const usdcbalance = await usdc.balanceOf(aaveStrategy.address);
        await aaveStrategy.safeHarvest(0, false, 0, true);

        const newUsdcbalance = await usdc.balanceOf(aaveStrategy.address);

        expect(wmaticBalance.gt(0)).to.be.true;
        expect(oldUsdcbalance.eq(0)).to.be.true;
        expect(usdcbalance.gt(0)).to.be.true;
        expect(newUsdcbalance.eq(0)).to.be.true;
    });

    it("Executes through combine harvester", async function () {

        expect((await bentoBox.strategyData(_usdc)).balance.gt(0)).to.be.true;

        let oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;

        await bentoBox.setStrategy(_usdc, aaveStrategyWithHarvester.address);
        await ethers.provider.send("evm_increaseTime", [1210000]);
        await bentoBox.setStrategy(_usdc, aaveStrategyWithHarvester.address);

        let newBentoBalance = (await bentoBox.totals(_usdc)).elastic;
        let newAUsdcBalance = await aUsdc.balanceOf(aaveStrategy.address);
        let bentoDiff = newBentoBalance.sub(oldBentoBalance);
        expect(bentoDiff.gt(0)).to.be.true;
        expect(newAUsdcBalance.eq(0)).to.be.true;

        await harvester.executeSafeHarvestsManual(
            [aaveStrategyWithHarvester.address],
            [ethers.constants.MaxUint256],
            [true],
            [0],
            [false],
            [0]
        );

        let oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
        oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;

        await expect(aaveStrategyWithHarvester.safeHarvest(0, false, 0, true)).to.be.revertedWith(customError("OnlyExecutor"));

        await ethers.provider.send("evm_increaseTime", [1210000]);
        await ethers.provider.send("evm_mine", []);

        await harvester.executeSafeHarvests(
            [aaveStrategyWithHarvester.address],
            [0],
            [true],
            [0]
        );


        newAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
        let newWmaticBalance = await wmatic.balanceOf(aaveStrategyWithHarvester.address);
        let newerBentoBalance = (await bentoBox.totals(_usdc)).elastic;
        let aTokenDiff = newAUsdcBalance.sub(oldAUsdcBalance);
        let newBalanceDiff = newerBentoBalance.sub(newBentoBalance);
        expect(aTokenDiff.lt(10)).to.be.true; // shouldn't skim the profits since we won't be out of the +-1% target

        oldAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
        oldBentoBalance = (await bentoBox.totals(_usdc)).elastic;

        await harvester.executeSafeHarvestsManual(
            [aaveStrategyWithHarvester.address],
            [0],
            [true],
            [0],
            [true],
            [0]
        );


        newAUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
        newWmaticBalance = await wmatic.balanceOf(aaveStrategyWithHarvester.address);

        newerBentoBalance = (await bentoBox.totals(_usdc)).elastic;
        aTokenDiff = newAUsdcBalance.sub(oldAUsdcBalance);
        newBalanceDiff = newerBentoBalance.sub(newBentoBalance);
        expect(aTokenDiff.gt(0)).to.be.true;
        expect(newBalanceDiff.gt(0)).to.be.true;
        expect(newWmaticBalance.gt(0)).to.be.true;

        let oldUsdcBalance = await usdc.balanceOf(aaveStrategyWithHarvester.address);

        await harvester.executeSafeHarvestsManual(
            [aaveStrategyWithHarvester.address],
            [0],
            [true],
            [0],
            [true],
            [1]
        );

        let newUsdcBalance = await aUsdc.balanceOf(aaveStrategyWithHarvester.address);
        newWmaticBalance = await wmatic.balanceOf(aaveStrategyWithHarvester.address);
        expect(newUsdcBalance.gt(oldUsdcBalance)).to.be.true;
        expect(newWmaticBalance.eq(0)).to.be.true;

    });

    it("Sanity checks", async function () {

        const randomSigner = await ethers.getNamedSigner("carol");

        expect(await aaveStrategy.aToken()).to.be.eq(_aUsdc, "didn't set correct aToken address");
        // expect(await aaveStrategy.incentiveController()).to.be.eq(_incentiveController, "didn't set correct incentive controller address");

        await expect(aaveStrategy.connect(randomSigner).safeHarvest(0, false, 0, true)).to.be.revertedWith(customError("OnlyExecutor"));
        await expect(harvester.connect(randomSigner).executeSafeHarvests([], [], [], [])).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(aaveStrategy.exit("1")).to.be.revertedWith(customError("OnlyBentoBox"));
        await expect(aaveStrategy.withdraw("1")).to.be.revertedWith(customError("OnlyBentoBox"));
        await expect(aaveStrategy.harvest("1", randomSigner.address)).to.be.revertedWith(customError("OnlyBentoBox"));
    });

});