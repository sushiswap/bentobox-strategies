/* eslint-disable prefer-const */
import { ethers, network } from "hardhat";
import { BigNumber } from "@ethersproject/bignumber";
import { BentoBoxStrategy, BentoBoxV1, YearnStrategy } from "../typechain";
import { StrategyHarness } from "./Harness";
import { BENTOBOX_ADDRESS, ChainId } from "@sushiswap/core-sdk";
import { expect } from "chai";

describe("Yearn Fantom strategy", async function () {

    this.timeout(60000);

    let snapshotId;
    let yearnStrategy: YearnStrategy;
    let bentoBox: BentoBoxV1;
    let signer;
    let usdc;
    let yvUsdc;
    let usdcWhale;

    let harness: StrategyHarness;

    const _bentoBox = BENTOBOX_ADDRESS[ChainId.FANTOM];
    const _bentoBoxOwner = "0xf9e7d4c6d36ca311566f46c81e572102a2dc9f52";
    const _usdc = "0x04068da6c83afcfa0e13ba15a6696662335d5b75";
    const _factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
    const _yearnRegistry = "0x727fe1759430df13655ddb0731dE0D0FDE929b04";
    const _yvUsdc = "0xEF0210eB96c7EB36AF8ed1c20306462764935607";
    const _usdcWhale = "0x27e611fd27b276acbd5ffd632e5eaebec9761e40"

    before(async () => {

        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: `https://rpc.ftm.tools/`
                    },
                },
            ],
        })

        await network.provider.request({ method: "hardhat_impersonateAccount", params: [_bentoBoxOwner] })
        signer = await ethers.getSigner(_bentoBoxOwner);
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [_usdcWhale] })
        usdcWhale = await ethers.getSigner(_usdcWhale);

        await network.provider.send("hardhat_setBalance", [_bentoBoxOwner, "0x1000000000000000000",]);
        await network.provider.send("hardhat_setBalance", [_usdcWhale, "0x1000000000000000000",]);

        const YearnStrategy = (await ethers.getContractFactory("YearnStrategy")).connect(signer);
        const BentoBox = (await ethers.getContractFactory("BentoBoxV1"));
        const Token = (await ethers.getContractFactory("ERC20Mock"));

        bentoBox = (await BentoBox.attach(_bentoBox)).connect(signer) as BentoBoxV1;
        usdc = await Token.attach(_usdc);
        yvUsdc = await Token.attach(_yvUsdc);
        yearnStrategy = await YearnStrategy.deploy(
            _yearnRegistry,
            [
                _usdc, // strategy token
                _bentoBox, // bentobox address
                signer.address, // strategy executioner (current signer)
                _factory // uni v2 factory
            ]
        ) as YearnStrategy;

        harness = new StrategyHarness(
            bentoBox,
            undefined,
            usdc,
            yvUsdc
        );

        await harness.setNewStrategy(yearnStrategy);
        await harness.setTargetPercentage(80);

        snapshotId = await ethers.provider.send('evm_snapshot', []);
    })

    afterEach(async () => {
        await network.provider.send('evm_revert', [snapshotId]);
        snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it("Should invest", async () => {
        await harness.setTargetPercentage(0);
        await harness.setTargetPercentage(95);
        await harness.setTargetPercentage(50);
        await harness.setTargetPercentage(10);
    });

    it("shouldn't harvest through bentobox", async () => {
        const elastic0 = (await harness.bentoBox.totals(_usdc)).elastic;
        const balance0 = await usdc.balanceOf(bentoBox.address);
        await harness.advanceTime(60 * 60 * 24 * 7);
        await harness.bentoBox.harvest(_usdc, true, 0);
        const elastic1 = (await harness.bentoBox.totals(_usdc)).elastic;
        const balance1 = await usdc.balanceOf(bentoBox.address);
        expect(elastic0.eq(elastic1)).to.be.true;
        expect(balance0.eq(balance1)).to.be.true;
    });

    it("should report profits", async () => {
        const elastic0 = (await harness.bentoBox.totals(_usdc)).elastic;
        const balance0 = await usdc.balanceOf(bentoBox.address);
        const bestVault = await yearnStrategy["bestVault()"]();
        // simulate profit
        await usdc.connect(usdcWhale).transfer(bestVault, 1e9);
        await yearnStrategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
        const elastic1 = (await harness.bentoBox.totals(_usdc)).elastic;
        const balance1 = await usdc.balanceOf(bentoBox.address);
        expect(elastic0.lt(elastic1)).to.be.true;
        expect(balance0.lt(balance1)).to.be.true;
        await harness.ensureTargetPercentage();
    });

    it("should handle loss", async () => {
        const elastic0 = (await harness.bentoBox.totals(_usdc)).elastic;
        const balance0 = await usdc.balanceOf(bentoBox.address);
        const bestVault = await yearnStrategy["bestVault()"]();

        // simulate loss
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [bestVault] })
        const vault = await ethers.getSigner(bestVault);
        await network.provider.send("hardhat_setBalance", [bestVault, "0x1000000000000000000",]);
        await usdc.connect(vault).transfer(_bentoBoxOwner, 1e9);
        const log = (await (await yearnStrategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false)).wait()).logs[0];
        const lossAmount = BigNumber.from(log.data);
        const elastic1 = (await harness.bentoBox.totals(_usdc)).elastic;
        const balance1 = await usdc.balanceOf(bentoBox.address);
        expect(lossAmount.lt(1e9));
        expect(elastic0.sub(lossAmount).eq(elastic1)).to.be.true;
        expect(balance0.gt(balance1)).to.be.true;
        expect(balance0.lt(balance1.add(1e9))).to.be.true;
        await harness.ensureTargetPercentage();
    });

});