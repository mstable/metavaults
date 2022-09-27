import { ethereumAddress } from "@utils/regex"
import { IERC20Metadata__factory, IERC4626Vault__factory } from "types"

import { logger } from "./logger"
import { Chain, tokens } from "./tokens"

import type { Signer } from "ethers"

import type { AssetAddressTypes, Token } from "./tokens"

const log = logger("addresses")

// TODO - clean this list of names
export const contractNames = [
    "Nexus",
    "DelayedProxyAdmin",
    "InstantProxyAdmin",
    "ProtocolDAO",
    "Governor",
    "VaultManager",
    "FundManager",
    "mStableDAO",
    "BadgerSafe",
    "SavingsManager",
    "Liquidator",
    // Will become the EmissionsController
    "RewardsDistributor",
    "EmissionsController",
    "PolygonPoSBridge",
    "PolygonRootChainManager",
    "PolygonChildChainManager",
    "BoostDirector",
    "VoterProxy",
    "Collector",
    "Ejector",
    "Poker",
    "SaveWrapper",
    "RevenueRecipient",
    "RevenueBuyBack",
    "MassetManager",
    "FeederManager",
    "FeederLogic",
    "FeederWrapper",
    "FeederInterestValidator",
    "BasketManager", // Legacy mUSD contract
    "SignatureVerifier",
    "QuestManager",
    "QuestMaster",
    "QuestSigner",
    "StakedTokenMTA",
    "StakedTokenBPT",
    "PlatformTokenVendorFactory",
    "BalancerVault",
    "BalancerRecipient",
    "BalancerStakingPoolId",
    "AaveIncentivesController",
    "AaveLendingPoolAddressProvider",
    "AlchemixStakingPool",
    "CompController",
    "Disperse",
    "DisperseForwarder",
    "QuickSwapRouter",
    "UniswapRouterV3",
    "UniswapQuoterV3",
    "UniswapEthToken",
    "UniswapV2-MTA/WETH",
    "MStableYieldSource", // Used for PoolTogether
    "OperationsSigner",
    "ENSRegistrarController",
    "ENSResolver",
    "FraxVault",
    "VisorRouter",
    "VotiumBribe",
    "VotiumForwarder",
    // v2
    "GPv2VaultRelayer",
    "GPv2Settlement",
    "CowSwapDex",
    // Pools
    "CurveMUSDPool",
    "CurveThreePool",
    "FraxBP",
    "CRVRewardsPool",
    "ConvexBooster",
    "OneInchAggregationRouterV4",
    "OneInchAggregationExecutor",
] as const
export type ContractNames = typeof contractNames[number]

export interface HardhatRuntime {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethers?: any
    hardhatArguments?: {
        config?: string
    }
    network?: {
        name: string
    }
}

export const getChainAddress = (contractName: ContractNames, chain: Chain): string => {
    if (chain === Chain.mainnet) {
        switch (contractName) {
            case "Nexus":
                return "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
            case "DelayedProxyAdmin":
                return "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
            case "InstantProxyAdmin":
                return "0x3517F5a251d56C768789c22E989FAa7d906b5a13"
            case "ProtocolDAO":
            case "Governor":
                return "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
            case "mStableDAO":
                return "0x3dd46846eed8D147841AE162C8425c08BD8E1b41"
            case "OperationsSigner":
                return "0xB81473F20818225302b8FfFB905B53D58a793D84"
            case "Liquidator":
                // the V1 Unliquidator
                return "0xC643B9D66C68d06EA844251a441A0a1211E60656"
            // V2
            case "GPv2VaultRelayer":
                return "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
            case "GPv2Settlement":
                return "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
            case "CurveThreePool": // Curve.fi: DAI/USDC/USDT Pool
                return "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
            case "FraxBP": // Curve FRAX+USDC pool
                return "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2"
            case "CurveMUSDPool": // Curve.fi: MUSD Pool
                return "0x8474DdbE98F5aA3179B3B3F5942D724aFcdec9f6"
            case "CRVRewardsPool":
                return "0xDBFa6187C79f4fE4Cda20609E75760C5AaE88e52"
            case "ConvexBooster": // Convex Finance: Booster
                return "0xF403C135812408BFbE8713b5A23a04b3D48AAE31"
            case "OneInchAggregationRouterV4":
                return "0x1111111254fb6c44bAC0beD2854e76F90643097d"
            case "OneInchAggregationExecutor":
                return "0xF2F400C138F9fb900576263af0BC7fCde2B1b8a8"
            default:
        }
    } else if (chain === Chain.polygon) {
        switch (contractName) {
            case "Nexus":
                return "0x3C6fbB8cbfCB75ecEC5128e9f73307f2cB33f2f6"
            case "DelayedProxyAdmin":
                return "0xCb6E4B67f2cac15c284AB49B6a4A671cdfe66711"
            case "ProtocolDAO":
            case "Governor":
                return "0x429F29A3A36B1B977C3d4Ec77C695c3391e7B9ED"
            case "OperationsSigner":
                return "0xdccb7a6567603af223c090be4b9c83eced210f18"
            default:
        }
    } else if (chain === Chain.mumbai) {
        switch (contractName) {
            case "Nexus":
                return "0xCB4aabDb4791B35bDc9348bb68603a68a59be28E"
            case "DelayedProxyAdmin":
                return "0x41E4fF04e6f931f6EA71C7138A79a5B2B994eF19"
            case "ProtocolDAO":
            case "Governor":
                return "0xE1304aA964C5119C98E8AE554F031Bf3B21eC836"
            default:
        }
    } else if (chain === Chain.ropsten) {
        switch (contractName) {
            case "Nexus":
                return "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB"
            case "DelayedProxyAdmin":
                return "0x2d369F83E9DC764a759a74e87a9Bc542a2BbfdF0"
            case "OperationsSigner":
                return "0xb805220e070bca63441233a1ca569afe392bb840"
            default:
        }
    } else if (chain === Chain.goerli) {
        switch (contractName) {
            case "Nexus":
                return "0x6691100F1D53e86d4991d823c397094f12996D8E"
            case "Governor":
            case "VaultManager":
            case "OperationsSigner":
                return "0xd003d06Af32242224B325bbe8630181317206C2c"
            case "InstantProxyAdmin":
                return "0xC06B8183A6BC9FCa36B760f4B460aE3140cc6bD4"
            case "DelayedProxyAdmin":
                return "0xdE0Fe341e324184d177617495F8D6d40b9edCe16"
            default:
        }
    } else if (chain === Chain.rinkeby) {
        switch (contractName) {
            // V2
            case "GPv2VaultRelayer":
                return "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
            case "GPv2Settlement":
                return "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
            case "CowSwapDex":
                return "0x930a3dd309f91fabc45281dff9ab3a9b7b6692ed"
            default:
        }
    }

    return undefined
}

export const getChain = (hre: HardhatRuntime = {}): Chain => {
    if (hre?.network.name === "mainnet" || hre?.hardhatArguments?.config === "tasks-fork.config.ts") {
        return Chain.mainnet
    }
    if (hre?.network.name === "polygon_mainnet" || hre?.hardhatArguments?.config === "tasks-fork-polygon.config.ts") {
        return Chain.polygon
    }
    if (hre?.network.name === "polygon_testnet") {
        return Chain.mumbai
    }
    if (hre?.network.name === "ropsten") {
        return Chain.ropsten
    }
    if (hre?.network.name === "rinkeby") {
        return Chain.rinkeby
    }
    if (hre?.network.name === "goerli") {
        return Chain.goerli
    }
    return Chain.mainnet
}

export const getNetworkAddress = (contractName: ContractNames, hre: HardhatRuntime = {}): string => {
    const chain = getChain(hre)
    return getChainAddress(contractName, chain)
}

// Singleton instances of different contract names and token symbols
const resolvedAddressesInstances: { [contractNameSymbol: string]: { [tokenType: string]: string } } = {}

// Update the singleton instance so we don't need to resolve this next time
const updateResolvedAddresses = (addressContractNameSymbol: string, tokenType: AssetAddressTypes, address: string) => {
    if (resolvedAddressesInstances[addressContractNameSymbol]) {
        resolvedAddressesInstances[addressContractNameSymbol][tokenType] = address
    } else {
        resolvedAddressesInstances[addressContractNameSymbol] = { [tokenType]: address }
    }
}

// Resolves a contract name or token symbol to an ethereum address
export const resolveAddress = (
    addressContractNameSymbol: string,
    chain = Chain.mainnet,
    tokenType: AssetAddressTypes = "address",
): string => {
    let address = addressContractNameSymbol
    // If not an Ethereum address
    if (!addressContractNameSymbol.match(ethereumAddress) && tokenType !== "localhost") {
        // If previously resolved then return from singleton instances
        if (resolvedAddressesInstances[addressContractNameSymbol]?.[tokenType])
            return resolvedAddressesInstances[addressContractNameSymbol][tokenType]

        // If an mStable contract name
        address = getChainAddress(addressContractNameSymbol as ContractNames, chain)

        if (!address) {
            // If a token Symbol
            const token = tokens.find((t) => t.symbol === addressContractNameSymbol && t.chain === chain)
            if (!token) throw Error(`Invalid address, token symbol or contract name "${addressContractNameSymbol}" for chain ${chain}`)
            if (!token[tokenType])
                throw Error(`Can not find token type "${tokenType}" for "${addressContractNameSymbol}" on chain ${chain}`)

            address = token[tokenType]
            log(`Resolved asset with symbol "${addressContractNameSymbol}" and type "${tokenType}" to address ${address}`)

            // Update the singleton instance so we don't need to resolve this next time
            updateResolvedAddresses(addressContractNameSymbol, tokenType, address)
            return address
        }

        log(`Resolved contract name "${addressContractNameSymbol}" to address ${address}`)

        // Update the singleton instance so we don't need to resolve this next time
        updateResolvedAddresses(addressContractNameSymbol, tokenType, address)

        return address
    }
    return address
}

// Singleton instances of different contract names and token symbols
const resolvedTokenInstances: { [address: string]: { [tokenType: string]: Token } } = {}

export const resolveToken = (symbol: string, chain = Chain.mainnet, tokenType: AssetAddressTypes = "address"): Token => {
    // If previously resolved then return from singleton instances
    if (resolvedTokenInstances[symbol]?.[tokenType]) return resolvedTokenInstances[symbol][tokenType]

    // If a token Symbol
    const token = tokens.find((t) => t.symbol === symbol && t.chain === chain)
    if (!token) throw Error(`Can not find token symbol ${symbol} on chain ${chain}`)
    if (!token[tokenType]) throw Error(`Can not find token type "${tokenType}" for ${symbol} on chain ${chain}`)

    log(`Resolved token symbol ${symbol} and type "${tokenType}" to address ${token[tokenType]}`)

    if (resolvedTokenInstances[symbol]) {
        resolvedTokenInstances[symbol][tokenType] = token
    } else {
        resolvedTokenInstances[symbol] = { [tokenType]: token }
    }

    return token
}

/**
 * Resolves a vault by symbol or by its address if it is provided.
 *
 * @param {Signer} signer
 * @param {Chain} chain
 * @param {string} symbol
 * @param {AssetAddressTypes} tokenType
 * @param {string} [address]
 * @return {*}  {Promise<Token>}
 */
export const resolveVaultToken = async (
    signer: Signer,
    chain: Chain,
    symbol: string,
    tokenType: AssetAddressTypes,
    address?: string,
): Promise<Token> => {
    let token: Token
    if (address !== undefined) {
        const tkn = IERC20Metadata__factory.connect(address, signer)
        const vault = IERC4626Vault__factory.connect(address, signer)
        token = {
            symbol: symbol,
            address: address,
            chain,
            quantityFormatter: "USD",
            asset: await vault.asset(),
            decimals: await tkn.decimals(),
        }
    } else {
        token = await resolveToken(symbol, chain, tokenType)
    }

    return token
}
/**
 * Resolves a token by symbol or by its address if it is provided.
 *
 * @param {Signer} signer
 * @param {Chain} chain
 * @param {string} symbol
 * @param {AssetAddressTypes} tokenType
 * @param {string} [address]
 * @return {*}  {Promise<Token>}
 */
export const resolveAssetToken = async (
    signer: Signer,
    chain: Chain,
    symbol: string,
    tokenType: AssetAddressTypes,
    address?: string,
): Promise<Token> => {
    let assetToken: Token
    if (address !== undefined) {
        const tkn = IERC20Metadata__factory.connect(address, signer)
        assetToken = {
            symbol: symbol,
            address: address,
            chain,
            quantityFormatter: "USD",
            decimals: await tkn.decimals(),
        }
    } else {
        assetToken = resolveToken(symbol, chain, tokenType)
    }
    return assetToken
}
