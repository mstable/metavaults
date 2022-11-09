import type { BigNumberish } from "ethers"

import type { Convex3CrvBasicVault, Convex3CrvLiquidatorVault, ConvexFraxBpBasicVault, ConvexFraxBpLiquidatorVault } from "./generated"

export type Convex3CrvPoolTypes = "musd" | "pwrd" | "usdp" | "mim"
export type Convex3CrvPoolFactory = "basic" | "liquidator"

export type ConvexFraxBpPoolTypes = "pusd" | "lusd" | "alusd" | "busd" | "tusd" | "susd"
export type ConvexFraxBpPoolFactory = "basic" | "liquidator"

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
    // liquidator settings
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
 * Meta vault parameters for  Convex Pools
 *
 * @export
 * @interface ConvexFraxBpPool
 */
 export interface ConvexFraxBpPool {
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
    // liquidator settings
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
    booster: string
    /** Convex3CrvPool.convexPoolId */
    convexPoolId: BigNumberish
}

/**
 * Convex FraxBp constructor struct
 *
 * @export
 * @interface ConvexFraxBpConstructorData
 */
 export interface ConvexFraxBpConstructorData {
    /** Curve Metapool Convex3CrvPool.curveMetapool */
    metapool: string
    booster: string
    /** Convex3CrvPool.convexPoolId */
    convexPoolId: BigNumberish
}

// Convex 3RCV Vault Configurations
export type Convex3CrvVaultsConstructors = {
    [key in Convex3CrvPoolTypes]?: Convex3CrvConstructorData
}
export type Convex3CrvVaultsConfig = {
    [key in Convex3CrvPoolTypes]?: Convex3CrvPool
}

// Convex FraxBp Vault Configurations
export type ConvexFraxBpVaultsConstructors = {
    [key in ConvexFraxBpPoolTypes]?: ConvexFraxBpConstructorData
}
export type ConvexFraxBpVaultsConfig = {
    [key in ConvexFraxBpPoolTypes]?: ConvexFraxBpPool
}

export type Convex3CrvVault = Convex3CrvLiquidatorVault | Convex3CrvBasicVault
export type ConvexFraxBpVault = ConvexFraxBpLiquidatorVault | ConvexFraxBpBasicVault

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

/**
 * Meta vault parameters for  Curve Pools
 *
 * @export
 * @interface ConvexFraxBpPool
 */
 export interface CurveFraxBpPool {
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
