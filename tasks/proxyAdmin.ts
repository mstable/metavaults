import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, DelayedProxyAdmin__factory, InstantProxyAdmin__factory } from "types/generated"

import { getBlockRange } from "./utils/blocks"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"
import { tokens } from "./utils/tokens"

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
    .addOptionalParam("governor", "Governor address override", "Governor", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, governor } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const governorAddress = resolveAddress(governor, chain)

        return deployProxyAdminInstant(hre, signer, governorAddress)
    })
task("proxy-admin-instant-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("proxy-admin-delayed-deploy", "Deploys an instant proxy admin contract")
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, nexus } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const nexusAddress = resolveAddress(nexus, chain)

        return deployProxyAdminDelayed(hre, signer, nexusAddress)
    })
task("proxy-admin-delayed-deploy").setAction(async (_, __, runSuper) => {
    await runSuper()
})

task("proxy-upgrades", "Lists all proxy implementation changes")
    .addParam(
        "asset",
        "Token symbol of main or feeder pool asset. eg mUSD, mBTC, fpmBTC/HBTC or fpmUSD/GUSD",
        undefined,
        types.string,
        false,
    )
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 10148031, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const asset = tokens.find((t) => t.symbol === taskArgs.asset)
        if (!asset) {
            console.error(`Failed to find main or feeder pool asset with token symbol ${taskArgs.asset}`)
            process.exit(1)
        }

        const { fromBlock, toBlock } = await getBlockRange(hre.ethers, taskArgs.from, taskArgs.to)

        const proxy = AssetProxy__factory.connect(asset.address, signer)

        const filter = await proxy.filters.Upgraded()
        const logs = await proxy.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber)

        console.log(`${asset.symbol} proxy ${asset.address}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logs.forEach((log: any) => {
            console.log(`Upgraded at block ${log.blockNumber} to ${log.args.implementation} in tx in ${log.blockHash}`)
        })
    })

task("proxy-admin", "Get the admin address of a proxy contract")
    .addParam(
        "proxy",
        "Token symbol, contract name or address of the proxy contract. eg mUSD, EmissionsController",
        undefined,
        types.string,
        false,
    )
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const proxyAddress = resolveAddress(taskArgs.proxy, chain)

        const adminSlot = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"

        const adminAddress = await signer.provider.getStorageAt(proxyAddress, adminSlot)
        console.log(`Admin: ${adminAddress}`)
    })

task("proxy-admin-change", "Change the admin of a proxy contract")
    .addParam(
        "proxy",
        "Token symbol, contract name or address of the proxy contract. eg mUSD, EmissionsController",
        undefined,
        types.string,
        false,
    )
    .addOptionalParam("type", "'address' or 'feederPool'", "address", types.string)
    .addOptionalParam("admin", "Contract name or address of the new admin. eg DelayedProxyAdmin", "DelayedProxyAdmin", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const proxyAddress = resolveAddress(taskArgs.proxy, chain)
        const proxy = AssetProxy__factory.connect(proxyAddress, signer)

        const newAdminAddress = resolveAddress(taskArgs.admin, chain)

        const tx = await proxy.changeAdmin(newAdminAddress)
        await logTxDetails(tx, "change admin")
    })

task("proxy-propose", "Propose new proxy implementation")
    .addParam(
        "proxy",
        "Token symbol, contract name or address of the proxy contract. eg mUSD, EmissionsController",
        undefined,
        types.string,
        false,
    )
    .addParam("impl", "Token symbol, contract name or address of the new implementation contract.", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const proxyImplAddress = resolveAddress(taskArgs.impl, chain)
        const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
        const proxyAddress = resolveAddress(taskArgs.proxy, chain)

        const proxyAdmin = DelayedProxyAdmin__factory.connect(proxyAdminAddress, signer)

        // TODO need to handle optional contract initialisation
        const data = []
        const tx = await proxyAdmin.proposeUpgrade(proxyAddress, proxyImplAddress, data)

        await logTxDetails(tx, "propose proxy upgrade")
    })

task("proxy-accept", "Accept new proxy implementation")
    .addParam(
        "proxy",
        "Token symbol, contract name or address of the proxy contract. eg mUSD, EmissionsController",
        undefined,
        types.string,
        false,
    )
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
        const proxyAdmin = DelayedProxyAdmin__factory.connect(proxyAdminAddress, signer)
        const proxyAddress = resolveAddress(taskArgs.proxy, chain)

        const tx = await proxyAdmin.acceptUpgradeRequest(proxyAddress)

        await logTxDetails(tx, "accept proxy upgrade")
    })
