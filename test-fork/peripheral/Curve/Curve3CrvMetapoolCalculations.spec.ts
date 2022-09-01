import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { DAI, mUSD, musd3CRV, resolveAddress, ThreeCRV, USDC, usdFormatter } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { impersonateAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { musdConvexConstructorData } from "@utils/peripheral/convex-curve"
import { expect } from "chai"
import { ethers } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import * as hre from "hardhat"
import {
    Curve3CrvMetapoolCalculator__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
    ICurve3Pool__factory,
    ICurveMetapool__factory,
    IERC20__factory,
} from "types/generated"

import type { Account } from "types/common"
import type { Curve3CrvMetapoolCalculator, ICurve3Pool, ICurveMetapool, IERC20 } from "types/generated"

const log = logger("test:Curve3CrvMetaCalcs")

const curveThreePoolAddress = resolveAddress("CurveThreePool")
const curveMUSDPoolAddress = resolveAddress("CurveMUSDPool")

const staker1Address = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503"
const musdWhaleAddress = "0x30647a72dc82d7fbb1123ea74716ab8a317eac19" // Savings Contract imUSD
const musd3CrvWhaleAddress = "0xe6e6e25efda5f69687aa9914f8d750c523a1d261" // EARN Pool Curve mUSD/3Pool
const threeCrvWhaleAddress1 = "0xbfcf63294ad7105dea65aa58f8ae5be2d9d0952a" // Curve 3Crv Gauge
const threeCrvWhaleAddress3 = "0xed279fdd11ca84beef15af5d39bb4d4bee23f0ca" // currently 3rd largest
// 3Crv
// 667,730,831.736980523295783974 // Gauge block 12510000
//  20,148,777.565353658424621863 // Frax  block 12510000
// 100,232,754.859360818168922491 // 3rd   block 12510000
// 234,928,920.907353737365095906 // Gauge block 14955000
// 786,213,997.084826288516095812 // Frax  block 14955000
//  57,461,511.123409734403939120 // 3rd   block 14955000
// musd3Crv
//  3,927,034.955321649070338494 // Gauge block 12510000
// 59,331,253.284864256770402509 // Gauge block 14955000

describe("Curve 3Crv metapool calculations", async () => {
    let staker1: Account
    let threeCrvWhale1: Account
    let threeCrvWhale3: Account
    let musdWhale: Account
    let musd3CrvWhale: Account
    let threeCrvToken: IERC20
    let threePool: ICurve3Pool
    let metapoolCalculator: Curve3CrvMetapoolCalculator
    let musdMetapool: ICurveMetapool
    let musd3CrvToken: IERC20
    let musdToken: IERC20
    let usdcToken: IERC20
    let daiToken: IERC20
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
        threeCrvWhale1 = await impersonateAccount(threeCrvWhaleAddress1)
        threeCrvWhale3 = await impersonateAccount(threeCrvWhaleAddress3)
        musdWhale = await impersonateAccount(musdWhaleAddress)
        musd3CrvWhale = await impersonateAccount(musd3CrvWhaleAddress)

        const calculatorLibrary = await new Curve3CrvMetapoolCalculatorLibrary__factory(staker1.signer).deploy()
        const libraryAddresses = {
            "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary":
                calculatorLibrary.address,
        }
        metapoolCalculator = await new Curve3CrvMetapoolCalculator__factory(libraryAddresses, staker1.signer).deploy(
            musdConvexConstructorData.metapool,
            musdConvexConstructorData.metapoolToken,
        )
    }

    const initialise = (owner: Account) => {
        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, owner.signer)
        threePool = ICurve3Pool__factory.connect(curveThreePoolAddress, owner.signer)
        musdMetapool = ICurveMetapool__factory.connect(curveMUSDPoolAddress, owner.signer)
        musd3CrvToken = IERC20__factory.connect(musd3CRV.address, owner.signer)
        musdToken = IERC20__factory.connect(mUSD.address, owner.signer)
        usdcToken = IERC20__factory.connect(USDC.address, owner.signer)
        daiToken = IERC20__factory.connect(DAI.address, owner.signer)
    }

    const outputMetapoolBalances = async (when = "") => {
        const coin0Bal = await musdMetapool.balances(0)
        const threeCrvBal = await musdMetapool.balances(1)

        const metapoolTotalBal = coin0Bal.add(threeCrvBal)
        log(`\nmusd3Crv Metapool balances ${when}`)
        log(`${usdFormatter(coin0Bal)} coin ${formatUnits(coin0Bal.mul(10000).div(metapoolTotalBal), 2)}%`)
        log(`${usdFormatter(threeCrvBal)} 3Crv ${formatUnits(threeCrvBal.mul(10000).div(metapoolTotalBal), 2)}%`)
        log(`${usdFormatter(metapoolTotalBal)} Total`)
    }

    const depositMetapool = async (metapoolToken: IERC20, owner: Account, threeCrvAmount: number) => {
        const threeCrvScaled = simpleToExactAmount(threeCrvAmount)

        const threeCrvBefore = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        const [metapoolLpCalculated] = await metapoolCalculator.calcDeposit(threeCrvScaled, 1)
        const unsignedTx = await metapoolCalculator.connect(owner.signer).populateTransaction.calcDeposit(threeCrvScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(threeCrvBefore, "enough base pool LP tokens (3Crv) to deposit").to.gte(threeCrvScaled)

        await threeCrvToken.connect(owner.signer).approve(musdMetapool.address, threeCrvScaled)
        await musdMetapool.connect(owner.signer).add_liquidity([0, threeCrvScaled], 0)

        const threeCrvAfter = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const threeCrvActual = threeCrvBefore.sub(threeCrvAfter)
        const metapoolLpActual = metapoolLpAfter.sub(metapoolLpBefore)
        const metapoolLpDiff = metapoolLpCalculated.sub(metapoolLpActual)
        const metapoolLpDiffBps = metapoolLpDiff.mul(1000000).div(metapoolLpActual)

        log(
            `musd3Crv ${usdFormatter(threeCrvScaled)} 3Crv deposited for ${usdFormatter(
                metapoolLpActual,
            )} actual LP, calculated LP ${usdFormatter(metapoolLpCalculated)} diff ${metapoolLpDiff} ${formatUnits(
                metapoolLpDiffBps,
                2,
            )} bps`,
        )

        expect(threeCrvScaled, "requested == actual 3Crv deposited").to.eq(threeCrvActual)
        expect(metapoolLpCalculated, "calculated <= actual Metapool LP tokens (musd3Crv) minted").lte(metapoolLpActual)
    }

    const withdrawMetapool = async (metapoolToken: IERC20, owner: Account, threeCrvAmount: number) => {
        const threeCrvScaled = simpleToExactAmount(threeCrvAmount)

        const threeCrvBefore = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        const [metapoolLpCalculated] = await metapoolCalculator.calcWithdraw(threeCrvScaled, 1)
        const unsignedTx = await metapoolCalculator.connect(owner.signer).populateTransaction.calcWithdraw(threeCrvScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        log(`Metapool LP (musd3Crv) balance ${usdFormatter(await metapoolToken.balanceOf(owner.address))}`)

        await musdMetapool.connect(owner.signer).remove_liquidity_imbalance([0, threeCrvScaled], ethers.constants.MaxUint256)

        const threeCrvAfter = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const threeCrvActual = threeCrvAfter.sub(threeCrvBefore)
        const metapoolLpActual = metapoolLpBefore.sub(metapoolLpAfter)
        const metapoolLpDiff = metapoolLpCalculated.sub(metapoolLpActual)
        const metapoolLpDiffBps = metapoolLpDiff.mul(100000000).div(metapoolLpActual)

        log(
            `musd3Crv ${usdFormatter(threeCrvScaled)} 3Crv withdrawn for ${usdFormatter(
                metapoolLpActual,
            )} actual LP, calculated LP ${usdFormatter(metapoolLpCalculated)} diff ${metapoolLpDiff} ${formatUnits(
                metapoolLpDiffBps,
                4,
            )} bps`,
        )

        expect(threeCrvScaled, "requested == actual 3Crv withdrawn").to.eq(threeCrvActual)
        expect(metapoolLpCalculated, "calculated >= actual Metapool LP tokens (musd3Crv) burnt").gte(metapoolLpActual)
    }

    const mintMetapool = async (metapoolToken: IERC20, owner: Account, lpAmount: number) => {
        const lpAmountScaled = simpleToExactAmount(lpAmount)

        const threeCrvBefore = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        // Calculate 3Crv to deposit for the required metapool LP tokens
        const [threeCrvCalculated] = await metapoolCalculator.calcMint(lpAmountScaled, 1)

        const unsignedTx = await metapoolCalculator.connect(owner.signer).populateTransaction.calcMint(lpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(threeCrvBefore, "enough 3Crv tokens to deposit").to.gte(threeCrvCalculated)

        await threeCrvToken.connect(owner.signer).approve(musdMetapool.address, threeCrvCalculated)
        await musdMetapool.connect(owner.signer).add_liquidity([0, threeCrvCalculated], 0)

        const threeCrvAfter = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const lpActual = metapoolLpAfter.sub(metapoolLpBefore)
        const threeCrvActual = threeCrvBefore.sub(threeCrvAfter)
        const lpDiff = lpAmountScaled.sub(lpActual)
        const lpDiffBps = lpDiff.mul(100000000).div(lpActual)

        log(
            `3Pool calculated ${usdFormatter(threeCrvCalculated)} 3Crv tokens added for required ${usdFormatter(
                lpAmountScaled,
            )} metapool LP tokens, actual LP ${usdFormatter(lpActual)} diff ${lpDiff} ${formatUnits(lpDiffBps, 4)}`,
        )

        expect(threeCrvActual, "calculated == actual assets (3Crv)").to.eq(threeCrvCalculated)
        expect(lpActual, "actual >= required metapool LP tokens").to.gte(lpAmountScaled)
    }

    const redeemMetapool = async (metapoolToken: IERC20, owner: Account, lpAmount: number) => {
        const metapoolLpAmountScaled = simpleToExactAmount(lpAmount)

        const threeCrvBefore = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        // Estimate USDC assets received from pool for burning LP tokens
        const threeCrvEstimated = await musdMetapool.connect(owner.signer).calc_withdraw_one_coin(metapoolLpAmountScaled, 1)
        let unsignedTx = await musdMetapool.connect(owner.signer).populateTransaction.calc_withdraw_one_coin(metapoolLpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        const [threeCrvCalculated] = await metapoolCalculator.calcRedeem(metapoolLpAmountScaled, 1)

        unsignedTx = await metapoolCalculator.connect(owner.signer).populateTransaction.calcRedeem(metapoolLpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(metapoolLpBefore, "enough metapool LP tokens (musd3Crv) to withdraw").to.gte(metapoolLpAmountScaled)

        await musdMetapool.connect(owner.signer).remove_liquidity_one_coin(metapoolLpAmountScaled, 1, 0)

        const threeCrvAfter = await threeCrvToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const lpActual = metapoolLpBefore.sub(metapoolLpAfter)
        const threeCrvActual = threeCrvAfter.sub(threeCrvBefore)
        const threeCrvEstimatedDiff = threeCrvEstimated.sub(threeCrvActual)
        const threeCrvEstimatedDiffBps = threeCrvEstimatedDiff.mul(100000000).div(threeCrvActual)
        const threeCrvCalculatedDiff = threeCrvCalculated.sub(threeCrvActual)
        const threeCrvCalculatedDiffBps = threeCrvCalculatedDiff.mul(100000000).div(threeCrvActual)

        log(
            `3Pool ${usdFormatter(metapoolLpAmountScaled)} metapool LP tokens removed for ${usdFormatter(
                threeCrvActual,
            )} actual 3Crv\ncalculated 3Crv ${usdFormatter(threeCrvCalculated)} diff ${threeCrvCalculatedDiff} ${formatUnits(
                threeCrvCalculatedDiffBps,
                4,
            )} bps\nestimated 3Crv ${usdFormatter(threeCrvEstimated)} diff ${threeCrvEstimatedDiff} ${formatUnits(
                threeCrvEstimatedDiffBps,
                4,
            )} bps`,
        )

        expect(lpActual, "actual == require metapool LP tokens (musd3Crv)").to.eq(metapoolLpAmountScaled)
        expect(threeCrvEstimated, "estimated == actual assets (3Crv)").to.eq(threeCrvActual)
        expect(threeCrvCalculated, "calculated == actual assets (3Crv)").to.eq(threeCrvActual)
    }

    const testCalculations = (blockNumber: number, rebalance3Pool: () => Promise<void>, rebalanceMetapool: () => Promise<void>) => {
        const setup = async () => {
            await reset(blockNumber)
            initialise(staker1)
            await rebalance3Pool()
            await rebalanceMetapool()
            await outputMetapoolBalances("before")
            await usdcToken.connect(staker1.signer).approve(threePool.address, ethers.constants.MaxUint256)
        }
        beforeEach(async () => {
            await loadFixture(setup)
        })
        after(async () => {
            await outputMetapoolBalances("after")
        })
        it("Remove liquidity symmetry", async () => {
            const mus3CrvTokens = simpleToExactAmount(1000000)
            console.log(`Redeem ${usdFormatter(mus3CrvTokens, 18, 14, 18)} Metapool LP tokens (musd3Crv)`)
            // Redeem Metapool LP tokens
            const threeCrvActual = await musdMetapool
                .connect(musd3CrvWhale.signer)
                .callStatic.remove_liquidity_one_coin(mus3CrvTokens, 1, 0)
            console.log(`${usdFormatter(threeCrvActual, 18, 14, 18)} 3Crv withdrawn`)

            // Redeem assets (3Crv) from Metapool
            console.log(`Withdraw ${usdFormatter(threeCrvActual, 18, 14, 18)} 3Crv`)
            const mus3CrvActual = await musdMetapool
                .connect(musd3CrvWhale.signer)
                .callStatic.remove_liquidity_imbalance([0, threeCrvActual], mus3CrvTokens)
            console.log(`${usdFormatter(mus3CrvActual, 18, 14, 18)} Metapool LP tokens (musd3Crv) were burned`)
            const mus3CrvDiff = mus3CrvTokens.sub(mus3CrvActual)
            const mus3CrvDiffBp = mus3CrvDiff.mul(10000000000).div(mus3CrvTokens)
            console.log(`Diff ${formatUnits(mus3CrvDiff, 18)} ${formatUnits(mus3CrvDiffBp, 6)} bps`)

            // expect(mus3CrvActual, "mus3Crv").to.eq(mus3CrvTokens)
        })
        it("Deposit 40m 3Crv to musd3Crv", async () => {
            await depositMetapool(musd3CrvToken, threeCrvWhale1, 40000000)
        })
        it("Withdraw 300k 3Crv from musd3Crv", async () => {
            await withdrawMetapool(musd3CrvToken, musd3CrvWhale, 300000)
        })
        it("Mint 10m musd3Crv from musd3Crv for 3Crv", async () => {
            await mintMetapool(musd3CrvToken, threeCrvWhale1, 40000000)
        })
        it("Redeem 1m musd3Crv to musd3Crv for 3Crv", async () => {
            await redeemMetapool(musd3CrvToken, musd3CrvWhale, 1000000)
        })
        it("Convert 100 meta pool lp tokens musd3Crv to base pool lp tokens (3Crv)", async () => {
            const musd3CrvTokens = simpleToExactAmount(100)
            const threeCrvTokens = await metapoolCalculator.convertToBaseLp(musd3CrvTokens, true)
            log(`${usdFormatter(musd3CrvTokens)} musd3Crv = ${usdFormatter(threeCrvTokens)} threeCrv`)
            expect(threeCrvTokens, "3Crv < musd3Crv").lt(musd3CrvTokens)

            await staker1.signer.sendTransaction(
                await metapoolCalculator.connect(staker1.signer).populateTransaction.convertToBaseLp(musd3CrvTokens, true),
            )
        })
        it("Convert 100 base pool lp tokens 3Crv to metapool lp tokens (musd3Crv)", async () => {
            const threeCrvTokens = simpleToExactAmount(100)
            const musd3CrvTokens = await metapoolCalculator.convertToMetaLp(threeCrvTokens, true)
            log(`${usdFormatter(threeCrvTokens)} 3Crv = ${usdFormatter(musd3CrvTokens)} musd3Crv`)
            expect(threeCrvTokens, "3Crv < musd3Crv").lt(musd3CrvTokens)

            await staker1.signer.sendTransaction(
                await metapoolCalculator.connect(staker1.signer).populateTransaction.convertToMetaLp(threeCrvTokens, true),
            )
        })
        it("Metapool virtual prices", async () => {
            const expectedMetapoolVP = await musdMetapool.get_virtual_price()
            const expected3PoolVP = await threePool.get_virtual_price()
            const [actualMetapoolVP, actual3PoolVP] = await metapoolCalculator.getVirtualPrices(false)
            expect(actualMetapoolVP, "Metapool virtual price").to.eq(expectedMetapoolVP)
            expect(actual3PoolVP, "3Pool virtual price").to.eq(expected3PoolVP)

            await staker1.signer.sendTransaction(await musdMetapool.connect(staker1.signer).populateTransaction.get_virtual_price())
            await staker1.signer.sendTransaction(
                await metapoolCalculator.connect(staker1.signer).populateTransaction.getVirtualPrices(false),
            )
        })
    }
    const usdcOverweight3Pool = async () => {
        // Add 600m USDC
        await usdcToken.connect(staker1.signer).approve(threePool.address, ethers.constants.MaxUint256)
        await threePool.connect(staker1.signer).add_liquidity([0, simpleToExactAmount(600000000, USDC.decimals), 0], 0)
    }
    const usdcUnderweight3Pool = async () => {
        // Add 100m DAI to 3Pool
        await daiToken.connect(staker1.signer).approve(threePool.address, ethers.constants.MaxUint256)
        await threePool.connect(staker1.signer).add_liquidity([simpleToExactAmount(100000000, DAI.decimals), 0, 0], 0)
        // Remove 160m USDC from 3Pool
        await threePool.connect(threeCrvWhale1.signer).remove_liquidity_one_coin(simpleToExactAmount(160000000), 1, 0)
    }
    const balanced3Pool = async () => {
        // Remove 300m DAI from 3Pool
        await threePool.connect(threeCrvWhale1.signer).remove_liquidity_one_coin(simpleToExactAmount(300000000), 0, 0)
        // Remove 300m USDC from 3Pool
        await threePool.connect(threeCrvWhale1.signer).remove_liquidity_one_coin(simpleToExactAmount(130000000), 1, 0)
    }
    const threeCrvOverweightMetapool = async () => {
        // Add 57m 3Crv to Metapool
        await threeCrvToken.connect(threeCrvWhale3.signer).approve(musdMetapool.address, ethers.constants.MaxUint256)
        await musdMetapool.connect(threeCrvWhale3.signer).add_liquidity([0, simpleToExactAmount(57000000)], 0)
    }
    const threeCrvUnderweightMetapool = async () => {
        // Add 20m mUSD to Metapool
        await musdToken.connect(musdWhale.signer).approve(musdMetapool.address, ethers.constants.MaxUint256)
        await musdMetapool.connect(musdWhale.signer).add_liquidity([simpleToExactAmount(20000000), 0], 0)
        // Remove 2m 3Crv
        await musdMetapool.connect(musd3CrvWhale.signer).remove_liquidity_one_coin(simpleToExactAmount(2000000), 1, 0)
    }
    const balancedMetapool = async () => {
        // Add 900k mUSD to Metapool
        await musdToken.connect(musdWhale.signer).approve(musdMetapool.address, ethers.constants.MaxUint256)
        await musdMetapool.connect(musdWhale.signer).add_liquidity([simpleToExactAmount(900000), 0], 0)
    }

    context("underweight USDC in 3Pool", () => {
        const blockNumber = 14955000
        describe(`overweight 3Crv in Metapool`, () => {
            testCalculations(blockNumber, usdcUnderweight3Pool, threeCrvOverweightMetapool)
        })
        describe(`underweight 3Crv in Metapool`, () => {
            testCalculations(blockNumber, usdcUnderweight3Pool, threeCrvUnderweightMetapool)
        })
    })
    context("overweight USDC in 3Pool", () => {
        const blockNumber = 12510000
        describe(`overweight 3Crv in Metapool`, () => {
            testCalculations(blockNumber, usdcOverweight3Pool, threeCrvOverweightMetapool)
        })
        describe(`underweight 3Crv in Metapool`, () => {
            testCalculations(blockNumber, usdcOverweight3Pool, threeCrvUnderweightMetapool)
        })
    })
    describe(`balanced 3Pool and balanced Metapool`, () => {
        testCalculations(14720000, balanced3Pool, balancedMetapool)
    })
    context("musd3Crv mainnet tx replication", () => {
        it("Deposit 14082.15 3Crv for LP tokens", async () => {
            await reset(14973627)
            initialise(threeCrvWhale1)
            await outputMetapoolBalances()

            await threeCrvToken.approve(musdMetapool.address, ethers.constants.MaxUint256)

            const threeCrvBefore = await threeCrvToken.balanceOf(threeCrvWhale1.address)
            const lpBefore = await musd3CrvToken.balanceOf(threeCrvWhale1.address)
            // 0x978ec0c996580d5f1fab35c03f9878fd31a1ba306e188a0877cf02a84605fc4d
            const threeCrvTokens = simpleToExactAmount(1408215, 16)
            const expectedLlpTokens = BN.from("14133074249861806636919")

            const [calculatedLp] = await metapoolCalculator.calcDeposit(threeCrvTokens, 1)

            expect(threeCrvBefore, "enough LP tokens (3Crv) to deposit").to.gte(threeCrvTokens)

            await musdMetapool.connect(threeCrvWhale1.signer).add_liquidity([0, threeCrvTokens], 0)

            const threeCrvAfter = await threeCrvToken.balanceOf(threeCrvWhale1.address)
            const lpAfter = await musd3CrvToken.balanceOf(threeCrvWhale1.address)
            const lpActual = lpAfter.sub(lpBefore)

            expect(threeCrvBefore.sub(threeCrvAfter), "actual == requested 3Crv tokens").to.eq(threeCrvTokens)
            expect(lpActual, "actual == expected LP tokens").to.eq(expectedLlpTokens)
            expect(calculatedLp, "calculated <= actual LP tokens").to.lte(lpActual)
            expect(calculatedLp, "calculated = expected LP tokens").to.eq(expectedLlpTokens)
        })
    })
})
