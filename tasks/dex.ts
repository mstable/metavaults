import { deployContract, logTxDetails } from "@tasks/utils/deploy-utils"
import { ONE_DAY, ONE_HOUR, ONE_MIN } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { encodeInitiateSwap } from "@utils/peripheral/cowswap"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { CowSwapDex__factory, IERC20Metadata__factory, OneInchDexSwap__factory } from "types/generated"

import { getFeeAndQuote, getOrder, getQuote, postSellOrder } from "./peripheral/cowswapApi"
import { OneInchRouter } from "./peripheral/oneInchApi"
import { verifyEtherscan } from "./utils/etherscan"
import { logger } from "./utils/logger"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { CowSwapDex, OneInchDexSwap } from "types/generated"

import type { CowSwapContext, PostOrderParams } from "./peripheral/cowswapApi"

const log = logger("task:dex")

export async function deployCowSwapDex(hre: HardhatRuntimeEnvironment, signer: Signer, nexusAddress: string) {
    const chain = getChain(hre)
    const relayerAddress = resolveAddress("GPv2VaultRelayer", chain)
    const settlementAddress = resolveAddress("GPv2Settlement", chain)

    const constructorArguments = [nexusAddress, relayerAddress, settlementAddress]
    const dex = await deployContract<CowSwapDex>(new CowSwapDex__factory(signer), "CowSwapDex", constructorArguments)

    await verifyEtherscan(hre, {
        address: dex.address,
        contract: "contracts/vault/swap/CowSwapDex.sol:CowSwapDex",
        constructorArguments,
    })
    return dex
}

export async function deployOneInchDex(hre: HardhatRuntimeEnvironment, signer: Signer, router?: string) {
    const chain = getChain(hre)
    const routerAddress = resolveAddress(router ?? "OneInchAggregationRouterV4", chain)
    const constructorArguments = [routerAddress]
    const dex = await deployContract<OneInchDexSwap>(new OneInchDexSwap__factory(signer), "OneInchDexSwap", constructorArguments)
    await verifyEtherscan(hre, {
        address: dex.address,
        contract: "contracts/vault/swap/OneInchDexSwap.sol:OneInchDexSwap",
        constructorArguments,
    })
    return dex
}

/// Utility tasks to call directly cow swap API

// Example  sell WETH => USDC
// yarn task cowswap-fee-quote --from WETH --to USDC --from--amount 1000
task("cowswap-fee-quote", "@deprecated Calls CowSwap api to get the fee and quote of an order ")
    .addParam("from", "Token symbol or address of the asset to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the asset to buy", undefined, types.string)
    .addParam("amount", "Amount of the asset to sell", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, amount, to } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const sellToken = await resolveAssetToken(signer, chain, from)
        const buyToken = await resolveAssetToken(signer, chain, to)
        const sellAmount = simpleToExactAmount(amount)

        const response = await getFeeAndQuote(chain, sellToken.address, buyToken.address, sellAmount)

        log(`CoW Swap fee quote`)
        log(`from amount: ${formatUnits(sellAmount, sellToken.decimals)} ${sellToken.symbol}`)
        log(`fee        : ${formatUnits(response.fee.amount, sellToken.decimals)}  ${sellToken.symbol}`)
        log(`buy amount : ${formatUnits(response.buyAmountAfterFee, buyToken.decimals)} ${buyToken.symbol}`)
        log(`rate       : ${formatUnits(response.buyAmountAfterFee.mul(10000).div(sellAmount), 4)}  ${sellToken.symbol}/${buyToken.symbol}`)
    })

// Example  sell WETH => USDC
// yarn task cowswap-quote --from  WETH --to USDC --from--amount 1000
task("cowswap-quote", "Get CoW Swap quote and fee for a swap")
    .addParam("from", "Token symbol or address of the asset to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the asset to buy", undefined, types.string)
    .addParam("amount", "Amount of from tokens to sell", undefined, types.float)
    .setAction(async (taskArgs, hre) => {
        const { from, amount, to } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const sellToken = await resolveAssetToken(signer, chain, from)
        const buyToken = await resolveAssetToken(signer, chain, to)
        const fromAmount = simpleToExactAmount(amount)

        const response = await getQuote(chain, sellToken.address, buyToken.address, fromAmount)

        log(`CoW Swap quote`)
        log(`from amount: ${formatUnits(fromAmount, sellToken.decimals)} ${sellToken.symbol}`)
        log(`sell amount: ${formatUnits(response.quote.sellAmount, sellToken.decimals)} ${sellToken.symbol}`)
        log(`fee        : ${formatUnits(response.quote.feeAmount, sellToken.decimals)}  ${sellToken.symbol}`)
        log(`buy amount : ${formatUnits(response.quote.buyAmount, buyToken.decimals)} ${buyToken.symbol}`)
        log(`rate       : ${formatUnits(response.quote.buyAmount.mul(10000).div(fromAmount), 4)}  ${sellToken.symbol}/${buyToken.symbol}`)
    })

task("cowswap-status", "Get CoW Swap order status")
    .addParam("uid", "CoW Swap unique order identifier", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const response = await getOrder(chain, taskArgs.uid)

        const sellToken = await resolveAssetToken(signer, chain, response.sellToken)
        const buyToken = await resolveAssetToken(signer, chain, response.buyToken)
        const fromAmount = response.sellAmount.add(response.feeAmount)

        log(`CoW Swap order`)
        log(`status     : ${response.status}`)
        log(`from amount: ${formatUnits(fromAmount, sellToken.decimals)} ${sellToken.symbol}`)
        log(`sell amount: ${formatUnits(response.sellAmount, sellToken.decimals)} ${sellToken.symbol}`)
        log(`fee        : ${formatUnits(response.feeAmount, sellToken.decimals)}  ${sellToken.symbol}`)
        log(`buy amount : ${formatUnits(response.buyAmount, buyToken.decimals)} ${buyToken.symbol}`)
        log(`rate       : ${formatUnits(response.buyAmount.mul(10000).div(fromAmount), 4)}  ${sellToken.symbol}/${buyToken.symbol}`)
    })

task("cowswap-cancel", "Get CoW Swap order status")
    .addParam("uid", "CoW Swap unique order identifier", undefined, types.string)
    .addOptionalParam("dex", "Contract name or address CoW Swap will get the sell tokens from.", "CowSwapDex", types.string)
    .setAction(async (taskArgs, hre) => {
        const { uid, dex, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const cowSwapDexAddress = resolveAddress(dex, chain)
        const cowSwapDex = CowSwapDex__factory.connect(cowSwapDexAddress, signer)

        const tx = await cowSwapDex.cancelSwap(uid)
        await logTxDetails(tx, `cancel swap`)
    })

subtask("cowswap-init-swap", "Initiates a CoW Swap swap")
    .addParam("from", "Token symbol or address of the assets to sell.", undefined, types.string)
    .addParam("to", "Token symbol or address of the assets to buy.", undefined, types.string)
    .addParam("amount", "Amount of from tokens to sell.", undefined, types.float)
    .addOptionalParam("transfer", "Transfer sell tokens from liquidator?.", true, types.boolean)
    .addOptionalParam("receiver", "Contract name or address to receive the tokens purchased.", "LiquidatorV2", types.string)
    .addOptionalParam("dex", "Contract name or address CoW Swap will get the sell tokens from.", "CowSwapDex", types.string)
    .addOptionalParam("approve", "Signer approves Cow Swap Dex contract to transfer sell tokens.", false, types.boolean)
    .addOptionalParam("minutes", "Number of minutes until the order expires.", undefined, types.int)
    .addOptionalParam("hours", "Number of hours until the order expires.", undefined, types.int)
    .addOptionalParam("days", "Number of days until the order expires.", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { approve, dex, from, amount, to, transfer, receiver, minutes, hours, days, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const cowSwapDexAddress = resolveAddress(dex, chain)
        const cowSwapDex = CowSwapDex__factory.connect(cowSwapDexAddress, signer)

        const sellToken = await resolveAssetToken(signer, chain, from)
        const sellAmount = simpleToExactAmount(amount, sellToken.decimals)
        const buyToken = await resolveAssetToken(signer, chain, to)
        const receiverAddress = resolveAddress(receiver, chain)

        // Approve Dex to spend tokens
        if (approve) {
            const sellTokenContract = IERC20Metadata__factory.connect(sellToken.address, signer)
            if ((await sellTokenContract.allowance(await signer.getAddress(), cowSwapDexAddress)).lt(sellAmount)) {
                await sellTokenContract.approve(cowSwapDex.address, sellAmount)
            }
        }

        let deadline = ONE_DAY
        if (days) {
            deadline = ONE_DAY.mul(days)
        } else if (hours) {
            deadline = ONE_HOUR.mul(hours)
        } else if (minutes) {
            deadline = ONE_MIN.mul(minutes)
        }

        const quoteOrder = await getQuote(chain, sellToken.address, buyToken.address, sellAmount)

        // # These two values are needed to create an order
        const feeAmount = quoteOrder.quote.feeAmount
        const toAssetAmountAfterFee = quoteOrder.quote.buyAmount

        log(`from amount: ${formatUnits(sellAmount, sellToken.decimals)}  ${sellToken.symbol}`)
        log(`fee        : ${formatUnits(feeAmount, sellToken.decimals)}  ${sellToken.symbol}`)
        log(`to amount  : ${formatUnits(toAssetAmountAfterFee, buyToken.decimals)} ${buyToken.symbol}`)
        // TODO need to handle different decimals. eg CRV and CVX to USDT or USDC
        log(`rate       : ${formatUnits(toAssetAmountAfterFee.mul(10000).div(sellAmount), 4)} ${sellToken.symbol}/${buyToken.symbol}`)

        // post sell order to CowSwap API
        const context: CowSwapContext = {
            trader: cowSwapDex.address,
            deadline,
            chainId: chain,
        }
        const orderParam: PostOrderParams = {
            fromAsset: sellToken.address,
            toAsset: buyToken.address,
            fromAssetAmount: sellAmount,
            feeAmount,
            toAssetAmountAfterFee,
            receiver: receiverAddress,
        }
        const orderUid = await postSellOrder(context, orderParam)

        log(`Order uid  : ${orderUid}`)

        // Initiate the order and sign
        const data = encodeInitiateSwap(orderUid, transfer)
        const swapData = {
            fromAsset: sellToken.address,
            fromAssetAmount: sellAmount,
            toAsset: buyToken.address,
            minToAssetAmount: toAssetAmountAfterFee,
            data,
        }

        const tx = await cowSwapDex.initiateSwap(swapData)
        await logTxDetails(tx, `cowSwapDex.initiateSwap`)
    })
task("cowswap-init-swap").setAction(async (_, __, runSuper) => {
    return runSuper()
})

task("cowswap-rescue-token", "Rescues tokens from the CowSwapDex and sends it to governor")
    .addParam("asset", "Token symbol or address of the asset to retrieve", undefined, types.string)
    .addOptionalParam("amount", "Amount of tokens to rescue. Defaults to all assets.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { amount, asset, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const cowSwapDexAddress = resolveAddress("CowSwapDex", chain)
        const assetAddress = resolveAddress(asset, chain)

        const cowSwapDex = CowSwapDex__factory.connect(cowSwapDexAddress, signer)
        const token = IERC20Metadata__factory.connect(assetAddress, signer)

        const actualAssetAmount = await token.balanceOf(cowSwapDex.address)

        const rescueAmount = amount ? simpleToExactAmount(amount, await token.decimals()) : actualAssetAmount

        await cowSwapDex.rescueToken(token.address, rescueAmount)
    })

subtask("cowswap-deploy", "Deploys a new CowSwapDex contract")
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const nexusAddress = resolveAddress(nexus, chain)

        return deployCowSwapDex(hre, signer, nexusAddress)
    })
task("cowswap-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

// One Inch Dex
subtask("oneinch-dex-deploy", "Deploys a new CowSwapDex contract")
    .addOptionalParam("router", "OneInch Router address override", "OneInchAggregationRouterV4", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { router, speed } = taskArgs
        const signer = await getSigner(hre, speed)

        return deployOneInchDex(hre, signer, router)
    })
task("oneinch-dex-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

task("oneinch-quote", "Calls OneInch api to get the fee and quote of an order")
    .addParam("from", "Token symbol or address of the assets to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the assets to buy", undefined, types.string)
    .addParam("fromAmount", "Amount of the asset to sell", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, fromAmount, to, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const sellTokenAddress = resolveAddress(from, chain)
        const buyTokenAddress = resolveAddress(to, chain)

        // Approve Dex to spend tokens
        const fromAssetToken = IERC20Metadata__factory.connect(sellTokenAddress, signer)
        const sellAmount = simpleToExactAmount(fromAmount, await fromAssetToken.decimals())

        const router = new OneInchRouter(chain)
        const toAssetAmount = await router.getQuote({
            fromTokenAddress: sellTokenAddress,
            toTokenAddress: buyTokenAddress,
            amount: sellAmount.toString(),
        })
        log(`oneinch-fee-quote fromAsset: ${sellTokenAddress}     toAsset: ${buyTokenAddress}  toAssetAmount: ${toAssetAmount} `)
    })
