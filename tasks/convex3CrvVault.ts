import { ONE_WEEK } from "@utils/constants"
import { subtask, task, types } from "hardhat/config"
import {
    AssetProxy__factory,
    Convex3CrvBasicVault__factory,
    Convex3CrvLiquidatorVault__factory,
    Curve3CrvFactoryMetapoolCalculatorLibrary__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
} from "types/generated"

import { config } from "./deployment/mainnet-config"
import { CRV, CVX } from "./utils"
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
    factory: boolean
    rewardTokens: string[]
    donateToken: string
    donationFee: number
    feeReceiver: string
}

interface Convex3CrvLiquidatorVaultParams extends Convex3CrvBasicVaultParams {
    streamDuration: number
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
const getMetapoolLinkAddresses = (calculatorLibrary: string) => ({
    "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary": calculatorLibrary,
})
const getFactoryMetapoolLinkAddresses = (calculatorLibrary: string) => ({
    "contracts/peripheral/Curve/Curve3CrvFactoryMetapoolCalculatorLibrary.sol:Curve3CrvFactoryMetapoolCalculatorLibrary": calculatorLibrary,
})

export async function deployConvex3CrvBasicVault(hre: HardhatRuntimeEnvironment, signer: Signer, params: Convex3CrvBasicVaultParams) {
    const { calculatorLibrary, nexus, asset, constructorData, slippageData, name, symbol, vaultManager, proxyAdmin } = params

    const curve3CrvMetapoolCalculatorLibraryLinkAddresses = getMetapoolLinkAddresses(calculatorLibrary)
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
    const {
        calculatorLibrary,
        nexus,
        asset,
        constructorData,
        slippageData,
        streamDuration,
        name,
        symbol,
        vaultManager,
        proxyAdmin,
        rewardTokens,
        donateToken,
        donationFee,
        feeReceiver,
    } = params

    const linkAddresses = getMetapoolLinkAddresses(calculatorLibrary)

    // Implementation
    const constructorArguments = [nexus, asset, constructorData, streamDuration]
    const vaultImpl = await deployContract<Convex3CrvLiquidatorVault>(
        new Convex3CrvLiquidatorVault__factory(linkAddresses, signer),
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
    liquidator: boolean,
    params: Convex3CrvLiquidatorVaultParams,
) {
    if (liquidator) {
        return deployConvex3CrvLiquidatorVault(hre, signer, params)
    }
    return deployConvex3CrvBasicVault(hre, signer, params)
}

subtask("convex-3crv-lib-deploy", "Deploys a Curve Metapool calculator library")
    .addOptionalParam("factory", "Is the Curve Metapool a factory pool", false, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { factory, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        // Vault library
        return factory
            ? deployCurve3CrvFactoryMetapoolCalculatorLibrary(hre, signer)
            : deployCurve3CrvMetapoolCalculatorLibrary(hre, signer)
    })
task("convex-3crv-lib-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("convex-3crv-vault-deploy", "Deploys Convex 3Crv Liquidator Vault")
    .addParam("name", "Vault name", undefined, types.string)
    .addParam("symbol", "Vault symbol", undefined, types.string)
    .addParam("pool", "Symbol of the Convex pool in lower case. eg musd, frax, mim, lusd, busd", undefined, types.string)
    .addOptionalParam("asset", "Token address or symbol of the vault's asset", "3Crv", types.string)
    .addOptionalParam("streamDuration", "Number of seconds the stream takes.", ONE_WEEK, types.int)
    .addOptionalParam(
        "proxyAdmin",
        "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin",
        "InstantProxyAdmin",
        types.string,
    )
    .addOptionalParam("slippage", "Max slippage in basis points. default 1% = 100", 100, types.int)
    .addOptionalParam("donationFee", "Liquidation fee scaled to 6 decimal places. default 1% = 10000", 10000, types.int)
    .addOptionalParam("donateToken", "Address or token symbol of token that rewards will be swapped to.", "DAI", types.string)
    .addOptionalParam("feeReceiver", "Address or name of account that will receive vault fees.", "mStableDAO", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { name, symbol, pool, asset, streamDuration, proxyAdmin, slippage, donateToken, donationFee, feeReceiver, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetAddress = resolveAddress(asset, chain)
        const proxyAdminAddress = resolveAddress(proxyAdmin, chain)
        const vaultManagerAddress = resolveAddress("VaultManager", chain)
        const convexBoosterAddress = resolveAddress("ConvexBooster", chain)

        const convex3CrvPool = config.convex3CrvPools[pool]
        const calculatorLibraryAddress = convex3CrvPool.isFactory
            ? resolveAddress("Curve3CrvFactoryMetapoolCalculatorLibrary", chain)
            : resolveAddress("Curve3CrvMetapoolCalculatorLibrary", chain)
        const constructorData = {
            metapool: convex3CrvPool.curveMetapool,
            booster: convexBoosterAddress,
            convexPoolId: convex3CrvPool.convexPoolId,
        }
        const feeReceiverAddress = resolveAddress(feeReceiver, chain)
        const donateTokenAddress = resolveAddress(donateToken, chain)
        const rewardTokens = [CRV.address, CVX.address]

        // Vault library
        const { proxy, impl } = await deployConvex3CrvLiquidatorVault(hre, signer, {
            calculatorLibrary: calculatorLibraryAddress,
            nexus: nexusAddress,
            asset: assetAddress,
            factory: convex3CrvPool.isFactory,
            constructorData,
            streamDuration,
            name,
            symbol,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            slippageData: { mint: slippage, deposit: slippage, redeem: slippage, withdraw: slippage },
            donateToken: donateTokenAddress,
            rewardTokens,
            donationFee,
            feeReceiver: feeReceiverAddress,
        })

        return { proxy, impl }
    })
task("convex-3crv-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})
