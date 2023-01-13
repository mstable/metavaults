import { ONE_DAY } from "@utils/constants"
import { BN } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import {
    AssetProxy__factory,
    ConvexFraxBpBasicVault__factory,
    ConvexFraxBpLiquidatorVault__factory,
    CurveFraxBpMetapoolCalculatorLibrary__factory,
    IERC20Metadata__factory,
} from "types/generated"

import { config } from "./deployment/convexFraxBpVaults-config"
import { CRV, CVX } from "./utils"
import { getBlock } from "./utils/blocks"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { ConvexFraxBpConstructorData } from "types"
import type {
    AssetProxy,
    ConvexFraxBpBasicVault,
    ConvexFraxBpLiquidatorVault,
    CurveFraxBpMetapoolCalculatorLibrary,
} from "types/generated"

interface ConvexFraxBpBasicVaultParams {
    calculatorLibrary: string
    nexus: string
    asset: string
    constructorData: ConvexFraxBpConstructorData
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
    rewardTokens: string[]
    donateToken: string
    donationFee: number
    feeReceiver: string
    assetToBurn: BN
}

interface ConvexFraxBpLiquidatorVaultParams extends ConvexFraxBpBasicVaultParams {
    streamDuration: number
}

export async function deployCurveFraxBpMetapoolCalculatorLibrary(hre: HardhatRuntimeEnvironment, signer: Signer) {
    const calculatorLibrary = await deployContract<CurveFraxBpMetapoolCalculatorLibrary>(
        new CurveFraxBpMetapoolCalculatorLibrary__factory(signer),
        `CurveFraxBpMetapoolCalculatorLibrary`,
        [],
    )

    await verifyEtherscan(hre, {
        address: calculatorLibrary.address,
        contract: "contracts/peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol:CurveFraxBpMetapoolCalculatorLibrary",
        constructorArguments: [],
    })
    return calculatorLibrary
}
const getMetapoolLinkAddresses = (calculatorLibrary: string) => ({
    "contracts/peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol:CurveFraxBpMetapoolCalculatorLibrary": calculatorLibrary,
})

export async function deployConvexFraxBpBasicVault(hre: HardhatRuntimeEnvironment, signer: Signer, params: ConvexFraxBpBasicVaultParams, deployerAddress: string) {
    const { calculatorLibrary, nexus, asset, constructorData, slippageData, name, symbol, vaultManager, proxyAdmin, assetToBurn } = params

    const curveFraxBpMetapoolCalculatorLibraryLinkAddresses = getMetapoolLinkAddresses(calculatorLibrary)
    // Vault
    const constructorArguments = [nexus, asset, constructorData]
    // <ConvexFraxBpBasicVault>
    const vaultImpl = await deployContract<ConvexFraxBpBasicVault>(
        new ConvexFraxBpBasicVault__factory(curveFraxBpMetapoolCalculatorLibraryLinkAddresses, signer),
        `ConvexFraxBpBasicVault ${name} (${symbol})`,
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/convex/ConvexFraxBpBasicVault.sol:ConvexFraxBpBasicVault",
        constructorArguments: constructorArguments,
    })

    // Pre-calculate proxyAddress for approval
    const nonce = await hre.ethers.provider.getTransactionCount(deployerAddress)
    const proxyAddress = hre.ethers.utils.getContractAddress({
      from: deployerAddress,
      nonce: nonce + 1, // Increment 1 to account for approval tx
    });

    // Approve allowance for assetToBurn
    let assetContract = IERC20Metadata__factory.connect(asset, signer)
    await assetContract.approve(proxyAddress, assetToBurn)

    // Proxy
    const data = vaultImpl.interface.encodeFunctionData("initialize", [name, symbol, vaultManager, slippageData, assetToBurn])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    await verifyEtherscan(hre, {
        address: proxy.address,
        contract: "contracts/upgradability/Proxies.sol:AssetProxy",
        constructorArguments: proxyConstructorArguments,
    })
    return { proxy, impl: vaultImpl }
}

export async function deployConvexFraxBpLiquidatorVault(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployerAddress: string,
    params: ConvexFraxBpLiquidatorVaultParams,
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
        assetToBurn
    } = params

    const linkAddresses = getMetapoolLinkAddresses(calculatorLibrary)

    // Implementation
    const constructorArguments = [nexus, asset, constructorData, streamDuration]
    const vaultImpl = await deployContract<ConvexFraxBpLiquidatorVault>(
        new ConvexFraxBpLiquidatorVault__factory(linkAddresses, signer),
        `ConvexFraxBpLiquidatorVault ${name} (${symbol})`,
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/convex/ConvexFraxBpLiquidatorVault.sol:ConvexFraxBpLiquidatorVault",
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
        assetToBurn
    ])

    // Pre-calculate proxyAddress for approval
    const nonce = await hre.ethers.provider.getTransactionCount(deployerAddress)
    const proxyAddress = hre.ethers.utils.getContractAddress({
      from: deployerAddress,
      nonce: nonce + 1, // Increment 1 to account for approval tx
    });

    // Approve allowance for assetToBurn
    let assetContract = IERC20Metadata__factory.connect(asset, signer)
    await assetContract.approve(proxyAddress, assetToBurn)

    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    return { proxy, impl: vaultImpl }
}

subtask("convex-FraxBp-lib-deploy", "Deploys a Curve Metapool calculator library")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const signer = await getSigner(hre, speed)
        // Vault library
        return deployCurveFraxBpMetapoolCalculatorLibrary(hre, signer)
    })
task("convex-FraxBp-lib-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("convex-FraxBp-vault-deploy", "Deploys Convex FraxBp Liquidator Vault")
    .addParam("name", "Vault name", undefined, types.string)
    .addParam("symbol", "Vault symbol", undefined, types.string)
    .addParam("pool", "Symbol of the Convex pool. eg TUSD, BUSD", undefined, types.string)
    .addParam("assetToBurn", "Amount of assets to deposit and corresponding shares locked", undefined , types.int)
    .addOptionalParam("asset", "Token address or symbol of the vault's asset", "FraxBp", types.string)
    .addOptionalParam("stream", "Number of days the stream takes.", 7, types.int)
    .addOptionalParam("admin", "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam(
        "calculatorLibrary",
        "Name or address of the Curve calculator library CurveFraxBpMetapoolCalculatorLibrary",
        undefined,
        types.string,
    )
    .addOptionalParam("slippage", "Max slippage in basis points. default 1% = 100", 100, types.int)
    .addOptionalParam("donateToken", "Address or token symbol of token that rewards will be swapped to.", "USDC", types.string)
    .addOptionalParam("fee", "Liquidation fee scaled to 6 decimal places. default 16% = 160000", 160000, types.int)
    .addOptionalParam("feeReceiver", "Address or name of account that will receive vault fees.", "mStableDAO", types.string)
    .addOptionalParam("vaultManager", "Name or address to override the Vault Manager", "VaultManager", types.string)
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
            speed,
            assetToBurn,
        } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetAddress = resolveAddress(asset, chain)
        const proxyAdminAddress = resolveAddress(admin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)
        const convexBoosterAddress = resolveAddress("ConvexBooster", chain)
        const deployerAddress = resolveAddress("OperationsSigner", chain)

        const convexFraxBpPool = config.convexFraxBpPools[pool.toLowerCase()]
        let calculatorLibraryAddress
        if (calculatorLibrary) {
            calculatorLibraryAddress = resolveAddress(calculatorLibrary, chain)
        } else {
            calculatorLibraryAddress = resolveAddress("CurveFraxBpMetapoolCalculatorLibrary", chain)
        }
        const constructorData = {
            metapool: convexFraxBpPool.curveMetapool,
            booster: convexBoosterAddress,
            convexPoolId: convexFraxBpPool.convexPoolId,
        }
        const feeReceiverAddress = resolveAddress(feeReceiver, chain)
        const donateTokenAddress = resolveAddress(donateToken, chain)
        const rewardTokens = [CRV.address, CVX.address]

        // Vault library
        const { proxy, impl } = await deployConvexFraxBpLiquidatorVault(hre, signer, deployerAddress, {
            calculatorLibrary: calculatorLibraryAddress,
            nexus: nexusAddress,
            asset: assetAddress,
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
            assetToBurn
        })

        return { proxy, impl }
    })
task("convex-FraxBp-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("convex-FraxBp-snap", "Logs Convex FraxBp Vault details")
    .addParam("vault", "Vault symbol or address", undefined, types.string)
    .addOptionalParam("owner", "Address, contract name or token symbol to get balances for. Defaults to signer", undefined, types.string)
    .addOptionalParam("block", "Block number. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { vault, owner, block, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const blk = await getBlock(hre.ethers, block)

        const vaultToken = await resolveAssetToken(signer, chain, vault)
        const vaultContract = ConvexFraxBpLiquidatorVault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol)

        await hre.run("vault-snap", {
            vault,
            owner,
        })

        console.log(`\nConvexFraxBpLiquidatorVault`)
        const stream = await vaultContract.shareStream({
            blockTag: blk.blockNumber,
        })
        const streamDuration = await vaultContract.STREAM_DURATION()
        const streamScale = await vaultContract.STREAM_PER_SECOND_SCALE()
        const streamTotal = stream.sharesPerSecond.mul(streamDuration).div(streamScale)
        const sharesStillStreaming = await vaultContract.streamedShares({
            blockTag: blk.blockNumber,
        })
        const streamRemainingPercentage = streamTotal.gt(0) ? sharesStillStreaming.mul(1000).div(streamTotal) : BN.from(0)
        console.log(`Stream total     : ${formatUnits(streamTotal)} shares`)
        console.log(`Stream remaining : ${formatUnits(sharesStillStreaming)} shares ${formatUnits(streamRemainingPercentage, 2)}%`)
        console.log(`Stream last      : ${new Date(stream.last * 1000)}`)
        console.log(`Stream end       : ${new Date(stream.end * 1000)}`)

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
    })

task("convex-FraxBp-snap").setAction(async (_, __, runSuper) => {
    return runSuper()
})
