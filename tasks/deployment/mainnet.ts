import {
    deployCurve3CrvMetaVault,
    deployCurve3PoolCalculatorLibrary,
    deployPeriodicAllocationPerfFeeMetaVault,
} from "@tasks/curve3CrvVault"
import { deployCowSwapDex, deployOneInchDex } from "@tasks/dex"
import { deployLiquidator } from "@tasks/liquidator"
import { deployNexus } from "@tasks/nexus"
import { deployProxyAdminDelayed, deployProxyAdminInstant } from "@tasks/proxyAdmin"
import { CRV, CVX, DAI, getSigner } from "@tasks/utils"
import { getChain, resolveAddress } from "@tasks/utils/networkAddressFactory"
import { ONE_WEEK } from "@utils/constants"
import { impersonate, setBalancesToAccount } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { BN } from "@utils/math"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { CowSwapDex__factory, ERC20__factory, OneInchDexSwap__factory } from "types"

import {
    deployConvex3CrvVault,
    deployCurve3CrvFactoryMetapoolCalculatorLibrary,
    deployCurve3CrvMetapoolCalculatorLibrary,
} from "../convex3CrvVault"
import { config } from "./mainnet-config"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type {
    AssetProxy,
    Convex3CrvPool,
    Convex3CrvVault,
    CowSwapDex,
    Curve3CrvBasicMetaVault,
    Curve3CrvFactoryMetapoolCalculatorLibrary,
    Curve3CrvMetapoolCalculatorLibrary,
    Curve3CrvPool,
    Curve3PoolCalculatorLibrary,
    DelayedProxyAdmin,
    InstantProxyAdmin,
    Liquidator,
    Nexus,
    OneInchDexSwap,
    PeriodicAllocationPerfFeeMetaVault,
} from "types"

interface Curve3CrvMetaVaultDeployed {
    proxy: AssetProxy
    impl: Curve3CrvBasicMetaVault
}
interface Curve3CrvMetaVaultsDeployed {
    [key: string]: { proxy: AssetProxy; impl: Curve3CrvBasicMetaVault }
}
interface Convex3CrvVaultDeployed {
    proxy: AssetProxy
    impl: Convex3CrvVault
}
interface Convex3CrvVaultsDeployed {
    [key: string]: { proxy: AssetProxy; impl: Convex3CrvVault }
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
async function setBalancesToAccounts(hre) {
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

        return deployConvex3CrvVault(hre, signer, true, {
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
    const pools: string[] = ["musd", "frax", "lusd", "busd"]
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
export async function deployPeriodicAllocationPerfFeeMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    convex3CrvVaults: Convex3CrvVaultsDeployed,
) {
    const { periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVaultConf } = config
    const underlyingVaults = [
        convex3CrvVaults.musd.proxy.address,
        convex3CrvVaults.frax.proxy.address,
        convex3CrvVaults.lusd.proxy.address,
        convex3CrvVaults.busd.proxy.address,
    ]
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

export async function deployCurve3CrvMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    metaVault: string,
) {
    const curve3CrvMetaVaults: Curve3CrvMetaVaultsDeployed = {}

    const { curve3CrvMetaVault } = config
    const pools: string[] = Object.keys(curve3CrvMetaVault)
    const curve3PoolCalculatorLibrary: Curve3PoolCalculatorLibrary = await deployCurve3PoolCalculatorLibrary(hre, signer)

    for (let i = 0; i < pools.length; i++) {
        const pool = pools[i]
        const curve3CrvPool: Curve3CrvPool = curve3CrvMetaVault[pool]
        const curve3CrvMetaVaultDeployed: Curve3CrvMetaVaultDeployed = await deployCurve3CrvMetaVault(hre, signer, {
            calculatorLibrary: curve3PoolCalculatorLibrary.address,
            nexus,
            asset: curve3CrvPool.asset,
            metaVault,
            // metaVault: curve3CrvPool.metaVault,
            slippageData: curve3CrvPool.slippageData,
            name: curve3CrvPool.name,
            symbol: curve3CrvPool.symbol,
            vaultManager,
            proxyAdmin,
        })
        curve3CrvMetaVaults[pool] = curve3CrvMetaVaultDeployed
    }
    return { curve3CrvMetaVaults, curve3PoolCalculatorLibrary }
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

subtask("deploy-core", "Deploys core smart contracts, nexus, proxy admin")
    .addOptionalParam("proxyAdminType", "Type of proxy admin: 'instant' | 'delayed'", "delayed", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { proxyAdminType, speed } = taskArgs
        const accounts = await hre.ethers.getSigners()
        const sa = await new StandardAccounts().initAccounts(accounts, true)

        // Deploy nexus
        const nexus = await hre.run("nexus-deploy", { speed, governor: sa.governor.address })
        // proxy-admin-instant-deploy , proxy-admin-delayed-deploy
        const proxyAdmin = await hre.run(`proxy-admin-${proxyAdminType}-deploy`, { speed })

        return { nexus, proxyAdmin }
    })
subtask("deploy-common", "Deploys common smart contracts")
    .addOptionalParam("nexus", "Nexus address, overrides lookup", undefined, types.string)
    .addOptionalParam("router", "OneInch Router address, overrides lookup", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, speed } = taskArgs
        const chain = getChain(hre)
        const nexusAddress = resolveAddress(nexus ?? "Nexus", chain)

        const oneInchDexSwap = await hre.run("one-inch-dex-deploy", { speed })
        const cowSwapDex = await hre.run("cow-swap-dex-deploy", { speed, nexus: nexusAddress })
        const liquidator = await hre.run("liq-deploy", {
            speed,
            nexus: nexusAddress,
            syncSwapper: oneInchDexSwap.address,
            asyncSwapper: cowSwapDex.address,
        })

        return { oneInchDexSwap, cowSwapDex, liquidator }
    })
subtask("deploy-3crv-meta-vaults", "Deploys Convex / Curve 3Crv Meta Vaults plus 4626 wrappers")
    .addParam("nexus", "Nexus address", undefined, types.string)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, types.string)
    .addParam("vaultManager", "VaultManager address", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, vaultManager, nexus, proxyAdmin } = taskArgs
        const signer = await getSigner(hre, speed)

        // 1 - deployConvex3CrvLiquidatorVault
        const { convex3CrvVaults, curve3CrvMetapoolCalculatorLibrary } = await deployConvex3CrvVaults(
            hre,
            signer,
            nexus,
            vaultManager,
            proxyAdmin,
        )
        // 2 - deployPeriodicAllocationPerfFeeMetaVaults
        const periodicAllocationPerfFeeMetaVault = await deployPeriodicAllocationPerfFeeMetaVaults(
            hre,
            signer,
            nexus,
            vaultManager,
            proxyAdmin,
            convex3CrvVaults,
        )
        // 3 - deployCurve3CrvMetaVault
        const { curve3CrvMetaVaults, curve3PoolCalculatorLibrary } = await deployCurve3CrvMetaVaults(
            hre,
            signer,
            nexus,
            vaultManager,
            proxyAdmin,
            periodicAllocationPerfFeeMetaVault.proxy.address,
        )

        return {
            convex3CrvVaults,
            curve3CrvMetapoolCalculatorLibrary,
            periodicAllocationPerfFeeMetaVault,
            curve3CrvMetaVaults,
            curve3PoolCalculatorLibrary,
        }
    })

task("deploy-full-fork")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const accounts = await hre.ethers.getSigners()
        const sa = await new StandardAccounts().initAccounts(accounts, true)
        // impersonate default signer with custom governor address
        process.env.IMPERSONATE = sa.governor.address
        const signer = await getSigner(hre, speed)

        const phase1: Phase1Deployed = await hre.run("deploy-core", { speed, proxyAdminType: "instant" })
        const phase2: Phase2Deployed = await hre.run("deploy-common", { speed })

        // has dependency on vault liquidators, can not be deployed without the module
        await phase1.nexus.connect(signer).proposeModule(keccak256(toUtf8Bytes("Liquidator")), phase2.liquidator.address)
        await hre.ethers.provider.send("evm_increaseTime", [BN.from(ONE_WEEK).toNumber()])
        await hre.ethers.provider.send("evm_mine", [])
        await phase1.nexus.connect(signer).acceptProposedModule(keccak256(toUtf8Bytes("Liquidator")))

        // deployCurve3CrvMetaVault
        // deployPeriodicAllocationPerfFeeMetaVault
        // deployConvex3CrvLiquidatorVault

        const phase3: Phase3Deployed = await hre.run("deploy-3crv-meta-vaults", {
            speed,
            nexus: phase1.nexus.address,
            proxyAdmin: phase1.proxyAdmin.address,
            vaultManager: sa.vaultManager.address,
        })
        // simulate accounts and deposit tokens.
        await setBalancesToAccounts(hre)
    })

// TODO - remove this module export and test if the tasks are still running
// module.exports = {}
