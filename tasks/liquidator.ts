import { deployContract, logTxDetails } from "@tasks/utils/deploy-utils"
import { ONE_DAY, ZERO } from "@utils/constants"
import { BN } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { Liquidator__factory } from "types/generated"

import { getOrderDetails, placeSellOrder } from "./peripheral/cowswapApi"
import { OneInchRouter } from "./peripheral/oneInchApi"
import { verifyEtherscan } from "./utils/etherscan"
import { buildDonateTokensInput } from "./utils/liquidatorUtil"
import { logger } from "./utils/logger"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { Liquidator } from "types/generated"

import type { CowSwapContext } from "./peripheral/cowswapApi"

const log = logger("liq")
const resolveMultipleAddress = async (chain, vaultsStr: string) =>
    Promise.all(vaultsStr.split(",").map((vaultName) => resolveAddress(vaultName, chain)))

export async function deployLiquidator(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexusAddress: string,
    syncSwapperAddress: string,
    asyncSwapperAddress: string,
) {
    const constructorArguments = [nexusAddress]
    const liquidator = await deployContract<Liquidator>(new Liquidator__factory(signer), "Liquidator", constructorArguments)
    await liquidator.initialize(syncSwapperAddress, asyncSwapperAddress)
    await verifyEtherscan(hre, {
        address: liquidator.address,
        contract: "contracts/vault/liquidator/Liquidator.sol:Liquidator",
        constructorArguments,
    })
    return liquidator
}

subtask("liq-deploy", "Deploys a new Liquidator contract")
    .addParam("syncSwapper", "Sync Swapper address", undefined, types.string)
    .addParam("asyncSwapper", "Async Swapper address", undefined, types.string)
    .addOptionalParam("nexus", "Nexus address, overrides lookup", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, speed, syncSwapper, asyncSwapper } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const nexusAddress = resolveAddress(nexus ?? "Nexus", chain)

        return deployLiquidator(hre, signer, nexusAddress, syncSwapper, asyncSwapper)
    })

task("liq-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("liq-collect-rewards", "Collect rewards from vaults")
    .addParam("vaults", "Vault names separated by ','.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const liquidatorAddress = resolveAddress("Liquidator", chain)
        const vaultsAddress = await resolveMultipleAddress(chain, taskArgs.vaults)
        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)
        const tx = await liquidator.collectRewards(vaultsAddress)
        await logTxDetails(tx, `liquidator.collectRewards${vaultsAddress})`)
    })
task("liq-collect-rewards").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-init-swap", "Calls initiateSwap on liquidator to swap rewards to asset")
    .addParam("reward", "Name of the reward to sell", undefined, types.string)
    .addParam("asset", "Name of the asset to buy", undefined, types.string)
    .addParam("receiver", "The receiver address of the tokens purchased", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const liquidatorAddress = resolveAddress("Liquidator", chain)
        const fromAssetAddress = await resolveAddress(taskArgs.reward, chain)
        const toAssetAddress = await resolveAddress(taskArgs.asset, chain)
        const receiver = taskArgs.receiver

        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get Pending rewards
        const { batch, rewards } = await liquidator.pendingRewards(fromAssetAddress, toAssetAddress)
        log(`batch: ${batch.toString()}, rewards: ${rewards.toString()}`)

        // Place  Sell Order on Cowswap API
        const context: CowSwapContext = {
            trader: liquidator.address,
            deadline: ONE_DAY,
            chainId: chain,
        }

        const sellOrderParams = { fromAsset: fromAssetAddress, toAsset: toAssetAddress, fromAssetAmount: rewards, receiver }
        const sellOrder = await placeSellOrder(context, sellOrderParams)
        log(`Swap initiated orderUid ${sellOrder.orderUid}`)

        // Initiate the order and sign
        const { encodeInitiateSwap } = await import("@utils/peripheral/cowswap")
        const data = encodeInitiateSwap(sellOrder.orderUid, sellOrder.fromAssetFeeAmount, receiver)
        const tx = await liquidator.initiateSwap(fromAssetAddress, toAssetAddress, data)

        await logTxDetails(tx, `liquidator.initiateSwap(${fromAssetAddress},${toAssetAddress})`)
    })
task("liq-init-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-settle-swap", "Calls settleSwap on liquidator to account for the swap")
    .addOptionalParam("orderUid", "The order uid to settle", "orderUid", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const liquidatorAddress = resolveAddress("Liquidator", chain)
        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)
        const orderOwner = await liquidator.asyncSwapper()

        // Get the order details from cowswap API
        const context: CowSwapContext = {
            chainId: chain,
        }
        const trades = await getOrderDetails(context, taskArgs.orderUid)

        if (trades.length == 0) {
            throw new Error("OrderUid not available")
        }
        const fromAssetAddress = trades[0].sellToken
        const toAssetAddress = trades[0].buyToken
        const toAssetAmount = trades.reduce((prevBuyAmount, curr) => BN.from(prevBuyAmount).add(BN.from(curr.buyAmount)), ZERO)
        // Settle the order
        const { encodeSettleSwap } = await import("@utils/peripheral/cowswap")

        const data = encodeSettleSwap(taskArgs.orderUid, orderOwner, liquidator.address) // orderUid , owner , receiver
        const tx = await liquidator.settleSwap(fromAssetAddress, toAssetAddress, toAssetAmount, data)
        await logTxDetails(tx, `liquidator.settleSwap${fromAssetAddress},${toAssetAddress},${toAssetAmount})`)
    })
task("liq-settle-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-sync-swap", "Calls sync swap on liquidator to swap rewards to asset")
    .addParam("reward", "Name of the reward to sell", undefined, types.string)
    .addParam("asset", "Name of the asset to buy", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const liquidatorAddress = resolveAddress("Liquidator", chain)
        const fromAssetAddress = await resolveAddress(taskArgs.reward, chain)
        const toAssetAddress = await resolveAddress(taskArgs.asset, chain)

        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get Pending rewards
        const { batch, rewards } = await liquidator.pendingRewards(fromAssetAddress, toAssetAddress)
        log(`batch: ${batch.toString()}, rewards: ${rewards.toString()}`)
        // Get quote
        const router = new OneInchRouter(chain)
        const minAssets = await router.getQuote({
            fromTokenAddress: taskArgs.fromAsset,
            toTokenAddress: taskArgs.toAsset,
            amount: taskArgs.fromAssetAmount,
        })

        // TODO - investigate and encode swaps
        // TODO - add slippage to minAssets
        const { encodeOneInchSwap } = await import("@utils/peripheral/oneInch")
        const data = encodeOneInchSwap("data")
        const tx = await liquidator.swap(fromAssetAddress, toAssetAddress, minAssets, data)
        await logTxDetails(tx, `liquidator.swap(${fromAssetAddress},${toAssetAddress}, ${minAssets})`)
    })
task("liq-sync-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-donate-tokens", "Donate purchased tokens to vaults")
    .addParam("vaults", "Vault names separated by ','.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const liquidatorAddress = resolveAddress("Liquidator", chain)
        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)
        const vaultsAddress = await resolveMultipleAddress(chain, taskArgs.vaults)
        const { rewardTokens, purchaseTokens, vaults } = await buildDonateTokensInput(signer, vaultsAddress)
        const tx = await liquidator.donateTokens(rewardTokens, purchaseTokens, vaults)
        await logTxDetails(tx, `liquidator.donateTokens${rewardTokens},${purchaseTokens},${vaults})`)
    })
task("liq-donate-tokens").setAction(async (_, __, runSuper) => {
    await runSuper()
})
