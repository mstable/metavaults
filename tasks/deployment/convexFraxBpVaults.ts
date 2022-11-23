import { deployPeriodicAllocationPerfFeeMetaVaults } from "@tasks/convexFraxBpMetaVault"
import { deployCurveFraxBpMetaVaults } from "@tasks/curveFraxBpVault"
import { deployCowSwapDex, deployOneInchDex } from "@tasks/dex"
import { deployLiquidator } from "@tasks/liquidator"
import { deployNexus } from "@tasks/nexus"
import { deployProxyAdminDelayed, deployProxyAdminInstant } from "@tasks/proxyAdmin"
import { CRV, CVX, USDC } from "@tasks/utils"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { impersonate, setBalancesToAccountForFraxBp } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { BN } from "@utils/math"
import { CowSwapDex__factory, ERC20__factory, OneInchDexSwap__factory } from "types"

import {
    deployConvexFraxBpLiquidatorVault,
    deployCurveFraxBpMetapoolCalculatorLibrary,
} from "../convexFraxBpVault"
import { config } from "./convexFraxBpVaults-config"

import type { CurveFraxBpMetaVaultsDeployed } from "@tasks/curveFraxBpVault"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type {
    AssetProxy,
    ConvexFraxBpPool,
    ConvexFraxBpVault,
    CowSwapDex,
    CurveFraxBpMetapoolCalculatorLibrary,
    CurveFraxBpCalculatorLibrary,
    DelayedProxyAdmin,
    InstantProxyAdmin,
    Liquidator,
    Nexus,
    OneInchDexSwap,
    PeriodicAllocationPerfFeeMetaVault,
} from "types"

export interface ConvexFraxBpVaultsDeployed {
    [key: string]: { proxy: AssetProxy; impl: ConvexFraxBpVault }
}
interface ConvexFraxBpVaultDeployed {
    proxy: AssetProxy
    impl: ConvexFraxBpVault
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
    convexFraxBpVaults: ConvexFraxBpVaultsDeployed
    curveFraxBpMetapoolCalculatorLibrary: CurveFraxBpMetapoolCalculatorLibrary
    periodicAllocationPerfFeeMetaVault: { proxy: AssetProxy; impl: PeriodicAllocationPerfFeeMetaVault }
    curveFraxBpMetaVaults: CurveFraxBpMetaVaultsDeployed
    curveFraxBpCalculatorLibrary: CurveFraxBpCalculatorLibrary
}

/**
 * Sets balances to all hre.ether.signers on the following tokens:
 * FraxBp, bUSD, FRAX, USDC.
 *
 * @param {*} hre Hardhat Runtime Environment
 */
export const setBalancesToAccounts = async (hre) => {
    const accounts = await hre.ethers.getSigners()
    const sa = await new StandardAccounts().initAccounts(accounts, true)
    const crvFRAXTokenAddress = resolveAddress("crvFRAX")
    const busdTokenAddress = resolveAddress("BUSD")
    const fraxTokenAddress = resolveAddress("FRAX")
    const usdcTokenAddress = resolveAddress("USDC")

    const crvFraxTokenWhale = "0xCFc25170633581Bf896CB6CDeE170e3E3Aa59503"

    const whale = await impersonate(crvFraxTokenWhale)
    const crvFraxToken = ERC20__factory.connect(crvFRAXTokenAddress, whale)
    const tokensToMockBalance = { busdTokenAddress, usdcTokenAddress, fraxTokenAddress }

    await setBalancesToAccountForFraxBp(sa.alice, [crvFraxToken], tokensToMockBalance)
    await setBalancesToAccountForFraxBp(sa.bob, [crvFraxToken], tokensToMockBalance)
    await setBalancesToAccountForFraxBp(sa.other, [crvFraxToken], tokensToMockBalance)
    await setBalancesToAccountForFraxBp(sa.default, [crvFraxToken], tokensToMockBalance)
    await setBalancesToAccountForFraxBp(sa.dummy1, [crvFraxToken], tokensToMockBalance)
    await setBalancesToAccountForFraxBp(sa.dummy2, [crvFraxToken], tokensToMockBalance)
}
const deployerConvexFraxBpVault =
    (hre: HardhatRuntimeEnvironment, signer: Signer, nexus: string, vaultManager: string, proxyAdmin: string) =>
    async (pool: string, calculatorLibrary: string) => {
        const convexFraxBpPool: ConvexFraxBpPool = config.convexFraxBpPools[pool]
        const constructorData = {
            metapool: convexFraxBpPool.curveMetapool,
            convexPoolId: convexFraxBpPool.convexPoolId,
            booster: resolveAddress("ConvexBooster"),
        }

        return deployConvexFraxBpLiquidatorVault(hre, signer, {
            name: convexFraxBpPool.name,
            symbol: convexFraxBpPool.symbol,
            constructorData,
            asset: convexFraxBpPool.asset,
            nexus,
            proxyAdmin,
            vaultManager,
            calculatorLibrary,
            streamDuration: BN.from(convexFraxBpPool.streamDuration).toNumber(),
            slippageData: convexFraxBpPool.slippageData,
            donateToken: USDC.address,
            rewardTokens: [CRV.address, CVX.address],
            feeReceiver: resolveAddress("mStableDAO"),
            donationFee: 10000,
        })
    }
export async function deployConvexFraxBpVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
) {
    const fnDeployConvexFraxBpVault = deployerConvexFraxBpVault(hre, signer, nexus, vaultManager, proxyAdmin)
    const convexFraxBpVaults: ConvexFraxBpVaultsDeployed = {}
    const pools: string[] = ["busd", "susd", "alusd"]
    const curveFraxBpMetapoolCalculatorLibrary: CurveFraxBpMetapoolCalculatorLibrary = await deployCurveFraxBpMetapoolCalculatorLibrary(
        hre,
        signer,
    )
    // Deploy deployConvexFraxBp[Basic|Liquidator]Vault
    for (const pool of pools) {
        const convexFraxBpVaultDeployed: ConvexFraxBpVaultDeployed = await fnDeployConvexFraxBpVault(
            pool,
            curveFraxBpMetapoolCalculatorLibrary.address,
        )
        convexFraxBpVaults[pool] = convexFraxBpVaultDeployed
    }
    return { convexFraxBpVaults, curveFraxBpMetapoolCalculatorLibrary }
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
    const liquidator = await deployLiquidator(hre, signer, nexus.address, oneInchDexSwap.address, cowSwapDex.address, proxyAdmin.address)
    return { oneInchDexSwap, cowSwapDex, liquidator }
}

export const deployFraxBpMetaVaults = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: Nexus,
    proxyAdmin: DelayedProxyAdmin | InstantProxyAdmin,
    vaultManager: string,
): Promise<Phase3Deployed> => {
    // 1 - deployConvexFraxBpLiquidatorVault
    const { convexFraxBpVaults, curveFraxBpMetapoolCalculatorLibrary } = await deployConvexFraxBpVaults(
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
        convexFraxBpVaults,
    )
    // 3 - deployCurveFraxBpMetaVault
    const { curveFraxBpMetaVaults, curveFraxBpCalculatorLibrary } = await deployCurveFraxBpMetaVaults(
        hre,
        signer,
        nexus.address,
        vaultManager,
        proxyAdmin.address,
        periodicAllocationPerfFeeMetaVault.proxy.address,
    )

    return {
        convexFraxBpVaults,
        curveFraxBpMetapoolCalculatorLibrary,
        periodicAllocationPerfFeeMetaVault,
        curveFraxBpMetaVaults,
        curveFraxBpCalculatorLibrary,
    }
}
