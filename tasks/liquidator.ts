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
    proxy = true,
) {
    const constructorArguments = [nexusAddress]
    const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(signer), "Liquidator", constructorArguments)

    await verifyEtherscan(hre, {
        address: liquidatorImpl.address,
        contract: "contracts/vault/liquidator/Liquidator.sol:Liquidator",
        constructorArguments,
    })

    // Proxy
    if (!proxy) {
        return liquidatorImpl
    }
    const data = liquidatorImpl.interface.encodeFunctionData("initialize", [syncSwapperAddress, asyncSwapperAddress])
    const proxyConstructorArguments = [liquidatorImpl.address, proxyAdmin, data]
    const proxyContract = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    await verifyEtherscan(hre, {
        address: proxyContract.address,
        contract: "contracts/upgradability/Proxies.sol:AssetProxy",
        constructorArguments: proxyConstructorArguments,
    })

    return Liquidator__factory.connect(proxyContract.address, signer)
}

subtask("liq-deploy", "Deploys a new Liquidator contract")
    .addOptionalParam("syncSwapper", "Sync Swapper address override", "1InchSwapDex", types.string)
    .addOptionalParam("asyncSwapper", "Async Swapper address override", "CowSwapDex", types.string)
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("admin", "Proxy admin name or address override. eg DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam("proxy", "Deploy a proxy contract", true, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, admin, syncSwapper, asyncSwapper, proxy, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const nexusAddress = resolveAddress(nexus, chain)
        const syncSwapperAddress = resolveAddress(syncSwapper, chain)
        const asyncSwapperAddress = resolveAddress(asyncSwapper, chain)
        const proxyAdminAddress = resolveAddress(admin, chain)

        return deployLiquidator(hre, signer, nexusAddress, syncSwapperAddress, asyncSwapperAddress, proxyAdminAddress, proxy)
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
        const totalRewards = {};

        let i = 0
        for (const rewards of events?.args?.rewards) {
            let j = 0
            for (const reward of rewards) {
                const vaultToken = await resolveAssetToken(signer, chain, vaultsAddress[i])
                const rewardToken = await resolveAssetToken(signer, chain, events?.args?.rewardTokens[i][j])
                log(`Collected ${formatUnits(reward, rewardToken.decimals)} ${rewardToken.symbol} rewards from vault ${vaultToken.symbol}`)
                totalRewards[rewardToken.symbol]= totalRewards[rewardToken.symbol] ? totalRewards[rewardToken.symbol].add(reward): reward;
                j++
            }
            i++
        }
        for (const symbol in totalRewards) {
            const rewardToken = await resolveAssetToken(signer, chain, symbol)
            log(`Total Collected ${formatUnits(totalRewards[symbol], rewardToken.decimals)} ${symbol}`)
        }
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
    .addOptionalParam("readonly", "Quote swap but not initiate.", false, types.boolean)
    .addOptionalParam("maxFee", "Max fee in from tokens", 0, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, to, liquidator, maxFee, readonly, receiver, transfer, swapper, speed } = taskArgs
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
        const feePercentage = sellOrder.fromAssetFeeAmount.mul(10000).div(rewards)
        log(`fee ${formatUnits(sellOrder.fromAssetFeeAmount, sellToken.decimals)} ${formatUnits(feePercentage, 2)}%`)
        log(`buy ${formatUnits(sellOrder.toAssetAmountAfterFee, buyToken.decimals)} ${buyToken.symbol}`)

        const gasPrice = await hre.ethers.provider.getGasPrice()
        log(`gas price ${formatUnits(gasPrice, "gwei")}`)

        const maxFeeScaled = simpleToExactAmount(maxFee, sellToken.decimals)
        if (maxFeeScaled.gt(0) && sellOrder.fromAssetFeeAmount.gt(maxFeeScaled)) {
            throw Error(`Fee ${formatUnits(sellOrder.fromAssetFeeAmount, sellToken.decimals)} is greater than maxFee ${maxFee}`)
        }

        if (!readonly) {
            // Initiate the order and sign
            const data = encodeInitiateSwap(sellOrder.orderUid, transfer)
            const tx = await liquidatorContract.initiateSwap(sellToken.address, buyToken.address, data)

            await logTxDetails(tx, `liquidator initiateSwap of ${sellToken.symbol} to ${buyToken.symbol}`)
        }
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
        const toAssetAmount = order.buyAmount

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
    .addParam("rewards", "Comma separated symbols or addresses of the reward tokens", undefined, types.string)
    .addOptionalParam("purchase", "Symbol or address of the purchased token", "DAI", types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { liquidator, speed, rewards, purchase, vaults } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)
        const rewardAddresses = await resolveMultipleAddress(chain, rewards)
        const vaultAddresses = await resolveMultipleAddress(chain, vaults)
        const purchaseToken = await resolveAddress(purchase, chain)

        const rewardTokens = []
        const vaultTokens = []
        const purchaseTokens = []
        // For each vault
        vaultAddresses.forEach((vaultAddress) => {
            // For each reward token
            rewardAddresses.forEach((rewardAddress) => {
                rewardTokens.push(rewardAddress)
                vaultTokens.push(vaultAddress)
                purchaseTokens.push(purchaseToken)
            })
        })
        log(`reward tokens   [${rewardTokens.length}] ${rewardTokens}`)
        log(`purchase tokens [${purchaseTokens.length}] ${purchaseTokens}`)
        log(`vaults          [${vaultTokens.length}] ${vaultTokens}`)

        const tx = await liquidatorContract.donateTokens(rewardTokens, purchaseTokens, vaultTokens)
        await logTxDetails(tx, `liquidator.donateTokens(${rewardTokens}, ${purchaseTokens}, ${vaultTokens})`)
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
