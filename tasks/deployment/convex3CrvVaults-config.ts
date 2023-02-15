import { CRV, CVX, DAI, ThreeCRV, USDC, USDT } from "@tasks/utils"
import { ONE_DAY } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"

import type { Convex3CrvPool, Curve3CrvPool } from "types/convexTypes"

const feeReceiver = "0x3dd46846eed8D147841AE162C8425c08BD8E1b41" //mStableDAO
const rewardTokens = [CRV.address, CVX.address]
const donateToken = DAI.address

const slippageData = {
    redeem: 101,
    deposit: 102,
    withdraw: 103,
    mint: 104,
}

/* ***********************************
 * Curve3CrvMetaVault configurations *
 **********************************  */
const daiCurve3CrvMetaVault: Curve3CrvPool = {
    // constructor
    asset: DAI.address,
    // initialize
    name: "DAI Convex Meta Vault",
    symbol: "mvDAI-CX1",
    decimals: DAI.decimals,
    slippageData,
}
const usdcCurve3CrvMetaVault: Curve3CrvPool = {
    // constructor
    asset: USDC.address,
    // initialize
    name: "USDC 3Pool Convex Meta Vault",
    symbol: "mvUSDC-3PCV",
    decimals: USDC.decimals,
    slippageData,
}

const usdtCurve3CrvMetaVault: Curve3CrvPool = {
    // constructor
    asset: USDT.address,
    // initialize
    name: "USDT Convex Meta Vault",
    symbol: "mvUSDT-CX1",
    decimals: USDT.decimals,
    slippageData,
}

/* *****************************************
 * PeriodicAllocationPerfFeeMetaVault configurations *
 ****************************************  */

const musdConvex3CrvPool: Convex3CrvPool = {
    // constructor
    curveMetapool: "0x8474DdbE98F5aA3179B3B3F5942D724aFcdec9f6", //Curve.fi: MUSD Pool
    curveMetapoolToken: "0x1AEf73d49Dedc4b1778d0706583995958Dc862e6",
    convexPoolId: 14, // Curve.fi musd3CRV
    // initialize
    name: "Vault Convex mUSD+3Crv",
    symbol: "vcvxmusd3CRV",
    // var
    metapoolDepositZap: "0x803A2B40c5a9BB2B86DD630B274Fa2A9202874C2",
    isFactory: false,
    convexRewardPool: "0xDBFa6187C79f4fE4Cda20609E75760C5AaE88e52", // CRVRewardsPool
    decimals: 18,
    asset: ThreeCRV.address,
    // liquidator
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}
const pwrdConvex3CrvPool: Convex3CrvPool = {
    curveMetapool: "0xbcb91E689114B9Cc865AD7871845C95241Df4105", // Curve.fi Factory USD Metapool: PWR... (PWRD3CRV-f)
    metapoolDepositZap: "0xA79828DF1850E8a3A3064576f380D90aECDD3359",
    isFactory: true,
    // Curve.fi Factory USD Metapool: PWRD Metapool (PWRD3CRV-f)
    curveMetapoolToken: "0xbcb91E689114B9Cc865AD7871845C95241Df4105",
    convexPoolId: 76,
    convexRewardPool: "0xC4d009E61a904BfDf39144295F12870E8305D4d9",
    name: "Vault Convex PWRD+3Crv",
    symbol: "vcvxPWRD3CRV-f",
    decimals: 18,
    asset: ThreeCRV.address,
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}
const usdpConvex3CrvPool: Convex3CrvPool = {
    curveMetapool: "0x42d7025938bEc20B69cBae5A77421082407f053A",
    metapoolDepositZap: "0x3c8cAee4E09296800f8D29A68Fa3837e2dae4940",
    isFactory: false,
    // Curve.fi USDP/3Crv (usdp3CRV)
    curveMetapoolToken: "0x7Eb40E450b9655f4B3cC4259BCC731c63ff55ae6",
    convexPoolId: 28,
    convexRewardPool: "0x24DfFd1949F888F91A0c8341Fc98a3F280a782a8",
    name: "Vault Convex USDP+3Crv",
    symbol: "vcvxusdp3CRV",
    decimals: 18,
    asset: ThreeCRV.address,
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}
const mimConvex3CrvPool: Convex3CrvPool = {
    curveMetapool: "0x5a6A4D54456819380173272A5E8E9B9904BdF41B",
    metapoolDepositZap: "0xA79828DF1850E8a3A3064576f380D90aECDD3359",
    isFactory: true,
    // Curve.fi Factory USD Metapool: Magic Internet Money 3Pool (MIM-3LP3CRV-f)
    curveMetapoolToken: "0x5a6A4D54456819380173272A5E8E9B9904BdF41B",
    convexPoolId: 40,
    convexRewardPool: "0xFd5AbF66b003881b88567EB9Ed9c651F14Dc4771",
    name: "Vault Convex MIM+3Crv",
    symbol: "vcvxMIM-3LP3CRV-f",
    decimals: 18,
    asset: ThreeCRV.address,
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}
const fraxConvex3CrvPool: Convex3CrvPool = {
    curveMetapool: "0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B",
    isFactory: true,
    // Curve.fi Factory USD Metapool: Frax (FRAX3CRV-f)
    curveMetapoolToken: "0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B",
    convexPoolId: 32,
    convexRewardPool: "0xB900EF131301B307dB5eFcbed9DBb50A3e209B2e",
    name: "Vault Convex FRAX+3Crv",
    symbol: "vcvxFRAX3CRV-f",
    decimals: 18,
    asset: ThreeCRV.address,
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}
const busdConvex3CrvPool: Convex3CrvPool = {
    curveMetapool: "0x4807862AA8b2bF68830e4C8dc86D0e9A998e085a",
    isFactory: true,
    // Curve.fi Factory USD Metapool: Binance USD (BUSD3CRV-f)
    curveMetapoolToken: "0x4807862AA8b2bF68830e4C8dc86D0e9A998e085a",
    convexPoolId: 34,
    convexRewardPool: "0xbD223812d360C9587921292D0644D18aDb6a2ad0",
    name: "Vault Convex BUSD+3Crv",
    symbol: "vcvxBUSD3CRV-f",
    decimals: 18,
    asset: ThreeCRV.address,
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}
const lusdConvex3CrvPool: Convex3CrvPool = {
    curveMetapool: "0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA",
    isFactory: true,
    // Curve.fi Factory USD Metapool: Liquity (LUSD3CRV-f)
    curveMetapoolToken: "0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA",
    convexPoolId: 33,
    convexRewardPool: "0x2ad92A7aE036a038ff02B96c88de868ddf3f8190",
    name: "Vault Convex LUSD+3Crv",
    symbol: "vcvxLUSD3CRV-f",
    decimals: 18,
    asset: ThreeCRV.address,
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}

export const config = {
    convex3CrvPools: {
        musd: musdConvex3CrvPool,
        pwrd: pwrdConvex3CrvPool,
        usdp: usdpConvex3CrvPool,
        mim: mimConvex3CrvPool,
        frax: fraxConvex3CrvPool,
        busd: busdConvex3CrvPool,
        lusd: lusdConvex3CrvPool,
    },

    periodicAllocationPerfFeeMetaVault: {
        asset: ThreeCRV.address,
        name: "3CRV Convex Meta Vault",
        symbol: "mv3CRV-CVX",
        performanceFee: 40000, //5
        feeReceiver,
        sourceParams: {
            // TODO - TBD
            singleVaultSharesThreshold: 1000, // 10%
            singleSourceVaultIndex: 0,
        },
        assetPerShareUpdateThreshold: simpleToExactAmount(100000),
    },
    curve3CrvMetaVault: { dai: daiCurve3CrvMetaVault, usdc: usdcCurve3CrvMetaVault, usdt: usdtCurve3CrvMetaVault },
}
