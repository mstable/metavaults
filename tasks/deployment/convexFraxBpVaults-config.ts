import { CRV, crvFRAX, CVX, FRAX, USDC } from "@tasks/utils"
import { ONE_DAY } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"

import type { ConvexFraxBpPool, CurveFraxBpPool } from "types/convexTypes"

const feeReceiver = "0x3dd46846eed8D147841AE162C8425c08BD8E1b41" //mStableDAO
const rewardTokens = [CRV.address, CVX.address]
const donateToken = USDC.address

const slippageData = {
    redeem: 101,
    deposit: 102,
    withdraw: 103,
    mint: 104,
}

/* ***********************************
 * CurveFraxBpMetaVault configurations *
 **********************************  */
const usdcCurveFraxBpMetaVault: CurveFraxBpPool = {
    // constructor
    asset: USDC.address,
    // initialize
    name: "USDC FraxBp Convex Meta Vault",
    symbol: "mvUSDCFraxBp-CX1",
    decimals: USDC.decimals,
    slippageData,
    assetToBurn: simpleToExactAmount(10, USDC.decimals),
}

const fraxCurveFraxBpMetaVault: CurveFraxBpPool = {
    // constructor
    asset: FRAX.address,
    // initialize
    name: "FRAX FraxBp Convex Meta Vault",
    symbol: "mvFRAXFraxBp-CX1",
    decimals: FRAX.decimals,
    slippageData,
    assetToBurn: simpleToExactAmount(10, FRAX.decimals),
}

/* *****************************************
 * PeriodicAllocationPerfFeeMetaVault configurations *
 ****************************************  */

const pusdConvexFraxBpPool: ConvexFraxBpPool = {
    // constructor
    curveMetapool: "0xc47ebd6c0f68fd5963005d28d0ba533750e5c11b", //Curve.fi: PUSD FRAX Pool
    curveMetapoolToken: "0xc47ebd6c0f68fd5963005d28d0ba533750e5c11b",
    convexPoolId: 114, // Curve.fi pUSDFRAXBP
    // initialize
    name: "Vault Convex pUSD+FraxBp",
    symbol: "cvxpUSDFRAXBP3CRV-f",
    // var
    isFactory: true,
    convexRewardPool: "0x6d096C99Cc2Ea52490355311b73D86365Acf087f", // CRVRewardsPool
    decimals: 18,
    asset: crvFRAX.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
}
const lusdConvexFraxBpPool: ConvexFraxBpPool = {
    // constructor
    curveMetapool: "0x497ce58f34605b9944e6b15ecafe6b001206fd25", //Curve.fi: LUSD FRAX Pool
    curveMetapoolToken: "0x497ce58f34605b9944e6b15ecafe6b001206fd25",
    convexPoolId: 102, // Curve.fi lUSDFRAXBP
    // initialize
    name: "Vault Convex lUSD+FraxBp",
    symbol: "cvxlUSDFRAXBP3CRV-f",
    // var
    isFactory: true,
    convexRewardPool: "0x053e1dad223A206e6BCa24C77786bb69a10e427d", // CRVRewardsPool
    decimals: 18,
    asset: crvFRAX.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
}
const alusdConvexFraxBpPool: ConvexFraxBpPool = {
    // constructor
    curveMetapool: "0xb30da2376f63de30b42dc055c93fa474f31330a5", //Curve.fi: aLUSD FRAX Pool
    curveMetapoolToken: "0xb30da2376f63de30b42dc055c93fa474f31330a5",
    convexPoolId: 106, // Curve.fi alUSDFRAXBP
    // initialize
    name: "Vault Convex alUSD+FraxBp",
    symbol: "cvxalUSDFRAXBP3CRV-f",
    // var
    isFactory: true,
    convexRewardPool: "0x26598e3E511ADFadefD70ab2C3475Ff741741104", // CRVRewardsPool
    decimals: 18,
    asset: crvFRAX.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
}
const busdConvexFraxBpPool: ConvexFraxBpPool = {
    // constructor
    curveMetapool: "0x8fdb0bb9365a46b145db80d0b1c5c5e979c84190", //Curve.fi: bUSD FRAX Pool
    curveMetapoolToken: "0x8fdb0bb9365a46b145db80d0b1c5c5e979c84190",
    convexPoolId: 105, // Curve.fi bUSDFRAXBP
    // initialize
    name: "Vault Convex bUSD+FraxBp",
    symbol: "cvxbUSDFRAXBP3CRV-f",
    // var
    isFactory: true,
    convexRewardPool: "0x9e6Daf019767D5cEAdE416ce77E8d187b5B254F3", // CRVRewardsPool
    decimals: 18,
    asset: crvFRAX.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
}
const tusdConvexFraxBpPool: ConvexFraxBpPool = {
    // constructor
    curveMetapool: "0x33baeda08b8afacc4d3d07cf31d49fc1f1f3e893", //Curve.fi: tUSD FRAX Pool
    curveMetapoolToken: "0x33baeda08b8afacc4d3d07cf31d49fc1f1f3e893",
    convexPoolId: 108, // Curve.fi tUSDFRAXBP
    // initialize
    name: "Vault Convex tUSD+FraxBp",
    symbol: "cvxtUSDFRAXBP3CRV-f",
    // var
    isFactory: true,
    convexRewardPool: "0x4a744870fD705971c8c00aC510eAc2206C93d5bb", // CRVRewardsPool
    decimals: 18,
    asset: crvFRAX.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
}
const susdConvexFraxBpPool: ConvexFraxBpPool = {
    // constructor
    curveMetapool: "0xe3c190c57b5959ae62efe3b6797058b76ba2f5ef", //Curve.fi: sUSD FRAX Pool
    curveMetapoolToken: "0xe3c190c57b5959ae62efe3b6797058b76ba2f5ef",
    convexPoolId: 101, // Curve.fi tUSDFRAXBP
    // initialize
    name: "Vault Convex sUSD+FraxBp",
    symbol: "cvxsUSDFRAXBP3CRV-f",
    // var
    isFactory: true,
    convexRewardPool: "0x3fABBDfe05487De1720a9420fE2e16d2c3e79A9D", // CRVRewardsPool
    decimals: 18,
    asset: crvFRAX.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
}

export const config = {
    convexFraxBpPools: {
        pusd: pusdConvexFraxBpPool,
        lusd: lusdConvexFraxBpPool,
        alusd: alusdConvexFraxBpPool,
        busd: busdConvexFraxBpPool,
        tusd: tusdConvexFraxBpPool,
        susd: susdConvexFraxBpPool,
    },

    periodicAllocationPerfFeeMetaVault: {
        asset: crvFRAX.address,
        name: "Convex crvFrax Meta Vault",
        symbol: "mCrvFrax-CX1",
        performanceFee: 50000, //5
        feeReceiver,
        // underlyingVaults: Array<string> after deployment,
        sourceParams: {
            // TODO - TBD
            singleVaultSharesThreshold: 1000, // 10%
            singleSourceVaultIndex: 0,
        },
        assetPerShareUpdateThreshold: simpleToExactAmount(1000000), //1M
        assetToBurn: simpleToExactAmount(10, crvFRAX.decimals),
    },
    curveFraxBpMetaVault: { usdc: usdcCurveFraxBpMetaVault, frax: fraxCurveFraxBpMetaVault },
}
