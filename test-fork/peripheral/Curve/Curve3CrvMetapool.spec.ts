import { mUSD, musd3CRV, resolveAddress, ThreeCRV } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { impersonateAccount } from "@utils/fork"
import { basisPointDiff, BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import * as hre from "hardhat"
import {
    Convex3CrvLiquidatorVault__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
    ICurve3Pool__factory,
    ICurveMetapool__factory,
    IERC20__factory,
    IERC20Metadata__factory,
} from "types/generated"

import type { Account } from "types/common"
import type { Curve3CrvMetapoolCalculatorLibrary, ICurve3Pool, ICurveMetapool, IERC20 } from "types/generated"
import { BinaryExpression } from "typescript"

const log = logger("test:CurveMetapoolCalcs")

const curveThreePoolAddress = resolveAddress("CurveThreePool")
const curveMUSDPoolAddress = resolveAddress("CurveMUSDPool")
const threeCrvWhaleAddress = "0xd632f22692fac7611d2aa1c0d552930d43caed3b"
const mpTokenWhaleAddress = "0xe6e6e25efda5f69687aa9914f8d750c523a1d261"

const defaultWithdrawSlippage = 100
const defaultDepositSlippage = 100

describe("Curve musd3Crv Metapool", async () => {
    let threeCrvWhale: Account
    let mpTokenWhale: Account
    let threeCrvToken: IERC20
    let musdToken: IERC20
    let threePool: ICurve3Pool
    let musdMetapool: ICurveMetapool
    let musd3CrvToken: IERC20
    const { network } = hre

    const reset = async (blockNumber?: number) => {
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
        threeCrvWhale = await impersonateAccount(threeCrvWhaleAddress)
        mpTokenWhale = await impersonateAccount(mpTokenWhaleAddress)
    }

    const initialise = (owner: Account) => {
        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, owner.signer)
        musdToken = IERC20__factory.connect(mUSD.address, owner.signer)
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
                    initialise(threeCrvWhale)
                    await deposit(musdMetapool, musd3CrvToken, threeCrvWhale, liquidityAmount)
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
                    initialise(threeCrvWhale)
                    await mint(musdMetapool, musd3CrvToken, threeCrvWhale, mpTokensAmount)
                })
            })
        })
    })

    const logPool = async () => {
        const musdBalance = await musdMetapool.balances(0)
        const threeCrvBalance = await musdMetapool.balances(1)
        const totalBalance = musdBalance.add(threeCrvBalance)
        log(`mUSD balance: ${formatUnits(musdBalance, mUSD.decimals)} ${formatUnits(musdBalance.mul(10000).div(totalBalance), 2)}%`)
        log(
            `3Crv balance: ${formatUnits(threeCrvBalance, ThreeCRV.decimals)} ${formatUnits(
                threeCrvBalance.mul(10000).div(totalBalance),
                2,
            )}%`,
        )
        log(`total supply  ${formatUnits(await musd3CrvToken.totalSupply())}`)
        log(`virtual price ${formatUnits(await musdMetapool.get_virtual_price())}\n`)
    }
    describe(`Add 3Crv liquidity worked example`, () => {
        let metapoolLibrary: Curve3CrvMetapoolCalculatorLibrary
        let musdBalanceBefore: BN
        let threeCrvBalanceBefore: BN
        const addAmount = simpleToExactAmount(100000, 18)

        beforeEach(async () => {
            await reset(15860000)
            const metapoolLibAddress = resolveAddress("Curve3CrvMetapoolCalculatorLibrary")
            metapoolLibrary = Curve3CrvMetapoolCalculatorLibrary__factory.connect(metapoolLibAddress, mpTokenWhale.signer)

            initialise(threeCrvWhale)

            musdBalanceBefore = await musdMetapool.balances(0)
            threeCrvBalanceBefore = await musdMetapool.balances(1)

            log(`mUSD balance before: ${formatUnits(musdBalanceBefore, mUSD.decimals)}`)
            log(`3Crv balance before: ${formatUnits(threeCrvBalanceBefore, ThreeCRV.decimals)}`)
        })
        it("Less 3Crv", async () => {
            const musdBalanced = simpleToExactAmount(2000000) // 2m
            const threeCrvBalanced = simpleToExactAmount(6000000) // 6m

            const musdWithdrawResult = await metapoolLibrary.calcWithdraw(
                musdMetapool.address,
                musd3CrvToken.address,
                // need to fudge the number a little bit as fees are also taken out
                musdBalanceBefore.sub(musdBalanced).sub(simpleToExactAmount(437)),
                0,
            )

            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(musdWithdrawResult.burnAmount_, 0, 0)

            const threeCrvWithdrawResult = await metapoolLibrary.calcWithdraw(
                musdMetapool.address,
                musd3CrvToken.address,
                // need to fudge the number a little bit as fees are also taken out
                threeCrvBalanceBefore.sub(threeCrvBalanced).sub(simpleToExactAmount(38)),
                1,
            )

            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(threeCrvWithdrawResult.burnAmount_, 1, 0)

            log("balanced pool")
            await logPool()

            await threeCrvToken.connect(threeCrvWhale.signer).approve(musdMetapool.address, addAmount)
            const lpTokens = await musdMetapool.connect(threeCrvWhale.signer).callStatic.add_liquidity([0, addAmount], 0)
            const virtualPrice = await musdMetapool.get_virtual_price()
            const dollarValue = virtualPrice.mul(lpTokens)
            log(
                `Received ${formatUnits(lpTokens)} lp tokens worth ${formatUnits(dollarValue, 36)} USD from adding ${formatUnits(
                    addAmount,
                )} 3Crv liquidity`,
            )
        })
        it("More 3Crv", async () => {
            const musdBalanced = simpleToExactAmount(6000000) // 6m
            const threeCrvBalanced = simpleToExactAmount(2000000) // 2m

            const musdWithdrawResult = await metapoolLibrary.calcWithdraw(
                musdMetapool.address,
                musd3CrvToken.address,
                // need to fudge the number a little bit as fees are also taken out
                musdBalanceBefore.sub(musdBalanced).sub(simpleToExactAmount(13)),
                0,
            )

            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(musdWithdrawResult.burnAmount_, 0, 0)

            const threeCrvWithdrawResult = await metapoolLibrary.calcWithdraw(
                musdMetapool.address,
                musd3CrvToken.address,
                // need to fudge the number a little bit as fees are also taken out
                threeCrvBalanceBefore.sub(threeCrvBalanced).sub(simpleToExactAmount(450)),
                1,
            )

            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(threeCrvWithdrawResult.burnAmount_, 1, 0)

            log("balanced pool")
            await logPool()

            await threeCrvToken.connect(threeCrvWhale.signer).approve(musdMetapool.address, addAmount)
            const lpTokens = await musdMetapool.connect(threeCrvWhale.signer).callStatic.add_liquidity([0, addAmount], 0)
            const virtualPrice = await musdMetapool.get_virtual_price()
            const dollarValue = virtualPrice.mul(lpTokens)
            log(
                `Received ${formatUnits(lpTokens)} lp tokens worth ${formatUnits(dollarValue, 36)} USD from adding ${formatUnits(
                    addAmount,
                )} 3Crv liquidity`,
            )
        })
    })
    describe(`Sandwich attack worked example`, () => {
        let metapoolLibrary: Curve3CrvMetapoolCalculatorLibrary
        const threeCrvBalanced = simpleToExactAmount(6000000) // 6m
        const attackerAdd3CrvBefore = simpleToExactAmount(50000000) // 50m
        const attackerRemoveLpBefore = simpleToExactAmount(6500000) //6.5m
        const victim3CrvBefore = simpleToExactAmount(100000) // 100k
        let victimBalancedLpTokens: BN
        let victimDollarValueBefore: BN
        let otherLpTokens: BN

        beforeEach(async () => {
            await reset(15860000)
            const metapoolLibAddress = resolveAddress("Curve3CrvMetapoolCalculatorLibrary")
            metapoolLibrary = Curve3CrvMetapoolCalculatorLibrary__factory.connect(metapoolLibAddress, mpTokenWhale.signer)

            initialise(threeCrvWhale)

            const musdBalanceBefore = await musdMetapool.balances(0)
            const threeCrvBalanceBefore = await musdMetapool.balances(1)

            log(`mUSD balance before: ${formatUnits(musdBalanceBefore, mUSD.decimals)}`)
            log(`3Crv balance before: ${formatUnits(threeCrvBalanceBefore, ThreeCRV.decimals)}`)

            const musdWithdrawResult = await metapoolLibrary.calcWithdraw(
                musdMetapool.address,
                musd3CrvToken.address,
                // need to fudge the number a little bit as fees are also taken out
                musdBalanceBefore.sub(threeCrvBalanced).sub(simpleToExactAmount(13)),
                0,
            )

            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(musdWithdrawResult.burnAmount_, 0, 0)

            const threeCrvWithdrawResult = await metapoolLibrary.calcWithdraw(
                musdMetapool.address,
                musd3CrvToken.address,
                // need to fudge the number a little bit as fees are also taken out
                threeCrvBalanceBefore.sub(threeCrvBalanced).sub(simpleToExactAmount(78)),
                1,
            )

            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(threeCrvWithdrawResult.burnAmount_, 1, 0)

            log("balanced pool")
            await logPool()

            log(`lp whale balance before: ${formatUnits(await musd3CrvToken.balanceOf(mpTokenWhale.address))}`)

            const virtualPrice = await musdMetapool.get_virtual_price()
            const attackerLpValue = virtualPrice.mul(attackerRemoveLpBefore)
            log(`attacker lp tokens ${formatUnits(attackerRemoveLpBefore, 18)} worth ${formatUnits(attackerLpValue, 36)} USD`)
            const totalLpTokens = await musd3CrvToken.totalSupply()
            otherLpTokens = totalLpTokens.sub(attackerRemoveLpBefore)
            const otherLpValue = virtualPrice.mul(otherLpTokens)
            log(`other lp tokens ${formatUnits(otherLpTokens, 18)} worth ${formatUnits(otherLpValue, 36)} USD`)
        })
        it("add liquidity to balanced pool", async () => {
            await threeCrvToken.connect(threeCrvWhale.signer).approve(musdMetapool.address, victim3CrvBefore)
            victimBalancedLpTokens = await musdMetapool.connect(threeCrvWhale.signer).callStatic.add_liquidity([0, victim3CrvBefore], 0)
            const virtualPrice = await musdMetapool.get_virtual_price()
            victimDollarValueBefore = virtualPrice.mul(victimBalancedLpTokens)
            log(
                `Received ${formatUnits(victimBalancedLpTokens)} lp tokens worth ${formatUnits(
                    victimDollarValueBefore,
                    36,
                )} USD from adding ${formatUnits(victim3CrvBefore)} 3Crv liquidity`,
            )
        })
        describe.skip("add liquidity to imbalance pool", () => {
            let attackerLpTokens: BN
            beforeEach(async () => {
                // Attacker's first tx adds 3Crv to the pool
                await threeCrvToken.connect(threeCrvWhale.signer).approve(musdMetapool.address, attackerAdd3CrvBefore)
                // static call to easily get the lp tokens
                attackerLpTokens = await musdMetapool.connect(threeCrvWhale.signer).callStatic.add_liquidity([0, attackerAdd3CrvBefore], 0)
                await musdMetapool.connect(threeCrvWhale.signer).add_liquidity([0, attackerAdd3CrvBefore], 0)

                log("Attacker added 3Crv to the pool")
                await logPool()
            })
            it("sandwich attack", async () => {
                // victim tx is second tx that adds 3Crv to the pool
                await threeCrvToken.connect(threeCrvWhale.signer).approve(musdMetapool.address, victim3CrvBefore)
                // static call to easily get the lp tokens
                const victimImbalancedLpTokens = await musdMetapool
                    .connect(threeCrvWhale.signer)
                    .callStatic.add_liquidity([0, victim3CrvBefore], 0)
                await musdMetapool.connect(threeCrvWhale.signer).add_liquidity([0, victim3CrvBefore], 0)
                const victimLpTokenDiff = victimImbalancedLpTokens.sub(victimBalancedLpTokens)
                const victimLpTokenDiffPercent = victimLpTokenDiff.mul(100000000).div(victimBalancedLpTokens)
                log(
                    `victim got ${formatUnits(victimImbalancedLpTokens)} diff ${formatUnits(victimLpTokenDiff)} ${formatUnits(
                        victimLpTokenDiffPercent,
                        6,
                    )}% musd3CRV lp tokens`,
                )
                const virtualPrice = await musdMetapool.get_virtual_price()
                const victimDollarValueAfter = virtualPrice.mul(victimImbalancedLpTokens)
                const victimDollarValueDiff = victimDollarValueAfter.sub(victimDollarValueBefore)
                const victimDollarLpTokenDiffPercent = victimDollarValueDiff.mul(100000000).div(victimDollarValueBefore)
                log(
                    `victim USD value of lp tokens ${formatUnits(victimDollarValueAfter)} diff ${formatUnits(
                        victimDollarValueDiff,
                    )} ${formatUnits(victimDollarLpTokenDiffPercent, 6)}%`,
                )

                // third tx the attacker redeems their extra metapool lp tokens for 3Crv
                const attacker3CrvAfter = await musdMetapool
                    .connect(threeCrvWhale.signer)
                    .callStatic.remove_liquidity_one_coin(attackerLpTokens, 1, 0)
                await musdMetapool.connect(threeCrvWhale.signer).remove_liquidity_one_coin(attackerLpTokens, 1, 0)
                log("After 3rd tx")
                const attacker3CrvDiff = attacker3CrvAfter.sub(attackerAdd3CrvBefore)
                const attacker3CrvDiffPercentage = attacker3CrvDiff.mul(1000000).div(attackerAdd3CrvBefore)
                log(
                    `attacker withdrew ${formatUnits(attacker3CrvAfter)} 3Crv diff ${formatUnits(attacker3CrvDiff)} ${formatUnits(
                        attacker3CrvDiffPercentage,
                        4,
                    )}% from ${formatUnits(attackerLpTokens)} lp tokens`,
                )

                await logPool()

                const victim3CrvAfter = await musdMetapool
                    .connect(mpTokenWhale.signer)
                    .callStatic.remove_liquidity_one_coin(victimImbalancedLpTokens, 1, 0)
                await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(victimImbalancedLpTokens, 1, 0)
                const victim3CrvDiff = victim3CrvAfter.sub(victim3CrvBefore)
                const victim3CrvDiffPercent = victim3CrvDiff.mul(10000).div(victim3CrvBefore)
                log("After victim removes liquidity")
                log(
                    `victim after ${formatUnits(victim3CrvAfter)} 3Crv ${formatUnits(victim3CrvDiff)} ${formatUnits(
                        victim3CrvDiffPercent,
                        2,
                    )}%`,
                )
                await logPool()
            })
            it("deposit to mUSD vault should fail due to sandwich protection", async () => {
                const vaultAddress = resolveAddress("vcx3CRV-mUSD")
                const musdVault = Convex3CrvLiquidatorVault__factory.connect(vaultAddress, threeCrvWhale.signer)
                await threeCrvToken.connect(threeCrvWhale.signer).approve(vaultAddress, attackerAdd3CrvBefore)
                const tx = musdVault["deposit(uint256,address)"](attackerAdd3CrvBefore, threeCrvWhale.address)
                await expect(tx).revertedWith("Slippage screwed you")
            })
        })
        it("remove liquidity to imbalanced pool", async () => {
            // Attacker's first tx remove mUSD from the pool
            // static call to easily get the 3Crv tokens removed
            const attackerRemovedMusd = await musdMetapool
                .connect(mpTokenWhale.signer)
                .callStatic.remove_liquidity_one_coin(attackerRemoveLpBefore, 0, 0)
            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(attackerRemoveLpBefore, 0, 0)
            log(
                `Attacker removed ${formatUnits(attackerRemovedMusd)} mUSD from the pool using ${formatUnits(
                    attackerRemoveLpBefore,
                )} lp tokens`,
            )

            log("3Crv removed from the pool")
            await logPool()

            // victim tx that adds 3Crv to the pool
            await threeCrvToken.connect(threeCrvWhale.signer).approve(musdMetapool.address, victim3CrvBefore)
            // static call to easily get the lp tokens
            const victimImbalancedLpTokens = await musdMetapool
                .connect(threeCrvWhale.signer)
                .callStatic.add_liquidity([0, victim3CrvBefore], 0)
            await musdMetapool.connect(threeCrvWhale.signer).add_liquidity([0, victim3CrvBefore], 0)
            const victimLpTokenDiff = victimImbalancedLpTokens.sub(victimBalancedLpTokens)
            const victimLpTokenDiffPercent = victimLpTokenDiff.mul(100000000).div(victimBalancedLpTokens)
            log(
                `victim got ${formatUnits(victimImbalancedLpTokens)} diff ${formatUnits(victimLpTokenDiff)} ${formatUnits(
                    victimLpTokenDiffPercent,
                    6,
                )}% musd3CRV lp tokens`,
            )
            const virtualPrice = await musdMetapool.get_virtual_price()
            const victimDollarValueAfter = virtualPrice.mul(victimImbalancedLpTokens)
            const victimDollarValueDiff = victimDollarValueAfter.sub(victimDollarValueBefore)
            const victimDollarLpTokenDiffPercent = victimDollarValueDiff.mul(100000000).div(victimDollarValueBefore)
            log(
                `victim USD value of lp tokens ${formatUnits(victimDollarValueAfter, 36)} diff ${formatUnits(
                    victimDollarValueDiff,
                    36,
                )} ${formatUnits(victimDollarLpTokenDiffPercent, 6)}%`,
            )

            // third tx the attacker adds the mUSD back to the pool
            await musdToken.connect(mpTokenWhale.signer).approve(musdMetapool.address, attackerRemovedMusd)
            const attackerLpAfter = await musdMetapool.connect(mpTokenWhale.signer).callStatic.add_liquidity([attackerRemovedMusd, 0], 0)
            await musdMetapool.connect(mpTokenWhale.signer).add_liquidity([attackerRemovedMusd, 0], 0)
            log("After 3rd tx")
            const attackerLpDiff = attackerLpAfter.sub(attackerRemoveLpBefore)
            const attackerLpDiffPercentage = attackerLpDiff.mul(1000000).div(attackerRemoveLpBefore)
            log(
                `attacker received ${formatUnits(attackerLpAfter)} lp tokens (musd3Crv) diff ${formatUnits(attackerLpDiff)} ${formatUnits(
                    attackerLpDiffPercentage,
                    4,
                )}% from adding ${formatUnits(attackerRemovedMusd)} mUSD`,
            )

            await logPool()

            const victim3CrvAfter = await musdMetapool
                .connect(mpTokenWhale.signer)
                .callStatic.remove_liquidity_one_coin(victimImbalancedLpTokens, 1, 0)
            await musdMetapool.connect(mpTokenWhale.signer).remove_liquidity_one_coin(victimImbalancedLpTokens, 1, 0)
            const victim3CrvDiff = victim3CrvAfter.sub(victim3CrvBefore)
            const victim3CrvDiffPercent = victim3CrvDiff.mul(10000).div(victim3CrvBefore)
            log("After victim removes liquidity")
            log(
                `victim after ${formatUnits(victim3CrvAfter)} 3Crv ${formatUnits(victim3CrvDiff)} ${formatUnits(
                    victim3CrvDiffPercent,
                    2,
                )}%`,
            )
            const otherLpValueAfter = virtualPrice.mul(otherLpTokens)
            log(`other lp tokens ${formatUnits(otherLpTokens, 18)} worth ${formatUnits(otherLpValueAfter, 36)} USD`)
            await logPool()
        })
    })
})
