import { DAI, USDC, USDT } from "@tasks/utils"
import { ONE_DAY } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"

import type { Convex3CrvConstructorData, Convex3CrvPool, Curve3CrvPool } from "types/convexTypes"

const curveThreeTokenAddress = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490" // ThreeCRV
const curveThreePoolAddress = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
const convexBoosterAddress = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31"
const feeReceiver = "0x3dd46846eed8D147841AE162C8425c08BD8E1b41" //mStableDAO
const rewardTokens = ["0xD533a949740bb3306d119CC777fa900bA034cd52", "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B"] // [CRV.address, CVX.address],
const donateToken = "0x6B175474E89094C44Da98b954EedeAC495271d0F" //DAI

const slippageData = {
    redeem: 101,
    deposit: 102,
    withdraw: 103,
    mint: 104,
}

/* ***********************************
 * Curve3CRVMetavault configurations *
 **********************************  */
const daiCurve3CrvMetaVault: Curve3CrvPool = {
    // constructor
    // metaVault: "0x0_DEFINE AFTER DEPLOYMENT",
    asset: DAI.address,
    slippageData,
    // initialize
    name: "DAI Convex Meta Vault",
    symbol: "mvDAI-CX1",
    decimals: DAI.decimals,
}
const usdcCurve3CrvMetaVault: Curve3CrvPool = {
    // constructor
    // metaVault: "0x0_DEFINE AFTER DEPLOYMENT",
    asset: USDC.address,
    slippageData,
    // initialize
    name: "USDC Convex Meta Vault",
    symbol: "mvUSDC-CX1",
    decimals: USDC.decimals,
}

const usdtCurve3CrvMetaVault: Curve3CrvPool = {
    // constructor
    // metaVault: "0x0_DEFINE AFTER DEPLOYMENT",
    asset: USDT.address,
    slippageData,
    // initialize
    name: "USDT Convex Meta Vault",
    symbol: "mvUSDT-CX1",
    decimals: USDT.decimals,
}

/* *****************************************
 * PeriodicAllocationPerfFeeMetaVault configurations *
 ****************************************  */

// convex related
const buildConvex3CrvConstructorData = (convex3CrvPool: Convex3CrvPool): Convex3CrvConstructorData => {
    return {
        metapool: convex3CrvPool.curveMetapool,
        metapoolToken: convex3CrvPool.curveMetapoolToken,
        convexPoolId: convex3CrvPool.convexPoolId,
        booster: convexBoosterAddress, // Convex Finance: Booster
        basePool: curveThreePoolAddress, // Curve.fi: DAI/USDC/USDT Pool
    }
}

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
    asset: curveThreeTokenAddress,
    // liquidator
    factory: "liquidator",
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
    // LP token address	0x1AEf73d49Dedc4b1778d0706583995958Dc862e6
    // Deposit contract address	0xF403C135812408BFbE8713b5A23a04b3D48AAE31
    // Rewards contract address	0xDBFa6187C79f4fE4Cda20609E75760C5AaE88e52
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
    asset: curveThreeTokenAddress,
    factory: "liquidator",
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
    asset: curveThreeTokenAddress,
    factory: "liquidator",
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
    asset: curveThreeTokenAddress,
    factory: "liquidator",
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
    asset: curveThreeTokenAddress,
    factory: "liquidator",
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
    asset: curveThreeTokenAddress,
    factory: "liquidator",
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
    asset: curveThreeTokenAddress,
    factory: "liquidator",
    streamDuration: ONE_DAY.mul(6),
    rewardTokens,
    donateToken,
    feeReceiver,
    donationFee: 10000, // 1%
    slippageData,
}

const musdPoolConstructor = buildConvex3CrvConstructorData(musdConvex3CrvPool)
const pwrdPoolConstructor = buildConvex3CrvConstructorData(pwrdConvex3CrvPool)
const usdpPoolConstructor = buildConvex3CrvConstructorData(usdpConvex3CrvPool)
const mimPoolConstructor = buildConvex3CrvConstructorData(mimConvex3CrvPool)
const fraxPoolConstructor = buildConvex3CrvConstructorData(fraxConvex3CrvPool)
const busdPoolConstructor = buildConvex3CrvConstructorData(busdConvex3CrvPool)
const lusdPoolConstructor = buildConvex3CrvConstructorData(lusdConvex3CrvPool)

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
    // TODO review to delete convex3CrvConstructors
    convex3CrvConstructors: {
        musd: musdPoolConstructor,
        pwrd: pwrdPoolConstructor,
        usdp: usdpPoolConstructor,
        mim: mimPoolConstructor,
        frax: fraxPoolConstructor,
        busd: busdPoolConstructor,
        lusd: lusdPoolConstructor,
    },

    periodicAllocationPerfFeeMetaVault: {
        asset: curveThreeTokenAddress,
        name: "Convex 3CRV Meta Vault",
        symbol: "m3CRV-CX1",
        performanceFee: 50000, //5
        feeReceiver,
        // underlyingVaults: Array<string> after deployment,
        sourceParams: {
            // TODO - TBD
            singleVaultSharesThreshold: 1000, // 10%
            singleSourceVaultIndex: 0,
        },
        assetPerShareUpdateThreshold: simpleToExactAmount(1000000), //1M
    },
    curve3CrvMetaVault: { dai: daiCurve3CrvMetaVault, usdc: usdcCurve3CrvMetaVault, usdt: usdtCurve3CrvMetaVault },
}
