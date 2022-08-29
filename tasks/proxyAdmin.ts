import { subtask, task, types } from "hardhat/config"
import { DelayedProxyAdmin__factory, InstantProxyAdmin__factory } from "types/generated"

import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DelayedProxyAdmin, InstantProxyAdmin } from "types/generated"

export async function deployProxyAdminDelayed(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexusAddress: string,
): Promise<DelayedProxyAdmin> {
    const constructorArguments = [nexusAddress]
    const proxyAdmin = await deployContract<DelayedProxyAdmin>(
        new DelayedProxyAdmin__factory(signer),
        "DelayedProxyAdmin",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: proxyAdmin.address,
        contract: "contracts/upgradability/DelayedProxyAdmin.sol:DelayedProxyAdmin",
        constructorArguments,
    })
    return proxyAdmin
}

export async function deployProxyAdminInstant(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    governorAddress: string,
): Promise<InstantProxyAdmin> {
    const constructorArguments = []
    const proxyAdmin = await deployContract<InstantProxyAdmin>(
        new InstantProxyAdmin__factory(signer),
        "InstantProxyAdmin",
        constructorArguments,
    )
    const tx = await proxyAdmin.transferOwnership(governorAddress)
    await logTxDetails(tx, "transfer ownership to governor")

    await verifyEtherscan(hre, {
        address: proxyAdmin.address,
        contract: "contracts/upgradability/InstantProxyAdmin.sol:InstantProxyAdmin",
        constructorArguments,
    })
    return proxyAdmin
}
subtask("proxy-admin-instant-deploy", "Deploys an instant proxy admin contract")
    .addOptionalParam("governor", "Governor address, overrides Governor lookup", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, governor } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const governorAddress = resolveAddress(governor ?? "Governor", chain)

        return deployProxyAdminInstant(hre, signer, governorAddress)
    })
task("proxy-admin-instant-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("proxy-admin-delayed-deploy", "Deploys an instant proxy admin contract")
    .addOptionalParam("nexus", "Nexus address, overrides lookup", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, nexus } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const nexusAddress = resolveAddress(nexus ?? "Nexus", chain)

        return deployProxyAdminDelayed(hre, signer, nexusAddress)
    })
task("proxy-admin-delayed-deploy").setAction(async (_, __, runSuper) => {
    await runSuper()
})
