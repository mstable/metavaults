import { StandardAccounts } from "@utils/machines"
import { subtask, task, types } from "hardhat/config"

import { config } from "./localhost-config"

import type { Nexus, ProxyAdmin } from "types"

interface CommonDeployed {
    nexus: Nexus
    proxyAdmin: ProxyAdmin
}
interface BasicVaultDeployed extends CommonDeployed {
    vault: string
    asset: string
}

subtask("deploy-core-local", "Deploys common smart contracts")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners()
        const sa = await new StandardAccounts().initAccounts(accounts)

        // Deploy nexus, proxy admin
        const nexus = await hre.run("nexus-deploy", { speed: taskArgs.speed, governor: sa.governor.address })
        const proxyAdmin = await hre.run("proxy-admin-instant-deploy", { speed: taskArgs.speed })

        return { nexus, proxyAdmin }
    })
subtask("deploy-basicVault", "Deploys a basic vault")
    .addParam("nexus", "Nexus address", undefined, types.string)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, types.string)
    .addOptionalParam("recipient", "Initial mint recipient", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners()
        const sa = await new StandardAccounts().initAccounts(accounts)

        const { asset, vault } = config
        const { nexus, proxyAdmin } = taskArgs
        // Deploy token and basic vault
        const token = await hre.run("token-deploy", {
            speed: taskArgs.speed,
            name: asset.name,
            symbol: asset.symbol,
            decimals: asset.decimals,
            supply: asset.supply,
            recipient: taskArgs.recipient,
        })

        const assetAddress = token.address

        const vaultProxy = await hre.run("vault-deploy", {
            speed: taskArgs.speed,
            name: vault.name,
            symbol: vault.symbol,
            asset: assetAddress,
            nexus,
            proxyAdmin,
            vaultManager: sa.vaultManager.address,
        })

        return { nexus, proxyAdmin, asset: token.address, vault: vaultProxy.address }
    })
subtask("deploy-initialize-vault", "Initialize deployed contracts")
    .addOptionalParam("recipient", "Initial mint recipient", undefined, types.string)
    .addOptionalParam("assetAddress", "Asset address, overrides lookup of asset parameter", undefined, types.string)
    .addOptionalParam("vaultAddress", "Asset address, overrides lookup of asset parameter", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const { asset, vault } = config

        await hre.run("token-transfer", {
            speed: taskArgs.speed,
            asset: asset.symbol,
            assetAddress: taskArgs.assetAddress,
            recipient: taskArgs.recipient,
            amount: 100000,
        })
        await hre.run("token-approve", {
            speed: taskArgs.speed,
            asset: asset.symbol,
            assetAddress: taskArgs.assetAddress,
            spender: taskArgs.vaultAddress,
            amount: 100000,
            spenderTokenType: "localhost",
        })
        await hre.run("vault-deposit", {
            speed: taskArgs.speed,
            symbol: vault.symbol,
            vaultAddress: taskArgs.vaultAddress,
            amount: 10000,
            approve: true,
        })
        await hre.run("vault-mint", {
            speed: taskArgs.speed,
            symbol: vault.symbol,
            vaultAddress: taskArgs.vaultAddress,
            amount: 50,
            approve: true,
        })
        await hre.run("vault-redeem", { speed: taskArgs.speed, symbol: vault.symbol, vaultAddress: taskArgs.vaultAddress, amount: 100 })
        await hre.run("vault-withdraw", { speed: taskArgs.speed, symbol: vault.symbol, vaultAddress: taskArgs.vaultAddress, amount: 200 })
    })
task("deploy-full")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners()
        const sa = await new StandardAccounts().initAccounts(accounts)
        // Deploys nexus, proxy admin
        const commonDeployed: CommonDeployed = await hre.run("deploy-core-local", { speed: taskArgs.speed })
        // Deploys basic vault with a token
        const basicVaultDeployed: BasicVaultDeployed = await hre.run("deploy-basicVault", {
            speed: taskArgs.speed,
            recipient: sa.governor.address,
            nexus: commonDeployed.nexus.address,
            proxyAdmin: commonDeployed.proxyAdmin.address,
        })

        const addresses = { ...basicVaultDeployed }
        await hre.run("deploy-initialize-vault", {
            speed: taskArgs.speed,
            recipient: sa.governor.address,
            assetAddress: addresses.asset,
            vaultAddress: addresses.vault,
        })
    })
module.exports = {}
