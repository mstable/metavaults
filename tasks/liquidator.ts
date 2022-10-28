import { deployContract, logTxDetails } from "@tasks/utils/deploy-utils"
import { ONE_DAY, ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { encodeInitiateSwap } from "@utils/peripheral/cowswap"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, IERC20Metadata__factory, Liquidator__factory } from "types/generated"

import { getOrder, placeSellOrder } from "./peripheral/cowswapApi"
import { OneInchRouter } from "./peripheral/oneInchApi"
import { verifyEtherscan } from "./utils/etherscan"
import { buildDonateTokensInput } from "./utils/liquidatorUtil"
import { logger } from "./utils/logger"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, Liquidator } from "types/generated"

import type { CowSwapContext } from "./peripheral/cowswapApi"
import type { Chain } from "./utils"

const log = logger("task:liq")

const resolveMultipleAddress = async (chain: Chain, vaultsStr: string) =>
    Promise.all(vaultsStr.split(",").map((vaultName) => resolveAddress(vaultName, chain)))

export async function deployLiquidator(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexusAddress: string,
    syncSwapperAddress: string,
    asyncSwapperAddress: string,
    proxyAdmin: string,
) {
    const constructorArguments = [nexusAddress]
    const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(signer), "Liquidator", constructorArguments)

    await verifyEtherscan(hre, {
        address: liquidatorImpl.address,
        contract: "contracts/vault/liquidator/Liquidator.sol:Liquidator",
        constructorArguments,
    })

    // Proxy
    const data = liquidatorImpl.interface.encodeFunctionData("initialize", [syncSwapperAddress, asyncSwapperAddress])
    const proxyConstructorArguments = [liquidatorImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    await verifyEtherscan(hre, {
        address: proxy.address,
        contract: "contracts/upgradability/Proxies.sol:AssetProxy",
        constructorArguments: proxyConstructorArguments,
    })

    return Liquidator__factory.connect(proxy.address, signer)
}

subtask("liq-deploy", "Deploys a new Liquidator contract")
    .addOptionalParam("syncSwapper", "Sync Swapper address override", "1InchSwapDex", types.string)
    .addOptionalParam("asyncSwapper", "Async Swapper address override", "CowSwapDex", types.string)
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("admin", "Proxy admin name or address override. eg DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, admin, syncSwapper, asyncSwapper, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const nexusAddress = resolveAddress(nexus, chain)
        const syncSwapperAddress = resolveAddress(syncSwapper, chain)
        const asyncSwapperAddress = resolveAddress(asyncSwapper, chain)
        const proxyAdminAddress = resolveAddress(admin, chain)

        return deployLiquidator(hre, signer, nexusAddress, syncSwapperAddress, asyncSwapperAddress, proxyAdminAddress)
    })

task("liq-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("liq-collect-rewards", "Collect rewards from vaults")
    .addParam("vaults", "Vault names separated by ','.", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { liquidator, speed, vaults } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const liquidatorAddress = resolveAddress(liquidator, chain)
        const vaultsAddress = await resolveMultipleAddress(chain, vaults)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)
        const tx = await liquidatorContract.collectRewards(vaultsAddress)
        await logTxDetails(tx, `liquidator.collectRewards(${vaultsAddress})`)

        const receipt = await tx.wait()
        const events = receipt.events?.find((e) => e.event === "CollectedRewards")
        events?.args?.rewards.forEach((rewards, i) => {
            // TODO include reward symbol, formatted amounts and vault symbol
            log(`Collected ${rewards} rewards from vault ${i}`)
        })
    })
task("liq-collect-rewards").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-init-swap", "Initiate CowSwap swap of rewards to donate tokens")
    .addParam("from", "Token symbol or address of the reward to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the asset to buy so it can be donated back to the vault", undefined, types.string)
    .addOptionalParam(
        "receiver",
        "Contract name or address of the contract or account to receive the tokens purchased",
        "LiquidatorV2",
        types.string,
    )
    .addOptionalParam("transfer", "Transfer sell tokens from liquidator?.", true, types.boolean)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("swapper", "Name or address to override the CowSwapDex contract", "CowSwapDex", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, to, liquidator, receiver, transfer, swapper, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const liquidatorAddress = resolveAddress(liquidator, chain)
        const swapperAddress = resolveAddress(swapper, chain)
        const sellToken = await resolveAssetToken(signer, chain, from)
        const buyToken = await resolveAssetToken(signer, chain, to)
        const receiverAddress = await resolveAddress(receiver, chain)

        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get Pending rewards
        const { batch, rewards } = await liquidatorContract.pendingRewards(sellToken.address, buyToken.address)
        log(`liquidator:\n  batch: ${batch}\n  rewards: ${formatUnits(rewards, sellToken.decimals)} ${sellToken.symbol}`)

        // Place Sell Order on CoW Swap API
        const context: CowSwapContext = {
            trader: swapperAddress,
            deadline: ONE_DAY,
            chainId: chain,
        }

        const sellOrderParams = {
            fromAsset: sellToken.address,
            toAsset: buyToken.address,
            fromAssetAmount: rewards,
            receiver: receiverAddress,
        }
        log(`Sell ${formatUnits(rewards, sellToken.decimals)} ${sellToken.symbol} rewards`)
        const sellOrder = await placeSellOrder(context, sellOrderParams)
        log(`uid ${sellOrder.orderUid}`)
        log(`fee ${formatUnits(sellOrder.fromAssetFeeAmount, sellToken.decimals)}`)
        log(`buy ${formatUnits(sellOrder.toAssetAmountAfterFee, buyToken.decimals)} ${buyToken.symbol}`)

        // Initiate the order and sign
        const data = encodeInitiateSwap(sellOrder.orderUid, transfer)
        const tx = await liquidatorContract.initiateSwap(sellToken.address, buyToken.address, data)

        await logTxDetails(tx, `liquidator initiateSwap of ${sellToken.symbol} to ${buyToken.symbol}`)
    })
task("liq-init-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-settle-swap", "Settle CoW Swap swap")
    .addParam("uid", "The order unique identifier to settle", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { liquidator, uid, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get the order details from cowswap API
        const order = await getOrder(chain, uid)

        if (order.status !== "fulfilled") {
            throw new Error("Order has not been filled")
        }
        const fromAssetAddress = order.sellToken
        const toAssetAddress = order.buyToken
        const toAssetAmount = order.sellAmount

        // Settle the order
        const tx = await liquidatorContract.settleSwap(fromAssetAddress, toAssetAddress, toAssetAmount, [])
        await logTxDetails(tx, `liquidator.settleSwap(${fromAssetAddress}, ${toAssetAddress}, ${toAssetAmount})`)
    })
task("liq-settle-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-sync-swap", "Swap rewards to donate tokens using 1Inch")
    .addParam("from", "Token symbol or address of the reward to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the asset to buy so they can be donated back to the vaults", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, to, liquidator, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const fromAsset = await resolveAssetToken(signer, chain, from)
        const toAssetAddress = await resolveAddress(to, chain)

        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get Pending rewards
        const { batch, rewards } = await liquidatorContract.pendingRewards(fromAsset.address, toAssetAddress)
        log(`liquidator:\n  batch: ${batch}\n  rewards: ${formatUnits(rewards, fromAsset.decimals)} ${from}`)
        // Get quote
        const router = new OneInchRouter(chain)
        const minAssets = await router.getQuote({
            fromTokenAddress: fromAsset.address,
            toTokenAddress: toAssetAddress,
            amount: rewards.toString(),
        })

        // TODO - investigate and encode swaps
        // TODO - add slippage to minAssets
        const { encodeOneInchSwap } = await import("@utils/peripheral/oneInch")
        const data = encodeOneInchSwap(ZERO_ADDRESS, liquidatorAddress, "0x")
        const tx = await liquidatorContract.swap(fromAsset.address, toAssetAddress, minAssets, data)
        await logTxDetails(tx, `liquidator.swap(${fromAsset.address}, ${toAssetAddress}, ${minAssets})`)
    })
task("liq-sync-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-donate-tokens", "Donate purchased tokens to vaults")
    .addParam("vaults", "Comma separated vault symbols or addresses", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { liquidator, speed, vaults } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)
        const vaultsAddress = await resolveMultipleAddress(chain, vaults)
        // TODO need option to restrict the reward and purchase tokens
        const { rewardTokens, purchaseTokens, vaults: vaultAddresses } = await buildDonateTokensInput(signer, vaultsAddress)
        log(`rewardTokens: ${rewardTokens}`)
        log(`purchaseTokens: ${purchaseTokens}`)
        log(`purchaseVaultAddresses: ${vaultAddresses}`)

        const tx = await liquidatorContract.donateTokens(rewardTokens, purchaseTokens, vaultAddresses)
        await logTxDetails(tx, `liquidator.donateTokens(${rewardTokens}, ${purchaseTokens}, ${vaultAddresses})`)
    })
task("liq-donate-tokens").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-set-async-swapper", "Set a new async swapper on the Liquidator when using forked chains")
    .addParam("swapper", "Contract address of the new async swapper", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { liquidator, speed, swapper } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)

        const tx = await liquidatorContract.setAsyncSwapper(swapper)
        await logTxDetails(tx, `liquidator.setAsyncSwapper(${swapper})`)
    })
task("liq-set-async-swapper").setAction(async (_, __, runSuper) => {
    await runSuper()
})

task("liq-rescue", "Rescues tokens from the Liquidator and sends it to governor")
    .addParam("asset", "Token symbol or address of the asset to retrieve", undefined, types.string)
    .addOptionalParam("amount", "Amount of tokens to rescue. Defaults to all assets.", undefined, types.float)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { amount, asset, liquidator, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const assetAddress = resolveAddress(asset, chain)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)
        const token = IERC20Metadata__factory.connect(assetAddress, signer)

        const actualAssetAmount = await token.balanceOf(liquidator.address)

        const rescueAmount = amount ? simpleToExactAmount(amount, await token.decimals()) : actualAssetAmount

        await liquidatorContract.rescueToken(token.address, rescueAmount)
    })
