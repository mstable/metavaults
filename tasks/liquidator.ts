import { deployContract, logTxDetails } from "@tasks/utils/deploy-utils"
import { ONE_DAY, ZERO, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, IERC20Metadata__factory, Liquidator__factory } from "types/generated"

import { getOrderDetails, placeSellOrder } from "./peripheral/cowswapApi"
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

const log = logger("liq")

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
    .addOptionalParam("proxyAdmin", "Proxy admin address override", "InstantProxyAdmin", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, proxyAdmin, syncSwapper, asyncSwapper, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const nexusAddress = resolveAddress(nexus, chain)
        const syncSwapperAddress = resolveAddress(syncSwapper, chain)
        const asyncSwapperAddress = resolveAddress(asyncSwapper, chain)
        const proxyAdminAddress = resolveAddress(proxyAdmin, chain)

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
    })
task("liq-collect-rewards").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-init-swap", "Calls initiateSwap on liquidator to swap rewards to asset using CowSwap")
    .addParam("reward", "Token symbol or address of the reward to sell", undefined, types.string)
    .addParam("asset", "Token symbol or address of the asset to buy", undefined, types.string)
    .addOptionalParam(
        "receiver",
        "Contract name or address of the contract or account to receive the tokens purchased",
        "LiquidatorV2",
        types.string,
    )
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { asset, liquidator, receiver, reward, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const liquidatorAddress = resolveAddress(liquidator, chain)
        const fromAssetAddress = await resolveAddress(reward, chain)
        const fromAsset = await resolveAssetToken(signer, chain, reward, fromAssetAddress)
        const toAssetAddress = await resolveAddress(asset, chain)
        const receiverAddress = await resolveAddress(receiver, chain)

        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get Pending rewards
        const { batch, rewards } = await liquidatorContract.pendingRewards(fromAssetAddress, toAssetAddress)
        log(`liquidator:\n  batch: ${batch}\n  rewards: ${formatUnits(rewards, fromAsset.decimals)} ${reward}`)

        // Place Sell Order on CoW Swap API
        const context: CowSwapContext = {
            trader: liquidatorAddress,
            deadline: ONE_DAY,
            chainId: chain,
        }

        const sellOrderParams = {
            fromAsset: fromAssetAddress,
            toAsset: toAssetAddress,
            fromAssetAmount: rewards,
            receiver: receiverAddress,
        }
        log(
            `Sell order params:\n from         : ${fromAssetAddress}\n from amount  : ${formatUnits(
                rewards,
            )}\n to           : ${toAssetAddress}\n receiver     : ${receiverAddress}`,
        )
        const sellOrder = await placeSellOrder(context, sellOrderParams)
        log(`Swap initiated order uid ${sellOrder.orderUid}`)

        // Initiate the order and sign
        const { encodeInitiateSwap } = await import("@utils/peripheral/cowswap")
        const data = encodeInitiateSwap(sellOrder.orderUid, sellOrder.fromAssetFeeAmount, receiverAddress)
        const tx = await liquidatorContract.initiateSwap(fromAssetAddress, toAssetAddress, data)
        // const cowSwapDex = CowSwapDex__factory.connect("0x8E9A9a122F402CD98727128BaF3dCCAF05189B67", signer)
        // const tx = await cowSwapDex["initiateSwap((address,uint256,address,uint256,bytes))"](data)

        await logTxDetails(tx, `liquidator.initiateSwap(${fromAssetAddress}, ${toAssetAddress})`)
    })
task("liq-init-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-settle-swap", "Calls settleSwap on liquidator to account for the swap")
    .addParam("uid", "The order unique identifier to settle", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { liquidator, uid, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)
        const orderOwner = await liquidatorContract.asyncSwapper()

        // Get the order details from cowswap API
        const context: CowSwapContext = {
            chainId: chain,
        }
        const trades = await getOrderDetails(context, uid)

        if (trades.length == 0) {
            throw new Error("Order uid not available")
        }
        const fromAssetAddress = trades[0].sellToken
        const toAssetAddress = trades[0].buyToken
        const toAssetAmount = trades.reduce((prevBuyAmount, curr) => BN.from(prevBuyAmount).add(BN.from(curr.buyAmount)), ZERO)
        // Settle the order
        const { encodeSettleSwap } = await import("@utils/peripheral/cowswap")

        const data = encodeSettleSwap(uid, orderOwner, liquidatorAddress) // orderUid , owner , receiver
        const tx = await liquidatorContract.settleSwap(fromAssetAddress, toAssetAddress, toAssetAmount, data)
        await logTxDetails(tx, `liquidator.settleSwap(${fromAssetAddress}, ${toAssetAddress}, ${toAssetAmount})`)
    })
task("liq-settle-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-sync-swap", "Calls sync swap on liquidator to swap rewards to asset")
    .addParam("reward", "Token symbol or address of the reward to sell", undefined, types.string)
    .addParam("asset", "Token symbol or address of the asset to buy", undefined, types.string)
    .addOptionalParam("liquidator", "Liquidator address override", "LiquidatorV2", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { asset, fromAsset, fromAssetAmount, toAsset, liquidator, reward, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const liquidatorAddress = resolveAddress(liquidator, chain)
        const fromAssetAddress = await resolveAddress(reward, chain)
        const toAssetAddress = await resolveAddress(asset, chain)

        const liquidatorContract = Liquidator__factory.connect(liquidatorAddress, signer)

        // Get Pending rewards
        const { batch, rewards } = await liquidatorContract.pendingRewards(fromAssetAddress, toAssetAddress)
        log(`batch: ${batch}, rewards: ${rewards}`)
        // Get quote
        const router = new OneInchRouter(chain)
        const minAssets = await router.getQuote({
            fromTokenAddress: fromAsset,
            toTokenAddress: toAsset,
            amount: fromAssetAmount,
        })

        // TODO - investigate and encode swaps
        // TODO - add slippage to minAssets
        const { encodeOneInchSwap } = await import("@utils/peripheral/oneInch")
        const data = encodeOneInchSwap(ZERO_ADDRESS, liquidatorAddress, "0x")
        const tx = await liquidatorContract.swap(fromAssetAddress, toAssetAddress, minAssets, data)
        await logTxDetails(tx, `liquidator.swap(${fromAssetAddress}, ${toAssetAddress}, ${minAssets})`)
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
