import { deployPeriodicAllocationPerfFeeMetaVaults } from "@tasks/convex3CrvMetaVault"
import { deployCurve3CrvMetaVaults } from "@tasks/curve3CrvVault"
import { deployCowSwapDex, deployOneInchDex } from "@tasks/dex"
import { deployLiquidator } from "@tasks/liquidator"
import { deployNexus } from "@tasks/nexus"
import { deployProxyAdminDelayed, deployProxyAdminInstant } from "@tasks/proxyAdmin"
import { CRV, CVX, DAI } from "@tasks/utils"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { impersonate, setBalancesToAccount } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { BN } from "@utils/math"
import { CowSwapDex__factory, ERC20__factory, OneInchDexSwap__factory } from "types"

import {
    deployConvex3CrvLiquidatorVault,
    deployCurve3CrvFactoryMetapoolCalculatorLibrary,
    deployCurve3CrvMetapoolCalculatorLibrary,
} from "../convex3CrvVault"
import { config } from "./convex3CrvVaults-config"

import type { Curve3CrvMetaVaultsDeployed } from "@tasks/curve3CrvVault"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type {
    AssetProxy,
    Convex3CrvPool,
    Convex3CrvVault,
    CowSwapDex,
    Curve3CrvFactoryMetapoolCalculatorLibrary,
    Curve3CrvMetapoolCalculatorLibrary,
    Curve3PoolCalculatorLibrary,
    DelayedProxyAdmin,
    InstantProxyAdmin,
    Liquidator,
    Nexus,
    OneInchDexSwap,
    PeriodicAllocationPerfFeeMetaVault,
} from "types"

export interface Convex3CrvVaultsDeployed {
    [key: string]: { proxy: AssetProxy; impl: Convex3CrvVault }
}
interface Convex3CrvVaultDeployed {
    proxy: AssetProxy
    impl: Convex3CrvVault
}

// Core smart contracts
interface Phase1Deployed {
    nexus: Nexus
    proxyAdmin: DelayedProxyAdmin | InstantProxyAdmin
}

// Common/Shared smart contracts
interface Phase2Deployed {
    oneInchDexSwap: OneInchDexSwap
    cowSwapDex: CowSwapDex
    liquidator: Liquidator
}

// Use case smart contracts,  ie vaults
interface Phase3Deployed {
    convex3CrvVaults: Convex3CrvVaultsDeployed
    curve3CrvMetapoolCalculatorLibrary: Curve3CrvMetapoolCalculatorLibrary
    periodicAllocationPerfFeeMetaVault: { proxy: AssetProxy; impl: PeriodicAllocationPerfFeeMetaVault }
    curve3CrvMetaVaults: Curve3CrvMetaVaultsDeployed
    curve3PoolCalculatorLibrary: Curve3PoolCalculatorLibrary
}

/**
 * Sets balances to all hre.ether.signers on the following tokens:
 * 3Crv, mUSD, DAI, USDC, USDT.
 *
 * @param {*} hre Hardhat Runtime Environment
 */
export const setBalancesToAccounts = async (hre) => {
    const accounts = await hre.ethers.getSigners()
    const sa = await new StandardAccounts().initAccounts(accounts, true)
    const threeCRVTokenAddress = resolveAddress("3Crv")
    const musdTokenAddress = resolveAddress("mUSD")
    const daiTokenAddress = resolveAddress("DAI")
    const usdcTokenAddress = resolveAddress("USDC")
    const usdtTokenAddress = resolveAddress("USDT")

    const threeCRVTokenWhale = "0xd632f22692fac7611d2aa1c0d552930d43caed3b"

    const whale = await impersonate(threeCRVTokenWhale)
    const threeCrvToken = ERC20__factory.connect(threeCRVTokenAddress, whale)
    const tokensToMockBalance = { musdTokenAddress, usdcTokenAddress, daiTokenAddress, usdtTokenAddress }

    await setBalancesToAccount(sa.alice, [threeCrvToken], tokensToMockBalance)
    await setBalancesToAccount(sa.bob, [threeCrvToken], tokensToMockBalance)
    await setBalancesToAccount(sa.other, [threeCrvToken], tokensToMockBalance)
    await setBalancesToAccount(sa.default, [threeCrvToken], tokensToMockBalance)
    await setBalancesToAccount(sa.dummy1, [threeCrvToken], tokensToMockBalance)
    await setBalancesToAccount(sa.dummy2, [threeCrvToken], tokensToMockBalance)
}
const deployerConvex3CrvVault =
    (hre: HardhatRuntimeEnvironment, signer: Signer, nexus: string, vaultManager: string, proxyAdmin: string) =>
    async (pool: string, calculatorLibrary: string) => {
        const convex3CrvPool: Convex3CrvPool = config.convex3CrvPools[pool]
        const constructorData = {
            metapool: convex3CrvPool.curveMetapool,
            convexPoolId: convex3CrvPool.convexPoolId,
            booster: resolveAddress("ConvexBooster"),
        }

        return deployConvex3CrvLiquidatorVault(hre, signer, {
            name: convex3CrvPool.name,
            symbol: convex3CrvPool.symbol,
            constructorData,
            asset: convex3CrvPool.asset,
            nexus,
            proxyAdmin,
            vaultManager,
            calculatorLibrary,
            streamDuration: BN.from(convex3CrvPool.streamDuration).toNumber(),
            slippageData: convex3CrvPool.slippageData,
            donateToken: DAI.address,
            rewardTokens: [CRV.address, CVX.address],
            feeReceiver: resolveAddress("mStableDAO"),
            donationFee: 10000,
            factory: convex3CrvPool.isFactory,
            proxy: true,
        })
    }
export async function deployConvex3CrvVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
) {
    const fnDeployConvex3CrvVault = deployerConvex3CrvVault(hre, signer, nexus, vaultManager, proxyAdmin)
    const convex3CrvVaults: Convex3CrvVaultsDeployed = {}
    const pools: string[] = ["musd", "frax", "busd"]
    const curve3CrvMetapoolCalculatorLibrary: Curve3CrvMetapoolCalculatorLibrary = await deployCurve3CrvMetapoolCalculatorLibrary(
        hre,
        signer,
    )
    const curve3CrvFactoryMetapoolCalculatorLibrary: Curve3CrvFactoryMetapoolCalculatorLibrary =
        await deployCurve3CrvFactoryMetapoolCalculatorLibrary(hre, signer)

    // Deploy deployConvex3Crv[Basic|Liquidator]Vault
    for (const pool of pools) {
        const convex3CrvVaultDeployed: Convex3CrvVaultDeployed = await fnDeployConvex3CrvVault(
            pool,
            config.convex3CrvPools[pool].isFactory
                ? curve3CrvFactoryMetapoolCalculatorLibrary.address
                : curve3CrvMetapoolCalculatorLibrary.address,
        )
        convex3CrvVaults[pool] = convex3CrvVaultDeployed
    }
    return { convex3CrvVaults, curve3CrvMetapoolCalculatorLibrary }
}

export const deployCore = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    proxyAdminType: "instant" | "delayed",
    governorAddress: string,
): Promise<Phase1Deployed> => {
    const nexus = await deployNexus(hre, signer, governorAddress)
    const proxyAdmin =
        proxyAdminType === "instant"
            ? await deployProxyAdminInstant(hre, signer, governorAddress)
            : await deployProxyAdminDelayed(hre, signer, nexus.address)

    return { nexus, proxyAdmin }
}

export const deployCommon = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: Nexus,
    proxyAdmin: DelayedProxyAdmin | InstantProxyAdmin,
    syncSwapperAddress?: string,
    asyncSwapperAddress?: string,
): Promise<Phase2Deployed> => {
    const oneInchDexSwap = !!syncSwapperAddress
        ? new OneInchDexSwap__factory(signer).attach(syncSwapperAddress)
        : await deployOneInchDex(hre, signer)
    const cowSwapDex = !!asyncSwapperAddress
        ? new CowSwapDex__factory(signer).attach(asyncSwapperAddress)
        : await deployCowSwapDex(hre, signer, nexus.address)
    const liquidator = await deployLiquidator(
        hre,
        signer,
        nexus.address,
        oneInchDexSwap.address,
        cowSwapDex.address,
        proxyAdmin.address,
        true,
    )
    return { oneInchDexSwap, cowSwapDex, liquidator }
}

export const deploy3CrvMetaVaults = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: Nexus,
    proxyAdmin: DelayedProxyAdmin | InstantProxyAdmin,
    vaultManager: string,
): Promise<Phase3Deployed> => {
    // 1 - deployConvex3CrvLiquidatorVault
    const { convex3CrvVaults, curve3CrvMetapoolCalculatorLibrary } = await deployConvex3CrvVaults(
        hre,
        signer,
        nexus.address,
        vaultManager,
        proxyAdmin.address,
    )
    // 2 - deployPeriodicAllocationPerfFeeMetaVaults
    const periodicAllocationPerfFeeMetaVault = await deployPeriodicAllocationPerfFeeMetaVaults(
        hre,
        signer,
        nexus.address,
        vaultManager,
        proxyAdmin.address,
        convex3CrvVaults,
    )
    // 3 - deployCurve3CrvMetaVault
    const { curve3CrvMetaVaults, curve3PoolCalculatorLibrary } = await deployCurve3CrvMetaVaults(
        hre,
        signer,
        nexus.address,
        vaultManager,
        proxyAdmin.address,
        periodicAllocationPerfFeeMetaVault.proxy.address,
    )

    return {
        convex3CrvVaults,
        curve3CrvMetapoolCalculatorLibrary,
        periodicAllocationPerfFeeMetaVault,
        curve3CrvMetaVaults,
        curve3PoolCalculatorLibrary,
    }
}
