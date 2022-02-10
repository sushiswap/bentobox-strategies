import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { BentoBoxStrategy, BentoBoxV1, ERC20Mock } from "../typechain";

export class StrategyHarness {

  bentoBox: BentoBoxV1;
  strategy!: BentoBoxStrategy;
  strategyToken: ERC20Mock;
  investedStrategyToken: ERC20Mock;

  constructor(
    bentoBox: BentoBoxV1,
    strategy: BentoBoxStrategy | undefined,
    strategyToken: ERC20Mock,
    investedStrategyToken: ERC20Mock
  ) {
    this.bentoBox = bentoBox;
    if (strategy) this.strategy = strategy;
    this.strategyToken = strategyToken;
    this.investedStrategyToken = investedStrategyToken;
    this.strategyToken.balanceOf(this.bentoBox.address).then(balance => {
      if (balance.eq(0)) throw Error("no funds in bento");
    });
  }

  async setNewStrategy(strategy: BentoBoxStrategy): Promise<void> {
    if (this.strategy?.address == strategy.address) throw Error("same strategy");
    await this.bentoBox.setStrategy(this.strategyToken.address, strategy.address);
    await this.advanceTime(1210000);
    await this.bentoBox.setStrategy(this.strategyToken.address, strategy.address);
    await this.bentoBox.harvest(this.strategyToken.address, true, 0); // invest in the strategy
    if (this.strategy && this.strategy.address != ethers.constants.AddressZero) {
      const oldStrategyBalance = await this.investedStrategyToken.balanceOf(this.strategy.address);
      expect(oldStrategyBalance.eq(0)).to.be.true;
    }
    const targetPercentage = (await this.bentoBox.strategyData(this.strategyToken.address)).targetPercentage;
    if (!targetPercentage.eq(0)) {
      const newStrategyBalance = await this.investedStrategyToken.balanceOf(strategy.address);
      expect(newStrategyBalance.gt(0)).to.be.true;
    }
    this.strategy = strategy;
    await this.ensureTargetPercentage();
  }

  async ensureTargetPercentage(): Promise<void> {
    const targetPercentage = (await this.bentoBox.strategyData(this.strategyToken.address)).targetPercentage;
    const elastic = (await this.bentoBox.totals(this.strategyToken.address)).elastic;
    const expected = elastic.mul(BigNumber.from(100).sub(targetPercentage)).div(100);
    const amountInBento = await this.strategyToken.balanceOf(this.bentoBox.address);
    const amountInStrategy = (await this.bentoBox.strategyData(this.strategyToken.address)).balance;
    expect(aboutTheSame(elastic, amountInBento.add(amountInStrategy), 1000)).to.be.true;
    expect(aboutTheSame(expected, amountInBento, 1000)).to.be.true;
  }

  async setTargetPercentage(target: number): Promise<void> {
    await this.bentoBox.setStrategyTargetPercentage(this.strategyToken.address, target);
    await this.bentoBox.harvest(this.strategyToken.address, true, 0);
    await this.ensureTargetPercentage();
  }

  async advanceTime(seconds: number): Promise<void> {
    return ethers.provider.send("evm_increaseTime", [seconds]);
  }

}

export function aboutTheSame(a: BigNumber, b: BigNumber, precision = 10000): boolean {
  const quotient = a.mul(precision).div(b);
  return quotient.gte(precision - 1) && quotient.lte(precision + 1);
}

export function customError(errorName: string): string {
  return `VM Exception while processing transaction: reverted with custom error '${errorName}()'`;
}