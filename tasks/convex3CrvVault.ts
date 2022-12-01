import { ONE_DAY } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import {
    AssetProxy__factory,
    Convex3CrvBasicVault__factory,
    Convex3CrvLiquidatorVault__factory,
    Curve3CrvFactoryMetapoolCalculatorLibrary__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
} from "types/generated"

import { config } from "./deployment/convex3CrvVaults-config"
import { CRV, CVX } from "./utils"
import { getBlock } from "./utils/blocks"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
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
    proxy: boolean
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
        proxy,
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
    if (!proxy) {
        return { proxy: undefined, impl: vaultImpl }
    }
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
    const proxyContract = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    return { proxy: proxyContract, impl: vaultImpl }
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
    .addParam("pool", "Symbol of the Convex pool. eg mUSD, FRAX, MIM, LUSD, BUSD", undefined, types.string)
    .addOptionalParam("asset", "Token address or symbol of the vault's asset", "3Crv", types.string)
    .addOptionalParam("stream", "Number of days the stream takes.", 7, types.int)
    .addOptionalParam("admin", "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam(
        "calculatorLibrary",
        "Name or address of the Curve calculator library. Curve3CrvFactoryMetapoolCalculatorLibrary | Curve3CrvMetapoolCalculatorLibrary",
        undefined,
        types.string,
    )
    .addOptionalParam("slippage", "Max slippage in basis points. default 1% = 100", 100, types.int)
    .addOptionalParam("donateToken", "Address or token symbol of token that rewards will be swapped to.", "DAI", types.string)
    .addOptionalParam("fee", "Liquidation fee scaled to 6 decimal places. default 16% = 160000", 160000, types.int)
    .addOptionalParam("feeReceiver", "Address or name of account that will receive vault fees.", "mStableDAO", types.string)
    .addOptionalParam("vaultManager", "Name or address to override the Vault Manager", "VaultManager", types.string)
    .addOptionalParam("proxy", "Deploy a proxy contract", true, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const {
            name,
            symbol,
            pool,
            asset,
            stream,
            admin,
            calculatorLibrary,
            slippage,
            donateToken,
            fee,
            feeReceiver,
            vaultManager,
            proxy,
            speed,
        } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetAddress = resolveAddress(asset, chain)
        const proxyAdminAddress = resolveAddress(admin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)
        const convexBoosterAddress = resolveAddress("ConvexBooster", chain)

        const convex3CrvPool = config.convex3CrvPools[pool.toLowerCase()]
        let calculatorLibraryAddress
        if (calculatorLibrary) {
            calculatorLibraryAddress = resolveAddress(calculatorLibrary, chain)
        } else {
            calculatorLibraryAddress = convex3CrvPool.isFactory
                ? resolveAddress("Curve3CrvFactoryMetapoolCalculatorLibrary", chain)
                : resolveAddress("Curve3CrvMetapoolCalculatorLibrary", chain)
        }
        const constructorData = {
            metapool: convex3CrvPool.curveMetapool,
            booster: convexBoosterAddress,
            convexPoolId: convex3CrvPool.convexPoolId,
        }
        const feeReceiverAddress = resolveAddress(feeReceiver, chain)
        const donateTokenAddress = resolveAddress(donateToken, chain)
        const rewardTokens = [CRV.address, CVX.address]

        // Vault library
        const { proxy: proxyContract, impl } = await deployConvex3CrvLiquidatorVault(hre, signer, {
            calculatorLibrary: calculatorLibraryAddress,
            nexus: nexusAddress,
            asset: assetAddress,
            factory: convex3CrvPool.isFactory,
            constructorData,
            streamDuration: ONE_DAY.mul(stream).toNumber(),
            name,
            symbol,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            slippageData: { mint: slippage, deposit: slippage, redeem: slippage, withdraw: slippage },
            donateToken: donateTokenAddress,
            rewardTokens,
            donationFee: fee,
            feeReceiver: feeReceiverAddress,
            proxy,
        })

        return { proxyContract, impl }
    })
task("convex-3crv-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

const secondsToBurn = (blocktime: number, stream: { last: number; end: number; sharesPerSecond: BN }) => {
    if (blocktime < stream.end) {
        return blocktime - stream.last
    } else if (stream.last < stream.end) {
        return stream.end - stream.last
    }
    return 0
}

subtask("convex-3crv-snap", "Logs Convex 3Crv Vault details")
    .addParam("vault", "Vault symbol or address", undefined, types.string)
    .addOptionalParam("owner", "Address, contract name or token symbol to get balances for. Defaults to signer", undefined, types.string)
    .addOptionalParam("block", "Block number. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { vault, owner, block, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const blk = await getBlock(hre.ethers, block)

        const vaultToken = await resolveAssetToken(signer, chain, vault)
        const vaultContract = Convex3CrvLiquidatorVault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol)

        await hre.run("vault-snap", {
            vault,
            owner,
        })

        console.log(`\nConvex3CrvLiquidatorVault`)
        // Assets per share
        const totalShares = await vaultContract.totalSupply({
            blockTag: blk.blockNumber,
        })
        const totalAssets = await vaultContract.totalAssets({
            blockTag: blk.blockNumber,
        })
        const assetsPerShare = totalAssets.mul(simpleToExactAmount(1)).div(totalShares)
        console.log(`Assets per share : ${formatUnits(assetsPerShare).padStart(21)}`)

        // Stream data
        const stream = await vaultContract.shareStream({
            blockTag: blk.blockNumber,
        })
        const streamDuration = await vaultContract.STREAM_DURATION()
        const streamScale = await vaultContract.STREAM_PER_SECOND_SCALE()
        const streamTotal = stream.sharesPerSecond.mul(streamDuration).div(streamScale)
        const sharesStillStreaming = await vaultContract.streamedShares({
            blockTag: blk.blockNumber,
        })
        const streamRemainingPercentage = streamTotal.gt(0) ? sharesStillStreaming.mul(10000).div(streamTotal) : BN.from(0)
        const streamBurnable = stream.sharesPerSecond.mul(secondsToBurn(blk.blockTimestamp, stream)).div(streamScale)
        const streamBurnablePercentage = streamTotal.gt(0) ? streamBurnable.mul(10000).div(streamTotal) : BN.from(0)

        console.log(`Stream total     : ${formatUnits(streamTotal).padStart(21)} shares`)
        console.log(`Stream burnable  : ${formatUnits(streamBurnable).padStart(21)} shares ${formatUnits(streamBurnablePercentage, 2)}%`)
        console.log(
            `Stream remaining : ${formatUnits(sharesStillStreaming).padStart(21)} shares ${formatUnits(streamRemainingPercentage, 2)}%`,
        )
        console.log(`Stream last      : ${new Date(stream.last * 1000)}`)
        console.log(`Stream end       : ${new Date(stream.end * 1000)}`)

        // Rewards
        console.log("\nRewards accrued:")
        const rewards = await vaultContract.callStatic.collectRewards({
            blockTag: blk.blockNumber,
        })
        let i = 0
        for (const reward of rewards.rewardTokens_) {
            const rewardToken = await resolveAssetToken(signer, chain, reward)
            console.log(`  ${formatUnits(rewards.rewards[i], rewardToken.decimals)} ${rewardToken.symbol}`)
            i++
        }
        const donateToken = await resolveAssetToken(signer, chain, rewards.donateTokens[0])
        console.log(`  Rewards are swapped for : ${donateToken.symbol}`)

        // Fees
        const fee = await vaultContract.donationFee({
            blockTag: blk.blockNumber,
        })
        console.log(`\nLiquidation fee : ${fee / 10000}%`)
        const feeReceiver = await vaultContract.feeReceiver({
            blockTag: blk.blockNumber,
        })
        const feeShares = await vaultContract.balanceOf(feeReceiver, {
            blockTag: blk.blockNumber,
        })
        const feeAssets = await vaultContract.maxWithdraw(feeReceiver, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Collected fees  : ${formatUnits(feeShares)} shares, ${formatUnits(feeAssets, assetToken.decimals)} ${assetToken.symbol}`,
        )
        const earnedRewards = await vaultContract.earnedRewards({ blockTag: blk.blockNumber })

        earnedRewards.rewardTokens_.forEach((rewardToken, i) => {
            console.log(`Earned rewards  : ${rewardToken}, earned ${formatUnits(earnedRewards.rewards[i]).padStart(21)}`)
        })
    })

task("convex-3crv-snap").setAction(async (_, __, runSuper) => {
    return runSuper()
})
