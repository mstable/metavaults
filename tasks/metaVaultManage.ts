import { simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import {
    AssetPerShareAbstractVault__factory,
    FeeAdminAbstractVault__factory,
    IERC20Metadata__factory,
    PerfFeeAbstractVault__factory,
    PeriodicAllocationAbstractVault__factory,
} from "types/generated"

import { logTxDetails } from "./utils/deploy-utils"
import { logger } from "./utils/logger"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

const log = logger("tasks:mv")

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

        const tx = await metaVault.updateAssetPerShare()
        await logTxDetails(tx, `${signerAddress} updated the assets per share for the ${vault} meta vault`)
    })
task("mv-update-asset-per-share").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
