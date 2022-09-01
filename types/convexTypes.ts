import type { BigNumberish } from "ethers"

import type { Convex3CrvBasicVault, Convex3CrvLiquidatorVault } from "./generated"

export type Convex3CrvPoolTypes = "musd" | "pwrd" | "usdp" | "mim"
export type Convex3CrvPoolFactory = "basic" | "liquidator"

/**
 * Meta vault parameters for  Convex Pools
 *
 * @export
 * @interface Convex3CrvPool
 */
export interface Convex3CrvPool {
    /** Curve Metapool */
    curveMetapool: string // dif
    metapoolDepositZap?: string
    isFactory: boolean
    /** Curve Metapool Token*/
    curveMetapoolToken: string // dif
    convexPoolId: number // dif
    convexRewardPool: string
    name: string
    symbol: string
    decimals: number
    asset: string
    // liquidator seetings
    factory?: Convex3CrvPoolFactory
    streamDuration?: BigNumberish
    rewardTokens?: string[]
    donateToken?: string
    feeReceiver?: string
    donationFee?: number
    slippageData: {
        redeem: number
        deposit: number
        withdraw: number
        mint: number
    }
}

/**
 * Convex 3Crv constructor struct
 * Convex3CrvBasicVault.Convex3CrvAbstractVault.ConstructorDataStructOutput
 * @see "/contracts/vault/liquidity/convex/Convex3CrvAbstractVault.sol"
 *
 * @export
 * @interface Convex3CrvConstructorData
 */
export interface Convex3CrvConstructorData {
    /** Curve Metapool Convex3CrvPool.curveMetapool */
    metapool: string
    /** Curve Metapool Token Convex3CrvPool.curveMetapoolToken */
    metapoolToken?: string
    booster: string
    /** Convex3CrvPool.convexPoolId */
    convexPoolId: BigNumberish
    basePool: string
}

// Convex 3RCV Vault Configurations
export type Convex3CrvVaultsConstructors = {
    [key in Convex3CrvPoolTypes]?: Convex3CrvConstructorData
}
export type Convex3CrvVaultsConfig = {
    [key in Convex3CrvPoolTypes]?: Convex3CrvPool
}

export type Convex3CrvVault = Convex3CrvLiquidatorVault | Convex3CrvBasicVault

/**
 * Meta vault parameters for  Curve Pools
 *
 * @export
 * @interface Convex3CrvPool
 */
export interface Curve3CrvPool {
    metaVault?: string
    name: string
    symbol: string
    decimals: number
    asset: string
    // TODO - review if it can be removed from here
    slippageData: {
        redeem: number
        deposit: number
        withdraw: number
        mint: number
    }
}