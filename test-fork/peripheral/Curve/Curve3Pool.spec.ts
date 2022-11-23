import { resolveAddress } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { DAI, ThreeCRV, USDC, USDT } from "@tasks/utils/tokens"
import { impersonateAccount } from "@utils/fork"
import { basisPointDiff, BN, simpleToExactAmount } from "@utils/math"
import { retry } from "@utils/time"
import { expect } from "chai"
import * as hre from "hardhat"
import { ethers } from "hardhat"
import { ICurve3Pool__factory, IERC20Metadata__factory } from "types/generated"

import type { BigNumberish } from "ethers"
import type { Account } from "types/common"
import type { ICurve3Pool, IERC20Metadata } from "types/generated"

const log = logger("test:Curve3Pool")

const curveThreePoolAddress = resolveAddress("CurveThreePool")

const threeCrvTokenScale = simpleToExactAmount(1, 18)
const threePoolVirtualPriceScale = simpleToExactAmount(1, 18)

const defaultWithdrawSlippage = 100
const defaultDepositSlippage = 100

const usdtUserAddress = "0x5754284f345afc66a98fbb0a0afe71e0f007b949" // >1B at block 14810528
const daiUserAddress = "0x075e72a5edf65f0a5f44699c7654c1a76941ddc8" // 250M at block 14810528
const usdcUserAddress = "0x0A59649758aa4d66E25f08Dd01271e891fe52199" // 2.5B at block 14810528
const threePoolWhaleAddress = "0xd632f22692fac7611d2aa1c0d552930d43caed3b" // 500M at block 14810528

const mediumDepegBlock = 14759700 // 12 May 0700 AM UTC .975USDT
const maxDepegBlock = 14759786 // 12 May 0722 AM UTC 0.95USDT
const normalBlock = 14810528

const underlying0Scale = BN.from(10).pow(DAI.decimals)
const underlying1Scale = BN.from(10).pow(USDC.decimals)
const underlying2Scale = BN.from(10).pow(USDT.decimals)

describe("Curve 3Pool", async () => {
    let threePool: ICurve3Pool
    let threePoolWhale: Account
    let daiToken: IERC20Metadata
    let usdcToken: IERC20Metadata
    let usdtToken: IERC20Metadata
    let threeCrvToken: IERC20Metadata
    let daiStaker: Account
    let usdcStaker: Account
    let usdtStaker: Account
    let underlyingIndex: number

    const { network } = hre

    const reset = async (blockNumber: number) => {
        await retry((_) => resetInternal(blockNumber))
    }

    const resetInternal = async (blockNumber: number) => {
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
        daiStaker = await impersonateAccount(daiUserAddress)
        usdcStaker = await impersonateAccount(usdcUserAddress)
        usdtStaker = await impersonateAccount(usdtUserAddress)
        threePoolWhale = await impersonateAccount(threePoolWhaleAddress)
    }

    const initialise = (owner: Account) => {
        threeCrvToken = IERC20Metadata__factory.connect(ThreeCRV.address, owner.signer)
        daiToken = IERC20Metadata__factory.connect(DAI.address, owner.signer)
        usdcToken = IERC20Metadata__factory.connect(USDC.address, owner.signer)
        usdtToken = IERC20Metadata__factory.connect(USDT.address, owner.signer)
        threePool = ICurve3Pool__factory.connect(curveThreePoolAddress, owner.signer)
    }

    const deposit = async (
        owner: Account,
        liquidityAmount: number,
        underlying: IERC20Metadata,
        depositSlippage: number = defaultDepositSlippage,
    ) => {
        await setUnderlyingIndex(underlying)
        await underlying.connect(owner.signer).approve(threePool.address, ethers.constants.MaxUint256)

        const threePoolVirtualPrice = await threePool.get_virtual_price()
        const underlyingScale = simpleToExactAmount(1, await underlying.decimals())
        const actualLiquidityAmount = simpleToExactAmount(liquidityAmount, await underlying.decimals())

        const expectedLpTokens = actualLiquidityAmount
            .mul(threePoolVirtualPriceScale)
            .mul(threeCrvTokenScale)
            .div(threePoolVirtualPrice.mul(underlyingScale))
        log(`Deposit Slippage (Basis Points): ${depositSlippage}`)
        const minExpectedLpTokens = expectedLpTokens.mul(10000 - depositSlippage).div(10000)
        log(`Oracle minExpectedLpTokens ${minExpectedLpTokens.toString()}`)

        const lpTokensBefore = await threeCrvToken.balanceOf(owner.address)
        await threePool.add_liquidity(getAssetArray(actualLiquidityAmount, underlyingIndex), 0)
        const lpTokensAfter = await threeCrvToken.balanceOf(owner.address)

        const receivedTokens = lpTokensAfter.sub(lpTokensBefore)
        log("ReceivedTokens: " + receivedTokens.toString())

        expect(receivedTokens, "Received Tokens").to.gt(minExpectedLpTokens)

        const differenceInActualAndExpected = basisPointDiff(receivedTokens, expectedLpTokens)
        log(`Actual vs Expected LpTokens (Basis Points): ${differenceInActualAndExpected.toString()}`)

        const differenceInActualvsMinimum = basisPointDiff(receivedTokens, minExpectedLpTokens)
        log(`Actual vs Minimum LpTokens (Basis Points): ${differenceInActualvsMinimum}`)
        expect(receivedTokens).gte(minExpectedLpTokens)
    }

    const redeem = async (
        owner: Account,
        lpTokensAmount: number,
        underlying: IERC20Metadata,
        withdrawSlippage: number = defaultWithdrawSlippage,
    ) => {
        await setUnderlyingIndex(underlying)
        await threeCrvToken.connect(owner.signer).approve(threePool.address, ethers.constants.MaxUint256)

        const threePoolVirtualPrice = await threePool.get_virtual_price()
        const underlyingScale = simpleToExactAmount(1, await underlying.decimals())
        const actualLpTokens = simpleToExactAmount(lpTokensAmount)

        const expectedAssets = threePoolVirtualPrice
            .mul(actualLpTokens)
            .mul(underlyingScale)
            .div(threePoolVirtualPriceScale.mul(threeCrvTokenScale))
        log(`Withdraw Slippage (Basis Points): ${withdrawSlippage}`)
        const minExpectedAssets = expectedAssets.mul(10000 - withdrawSlippage).div(10000)
        log(`Oracle minExpectedAssets ${minExpectedAssets.toString()}`)

        const assetsBefore = await underlying.balanceOf(owner.address)
        await threePool.remove_liquidity_one_coin(actualLpTokens, underlyingIndex, 0)
        const assetsAfter = await underlying.balanceOf(owner.address)

        const receivedAssets = assetsAfter.sub(assetsBefore)
        log("ReceivedAssets: " + receivedAssets.toString())

        expect(receivedAssets, "Received Assets").to.gt(minExpectedAssets)

        const differenceInActualAndExpected = basisPointDiff(receivedAssets, expectedAssets)
        log(`Actual vs Expected Assets (Basis Points): ${differenceInActualAndExpected.toString()}`)

        const differenceInActualvsMinimum = basisPointDiff(receivedAssets, minExpectedAssets)
        log(`Actual vs Minimum Assets (Basis Points): ${differenceInActualvsMinimum}`)
        expect(receivedAssets).gte(minExpectedAssets)
    }

    const withdraw = async (owner: Account, liquidityAmount: number, underlying: IERC20Metadata) => {
        await setUnderlyingIndex(underlying)
        const underlyingScale = simpleToExactAmount(1, await underlying.decimals())
        const actualLiquidityAmount = simpleToExactAmount(liquidityAmount, await underlying.decimals())
        const threePoolVirtualPrice = await threePool.get_virtual_price()

        const expectedLpTokens = actualLiquidityAmount
            .mul(threePoolVirtualPriceScale)
            .mul(threeCrvTokenScale)
            .div(threePoolVirtualPrice.mul(underlyingScale))

        const sharesCalculatedVP = expectedLpTokens.mul(10000 + 10).div(10000)

        const fee = await threePool.fee()
        const curveFeeScale = BN.from(10).pow(10)
        const curveFeeAdjust = BN.from(10).pow(4).mul(5)

        const coin0Bal = (await threePool.balances(0)).div(underlying0Scale)
        const coin1Bal = (await threePool.balances(1)).div(underlying1Scale)
        const coin2Bal = (await threePool.balances(2)).div(underlying2Scale)
        const totalBal = coin0Bal.add(coin1Bal).add(coin2Bal)
        let mainBal: BN
        let othersBal: BN

        switch (underlyingIndex) {
            case 0:
                mainBal = coin0Bal
                othersBal = coin1Bal.add(coin2Bal)
                break
            case 1:
                mainBal = coin1Bal
                othersBal = coin0Bal.add(coin2Bal)
                break
            case 2:
                mainBal = coin2Bal
                othersBal = coin0Bal.add(coin1Bal)
                break
        }

        log(` Underlying Balance in pool: ${mainBal.toNumber().toLocaleString("en-US")}`)
        const assetsAdjusted = actualLiquidityAmount
            .mul(totalBal)
            .div(mainBal.add(othersBal.mul(curveFeeScale.sub(fee).add(curveFeeAdjust)).div(curveFeeScale)))

        const sharesCalculatedCurve = await threePool.calc_token_amount(getAssetArray(assetsAdjusted, underlyingIndex), false)

        const assetsBeforeCurve = await underlying.balanceOf(owner.address)
        await threePool.remove_liquidity_one_coin(sharesCalculatedCurve, underlyingIndex, actualLiquidityAmount)
        const assetsAfterCurve = await underlying.balanceOf(owner.address)

        const receivedAssetsCurve = assetsAfterCurve.sub(assetsBeforeCurve)

        const differenceCurve = basisPointDiff(receivedAssetsCurve, actualLiquidityAmount)
        log(` Curve Actual vs Expected Assets (Basis Points): ${differenceCurve.toString()}`)
        log(` Received - Demanded Assets: ${receivedAssetsCurve.sub(actualLiquidityAmount).div(underlyingScale).toString()}`)
        expect(receivedAssetsCurve, "Received Assets").to.gt(actualLiquidityAmount)
    }

    const mint = async (owner: Account, lpTokensAmount: number, underlying: IERC20Metadata) => {
        await setUnderlyingIndex(underlying)
        await underlying.connect(owner.signer).approve(threePool.address, ethers.constants.MaxUint256)
        const underlyingScale = simpleToExactAmount(1, await underlying.decimals())
        const actualLpTokens = simpleToExactAmount(lpTokensAmount)
        const threePoolVirtualPrice = await threePool.get_virtual_price()

        const fee = await threePool.fee()
        const curveFeeScale = BN.from(10).pow(10)
        const curveFeeAdjust = BN.from(10).pow(4).mul(5)

        const coin0Bal = (await threePool.balances(0)).div(underlying0Scale)
        const coin1Bal = (await threePool.balances(1)).div(underlying1Scale)
        const coin2Bal = (await threePool.balances(2)).div(underlying2Scale)
        const totalBal = coin0Bal.add(coin1Bal).add(coin2Bal)
        let mainBal: BN
        let othersBal: BN

        switch (underlyingIndex) {
            case 0:
                mainBal = coin0Bal
                othersBal = coin1Bal.add(coin2Bal)
                break
            case 1:
                mainBal = coin1Bal
                othersBal = coin0Bal.add(coin2Bal)
                break
            case 2:
                mainBal = coin2Bal
                othersBal = coin0Bal.add(coin1Bal)
                break
        }

        const expectedAssets = threePoolVirtualPrice
            .mul(actualLpTokens)
            .mul(underlyingScale)
            .div(threePoolVirtualPriceScale.mul(threeCrvTokenScale))

        const assetsCalculatedVP = expectedAssets.mul(10000 + 10).div(10000)

        const assetsCalculatedCurve = await threePool.calc_withdraw_one_coin(actualLpTokens, underlyingIndex)

        let assetsCalculatedCurveNew = assetsCalculatedCurve.mul(2).sub(expectedAssets).mul(expectedAssets).div(assetsCalculatedCurve)
        assetsCalculatedCurveNew = assetsCalculatedCurveNew.mul(10000 + 2).div(10000)

        let assetsCheckAmount = assetsCalculatedCurveNew
            .mul(totalBal)
            .div(mainBal.add(othersBal.mul(curveFeeScale).div(curveFeeScale.sub(fee).add(curveFeeAdjust))))
        let lpTokensCheckAmount = await threePool.calc_token_amount(getAssetArray(assetsCheckAmount, underlyingIndex), true)

        // for Loop:  increase 1 basis point each iteration check with calc_token_amount
        while (lpTokensCheckAmount.lt(actualLpTokens)) {
            assetsCalculatedCurveNew = assetsCalculatedCurveNew.mul(10000 + 1).div(10000)
            assetsCheckAmount = assetsCalculatedCurveNew
                .mul(totalBal)
                .div(mainBal.add(othersBal.mul(curveFeeScale).div(curveFeeScale.sub(fee).add(curveFeeAdjust))))
            lpTokensCheckAmount = await threePool.calc_token_amount(getAssetArray(assetsCheckAmount, underlyingIndex), true)
        }

        const lpTokensBeforeCurve = await threeCrvToken.balanceOf(owner.address)
        await threePool.add_liquidity(getAssetArray(assetsCalculatedCurveNew, underlyingIndex), actualLpTokens)
        const lpTokensAfterCurve = await threeCrvToken.balanceOf(owner.address)
        const receivedTokensCurve = lpTokensAfterCurve.sub(lpTokensBeforeCurve)

        const differenceCurve = basisPointDiff(receivedTokensCurve, actualLpTokens)

        log(` Curve Actual vs Expected LpTokens (Basis Points): ${differenceCurve.toString()}`)
        log(` Received - Demanded LpTokens: ${receivedTokensCurve.sub(actualLpTokens).div(threeCrvTokenScale).toString()}`)
        expect(receivedTokensCurve, "Received Assets").to.gt(actualLpTokens)
    }

    xit("testOracleDepositMinAmount", async () => {
        await reset(14810528)
        initialise(usdtStaker)
        await deposit(usdtStaker, 100000, usdtToken, 50)
    })

    xit("testOracleRedeemMinAmount", async () => {
        await reset(14810528)
        initialise(threePoolWhale)
        await redeem(threePoolWhale, 100000, usdtToken, 100)
    })

    xit("testWithdrawAmountFormula", async () => {
        await reset(normalBlock)
        initialise(threePoolWhale)
        await withdraw(threePoolWhale, 100000, usdtToken)
    })

    xit("testMintAmountFormula", async () => {
        await reset(normalBlock)
        initialise(usdtStaker)
        await mint(usdtStaker, 100000, usdtToken)
    })

    const setUnderlyingIndex = async (underlying: IERC20Metadata) => {
        for (let i = 0; i < 3; i++) {
            if ((await threePool.coins(i)) == underlying.address) {
                underlyingIndex = i
                break
            }
        }
    }

    const getAssetArray = (amount: BigNumberish, index: number): [BigNumberish, BigNumberish, BigNumberish] => {
        switch (index) {
            case 0:
                return [amount, 0, 0]
            case 1:
                return [0, amount, 0]
            case 2:
                return [0, 0, amount]
        }
    }

    const testBlockNumbers = [normalBlock /* mediumDepegBlock, maxDepegBlock */]
    const depositLiquidityAmounts = [100000, 1000000, 10000000, 100000000, 1000000000]
    const withdrawLpTokensAmounts = [100000, 1000000, 10000000, 25000000, 50000000, 75000000, 100000000, 150000000]
    const daiDepositLiquidityAmounts = [100000, 1000000, 10000000, 100000000, 250000000]
    const withdrawAssetsAmount = [10000, 100000, 1000000, 10000000, 25000000, 50000000, 75000000, 100000000]

    testBlockNumbers.forEach((blockNumber) => {
        //// USDT ////
        describe(`USDT, Block number: ${blockNumber}`, () => {
            beforeEach(async () => {
                await reset(blockNumber)
            })
            depositLiquidityAmounts.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, USDT deposit amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(usdtStaker)
                    await deposit(usdtStaker, liquidityAmount, usdtToken, 100)
                })
            })
            withdrawLpTokensAmounts.forEach((lpTokens) => {
                it(`block ${blockNumber}, Redeem amount ${lpTokens.toLocaleString("en-US")}`, async () => {
                    initialise(threePoolWhale)
                    await redeem(threePoolWhale, lpTokens, usdtToken, 100)
                })
            })
            withdrawAssetsAmount.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, USDT demand amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(threePoolWhale)
                    await withdraw(threePoolWhale, liquidityAmount, usdtToken)
                })
            })
            withdrawLpTokensAmounts.forEach((lpTokens) => {
                it(`block ${blockNumber}, LpTokens demand amount ${lpTokens.toLocaleString("en-US")}`, async () => {
                    initialise(usdtStaker)
                    await mint(usdtStaker, lpTokens, usdtToken)
                })
            })
        })

        //// USDC ////
        describe(`USDC, Block number: ${blockNumber}`, () => {
            beforeEach(async () => {
                await reset(blockNumber)
            })
            depositLiquidityAmounts.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, USDC deposit amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(usdcStaker)
                    await deposit(usdcStaker, liquidityAmount, usdcToken, 100)
                })
            })
            withdrawLpTokensAmounts.forEach((lpTokens) => {
                it(`block ${blockNumber}, lpTokens withdraw amount ${lpTokens.toLocaleString("en-US")}`, async () => {
                    initialise(threePoolWhale)
                    await redeem(threePoolWhale, lpTokens, usdcToken, 100)
                })
            })
            withdrawAssetsAmount.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, USDC demand amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(threePoolWhale)
                    await withdraw(threePoolWhale, liquidityAmount, usdcToken)
                })
            })
            withdrawLpTokensAmounts.forEach((lpTokens) => {
                it(`block ${blockNumber}, LpTokens demand amount ${lpTokens.toLocaleString("en-US")}`, async () => {
                    initialise(usdcStaker)
                    await mint(usdcStaker, lpTokens, usdcToken)
                })
            })
        })

        //// DAI ////
        describe(`DAI, Block number: ${blockNumber}`, () => {
            beforeEach(async () => {
                await reset(blockNumber)
            })
            daiDepositLiquidityAmounts.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, DAI deposit amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(daiStaker)
                    await deposit(daiStaker, liquidityAmount, daiToken, 100)
                })
            })
            withdrawLpTokensAmounts.forEach((lpTokens) => {
                it(`block ${blockNumber}, lpTokens withdraw amount ${lpTokens.toLocaleString("en-US")}`, async () => {
                    initialise(threePoolWhale)
                    await redeem(threePoolWhale, lpTokens, daiToken, 100)
                })
            })
            withdrawAssetsAmount.forEach((liquidityAmount) => {
                it(`block ${blockNumber}, DAI demand amount ${liquidityAmount.toLocaleString("en-US")}`, async () => {
                    initialise(threePoolWhale)
                    await withdraw(threePoolWhale, liquidityAmount, daiToken)
                })
            })
            withdrawLpTokensAmounts.forEach((lpTokens) => {
                it(`block ${blockNumber}, LpTokens demand amount ${lpTokens.toLocaleString("en-US")}`, async () => {
                    initialise(daiStaker)
                    await mint(daiStaker, lpTokens, daiToken)
                })
            })
        })
    })
})
