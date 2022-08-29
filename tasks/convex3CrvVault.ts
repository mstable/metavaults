import { subtask, task, types } from "hardhat/config"
import {
    AssetProxy__factory,
    Convex3CrvBasicVault__factory,
    Convex3CrvLiquidatorVault__factory,
    Curve3CrvFactoryMetapoolCalculatorLibrary__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
} from "types/generated"

import { CRV, CVX, DAI, ThreeCRV } from "./utils"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { Convex3CrvConstructorData } from "types"
import type {
    AssetProxy,
    Convex3CrvBasicVault,
    Convex3CrvLiquidatorVault,
    Curve3CrvFactoryMetapoolCalculatorLibrary,
    Curve3CrvMetapoolCalculatorLibrary,
} from "types/generated"

interface Convex3CrvBasicVaultParams {
    calculatorLibrary: string
    nexus: string
    asset: string
    constructorData: Convex3CrvConstructorData
    slippageData: {
        redeem: number
        deposit: number
        withdraw: number
        mint: number
    }
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
}

interface Convex3CrvLiquidatorVaultParams extends Convex3CrvBasicVaultParams {
    streamDuration: number
}

// liquidator initialize
const feeReceiver = resolveAddress("mStableDAO")
const rewardTokens = [CRV.address, CVX.address]
const donateToken = DAI.address
const donationFee = 10000 // 1%

export const TASK_NAMES = {
    // subtasks
    TASK_DEPLOY_CONVEX3CRV_LIB: "convex3crv-lib-deploy",
    TASK_DEPLOY_CONVEX3CRV_FACTORY_LIB: "convex3crv-factory-lib-deploy",
    TASK_DEPLOY_CONVEX3CRV_BASIC_VAULT: "convex3crv-basic-vault-deploy",
    TASK_DEPLOY_CONVEX3CRV_LIQUIDATOR_VAULT: "convex3crv-liquidator-vault-deploy",
    // tasks
    TASK_DEPLOY_CONVEX3CRV_VAULT: "convex3crv-vault-deploy",
}

export async function deployCurve3CrvMetapoolCalculatorLibrary(hre: HardhatRuntimeEnvironment, signer: Signer) {
    const calculatorLibrary = await deployContract<Curve3CrvMetapoolCalculatorLibrary>(
        new Curve3CrvMetapoolCalculatorLibrary__factory(signer),
        `Curve3CrvMetapoolCalculatorLibrary`,
        [],
    )

    await verifyEtherscan(hre, {
        address: calculatorLibrary.address,
        contract: "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary",
        constructorArguments: [],
    })
    return calculatorLibrary
}
export async function deployCurve3CrvFactoryMetapoolCalculatorLibrary(hre: HardhatRuntimeEnvironment, signer: Signer) {
    const calculatorLibrary = await deployContract<Curve3CrvFactoryMetapoolCalculatorLibrary>(
        new Curve3CrvFactoryMetapoolCalculatorLibrary__factory(signer),
        `Curve3CrvFactoryMetapoolCalculatorLibrary`,
        [],
    )

    await verifyEtherscan(hre, {
        address: calculatorLibrary.address,
        contract: "contracts/peripheral/Curve/Curve3CrvFactoryMetapoolCalculatorLibrary.sol:Curve3CrvFactoryMetapoolCalculatorLibrary",
        constructorArguments: [],
    })
    return calculatorLibrary
}
const getMetaPoolLinkAddresses = (calculatorLibrary: string) => ({
    "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary": calculatorLibrary,
})

export async function deployConvex3CrvBasicVault(hre: HardhatRuntimeEnvironment, signer: Signer, params: Convex3CrvBasicVaultParams) {
    const { calculatorLibrary, nexus, asset, constructorData, slippageData, name, symbol, vaultManager, proxyAdmin } = params

    const curve3CrvMetapoolCalculatorLibraryLinkAddresses = getMetaPoolLinkAddresses(calculatorLibrary)
    // Vault
    const constructorArguments = [nexus, asset, constructorData]
    // <Convex3CrvBasicVault>
    const vaultImpl = await deployContract<Convex3CrvBasicVault>(
        new Convex3CrvBasicVault__factory(curve3CrvMetapoolCalculatorLibraryLinkAddresses, signer),
        `Convex3CrvBasicVault ${name} (${symbol})`,
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/convex/Convex3CrvBasicVault.sol:Convex3CrvBasicVault",
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

export async function deployConvex3CrvLiquidatorVault(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    params: Convex3CrvLiquidatorVaultParams,
) {
    const { calculatorLibrary, nexus, asset, constructorData, slippageData, streamDuration, name, symbol, vaultManager, proxyAdmin } =
        params

    const curve3CrvMetapoolCalculatorLibraryLinkAddresses = getMetaPoolLinkAddresses(calculatorLibrary)

    // Implementation
    const constructorArguments = [nexus, asset, constructorData, streamDuration]
    const vaultImpl = await deployContract<Convex3CrvLiquidatorVault>(
        new Convex3CrvLiquidatorVault__factory(curve3CrvMetapoolCalculatorLibraryLinkAddresses, signer),
        `Convex3CrvLiquidatorVault ${name} (${symbol})`,
        constructorArguments,
    )
    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/convex/Convex3CrvLiquidatorVault.sol:Convex3CrvLiquidatorVault",
        constructorArguments: constructorArguments,
    })
    // Proxy
    const data = vaultImpl.interface.encodeFunctionData("initialize", [
        name,
        symbol,
        vaultManager,
        slippageData,
        rewardTokens,
        donateToken,
        feeReceiver,
        donationFee,
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
export async function deployConvex3CrvVault(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    factory: string,
    params: Convex3CrvLiquidatorVaultParams,
) {
    if (factory === "liquidator") {
        return deployConvex3CrvLiquidatorVault(hre, signer, params)
    }
    return deployConvex3CrvBasicVault(hre, signer, params)
}

subtask(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_LIB, "Deploys curve metapool calculator library")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const signer = await getSigner(hre, speed)
        // Vault library
        return deployCurve3CrvMetapoolCalculatorLibrary(hre, signer)
    })
subtask(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_FACTORY_LIB, "Deploys curve factory metapool calculator library")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const signer = await getSigner(hre, speed)
        // Vault library
        return deployCurve3CrvFactoryMetapoolCalculatorLibrary(hre, signer)
    })
subtask(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_BASIC_VAULT, "Deploys Convex 3Crv Basic Vault")
    .addParam("name", "Vault name", undefined, types.string)
    .addParam("symbol", "Vault symbol", undefined, types.string)
    .addParam("nexus", "Nexus address", undefined, types.string)
    .addParam("asset", "Token address of the vault's asset", undefined, types.string)
    .addParam("calculatorLibrary", "Curve 3Crv metapool calculator library address", undefined, types.string)
    .addParam("vaultManager", "VaultManager address", undefined, types.string)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, types.string)
    .addParam("constructorData", "Constructor data", undefined, types.any)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, name, symbol, nexus, asset, calculatorLibrary, proxyAdmin, vaultManager, slippageData } = taskArgs
        const constructorData: Convex3CrvConstructorData = taskArgs.constructorData

        const signer = await getSigner(hre, speed)
        // Vault library
        const { proxy, impl: vaultImpl } = await deployConvex3CrvBasicVault(hre, signer, {
            calculatorLibrary,
            nexus,
            asset,
            constructorData,
            name,
            symbol,
            vaultManager,
            proxyAdmin,
            slippageData,
        })

        return { proxy, impl: vaultImpl }
    })

subtask(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_LIQUIDATOR_VAULT, "Deploys Convex 3Crv Liquidator Vault")
    .addParam("nexus", "Nexus address", undefined, types.string)
    .addParam("asset", "Token address of the vault's asset", undefined, types.string)
    .addParam("name", "Vault name", undefined, types.string)
    .addParam("symbol", "Vault symbol", undefined, types.string)
    .addParam("streamDuration", "Number of seconds the stream takes.", undefined, types.int)
    .addParam("calculatorLibrary", "Curve Metapool Calculator Library address", undefined, types.string)
    .addParam("vaultManager", "VaultManager address", undefined, types.string)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, types.string)
    .addParam("constructorData", "Constructor data", undefined, types.any)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, name, symbol, nexus, asset, slippageData, streamDuration, calculatorLibrary, proxyAdmin, vaultManager } = taskArgs
        const constructorData: Convex3CrvConstructorData = taskArgs.constructorData

        const signer = await getSigner(hre, speed)
        // Vault library
        const { proxy, impl } = await deployConvex3CrvLiquidatorVault(hre, signer, {
            calculatorLibrary,
            nexus,
            asset,
            constructorData,
            streamDuration,
            name,
            symbol,
            vaultManager,
            proxyAdmin,
            slippageData,
        })

        return { proxy, impl }
    })

// returns vault{proxy, impl} and calculatorLibrary
subtask(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_VAULT, "Deploys a convex 3crv vault and its libraries")
    .addParam("name", "Vault name", undefined, types.string)
    .addParam("symbol", "Vault symbol", undefined, types.string)
    .addParam("constructorData", "Constructor data", undefined, types.any)
    .addOptionalParam("asset", "Token symbol or address of the vault's asset", undefined, types.string)
    .addOptionalParam("nexus", "Nexus address, overrides lookup", undefined, types.string)
    .addOptionalParam("proxyAdmin", "ProxyAdmin address, overrides lookup", undefined, types.string)
    .addOptionalParam("vaultManager", "VaultManager address, overrides lookup", undefined, types.string)
    .addOptionalParam("calculatorLibrary", "CalculatorLibrary address, overrides lookup of asset parameter", undefined, types.string)
    .addOptionalParam("streamDuration", "Number of seconds the stream takes.", 0, types.int)
    .addOptionalParam("factory", "Convex 3Crv Vault factory: 'basic' | 'liquidator' ", "liquidator", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        // yarn convex3crv-vault-deploy --name "name" --symbol "symbol --constructor-data arguments/vault.arguments.js
        const {
            speed,
            constructorData,
            name,
            symbol,
            asset,
            calculatorLibrary,
            pool,
            nexus,
            proxyAdmin,
            vaultManager,
            factory,
            streamDuration,
        } = taskArgs

        const chain = getChain(hre)

        const nexusAddress = resolveAddress(nexus ?? "Nexus", chain)
        const proxyAdminAddress = resolveAddress(proxyAdmin ?? "InstantProxyAdmin", chain)
        const vaultManagerAddress = resolveAddress(vaultManager ?? "VaultManager", chain)
        const assetAddress = resolveAddress(asset ?? ThreeCRV.address, chain)

        // If library is not defined deploy a new one
        let calculatorLibraryAddress: string
        if (!!calculatorLibrary) {
            calculatorLibraryAddress = calculatorLibrary
        } else {
            // deploy library
            const calculatorLib = await hre.run(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_LIB, { speed })
            calculatorLibraryAddress = calculatorLib.address
        }

        // Basic Vault
        let subtaskName = TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_BASIC_VAULT
        const subtaskArgs = {
            speed,
            name,
            symbol,
            nexus: nexusAddress,
            asset: assetAddress,
            calculatorLibrary: calculatorLibraryAddress,
            pool,
            vaultManager: vaultManagerAddress,
            constructorData,
            proxyAdmin: proxyAdminAddress,
            streamDuration,
        }

        if (factory === "liquidator") {
            subtaskName = TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_LIQUIDATOR_VAULT
        }
        // proxy , impl
        const vault = await hre.run(subtaskName, subtaskArgs)

        return { vault, calculatorLibraryAddress }
    })
task(TASK_NAMES.TASK_DEPLOY_CONVEX3CRV_VAULT).setAction(async (_, __, runSuper) => {
    return runSuper()
})
