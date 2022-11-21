import { setBalance, setStorageAt } from "@nomicfoundation/hardhat-network-helpers"
import { logger } from "@tasks/utils/logger"
import { utils } from "ethers"

import { BN, simpleToExactAmount } from "./math"

import type { Signer } from "ethers"
import type { Account, ERC20 } from "types"

const log = logger("fork")

type Fixture<T> = () => Promise<T>

// impersonates a specific account
export const impersonate = async (addr: string, fund = true): Promise<Signer> => {
    // Dynamic import hardhat module to avoid importing while hardhat config is being defined.
    // The error this avoids is:
    // Error HH9: Error while loading Hardhat's configuration.
    // You probably tried to import the "hardhat" module from your config or a file imported from it.
    // This is not possible, as Hardhat can't be initialized while its config is being defined.
    const { network, ethers } = await import("hardhat")
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    if (fund) {
        // Give the account 10 Ether
        await setBalance(addr, simpleToExactAmount(10))
    }
    return ethers.provider.getSigner(addr)
}

export const impersonateAccount = async (address: string, fund = true): Promise<Account> => {
    const signer = await impersonate(address, fund)
    return {
        signer,
        address,
    }
}

export const toBytes32 = (bn: BN): string => utils.hexlify(utils.zeroPad(bn.toHexString(), 32))

/**
 *
 * Based on https://blog.euler.finance/brute-force-storage-layout-discovery-in-erc20-contracts-with-hardhat-7ff9342143ed
 * @export
 * @param {string} tokenAddress
 * @return {*}  {Promise<number>}
 */
export const findBalancesSlot = async (tokenAddress: string): Promise<number> => {
    const { ethers, network } = await import("hardhat")

    const encode = (types, values) => ethers.utils.defaultAbiCoder.encode(types, values)

    const account = ethers.constants.AddressZero
    const probeA = encode(["uint"], [1])
    const probeB = encode(["uint"], [2])
    const token = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenAddress)

    for (let i = 0; i < 100; i += 1) {
        const probedSlot = ethers.utils.keccak256(encode(["address", "uint"], [account, i]))
        if (probedSlot.startsWith("0x0")) continue
        // remove padding for JSON RPC
        // while (probedSlot.startsWith("0x0")) {
        //     probedSlot = `0x${probedSlot.slice(3)}`
        // }

        const prev = await network.provider.send("eth_getStorageAt", [tokenAddress, probedSlot, "latest"])
        // make sure the probe will change the slot value
        const probe = prev === probeA ? probeB : probeA

        await setStorageAt(tokenAddress, probedSlot, probe)

        const balance = await token.balanceOf(account)
        // reset to previous value
        await setStorageAt(tokenAddress, probedSlot, prev)
        if (balance.eq(ethers.BigNumber.from(probe))) return i
    }
    throw new Error("Balances slot not found!")
}
/**
 * Set the Balance of a user undere an ERC20 token
 *
 * @param {string} userAddress
 * @param {string} tokenAddress
 * @param {BN} amount
 * @param {string} [slotIndex]
 * @return {*}  {Promise<void>}
 */
export const setTokenBalance = async (userAddress: string, tokenAddress: string, amount: BN, slotIndex?: string): Promise<void> => {
    let index = slotIndex
    if (slotIndex === undefined) {
        const balanceSlot = await findBalancesSlot(tokenAddress)
        // key, slot
        index = utils.solidityKeccak256(["uint256", "uint256"], [userAddress, balanceSlot])
    }

    log(`Setting balance of user  ${userAddress} with token ${tokenAddress} at index ${index}`)
    await setStorageAt(tokenAddress, toBytes32(BN.from(index)), toBytes32(amount).toString())
}
/**
 * Load a fixture only if the network is Hardhat otherwise it calls directly the fixture function.
 * This avoid errors if the network is anvil or other different from hardhat.
 *
 * @export
 * @template T
 * @param {Fixture<T>} fixture
 * @return {*}  {Promise<T>}
 */
export async function loadOrExecFixture<T>(fixture: Fixture<T>): Promise<T> {
    const { network } = await import("hardhat")
    const { loadFixture } = await import("@nomicfoundation/hardhat-network-helpers")

    if (network.name.toLowerCase() === "hardhat") {
        return loadFixture(fixture)
    } else {
        return fixture()
    }
}

/**
 * Sets balance to a given account
 *
 * @param {Account} account to set balance
 * @param {[ERC20]} tokensTransfer Tokens that sets the balance by token.transfer tx
 * @param {{
 *         musdTokenAddress: string, usdcTokenAddress: string, daiTokenAddress: string, usdtTokenAddress: string
 *     }} tokensStorage Tokens that sets the balance by manipulation of their storage
 * @param {number} [amount=10000] Amount of tokens to set
 */
export async function setBalancesToAccount(
    account: Account,
    tokensTransfer: Array<ERC20>,
    tokensStorage: {
        musdTokenAddress: string
        usdcTokenAddress: string
        daiTokenAddress: string
        usdtTokenAddress: string
    },
    amount = 10000,
) {
    const { musdTokenAddress, usdcTokenAddress, daiTokenAddress, usdtTokenAddress } = tokensStorage

    await Promise.all(tokensTransfer.map((token) => token.transfer(account.address, simpleToExactAmount(amount))))

    // Set balance directly by manipulating the contract storage
    await setTokenBalance(
        account.address,
        musdTokenAddress,
        simpleToExactAmount(amount),
        "0xa9b759fed45888fb7af7fd8c229074535d6dd9f041494f8276fb277331ee6b1a",
    )
    await setTokenBalance(
        account.address,
        usdcTokenAddress,
        simpleToExactAmount(amount),
        "0xe5edfbb1a168440ed929bb6e6e846a69c257cb12652e468fc03b05a005956076",
    )
    await setTokenBalance(
        account.address,
        daiTokenAddress,
        simpleToExactAmount(amount),
        "0xabc891fafcb542a415fddaa6995544b58e8a23eba34a9a8e87af53857c0f1bfc",
    )
    await setTokenBalance(
        account.address,
        usdtTokenAddress,
        simpleToExactAmount(amount),
        "0xbc40fbf4394cd00f78fae9763b0c2c71b21ea442c42fdadc5b720537240ebac1",
    )
}
