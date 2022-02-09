/* eslint-disable prefer-const */
import { ethers, network } from "hardhat";
import { BigNumber } from "@ethersproject/bignumber";
import { BaseStrategy, BentoBoxV1 } from "../typechain";
import { StrategyHarness } from "./Harness";
import { BENTOBOX_ADDRESS, ChainId } from "@sushiswap/core-sdk";

describe.only("Yearn Fantom strategy", async function () {

    this.timeout(60000);

    let snapshotId;
    let yearnStrategy: BaseStrategy;
    let bentoBox: BentoBoxV1;
    let signer;
    let usdc;
    let yvUsdc;

    let harness: StrategyHarness;

    const _bentoBox = BENTOBOX_ADDRESS[ChainId.FANTOM];
    const _bentoBoxOwner = "0xf9e7d4c6d36ca311566f46c81e572102a2dc9f52";
    const _usdc = "0x04068da6c83afcfa0e13ba15a6696662335d5b75";
    const _factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
    const _yearnRegistry = "0x727fe1759430df13655ddb0731dE0D0FDE929b04";
    const _yvUsdc = "0xEF0210eB96c7EB36AF8ed1c20306462764935607";
    const _1e18 = BigNumber.from("1000000000000000000");

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

        await network.provider.send("hardhat_setBalance", [
            _bentoBoxOwner,
            "0x1000000000000000000",
        ]);

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
        ) as BaseStrategy;

        harness = new StrategyHarness(
            bentoBox,
            undefined,
            usdc,
            yvUsdc
        );

        await harness.setNewStrategy(yearnStrategy);

        snapshotId = await ethers.provider.send('evm_snapshot', []);
    })

    afterEach(async () => {
        await network.provider.send('evm_revert', [snapshotId]);
        snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it("Should invest", async () => {
        await harness.setTargetPercentage(50);
    });

});