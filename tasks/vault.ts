import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, BasicVault__factory, ERC20__factory, IERC20__factory, IERC4626Vault__factory } from "types/generated"

import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { logger } from "./utils/logger"
import { getChain, resolveAddress, resolveAssetToken, resolveToken, resolveVaultToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { AssetProxy, BasicVault, ERC20, IERC4626Vault } from "types/generated"

const log = logger("vault")

subtask("vault-deposit", "Deposit assets into a vault from the signer's account")
    .addParam("symbol", "Token symbol of the vault. eg imUSD, ", undefined, types.string)
    .addParam("amount", "Amount as assets to deposit.", undefined, types.float)
    .addOptionalParam("approve", "Will approve the vault to transfer the assets", false, types.boolean)
    .addOptionalParam(
        "receiver",
        "Address or contract name that the vault tokens will be minted to. Default to the signer's address",
        undefined,
        types.string,
    )
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, receiver, amount, approve, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, vaultAddress)
        const vault = IERC4626Vault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol, vaultToken.assetAddress)

        const receiverAddress = receiver ? resolveAddress(receiver, chain) : signerAddress
        const assets = simpleToExactAmount(amount, assetToken.decimals)

        if (approve) {
            const asset = IERC20__factory.connect(assetToken.address, signer)
            const approveTx = await asset.approve(vaultToken.address, assets)
            await logTxDetails(approveTx, `approve ${vaultToken.symbol} vault to transfer ${vaultToken.assetSymbol} assets`)
        }

        const tx = await vault.deposit(assets, receiverAddress)
        await logTxDetails(
            tx,
            `${signerAddress} deposited ${formatUnits(assets, vaultToken.decimals)} ${
                vaultToken.assetSymbol
            } into ${symbol} vault minting to ${receiverAddress}`,
        )
        const receipt = await tx.wait()
        const event = receipt.events.find((e) => e.event == "Deposit")
        log(`${formatUnits(event.args.shares, vaultToken.decimals)} shares minted`)
    })
task("vault-deposit").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-mint", "Mint vault shares by depositing assets from the signer's account")
    .addParam("symbol", "Token symbol of the vault. eg imUSD, ", undefined, types.string)
    .addParam("amount", "Amount as vault shares to mint.", undefined, types.float)
    .addOptionalParam("approve", "Will approve the vault to transfer the assets", false, types.boolean)
    .addOptionalParam(
        "receiver",
        "Address or contract name that the vault tokens will be minted to. Default to the signer's address",
        undefined,
        types.string,
    )
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, receiver, amount, approve, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, vaultAddress)
        const vault = IERC4626Vault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol, vaultToken.assetAddress)

        const receiverAddress = receiver ? resolveAddress(receiver, chain) : signerAddress
        const shares = simpleToExactAmount(amount, vaultToken.decimals)

        if (approve) {
            const assets = await vault.previewMint(shares)
            const asset = IERC20__factory.connect(assetToken.address, signer)
            const approveTx = await asset.approve(vaultToken.address, assets)
            await logTxDetails(approveTx, `approve ${vaultToken.symbol} vault to transfer ${vaultToken.assetSymbol} assets`)
        }

        const tx = await vault.deposit(shares, receiverAddress)
        await logTxDetails(tx, `${signerAddress} minted ${formatUnits(shares, vaultToken.decimals)} ${symbol} shares to ${receiverAddress}`)
        const receipt = await tx.wait()
        const event = receipt.events.find((e) => e.event == "Deposit")
        log(`${formatUnits(event.args.assets, assetToken.decimals)} assets deposited`)
    })
task("vault-mint").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-withdraw", "Withdraw assets from a vault.")
    .addParam("symbol", "Token symbol of the vault. eg imUSD, ", undefined, types.string)
    .addParam("amount", "Amount as assets to withdraw.", undefined, types.float)
    .addOptionalParam(
        "receiver",
        "Address or contract name that the vault tokens will be minted to. Default to the signer's address",
        undefined,
        types.string,
    )
    .addOptionalParam(
        "owner",
        "Address or contract name of the vault share's owner. Default to the signer's address",
        undefined,
        types.string,
    )
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, receiver, owner, amount, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, vaultAddress)
        const vault = IERC4626Vault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol, vaultToken.assetAddress)

        const ownerAddress = owner ? resolveAddress(owner, chain) : signerAddress
        const receiverAddress = owner ? resolveAddress(receiver, chain) : signerAddress
        const assets = simpleToExactAmount(amount, assetToken.decimals)

        const tx = await vault.withdraw(assets, receiverAddress, ownerAddress)
        await logTxDetails(
            tx,
            `${signerAddress} withdrew ${formatUnits(assets, assetToken.decimals)} ${
                vaultToken.assetSymbol
            } from ${symbol} vault and owner ${ownerAddress} to ${receiverAddress}`,
        )
        const receipt = await tx.wait()
        const event = receipt.events.find((e) => e.event == "Withdraw")
        log(`${formatUnits(event.args.shares, vaultToken.decimals)} shares burnt`)
    })
task("vault-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-redeem", "Redeem vault shares from a vault.")
    .addParam("symbol", "Token symbol of the vault. eg imUSD, ", undefined, types.string)
    .addParam("amount", "Amount as vault shares to burn.", undefined, types.float)
    .addOptionalParam(
        "receiver",
        "Address or contract name that the withdrawn asset tokens will be sent to. Default to the signer's address",
        undefined,
        types.string,
    )
    .addOptionalParam(
        "owner",
        "Address or contract name of the vault share's owner. Default to the signer's address",
        undefined,
        types.string,
    )
    .addOptionalParam("vaultAddress", "Vault address, overrides lookup of symbol parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { symbol, receiver, owner, amount, speed, vaultAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const vaultToken = await resolveVaultToken(signer, chain, symbol, vaultAddress)
        const vault = IERC4626Vault__factory.connect(vaultToken.address, signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol, vaultToken.assetAddress)

        const ownerAddress = owner ? resolveAddress(owner, chain) : signerAddress
        const receiverAddress = receiver ? resolveAddress(receiver, chain) : signerAddress
        const shares = simpleToExactAmount(amount, vaultToken.decimals)

        const tx = await vault.redeem(shares, receiverAddress, ownerAddress)
        await logTxDetails(
            tx,
            `${signerAddress} redeemed ${formatUnits(
                shares,
                vaultToken.decimals,
            )} ${symbol} shares from ${ownerAddress} to ${receiverAddress}`,
        )
        const receipt = await tx.wait()
        const event = receipt.events.find((e) => e.event == "Withdraw")
        log(`${formatUnits(event.args.assets, assetToken.decimals)} assets withdrawn`)
    })
task("vault-redeem").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-balance", "Logs the vault balance of an owner")
    .addParam("symbol", "Symbol of the vault. eg imUSD, ", undefined, types.string)
    .addOptionalParam(
        "owner",
        "Address or contract name of the vault share's owner. Default to the signer's address",
        undefined,
        types.string,
    )
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const vaultToken = resolveToken(taskArgs.symbol, chain)
        const vault = ERC20__factory.connect(vaultToken.address, signer)

        const ownerAddress = resolveAddress(taskArgs.owner, chain)

        const amount = await vault.balanceOf(ownerAddress)
        log(`Share balance of ${ownerAddress} is ${formatUnits(amount, vaultToken.decimals)} ${taskArgs.symbol}`)
    })
task("vault-balance").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-snap", "Logs vault details")
    .addParam("symbol", "Symbol of the vault. eg imUSD", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const vaultToken = resolveToken(taskArgs.symbol, chain)
        const vault = IERC4626Vault__factory.connect(vaultToken.address, signer) as ERC20 & IERC4626Vault

        const decimals = await vault.decimals()
        log(`Asset       : ${await vault.asset()}`)
        log(`Symbol      : ${await vault.symbol()}`)
        log(`Name        : ${await vault.name()}`)
        log(`Decimals    : ${decimals}`)
        log(`Total Supply: ${formatUnits(await vault.totalSupply(), decimals)}`)
        log(`Total Assets: ${formatUnits(await vault.totalAssets(), decimals)}`)
    })
task("vault-snap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-deploy", "Deploys a basic vault for testing")
    .addParam("name", "Vault name", undefined, types.string)
    .addParam("symbol", "Vault symbol", undefined, types.string)
    .addParam("asset", "Token symbol or address of the vault's asset", undefined, types.string)
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("proxyAdmin", "ProxyAdmin address, overrides lookup", "InstantProxyAdmin", types.string)
    .addOptionalParam("vaultManager", "VaultManager address, overrides lookup", "VaultManager", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, name, symbol, asset, nexus, proxyAdmin, vaultManager } = taskArgs
        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress(nexus, chain)
        const proxyAdminAddress = resolveAddress(proxyAdmin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)
        const assetAddress = resolveAddress(asset, chain)

        // Vault
        const vaultConstructorArguments = [nexusAddress, assetAddress]
        const vaultImpl = await deployContract<BasicVault>(
            new BasicVault__factory(signer),
            `Vault ${name} (${symbol})`,
            vaultConstructorArguments,
        )

        await verifyEtherscan(hre, {
            address: vaultImpl.address,
            contract: "contracts/vault/BasicVault.sol:BasicVault",
            constructorArguments: vaultConstructorArguments,
        })

        // Proxy
        const data = vaultImpl.interface.encodeFunctionData("initialize", [name, symbol, vaultManagerAddress])
        const proxyConstructorArguments = [vaultImpl.address, proxyAdminAddress, data]
        const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

        await verifyEtherscan(hre, {
            address: proxy.address,
            contract: "contracts/upgradability/Proxies.sol:AssetProxy",
            constructorArguments: proxyConstructorArguments,
        })
        return proxy
    })
task("vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

module.exports = {}
