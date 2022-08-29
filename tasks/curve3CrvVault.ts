import {
    AssetProxy__factory,
    Curve3CrvBasicMetaVault__factory,
    Curve3PoolCalculatorLibrary__factory,
    PeriodicAllocationPerfFeeMetaVault__factory,
} from "types"

import { deployContract } from "./utils"
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

// TODO ADD TASK
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

// TODO ADD TASK
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
