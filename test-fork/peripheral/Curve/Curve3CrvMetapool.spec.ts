import { musd3CRV, resolveAddress, ThreeCRV } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { impersonateAccount } from "@utils/fork"
import { basisPointDiff, BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "ethers"
import * as hre from "hardhat"
import { ICurve3Pool__factory, ICurveMetapool__factory, IERC20__factory, IERC20Metadata__factory } from "types/generated"

import type { Account } from "types/common"
import type { ICurve3Pool, ICurveMetapool, IERC20 } from "types/generated"

const log = logger("test:CurveMetapoolCalcs")

const curveThreePoolAddress = resolveAddress("CurveThreePool")
const curveMUSDPoolAddress = resolveAddress("CurveMUSDPool")
const staker1Address = "0xd632f22692fac7611d2aa1c0d552930d43caed3b"
const mpTokenWhaleAddress = "0xe6e6e25efda5f69687aa9914f8d750c523a1d261"

const defaultWithdrawSlippage = 100
const defaultDepositSlippage = 100

describe("Curve musd3Crv Metapool", async () => {
    let staker1: Account
    let mpTokenWhale: Account
    let threeCrvToken: IERC20
    let threePool: ICurve3Pool
    let musdMetapool: ICurveMetapool
    let musd3CrvToken: IERC20
    const { network } = hre

    const reset = async (blockNumber: number) => {
        if (network.name === "hardhat") {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber,
                        },
                    },
                ],
            })
        }
        staker1 = await impersonateAccount(staker1Address)
        mpTokenWhale = await impersonateAccount(mpTokenWhaleAddress)
    }

    const initialise = (owner: Account) => {
        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, owner.signer)
        threePool = ICurve3Pool__factory.connect(curveThreePoolAddress, owner.signer)
        musdMetapool = ICurveMetapool__factory.connect(curveMUSDPoolAddress, owner.signer)
        musd3CrvToken = IERC20__factory.connect(musd3CRV.address, owner.signer)
    }

    const deposit = async (metapool: ICurveMetapool, metapoolToken: IERC20, owner: Account, liquidityAmount: number) => {
        await threeCrvToken.connect(owner.signer).approve(metapool.address, ethers.constants.MaxUint256)

        const actualLiquidityAmount = simpleToExactAmount(liquidityAmount, 18)
        const threePoolVirtualPrice = await threePool.get_virtual_price()
        const metaPoolVirtualPrice = await metapool.get_virtual_price()

        const expectedMPTokens = threePoolVirtualPrice.mul(actualLiquidityAmount).div(metaPoolVirtualPrice)
        const minExpectedMPTokens = expectedMPTokens.mul(10000 - defaultDepositSlippage).div(10000)

        const MPTokensBefore = await metapoolToken.balanceOf(owner.address)
        await metapool.add_liquidity([0, actualLiquidityAmount], 0)
        const MPTokensAfter = await metapoolToken.balanceOf(owner.address)

        const receivedTokens = MPTokensAfter.sub(MPTokensBefore)
        log("ReceivedTokens: " + receivedTokens.toString())

        expect(receivedTokens, "Received Tokens").to.gt(minExpectedMPTokens)

        const differenceInActualAndExpected = basisPointDiff(receivedTokens, expectedMPTokens)
        log(`Actual vs Expected MPTokens (Basis Points): ${differenceInActualAndExpected.toString()}`)

        const differenceInActualvsMinimum = basisPointDiff(receivedTokens, minExpectedMPTokens)
        log(`Actual vs Minimum MPTokens (Basis Points): ${differenceInActualvsMinimum}`)
        expect(receivedTokens, "deposit Min Tokens").gte(minExpectedMPTokens)
    }

    const redeem = async (metapool: ICurveMetapool, metapoolToken: IERC20, owner: Account, mpTokensAmount: number) => {
        await metapoolToken.connect(owner.signer).approve(metapool.address, ethers.constants.MaxUint256)

        const actualMpTokensAmount = simpleToExactAmount(mpTokensAmount, 18)
        const threePoolVirtualPrice = await threePool.get_virtual_price()
        const metaPoolVirtualPrice = await metapool.get_virtual_price()

        const expectedAssets = metaPoolVirtualPrice.mul(actualMpTokensAmount).div(threePoolVirtualPrice)
        const minExpectedAssets = expectedAssets.mul(10000 - defaultWithdrawSlippage).div(10000)

        const assetsBefore = await threeCrvToken.balanceOf(owner.address)
        await metapool.remove_liquidity_one_coin(actualMpTokensAmount, 1, 0)
        const assetsAfter = await threeCrvToken.balanceOf(owner.address)

        const receivedAssets = assetsAfter.sub(assetsBefore)

        expect(receivedAssets, "Received Assets").to.gt(minExpectedAssets)

        const differenceInActualAndExpected = basisPointDiff(receivedAssets, expectedAssets)
        log(`Actual vs Expected Assets (Basis Points): ${differenceInActualAndExpected.toString()}`)

        const differenceInActualvsMinimum = basisPointDiff(receivedAssets, minExpectedAssets)
        log(`Actual vs Minimum Assets (Basis Points): ${differenceInActualvsMinimum}`)
        expect(receivedAssets, "Redeem Minimum Assets").gte(minExpectedAssets)
    }

    const withdraw = async (metapool: ICurveMetapool, metapoolToken: IERC20, owner: Account, liquidityAmount: number) => {
        await threeCrvToken.connect(owner.signer).approve(metapool.address, ethers.constants.MaxUint256)
        await metapoolToken.connect(owner.signer).approve(metapool.address, ethers.constants.MaxUint256)

        const actualLiquidityAmount = simpleToExactAmount(liquidityAmount, 18)
        const fee = await metapool.fee()
        const curveFeeScale = BN.from(10).pow(10)
        const curveFeeAdjust = BN.from(10).pow(4).mul(5)
        const underlying0Token = IERC20Metadata__factory.connect(await metapool.coins(0), owner.signer)

        const coin0Bal = (await metapool.balances(0)).div(simpleToExactAmount(1, await underlying0Token.decimals()))
        const coin1Bal = (await metapool.balances(1)).div(simpleToExactAmount(1, 18))
        const totalBal = coin0Bal.add(coin1Bal)

        const assetsAdjusted = actualLiquidityAmount
            .mul(totalBal)
            .div(coin1Bal.add(coin0Bal.mul(curveFeeScale.sub(fee).add(curveFeeAdjust)).div(curveFeeScale)))

        let metapoolTokensNeeded = await metapool.calc_token_amount([0, assetsAdjusted], false)
        metapoolTokensNeeded = metapoolTokensNeeded.mul(100000 + 1).div(100000)

        const assetsBeforeCurve = await threeCrvToken.balanceOf(owner.address)
        await metapool.remove_liquidity_one_coin(metapoolTokensNeeded, 1, actualLiquidityAmount)
        const assetsAfterCurve = await threeCrvToken.balanceOf(owner.address)

        const receivedAssetsCurve = assetsAfterCurve.sub(assetsBeforeCurve)
        expect(receivedAssetsCurve, "Received Assets").to.gt(actualLiquidityAmount)
    }

    const mint = async (metapool: ICurveMetapool, metapoolToken: IERC20, owner: Account, mpTokensAmount: number) => {
        await threeCrvToken.connect(owner.signer).approve(metapool.address, ethers.constants.MaxUint256)
        await metapoolToken.connect(owner.signer).approve(metapool.address, ethers.constants.MaxUint256)

        const actualMpTokensAmount = simpleToExactAmount(mpTokensAmount, 18)
        const threePoolVirtualPrice = await threePool.get_virtual_price()
        const metaPoolVirtualPrice = await metapool.get_virtual_price()

        const fee = await metapool.fee()
        const curveFeeScale = BN.from(10).pow(10)
        const curveFeeAdjust = BN.from(10).pow(4).mul(5)
        const underlying0Token = IERC20Metadata__factory.connect(await metapool.coins(0), owner.signer)

        const coin0Bal = (await metapool.balances(0)).div(simpleToExactAmount(1, await underlying0Token.decimals()))
        const coin1Bal = (await metapool.balances(1)).div(simpleToExactAmount(1, 18))
        const totalBal = coin0Bal.add(coin1Bal)

        const expectedAssets = metaPoolVirtualPrice.mul(actualMpTokensAmount).div(threePoolVirtualPrice)
        const assetsCalculatedVP = expectedAssets.mul(10000 + 10).div(10000)

        const assetsCalculatedCurve = await metapool.calc_withdraw_one_coin(actualMpTokensAmount, 1)

        let assetsCalculatedCurveNew = assetsCalculatedCurve.mul(2).sub(expectedAssets).mul(expectedAssets).div(assetsCalculatedCurve)
        assetsCalculatedCurveNew = assetsCalculatedCurveNew.mul(10000 + 5).div(10000)

        let assetsCheckAmount = assetsCalculatedCurveNew
            .mul(totalBal)
            .div(coin1Bal.add(coin0Bal.mul(curveFeeScale).div(curveFeeScale.sub(fee).add(curveFeeAdjust))))
        let mpTokensCheckAmount = await metapool.calc_token_amount([0, assetsCheckAmount], true)
        mpTokensCheckAmount = mpTokensCheckAmount.mul(100000 - 1).div(100000)

        // for Loop:  increase 1 basis point each iteration check with calc_token_amount
        while (mpTokensCheckAmount.lt(actualMpTokensAmount)) {
            assetsCalculatedCurveNew = assetsCalculatedCurveNew.mul(10000 + 1).div(10000)
            assetsCheckAmount = assetsCalculatedCurveNew
                .mul(totalBal)
                .div(coin1Bal.add(coin0Bal.mul(curveFeeScale).div(curveFeeScale.sub(fee).add(curveFeeAdjust))))
            mpTokensCheckAmount = await metapool.calc_token_amount([0, assetsCheckAmount], true)
            mpTokensCheckAmount = mpTokensCheckAmount.mul(100000 - 1).div(100000)
        }

        const mpTokensBeforeCurve = await metapoolToken.balanceOf(owner.address)
        await metapool.add_liquidity([0, assetsCalculatedCurveNew], actualMpTokensAmount)
        const mpTokensAfterCurve = await metapoolToken.balanceOf(owner.address)
        const receivedTokensCurve = mpTokensAfterCurve.sub(mpTokensBeforeCurve)
        log(`receivedAssets: ${receivedTokensCurve.toString()}`)

        const differenceCurve = basisPointDiff(receivedTokensCurve, actualMpTokensAmount)

        log(` Received - Demanded MpTokens: ${receivedTokensCurve.sub(actualMpTokensAmount).div(simpleToExactAmount(1, 18)).toString()}`)
        expect(receivedTokensCurve, "Received Assets").to.gt(actualMpTokensAmount)
    }

    const testBlockNumbers = [14677900, 14919111]
    const liquidityAmounts = [100000, 1000000, 10000000, 20000000, 25000000]
    const mpTokensAmounts = [100000, 1000000, 10000000, 20000000, 25000000]

    testBlockNumbers.forEach((blockNumber) => {
        describe(`Block number ${blockNumber}`, () => {
            beforeEach(async () => {
                await reset(blockNumber)
            })
            liquidityAmounts.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, Deposit amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(staker1)
                    await deposit(musdMetapool, musd3CrvToken, staker1, liquidityAmount)
                })
            })
            mpTokensAmounts.forEach((mpTokensAmount) => {
                it(`block ${blockNumber}, Redeem amount ${mpTokensAmount.toLocaleString("en-US")}`, async () => {
                    initialise(mpTokenWhale)
                    await redeem(musdMetapool, musd3CrvToken, mpTokenWhale, mpTokensAmount)
                })
            })
            liquidityAmounts.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, 3CRV demand amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(mpTokenWhale)
                    await withdraw(musdMetapool, musd3CrvToken, mpTokenWhale, liquidityAmount)
                })
            })
            mpTokensAmounts.forEach((mpTokensAmount) => {
                it(`block ${blockNumber}, mpTokens demand amount ${mpTokensAmount.toLocaleString("en-US")}`, async () => {
                    initialise(staker1)
                    await mint(musdMetapool, musd3CrvToken, staker1, mpTokensAmount)
                })
            })
        })
    })
})
