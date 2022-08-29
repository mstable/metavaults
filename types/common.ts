import type { BytesLike } from "@ethersproject/bytes"
import type { BigNumber as BN, Signer } from "ethers"

import type {
    Convex3CrvLiquidatorVault,
    CowSwapDex,
    Curve3CrvBasicMetaVault,
    IERC20Metadata,
    OneInchDexSwap,
    PeriodicAllocationPerfFeeMetaVault,
} from "./generated"

export type EthAddress = string
export type Bytes32 = string

export interface Account {
    signer: Signer
    address: string
}

export interface DexSwapData {
    fromAsset: string
    fromAssetAmount: BN
    toAsset: string
    minToAssetAmount: BN
    data: BytesLike
}

// Cowswap data
export interface DexTradeData {
    // Owner of the swap, the address that pre-sing orders with CowSwap
    owner: string
    // The address that will receive the tokens
    receiver: string
    fromAsset: string
    fromAssetAmount: BN
    fromAssetFeeAmount: BN
    toAsset: string
    toAssetAmount: BN
}

export type AnyVault = (Convex3CrvLiquidatorVault | Curve3CrvBasicMetaVault | PeriodicAllocationPerfFeeMetaVault) & IERC20Metadata
export type SyncSwapper = OneInchDexSwap
export type AsyncSwapper = CowSwapDex
