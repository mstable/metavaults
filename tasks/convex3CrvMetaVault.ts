import { simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, PeriodicAllocationPerfFeeMetaVault__factory } from "types/generated"

import { config } from "./deployment/convex3CrvVaults-config"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { BN } from "@utils/math"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, PeriodicAllocationPerfFeeMetaVault } from "types/generated"

import type { Convex3CrvVaultsDeployed } from "./deployment/convex3CrvVaults"

// deployPeriodicAllocationPerfFeeMetaVault
interface AssetSourcingParams {
    singleVaultSharesThreshold: number
    singleSourceVaultIndex: number
}

interface PeriodicAllocationPerfFeeMetaVaultParams {
    nexus: string
    asset: string
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
    performanceFee: number
    feeReceiver: string
    underlyingVaults: Array<string>
    sourceParams: AssetSourcingParams
    assetPerShareUpdateThreshold: BN
}

export async function deployPeriodicAllocationPerfFeeMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    convex3CrvVaults: Convex3CrvVaultsDeployed,
) {
    const { periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVaultConf } = config
    const underlyingVaults = [convex3CrvVaults.musd.proxy.address, convex3CrvVaults.frax.proxy.address, convex3CrvVaults.busd.proxy.address]
    const periodicAllocationPerfFeeMetaVault = await deployPeriodicAllocationPerfFeeMetaVault(hre, signer, {
        nexus,
        asset: PeriodicAllocationPerfFeeMetaVaultConf.asset,
        name: PeriodicAllocationPerfFeeMetaVaultConf.name,
        symbol: PeriodicAllocationPerfFeeMetaVaultConf.symbol,
        vaultManager,
        proxyAdmin,
        performanceFee: PeriodicAllocationPerfFeeMetaVaultConf.performanceFee,
        feeReceiver: PeriodicAllocationPerfFeeMetaVaultConf.feeReceiver,
        sourceParams: PeriodicAllocationPerfFeeMetaVaultConf.sourceParams,
        assetPerShareUpdateThreshold: PeriodicAllocationPerfFeeMetaVaultConf.assetPerShareUpdateThreshold,
        underlyingVaults,
    })
    return periodicAllocationPerfFeeMetaVault
}

export const deployPeriodicAllocationPerfFeeMetaVault = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    params: PeriodicAllocationPerfFeeMetaVaultParams,
) => {
    const {
        nexus,
        asset,
        name,
        symbol,
        vaultManager,
        proxyAdmin,
        performanceFee,
        feeReceiver,
        underlyingVaults,
        sourceParams,
        assetPerShareUpdateThreshold,
    } = params
    const constructorArguments = [nexus, asset]
    const vaultImpl = await deployContract<PeriodicAllocationPerfFeeMetaVault>(
        new PeriodicAllocationPerfFeeMetaVault__factory(signer),
        "PeriodicAllocationPerfFeeMetaVault",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/meta/PeriodicAllocationPerfFeeMetaVault.sol:PeriodicAllocationPerfFeeMetaVault",
        constructorArguments: constructorArguments,
    })

    // Proxy
    const data = vaultImpl.interface.encodeFunctionData("initialize", [
        name,
        symbol,
        vaultManager,
        performanceFee,
        feeReceiver,
        underlyingVaults,
        sourceParams,
        assetPerShareUpdateThreshold,
    ])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    await verifyEtherscan(hre, {
        address: proxy.address,
        contract: "contracts/upgradability/Proxies.sol:AssetProxy",
        constructorArguments: proxyConstructorArguments,
    })

    return { proxy, impl: vaultImpl }
}

subtask("convex-3crv-meta-vault-deploy", "Deploys Convex 3Crv Meta Vault")
    .addParam("vaults", "Comma separated symbols or addresses of the underlying convex vaults", undefined, types.string)
    .addParam(
        "singleSource",
        "Token symbol or address of the vault that smaller withdraws should be sourced from.",
        undefined,
        types.string,
    )
    .addOptionalParam("name", "Vault name", "3CRV Convex Meta Vault", types.string)
    .addOptionalParam("symbol", "Vault symbol", "mv3CRV", types.string)
    .addOptionalParam("asset", "Token address or symbol of the vault's asset", "3Crv", types.string)
    .addOptionalParam(
        "proxyAdmin",
        "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin",
        "InstantProxyAdmin",
        types.string,
    )
    .addOptionalParam("feeReceiver", "Address or name of account that will receive vault fees.", "mStableDAO", types.string)
    .addOptionalParam("perfFee", "Performance fee scaled to 6 decimal places. default 5% = 50000", 50000, types.int)
    .addOptionalParam(
        "singleThreshold",
        "Max percentage of assets withdraws will source from a single vault in basis points. default 10%",
        1000,
        types.int,
    )
    .addOptionalParam("updateThreshold", "Asset per share update threshold. default 100k", 100000, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { name, symbol, asset, vaults, proxyAdmin, feeReceiver, perfFee, singleSource, singleThreshold, updateThreshold, speed } =
            taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetToken = resolveToken(asset, chain)
        const proxyAdminAddress = resolveAddress(proxyAdmin, chain)
        const vaultManagerAddress = resolveAddress("VaultManager", chain)

        const underlyings = vaults.split(",")
        const underlyingAddresses = underlyings.map((underlying) => resolveAddress(underlying, chain))
        const singleSourceAddress = resolveAddress(singleSource, chain)
        const singleSourceVaultIndex = underlyingAddresses.indexOf(singleSourceAddress)

        const feeReceiverAddress = resolveAddress(feeReceiver, chain)

        const { proxy, impl } = await deployPeriodicAllocationPerfFeeMetaVault(hre, signer, {
            nexus: nexusAddress,
            asset: assetToken.address,
            name,
            symbol,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            feeReceiver: feeReceiverAddress,
            performanceFee: perfFee,
            underlyingVaults: underlyingAddresses,
            sourceParams: {
                singleVaultSharesThreshold: singleThreshold,
                singleSourceVaultIndex,
            },
            assetPerShareUpdateThreshold: simpleToExactAmount(updateThreshold, assetToken.decimals),
        })

        return { proxy, impl }
    })
task("convex-3crv-meta-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})
