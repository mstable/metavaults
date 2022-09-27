import { simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import {
    AssetPerShareAbstractVault__factory,
    FeeAdminAbstractVault__factory,
    PerfFeeAbstractVault__factory,
    PeriodicAllocationAbstractVault__factory,
} from "types/generated"

import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress, resolveAssetToken, resolveVaultToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

subtask("mv-set-pref-fee", "Sets a vault's performance fee")
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("fee", "Fee as a percentage. eg 0.75 = 0.75%", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, fee, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PerfFeeAbstractVault__factory.connect(vaultToken.address, signer)

        const perfFee = simpleToExactAmount(fee, 6)

        const tx = await vault.setPerformanceFee(perfFee)
        await logTxDetails(tx, `${signerAddress} set performance fee of ${fee}% for the ${symbol} meta vault`)
    })
task("mv-set-pref-fee").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-charge-pref-fee", "Charges a performance fee since the last time a fee was charged")
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PerfFeeAbstractVault__factory.connect(vaultToken.address, signer)

        const tx = await vault.chargePerformanceFee()
        await logTxDetails(tx, `${signerAddress} charged performance fee for the ${symbol} meta vault`)
    })
task("mv-charge-pref-fee").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask(
    "mv-set-single-threshold",
    "Sets the threshold for large withdrawals that withdraw proportionally from all underlying vaults instead of just from a single configured vault",
)
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("threshold", "Percentage. eg 20% or 2.5%", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, threshold, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PeriodicAllocationAbstractVault__factory.connect(vaultToken.address, signer)

        const singleThreshold = simpleToExactAmount(threshold, 2)

        const tx = await vault.setSingleVaultSharesThreshold(singleThreshold)
        await logTxDetails(tx, `${signerAddress} set single vault threshold to ${threshold}% for the ${symbol} meta vault`)
    })
task("mv-set-single-threshold").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-set-single-source", "Sets the underlying vault that small withdrawals are redeemed from")
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("index", "Vault index within the meta vault. eg 0, 1, 2...", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, index, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PeriodicAllocationAbstractVault__factory.connect(vaultToken.address, signer)

        const tx = await vault.setSingleSourceVaultIndex(index)
        await logTxDetails(tx, `${signerAddress} set single vault index to ${index}% for the ${symbol} meta vault`)
    })
task("mv-set-single-source").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask(
    "mv-set-asset-per-share-threshold",
    "Sets the threshold asset amount of cumulative transfers to/from the vault before the assets per share is updated",
)
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("threshold", "The amount of assets", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, threshold, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PeriodicAllocationAbstractVault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.asset, "address", vaultToken.asset)

        const assetsPerShareThreshold = simpleToExactAmount(threshold, assetToken.decimals)

        const tx = await vault.setAssetPerShareUpdateThreshold(assetsPerShareThreshold)
        await logTxDetails(tx, `${signerAddress} set assets/share threshold to ${threshold} for the ${symbol} meta vault`)
    })
task("mv-set-asset-per-share-threshold").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-add-vault", "Adds a new underlying ERC-4626 compliant vault.")
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("underlying", "The symbol of the underlying vault that is being added", undefined, types.string)
    .addOptionalParam("underlyingAddress", "The contract address of the underlying vault that is being added", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, underlying, underlyingAddress, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PeriodicAllocationAbstractVault__factory.connect(vaultToken.address, signer)

        const underlyingVaultToken = await resolveVaultToken(signer, chain, underlying, "address", underlyingAddress)

        const tx = await vault.addVault(underlyingVaultToken.address)
        await logTxDetails(tx, `${signerAddress} add underlying vault ${underlyingVaultToken.address} to the ${symbol} meta vault`)
    })
task("mv-add-vault").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-remove-vault", "Removes an underlying ERC-4626 compliant vault.")
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("index", "Vault index to remove. eg 0, 1, 2...", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, index, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = PeriodicAllocationAbstractVault__factory.connect(vaultToken.address, signer)

        const tx = await vault.removeVault(index)
        await logTxDetails(tx, `${signerAddress} removed underlying indexed vault ${index} from the ${symbol} meta vault`)
    })
task("mv-remove-vault").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask(
    "mv-set-fee-receiver",
    "Sets the threshold asset amount of cumulative transfers to/from the vault before the assets per share is updated",
)
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addParam("receiver", "The address that will receive fees", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, receiver, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = FeeAdminAbstractVault__factory.connect(vaultToken.address, signer)

        const receiverAddress = resolveAddress(receiver, chain)

        const tx = await vault.setFeeReceiver(receiverAddress)
        await logTxDetails(tx, `${signerAddress} set fee receiver to ${receiverAddress} for the ${symbol} meta vault`)
    })
task("mv-set-fee-receiver").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("mv-update-asset-per-share", "Recalculate the meta vault's assets per share")
    .addParam("symbol", "Token symbol of the meta vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, "address", vaultAddress)
        const vault = AssetPerShareAbstractVault__factory.connect(vaultToken.address, signer)

        const tx = await vault.updateAssetPerShare()
        await logTxDetails(tx, `${signerAddress} updated the assets per share for the ${symbol} meta vault`)
    })
task("mv-update-asset-per-share").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
