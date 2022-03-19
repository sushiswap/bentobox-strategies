import { ParamType } from "@ethersproject/abi";
import { BigNumber, Contract } from "ethers";
import hre, { ethers, network } from "hardhat";
import { DeployOptions } from "hardhat-deploy/types";

export const BASE_TEN = 10;

export function encodeParameters(types: readonly (string | ParamType)[], values: readonly any[]) {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
}

export const impersonate = async (address: string) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
};

// Defaults to e18 using amount * 10^18
export function getBigNumber(amount: any, decimals = 18) {
  return BigNumber.from(amount).mul(BigNumber.from(BASE_TEN).pow(decimals));
}

export async function wrappedDeploy<T extends Contract>(name: string, options: DeployOptions): Promise<T> {
  await hre.deployments.deploy(name, options);

  const contract = await ethers.getContract<T>(name);
  await verifyContract(name, contract.address, options.args || []);

  return contract;
}

export async function verifyContract(name: string, address: string, constructorArguments: string[]) {
  if (network.name !== "hardhat") {
    process.stdout.write(`Verifying ${name}...`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments,
      });
      console.log("[OK]");
    } catch (e: any) {
      console.log(`[FAILED] ${e.message}`);
    }
  }
}

export * from "./time";
