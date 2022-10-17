import { subtask, task, types } from "hardhat/config"
import { Convex3CrvLiquidatorVault__factory, ILiquidatorVault__factory, Mock3CrvLiquidatorVault__factory } from "types/generated"

import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Mock3CrvLiquidatorVault } from "types/generated"

subtask("liq-vault-donate-token", "Get the donation token of a liquidator vault")
    .addParam("vault", "Symbol or address of the vault.", undefined, types.string)
    .addParam("reward", "Symbol or address of the reward token.", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { reward, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const vaultAddress = await resolveAddress(vault, chain)
        const liquidatorVault = ILiquidatorVault__factory.connect(vaultAddress, signer)
        const rewardTokenAddress = await resolveAddress(reward, chain)

        const donateTokenAddress = await liquidatorVault.donateToken(rewardTokenAddress)
        console.log(`Donation token for ${reward} is ${donateTokenAddress}`)
    })
task("liq-vault-donate-token").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-vault-set-donate-token", "Set the donation token of a liquidator vault")
    .addParam("vault", "Symbol or address of the vault.", undefined, types.string)
    .addParam("token", "Symbol or address of the token the rewards are swapped for.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, token, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const vaultAddress = await resolveAddress(vault, chain)
        const convexVault = Convex3CrvLiquidatorVault__factory.connect(vaultAddress, signer)
        const tokenAddress = await resolveAddress(token, chain)

        const tx = await convexVault.setDonateToken(tokenAddress)
        await logTxDetails(tx, `set donate token to ${tokenAddress}`)
    })
task("liq-vault-set-donate-token").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-vault-reward-tokens", "List the reward tokens of a liquidator vault")
    .addParam("vault", "Symbol or address of the vault.", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const vaultAddress = await resolveAddress(vault, chain)
        const liquidatorVault = ILiquidatorVault__factory.connect(vaultAddress, signer)

        const rewardTokens = await liquidatorVault.rewardTokens()
        console.log(`Reward tokens ${rewardTokens}`)
    })
task("liq-vault-reward-tokens").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-vault-collect-rewards", "Collect reward tokens for a liquidator vault")
    .addParam("vault", "Symbol or address of the vault.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const vaultAddress = await resolveAddress(vault, chain)
        const liquidatorVault = ILiquidatorVault__factory.connect(vaultAddress, signer)

        const tx = await liquidatorVault.collectRewards()
        await logTxDetails(tx, `collect rewards from liquidator vault ${vault}`)
    })
task("liq-vault-collect-rewards").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-vault-donate", "Donated tokens to a liquidator vault")
    .addParam("vault", "Symbol or address of the vault.", undefined, types.string)
    .addParam("token", "Symbol or address of the donated token.", undefined, types.string)
    .addParam("amount", "Amount to of tokens to be donated without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { amount, speed, token, vault } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const vaultAddress = await resolveAddress(vault, chain)
        const liquidatorVault = ILiquidatorVault__factory.connect(vaultAddress, signer)
        const donatedToken = resolveToken(token)

        const tx = await liquidatorVault.donate(donatedToken.address, amount)
        await logTxDetails(tx, `donate ${amount} ${donatedToken.symbol}`)
    })
task("liq-vault-donate").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-vault-mock-deploy", "Deploys an instant proxy admin contract")
    .addParam("token", "Symbol or address of the donated token", undefined, types.string)
    .addOptionalParam("nexus", "Nexus address override", "Nexus", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { nexus, token, speed } = taskArgs
        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress(nexus, chain)
        const donatedTokenAddress = resolveAddress(token, chain)
        const constructorArguments = [nexusAddress, donatedTokenAddress]

        const mockVault = await deployContract<Mock3CrvLiquidatorVault>(
            new Mock3CrvLiquidatorVault__factory(signer),
            "Mock3CrvLiquidatorVault",
            constructorArguments,
        )

        await verifyEtherscan(hre, {
            address: mockVault.address,
            contract: "contracts/z_mocks/vault/Mock3CrvLiquidatorVault.sol:Mock3CrvLiquidatorVault",
            constructorArguments,
        })
        return mockVault
    })
task("liq-vault-mock-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})
