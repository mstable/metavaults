import { deployContract, logTxDetails } from "@tasks/utils/deploy-utils"
import { ONE_DAY, ZERO } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { CowSwapDex__factory, IERC20Metadata__factory, OneInchDexSwap__factory } from "types/generated"

import { getFeeAndQuote, getQuote, placeSellOrder } from "./peripheral/cowswapApi"
import { OneInchRouter } from "./peripheral/oneInchApi"
import { verifyEtherscan } from "./utils/etherscan"
import { logger } from "./utils/logger"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { CowSwapDex, OneInchDexSwap } from "types/generated"

import type { CowSwapContext } from "./peripheral/cowswapApi"

const log = logger("task:dex")
const DEX_SWAP_DATA = "(address,uint256,address,uint256,bytes)"
const INITIATE_SWAP_SINGLE = `initiateSwap(${DEX_SWAP_DATA})`

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
    .addParam("fromAmount", "Amount of the asset to sell", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, fromAmount, to } = taskArgs
        const chain = getChain(hre)

        const sellTokenAddress = resolveAddress(from, chain)
        const buyTokenAddress = resolveAddress(to, chain)
        const sellAmount = simpleToExactAmount(fromAmount)

        const feeQuote = await getFeeAndQuote(chain, sellTokenAddress, buyTokenAddress, sellAmount)

        log(`cowswap-fee-quote
                    fromAsset:${sellTokenAddress}     toAsset:${buyTokenAddress}
                    fromAssetAmount:${fromAmount}    buyAmountAfterFee:${feeQuote.buyAmountAfterFee}
                    feeAmount:${feeQuote.fee.amount}   feeExpirationDate:${feeQuote.fee.expirationDate}`)
    })

// Example  sell WETH => USDC
// yarn task cowswap-quote --from  WETH --to USDC --from--amount 1000
task("cowswap-quote", "Calls CowSwap api to get the fee and quote of an order")
    .addParam("from", "Token symbol or address of the asset to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the asset to buy", undefined, types.string)
    .addParam("fromAmount", "Amount of the asset to sell", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, fromAmount, to } = taskArgs
        const chain = getChain(hre)

        const sellTokenAddress = resolveAddress(from, chain)
        const buyTokenAddress = resolveAddress(to, chain)
        const sellAmount = simpleToExactAmount(fromAmount)

        const quote = await getQuote(chain, sellTokenAddress, buyTokenAddress, sellAmount)

        log(`cowswap-fee-quote
                    fromAsset: ${sellTokenAddress}     toAsset: ${buyTokenAddress} expiration: ${quote.expiration}
                    fromAssetAmount: ${fromAmount}  fromAssetAmountAfterFee: ${quote.quote.sellAmount}
                    feeAmount: ${quote.quote.feeAmount}           buyAmountAfterFee: ${quote.quote.buyAmount} `)
    })

task("dex-init-swap", "Initiates a CoW Swap swap")
    .addParam("from", "Token symbol or address of the assets to sell", undefined, types.string)
    .addParam("to", "Token symbol or address of the assets to buy", undefined, types.string)
    .addParam("fromAmount", "Amount of the asset to sell", undefined, types.float)
    .addOptionalParam("receiver", "Contract name or address to receive the tokens purchased", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { from, fromAmount, to, receiver, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const cowSwapDexAddress = resolveAddress("CowSwapDex", chain)
        const cowSwapDex = CowSwapDex__factory.connect(cowSwapDexAddress, signer)

        const sellTokenAddress = resolveAddress(from, chain)
        const buyTokenAddress = resolveAddress(to, chain)
        const receiverAddress = resolveAddress(receiver, chain)

        // Approve Dex to spend tokens
        const fromAssetToken = IERC20Metadata__factory.connect(sellTokenAddress, signer)
        const sellAmount = simpleToExactAmount(fromAmount, await fromAssetToken.decimals())
        if ((await fromAssetToken.allowance(await signer.getAddress(), cowSwapDex.address)).lt(sellAmount)) {
            await fromAssetToken.connect(signer).approve(cowSwapDex.address, hre.ethers.constants.MaxUint256)
        }

        // Place  Sell Order on Cowswap API
        const context: CowSwapContext = {
            trader: cowSwapDex.address,
            deadline: ONE_DAY,
            chainId: chain,
        }

        const sellOrderParams = {
            fromAsset: sellTokenAddress,
            toAsset: buyTokenAddress,
            fromAssetAmount: fromAmount,
            receiver: receiverAddress,
        }
        const sellOrder = await placeSellOrder(context, sellOrderParams)
        log(`Swap order uid ${sellOrder.orderUid}`)

        // Initiate the order and sign
        const { encodeInitiateSwap } = await import("@utils/peripheral/cowswap")
        const data = encodeInitiateSwap(sellOrder.orderUid, sellOrder.fromAssetFeeAmount, receiverAddress)
        const swapData = {
            fromAsset: sellTokenAddress,
            fromAssetAmount: fromAmount.sub(sellOrder.fromAssetFeeAmount),
            toAsset: buyTokenAddress,
            minToAssetAmount: sellOrder.toAssetAmountAfterFee,
            data: data,
        }
        const tx = await cowSwapDex.connect(signer)[INITIATE_SWAP_SINGLE](swapData)
        await logTxDetails(tx, `cowSwapDex.initiateSwap`)
    })

task("dex-rescue-token", "Rescues tokens from the CowSwapDex and sends it to governor")
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

subtask("cow-swap-dex-deploy", "Deploys a new CowSwapDex contract")
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const nexusAddress = resolveAddress(nexus, chain)

        return deployCowSwapDex(hre, signer, nexusAddress)
    })
task("cow-swap-dex-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

// One Inch Dex
subtask("one-inch-dex-deploy", "Deploys a new CowSwapDex contract")
    .addOptionalParam("router", "OneInch Router address override", "OneInchAggregationRouterV4", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { router, speed } = taskArgs
        const signer = await getSigner(hre, speed)

        return deployOneInchDex(hre, signer, router)
    })
task("one-inch-dex-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

task("one-inch-quote", "Calls OneInch api to get the fee and quote of an order")
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
        log(`one-inch-fee-quote fromAsset: ${sellTokenAddress}     toAsset: ${buyTokenAddress}  toAssetAmount: ${toAssetAmount} `)
    })
