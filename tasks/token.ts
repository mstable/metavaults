import { MAX_INT128 } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { ERC20__factory, MockERC20__factory } from "types/generated"

import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { logger } from "./utils/logger"
import { getChain, resolveAddress, resolveAssetToken, resolveToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

const log = logger("token")

subtask("token-approve", "Approve address or contract to spend (transferFrom) an amount of tokens from the signer's account")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("assetAddress", "Asset address, overrides lookup of asset parameter", undefined, types.string)
    .addParam("spender", "Address or contract name that will send the transferFrom transaction.", undefined, types.string)
    .addOptionalParam("amount", "Amount to approve. Default is max unit128", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { asset, spender, amount, assetAddress } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetToken = await resolveAssetToken(signer, chain, taskArgs.asset, assetAddress)
        const token = ERC20__factory.connect(assetToken.address, signer)

        const spenderAddress = resolveAddress(spender, chain)
        const amountBN = Number.isInteger(amount) ? simpleToExactAmount(amount, assetToken.decimals) : MAX_INT128

        const tx = await token.approve(spenderAddress, amountBN)
        await logTxDetails(
            tx,
            `${signerAddress} approves ${spenderAddress} to transfer ${formatUnits(amountBN, assetToken.decimals)} ${asset}`,
        )
    })
task("token-approve").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-transfer", "Transfer an amount of tokens from the signer to the recipient")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("assetAddress", "Asset address, overrides lookup of asset parameter", undefined, types.string)
    .addParam("recipient", "Address or contract name the tokens will be sent to.", undefined, types.string)
    .addParam("amount", "Amount to of token to be sent without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, recipient, amount, assetAddress } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const assetToken = await resolveAssetToken(signer, chain, taskArgs.asset, assetAddress)
        const token = ERC20__factory.connect(assetToken.address, signer)

        const recipientAddress = resolveAddress(recipient, chain)
        const amountBN = simpleToExactAmount(amount, assetToken.decimals)

        const desc = `${signerAddress} transfers ${formatUnits(amountBN, assetToken.decimals)} ${taskArgs.asset} to ${recipientAddress}`
        log(`About to send tx ${desc}`)
        const tx = await token.transfer(recipientAddress, amountBN)
        await logTxDetails(tx, desc)
    })
task("token-transfer").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-transfer-from", "Transfer an amount of tokens from the sender to the recipient")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("assetAddress", "Asset address, overrides lookup of asset parameter", undefined, types.string)
    .addParam("sender", "Address or contract name the tokens will be sent from.", undefined, types.string)
    .addParam("recipient", "Address or contract name the tokens will be sent to.", undefined, types.string)
    .addParam("amount", "Amount to of token to be sent without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, sender, recipient, amount, assetAddress } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const assetToken = await resolveAssetToken(signer, chain, taskArgs.asset, assetAddress)
        const token = ERC20__factory.connect(assetToken.address, signer)

        const senderAddress = resolveAddress(sender, chain)
        const recipientAddress = resolveAddress(recipient, chain)
        const amountBN = simpleToExactAmount(amount, assetToken.decimals)

        const tx = await token.transferFrom(senderAddress, recipientAddress, amountBN)
        await logTxDetails(
            tx,
            `${signerAddress} transfers ${formatUnits(amountBN, assetToken.decimals)} ${taskArgs.asset} to ${recipientAddress}`,
        )
    })
task("token-transfer-from").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-allowance", "Logs the amount of tokens a spender can transfer from an owner")
    .addParam("token", "Symbol of the token. eg mUSD, imUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addParam("owner", "Address or contract name where the tokens are held.", undefined, types.string)
    .addParam("spender", "Address or contract name that can transferFrom.", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, owner, spender } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const assetSymbol = taskArgs.token
        const assetToken = resolveToken(taskArgs.token, chain)
        const token = ERC20__factory.connect(assetToken.address, signer)

        const ownerAddress = resolveAddress(owner, chain)
        const spenderAddress = resolveAddress(spender, chain)

        const amount = await token.allowance(ownerAddress, spenderAddress)
        log(`Spender ${spenderAddress} can transfer ${formatUnits(amount, assetToken.decimals)} ${assetSymbol} from ${spenderAddress}`)
    })
task("token-allowance").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-balance", "Logs the token balance of an owner")
    .addParam("token", "Symbol of the token. eg mUSD, imUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addParam("owner", "Address or contract name where the tokens are held.", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, owner } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const assetToken = resolveToken(taskArgs.token, chain)
        const token = ERC20__factory.connect(assetToken.address, signer)

        const ownerAddress = resolveAddress(owner, chain)

        const amount = await token.balanceOf(ownerAddress)
        log(`Balance of ${ownerAddress} is ${formatUnits(amount, assetToken.decimals)} ${taskArgs.token}`)
    })
task("token-balance").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-snap", "Logs the token balance of an owner")
    .addParam("token", "Symbol of the token. eg mUSD, imUSD, GUSD, alUSD, MTA", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const assetToken = resolveToken(taskArgs.token, chain)
        const token = ERC20__factory.connect(assetToken.address, signer)

        const decimals = await token.decimals()
        log(`Symbol      : ${await token.symbol()}`)
        log(`Name        : ${await token.name()}`)
        log(`Decimals    : ${decimals}`)
        log(`Total Supply: ${formatUnits(await token.totalSupply(), decimals)}`)
    })
task("token-snap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-deploy", "Deploys a new mock ERC20 token")
    .addParam("name", "Token name", undefined, types.string)
    .addParam("symbol", "Token symbol", undefined, types.string)
    .addOptionalParam("decimals", "Token decimal places", 18, types.int)
    .addOptionalParam("recipient", "Initial mint recipient", undefined, types.string)
    .addOptionalParam("supply", "Initial mint amount", 1000000, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, name, symbol, decimals, supply } = taskArgs
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()
        const recipient = taskArgs.recipient || signerAddress

        const constructorArguments = [name, symbol, decimals, recipient, supply]
        const token = await deployContract(new MockERC20__factory(signer), `Token ${name} (${symbol})`, constructorArguments)

        await verifyEtherscan(hre, {
            address: token.address,
            contract: "contracts/z_mocks/shared/MockERC20.sol:MockERC20",
            constructorArguments,
        })
        return token
    })
task("token-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

module.exports = {}
