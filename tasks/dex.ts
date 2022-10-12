import { deployContract, logTxDetails } from "@tasks/utils/deploy-utils"
import { ONE_DAY, ZERO } from "@utils/constants"
import { BN } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { CowSwapDex__factory, IERC20__factory, OneInchDexSwap__factory } from "types/generated"

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

const log = logger("dex")
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
task("cowswap-fee-quote", "@deprecated Calls CowSwap api to get the fee and quote of an order ")
    .addParam("fromAsset", "Address of the asset to sell", undefined, types.string)
    .addParam("toAsset", "Address of the asset to buy", undefined, types.string)
    .addParam("fromAssetAmount", "Amount of the asset to sell", ZERO, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        // Example  sell WETH => USDC
        // yarn task cowswap-fee-quote --from--asset  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" --to--asset "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" --from--asset--amount "100000000000000000"
        const chain = getChain(hre)
        const feeQuote = await getFeeAndQuote(chain, taskArgs.fromAsset, taskArgs.toAsset, BN.from(taskArgs.fromAssetAmount))
        log(`cowswap-fee-quote
                    fromAsset:${taskArgs.fromAsset}     toAsset:${taskArgs.toAsset}
                    fromAssetAmount:${taskArgs.fromAssetAmount}    buyAmountAfterFee:${feeQuote.buyAmountAfterFee}
                    feeAmount:${feeQuote.fee.amount}   feeExpirationDate:${feeQuote.fee.expirationDate}`)
    })

task("cowswap-quote", "Calls CowSwap api to get the fee and quote of an order")
    .addParam("fromAsset", "Address of the asset to sell", undefined, types.string)
    .addParam("toAsset", "Address of the asset to buy", undefined, types.string)
    .addParam("fromAssetAmount", "Amount of the asset to sell", ZERO, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        // Example  sell WETH => USDC
        // yarn task cowswap-quote --from--asset  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" --to--asset "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" --from--asset--amount "100000000000000000"
        const chain = getChain(hre)
        const quote = await getQuote(chain, taskArgs.fromAsset, taskArgs.toAsset, BN.from(taskArgs.fromAssetAmount))
        log(`cowswap-fee-quote
                    fromAsset:${taskArgs.fromAsset}     toAsset:${taskArgs.toAsset} expiration:${quote.expiration}
                    fromAssetAmount:${taskArgs.fromAssetAmount.toString()}  fromAssetAmountAfterFee:${quote.quote.sellAmount.toString()}
                    feeAmount:${quote.quote.feeAmount.toString()}           buyAmountAfterFee:${quote.quote.buyAmount.toString()} `)
    })

/// Utility tasks to call directly cow swap dex contract
task("dex-init-swap", "Calls initiateSwap to initiates a CowSwap of rewards to asset")
    .addParam("fromAsset", "Address of the fromAsset to sell", undefined, types.string)
    .addParam("toAsset", "Address of the toAsset to buy", undefined, types.string)
    .addParam("fromAssetAmount", "Amount of the asset to sell", ZERO, types.string)
    .addParam("receiver", "The receiver address of the tokens purchased", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const cowSwapDexAddress = resolveAddress("CowSwapDex", chain)
        const cowSwapDex = CowSwapDex__factory.connect(cowSwapDexAddress, signer)
        const fromAssetAddress = taskArgs.fromAsset
        const toAssetAddress = taskArgs.toAsset
        const receiver = taskArgs.receiver

        // Approve Dex to spend tokens
        const fromAssetToken = IERC20__factory.connect(fromAssetAddress, signer)
        const fromAssetAmount = BN.from(taskArgs.fromAssetAmount)
        if ((await fromAssetToken.allowance(receiver, cowSwapDex.address)).lt(fromAssetAmount)) {
            await fromAssetToken.connect(signer).approve(cowSwapDex.address, hre.ethers.constants.MaxUint256)
        }

        // Place  Sell Order on Cowswap API
        const context: CowSwapContext = {
            trader: cowSwapDex.address,
            deadline: ONE_DAY,
            chainId: chain,
        }

        const sellOrderParams = { fromAsset: fromAssetAddress, toAsset: toAssetAddress, fromAssetAmount, receiver }
        const sellOrder = await placeSellOrder(context, sellOrderParams)
        log(`Swap initiated orderUid ${sellOrder.orderUid}`)

        // Initiate the order and sign
        const { encodeInitiateSwap } = await import("@utils/peripheral/cowswap")
        const data = encodeInitiateSwap(sellOrder.orderUid, sellOrder.fromAssetFeeAmount, receiver)
        const swapData = {
            fromAsset: fromAssetAddress,
            fromAssetAmount: fromAssetAmount.sub(sellOrder.fromAssetFeeAmount),
            toAsset: toAssetAddress,
            minToAssetAmount: sellOrder.toAssetAmountAfterFee,
            data: data,
        }
        const tx = await cowSwapDex.connect(signer)[INITIATE_SWAP_SINGLE](swapData)
        await logTxDetails(tx, `cowSwapDex.initiateSwap`)
    })

task("dex-rescue-token", "Calls rescueToken from the CowSwapDex and sends it to governor")
    .addParam("asset", "Address of the asset to retrieve", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const cowSwapDexAddress = resolveAddress("CowSwapDex", chain)
        const cowSwapDex = CowSwapDex__factory.connect(cowSwapDexAddress, signer)
        const token = IERC20__factory.connect(taskArgs.asset, signer)
        const assetAmount = await token.balanceOf(cowSwapDex.address)
        if (assetAmount.eq(ZERO)) throw new Error("CowSwapDex has zero balance")

        await cowSwapDex.rescueToken(token.address, assetAmount)
    })

subtask("cow-swap-dex-deploy", "Deploys a new CowSwapDex contract")
    .addOptionalParam("nexus", "Nexus address, overrides lookup", "Nexus", types.string)
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
    .addOptionalParam("router", "OneInch Router address, overrides lookup", undefined, types.string)
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
    .addParam("fromAsset", "Address of the asset to sell", undefined, types.string)
    .addParam("toAsset", "Address of the asset to buy", undefined, types.string)
    .addParam("fromAssetAmount", "Amount of the asset to sell", ZERO, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const router = new OneInchRouter(chain)
        const toAssetAmount = await router.getQuote({
            fromTokenAddress: taskArgs.fromAsset,
            toTokenAddress: taskArgs.toAsset,
            amount: taskArgs.fromAssetAmount,
        })
        log(`one-inch-fee-quote fromAsset:${taskArgs.fromAsset}     toAsset:${taskArgs.toAsset}  toAssetAmount:${toAssetAmount} `)
    })
