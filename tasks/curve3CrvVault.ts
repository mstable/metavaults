import { simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import {
    AssetProxy__factory,
    Curve3CrvBasicMetaVault__factory,
    Curve3PoolCalculatorLibrary__factory,
    PeriodicAllocationPerfFeeMetaVault__factory,
} from "types"

import { deployContract, getChain, getSigner, resolveAddress, resolveToken } from "./utils"
import { verifyEtherscan } from "./utils/etherscan"

import type { BN } from "@utils/math"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, Curve3CrvBasicMetaVault, Curve3PoolCalculatorLibrary, PeriodicAllocationPerfFeeMetaVault } from "types"

// deployCurve3CrvMetaVault
type SlippageData = {
    redeem: number
    deposit: number
    withdraw: number
    mint: number
}
interface Curve3CrvBasicMetaVaultParams {
    calculatorLibrary: string
    nexus: string
    asset: string
    metaVault: string
    slippageData: SlippageData
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
}

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

export async function deployCurve3PoolCalculatorLibrary(hre: HardhatRuntimeEnvironment, signer: Signer) {
    const calculatorLibrary = await deployContract<Curve3PoolCalculatorLibrary>(
        new Curve3PoolCalculatorLibrary__factory(signer),
        `Curve3PoolCalculatorLibrary`,
        [],
    )

    await verifyEtherscan(hre, {
        address: calculatorLibrary.address,
        contract: "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary",
        constructorArguments: [],
    })

    return calculatorLibrary
}

// TODO ADD TASK
export const deployCurve3CrvMetaVault = async (hre: HardhatRuntimeEnvironment, signer: Signer, params: Curve3CrvBasicMetaVaultParams) => {
    const { calculatorLibrary, nexus, asset, metaVault, slippageData, name, symbol, vaultManager, proxyAdmin } = params

    const libraryAddresses = { "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary": calculatorLibrary }

    const constructorArguments = [nexus, asset, metaVault]
    const vaultImpl = await deployContract<Curve3CrvBasicMetaVault>(
        new Curve3CrvBasicMetaVault__factory(libraryAddresses, signer),
        "Curve3CrvBasicMetaVault",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/curve/Curve3CrvBasicMetaVault.sol:Curve3CrvBasicMetaVault",
        constructorArguments: constructorArguments,
    })

    // Proxy
    const data = vaultImpl.interface.encodeFunctionData("initialize", [name, symbol, vaultManager, slippageData])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    await verifyEtherscan(hre, {
        address: proxy.address,
        contract: "contracts/upgradability/Proxies.sol:AssetProxy",
        constructorArguments: proxyConstructorArguments,
    })

    return { proxy, impl: vaultImpl }
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

subtask("curve-3crv-lib-deploy", "Deploys a Curve 3Pool calculator library")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const signer = await getSigner(hre, speed)

        return deployCurve3PoolCalculatorLibrary(hre, signer)
    })
task("curve-3crv-lib-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("curve-3crv-meta-vault-deploy", "Deploys Curve 3Crv Meta Vault")
    .addParam("metaVault", "Underlying Meta Vault override", "mv3CRV", types.string)
    .addParam("name", "Meta Vault name", undefined, types.string)
    .addParam("symbol", "Meta Vault symbol", undefined, types.string)
    .addParam("asset", "Token address or symbol of the vault's asset. eg DAI, USDC or USDT", undefined, types.string)
    .addOptionalParam(
        "proxyAdmin",
        "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin",
        "InstantProxyAdmin",
        types.string,
    )
    .addOptionalParam("calculatorLibrary", "Name or address of the Curve calculator library.", "Curve3CrvCalculatorLibrary", types.string)
    .addOptionalParam("slippage", "Max slippage in basis points. default 1% = 100", 100, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { metaVault, name, symbol, asset, calculatorLibrary, slippage, proxyAdmin, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetToken = resolveToken(asset, chain)
        const proxyAdminAddress = resolveAddress(proxyAdmin, chain)
        const vaultManagerAddress = resolveAddress("VaultManager", chain)
        const metaVaultAddress = resolveAddress(metaVault, chain)
        const calculatorLibraryAddress = resolveAddress(calculatorLibrary, chain)

        const { proxy, impl } = await deployCurve3CrvMetaVault(hre, signer, {
            nexus: nexusAddress,
            asset: assetToken.address,
            name,
            symbol,
            metaVault: metaVaultAddress,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            slippageData: { mint: slippage, deposit: slippage, redeem: slippage, withdraw: slippage },
            calculatorLibrary: calculatorLibraryAddress,
        })

        return { proxy, impl }
    })
task("curve-3crv-meta-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

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
    .addOptionalParam("perfFee", "Performance fee scaled to 6 decimal places. default 1% = 10000", 10000, types.int)
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
