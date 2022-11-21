import { impersonate } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import {
    AssetPerShareAbstractVault__factory,
    FeeAdminAbstractVault__factory,
    IERC20__factory,
    IERC20Metadata__factory,
    IERC4626Vault__factory,
    PerfFeeAbstractVault__factory,
    PeriodicAllocationAbstractVault__factory,
    SameAssetUnderlyingsAbstractVault__factory,
} from "types/generated"

import { logTxDetails } from "./utils/deploy-utils"
import { logger } from "./utils/logger"
import { getChain, resolveAddress, resolveAssetToken, resolveVaultToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

const log = logger("task:mv")

subtask("mv-set-perf-fee", "Governor sets a vault's performance fee")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("fee", "Fee as a percentage. eg 0.75 = 0.75%", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { fee, vault, speed } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        log(`Using signer ${await signer.getAddress()}`)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PerfFeeAbstractVault__factory.connect(vaultAddress, signer)

        const perfFee = simpleToExactAmount(fee, 6)

        const tx = await metaVault.setPerformanceFee(perfFee)
        await logTxDetails(tx, `${signerAddress} set performance fee of ${fee}% for the ${vault} meta vault`)
    })
task("mv-set-perf-fee").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-charge-perf-fee", "Vault Manager charges a performance fee since the last time a fee was charged")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PerfFeeAbstractVault__factory.connect(vaultAddress, signer)

        const tx = await metaVault.chargePerformanceFee()
        await logTxDetails(tx, `${signerAddress} charged performance fee for the ${vault} meta vault`)

        const receipt = await tx.wait()
        const prefFeeEvent = receipt.events?.find((e) => e.event === "PerformanceFee")
        if (prefFeeEvent) {
            log(`${prefFeeEvent.args.feeReceiver} received ${formatUnits(prefFeeEvent.args.feeShares)} shares as a fee`)
            log(`Fee assets/share updated to ${formatUnits(prefFeeEvent.args.assetsPerShare, 26)}`)
        } else {
            log("No performance fee was charged")
        }
    })
task("mv-charge-perf-fee").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask(
    "mv-set-single-threshold",
    "Governor sets the threshold for large withdrawals that withdraw proportionally from all underlying vaults instead of just from a single configured vault",
)
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("threshold", "Percentage. eg 20% or 2.5%", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, threshold, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PeriodicAllocationAbstractVault__factory.connect(vaultAddress, signer)

        const singleThreshold = simpleToExactAmount(threshold, 2)

        const tx = await metaVault.setSingleVaultSharesThreshold(singleThreshold)
        await logTxDetails(tx, `${signerAddress} set single vault threshold to ${threshold}% for the ${vault} meta vault`)
    })
task("mv-set-single-threshold").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-set-single-source", "Governor sets the underlying vault that small withdrawals are redeemed from")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("index", "Vault index within the meta vault. eg 0, 1, 2...", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, index, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PeriodicAllocationAbstractVault__factory.connect(vaultAddress, signer)

        const tx = await metaVault.setSingleSourceVaultIndex(index)
        await logTxDetails(tx, `${signerAddress} set single vault index to ${index}% for the ${vault} meta vault`)
    })
task("mv-set-single-source").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask(
    "mv-set-asset-per-share-threshold",
    "Governor sets the threshold asset amount of cumulative transfers to/from the vault before the assets per share is updated",
)
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("threshold", "The amount of assets", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, threshold, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PeriodicAllocationAbstractVault__factory.connect(vaultAddress, signer)

        const asset = IERC20Metadata__factory.connect(await metaVault.asset(), signer)
        const assetsPerShareThreshold = simpleToExactAmount(threshold, await asset.decimals())

        const tx = await metaVault.setAssetPerShareUpdateThreshold(assetsPerShareThreshold)
        await logTxDetails(tx, `${signerAddress} set assets/share threshold to ${threshold} for the ${vault} meta vault`)
    })
task("mv-set-asset-per-share-threshold").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-add-vault", "Governor adds a new underlying ERC-4626 compliant vault.")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("underlying", "The symbol or address of the underlying vault that is being added", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, underlying, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PeriodicAllocationAbstractVault__factory.connect(vaultAddress, signer)

        const underlyingAddress = await resolveAddress(underlying, chain)

        const tx = await metaVault.addVault(underlyingAddress)
        await logTxDetails(tx, `${signerAddress} add underlying vault ${underlyingAddress} to the ${vault} meta vault`)
    })
task("mv-add-vault").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-remove-vault", "Governor removes an underlying ERC-4626 compliant vault.")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("index", "Vault index to remove. eg 0, 1, 2...", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, index, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PeriodicAllocationAbstractVault__factory.connect(vaultAddress, signer)

        const tx = await metaVault.removeVault(index)
        await logTxDetails(tx, `${signerAddress} removed underlying indexed vault ${index} from the ${vault} meta vault`)
    })
task("mv-remove-vault").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask(
    "mv-set-fee-receiver",
    "Governor sets the threshold asset amount of cumulative transfers to/from the vault before the assets per share is updated",
)
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam("receiver", "The address that will receive fees", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, receiver, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = FeeAdminAbstractVault__factory.connect(vaultAddress, signer)

        const receiverAddress = resolveAddress(receiver, chain)

        const tx = await metaVault.setFeeReceiver(receiverAddress)
        await logTxDetails(tx, `${signerAddress} set fee receiver to ${receiverAddress} for the ${vault} meta vault`)
    })
task("mv-set-fee-receiver").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-update-asset-per-share", "Vault Manager recalculate the meta vault's assets per share")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = AssetPerShareAbstractVault__factory.connect(vaultAddress, signer)

        log(`old assets/share ${await metaVault.assetsPerShare()}`)

        const tx = await metaVault.updateAssetPerShare()
        await logTxDetails(tx, `${signerAddress} updated the assets per share for the ${vault} meta vault`)

        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "AssetsPerShareUpdated")
        log(`new assets/share ${event.args.assetsPerShare}`)
        log(`new total assets ${event.args.totalAssets}`)
    })
task("mv-update-asset-per-share").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-settle", "Vault Manager invests the assets sitting in the vault to underlying vaults.")
    .addParam("vault", "Symbol or address of the meta vault.", "mv3CRV-CVX", types.string)
    .addParam(
        "underlyings",
        'json array. eg [{"vaultIndex": 3, "assets": 10000},{"vaultIndex": 4, "assets": 20000}]',
        undefined,
        types.json,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, underlyings, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = PeriodicAllocationAbstractVault__factory.connect(vaultAddress, signer)

        const asset = IERC20Metadata__factory.connect(await metaVault.asset(), signer)
        const assetDecimals = await asset.decimals()
        const scaledUnderlyings = underlyings.map((u) => ({
            vaultIndex: u.vaultIndex,
            assets: simpleToExactAmount(u.assets, assetDecimals),
        }))

        const tx = await metaVault.settle(scaledUnderlyings)
        await logTxDetails(tx, `${signerAddress} settle ${vault} meta vault`)
    })
task("mv-settle").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-rebalance", "Vault Manager rebalances the assets in the underlying vaults")
    .addParam("vault", "Symbol or address of the meta vault.", undefined, types.string)
    .addParam(
        "swaps",
        'json array of the underlying vault swaps. eg [{"fromVaultIndex": 1, "toVaultIndex": 2, "assets": 10000, "shares": 200}]',
        undefined,
        types.json,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, swaps, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultAddress = await resolveAddress(vault, chain)
        const metaVault = SameAssetUnderlyingsAbstractVault__factory.connect(vaultAddress, signer)

        const asset = IERC20Metadata__factory.connect(await metaVault.asset(), signer)
        const assetDecimals = await asset.decimals()
        const scaledSwaps = swaps.map((u) => ({
            fromVaultIndex: u.fromVaultIndex,
            toVaultIndex: u.toVaultIndex,
            assets: simpleToExactAmount(u.assets, assetDecimals),
            shares: simpleToExactAmount(u.shares),
        }))

        const tx = await metaVault.rebalance(scaledSwaps)
        await logTxDetails(tx, `${signerAddress} rebalance ${vault} meta vault`)
    })
task("mv-rebalance").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-slippage", "Slippage from a deposit and full redeem")
    .addParam("vault", "Vault symbol or address. eg mvDAI-3PCV or vcx3CRV-FRAX, ", undefined, types.string)
    .addParam("amount", "Amount as vault shares to burn.", undefined, types.float)
    .addOptionalParam("approve", "Will approve the vault to transfer the assets", true, types.boolean)
    .addOptionalParam("metaVault", "Symbol or address of the meta vault.", "mv3CRV-CVX", types.string)
    .addOptionalParam("settle", "Settle the meta vault", false, types.boolean)
    .setAction(async (taskArgs, hre) => {
        const { approve, amount, vault, metaVault, settle, speed } = taskArgs

        if (hre?.network.name === "mainnet") throw Error("Slippage calculation not supported on mainnet. Use a fork instead")

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, vault)
        const vaultContract = IERC4626Vault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol)
        const assetsScaled = simpleToExactAmount(amount, assetToken.decimals)

        if (approve) {
            const assetContract = IERC20__factory.connect(assetToken.address, signer)
            const approveTx = await assetContract.approve(vaultToken.address, assetsScaled)
            await logTxDetails(
                approveTx,
                `approve ${vaultToken.symbol} vault to transfer ${formatUnits(assetsScaled, assetToken.decimals)} ${
                    assetToken.symbol
                } assets`,
            )
        }

        // Deposit
        const tx = await vaultContract.deposit(assetsScaled, signerAddress)
        const receipt = await tx.wait()
        const depositEvent = receipt.events.find((e) => e.event == "Deposit" && e.address == vaultToken.address)
        const shares = depositEvent.args.shares
        log(`Deposit ${amount} ${assetToken.symbol} for ${formatUnits(shares, vaultToken.decimals)} ${vaultToken.symbol} shares`)

        if (settle) {
            const metaVaultAddress = await resolveAddress(metaVault, chain)
            const metaVaultContract = PeriodicAllocationAbstractVault__factory.connect(metaVaultAddress, signer)

            const threeCrvAddress = await resolveAddress("3Crv", chain)
            const threeCrvContract = IERC20Metadata__factory.connect(threeCrvAddress, signer)
            const threeCrvInMetaVault = await threeCrvContract.balanceOf(metaVaultAddress)

            const settlements = [
                {
                    vaultIndex: 0,
                    assets: threeCrvInMetaVault.div(3),
                },
                {
                    vaultIndex: 1,
                    assets: threeCrvInMetaVault.div(3),
                },
                {
                    vaultIndex: 2,
                    assets: threeCrvInMetaVault.div(3),
                },
            ]

            const vaultManagerSigner = await impersonate(resolveAddress("VaultManager", chain))
            const settleTx = await metaVaultContract.connect(vaultManagerSigner).settle(settlements)
            await logTxDetails(settleTx, `${signerAddress} settle ${vault} meta vault`)
        }

        // Redeem
        const redeemedAssets = await vaultContract.callStatic.redeem(shares, signerAddress, signerAddress)
        log(
            `Redeemed ${formatUnits(redeemedAssets, assetToken.decimals)} ${assetToken.symbol} from ${formatUnits(
                shares,
                vaultToken.decimals,
            )} ${vaultToken.symbol} shares`,
        )
        const diff = redeemedAssets.sub(assetsScaled)
        const diffPercentage = diff.mul(1000000).div(assetsScaled)

        log(
            `Deposit ${formatUnits(assetsScaled, assetToken.decimals)} ${assetToken.symbol}, redeemed ${formatUnits(
                redeemedAssets,
                assetToken.decimals,
            )} ${assetToken.symbol} diff ${formatUnits(diff, assetToken.decimals)} ${formatUnits(diffPercentage, 4)}%`,
        )
    })
task("vault-slippage").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
