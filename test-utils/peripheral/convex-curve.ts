import { musd3CRV, resolveAddress } from "@tasks/utils"

import type { Convex3CrvConstructorData, Convex3CrvVaultsConstructors } from "types"
const curveThreePoolAddress = resolveAddress("CurveThreePool")
const curveMUSDPoolAddress = resolveAddress("CurveMUSDPool")
const convexBoosterAddress = resolveAddress("ConvexBooster")

// ------------------------------------- //
//  Convex Testing Configurations
// ------------------------------------- //
// TODO - review if it can be removed and only trust on main-config
export const musdConvexConstructorData: Convex3CrvConstructorData = {
    metapool: curveMUSDPoolAddress, // Curve.fi: MUSD Pool,
    metapoolToken: musd3CRV.address, // Curve.fi: musd3CRV Token
    booster: convexBoosterAddress, // Convex Finance: Booster
    convexPoolId: 14,
    basePool: curveThreePoolAddress, // Curve.fi: DAI/USDC/USDT Pool
}

export const convex3CrvVaultsConstructors: Convex3CrvVaultsConstructors = {
    musd: musdConvexConstructorData,
}

export const slippageData = {
    redeem: 100,
    deposit: 100,
    withdraw: 10,
    mint: 10,
}
