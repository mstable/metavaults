import { DAI, resolveAddress, ThreeCRV, USDC, usdFormatter, USDT } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { impersonateAccount, loadOrExecFixture } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { BigNumber, ethers } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import * as hre from "hardhat"
import { Curve3PoolCalculator__factory, Curve3PoolCalculatorLibrary__factory, ICurve3Pool__factory, IERC20__factory } from "types/generated"

import type { BlockTag } from "@nomicfoundation/hardhat-network-helpers/dist/src/types"
import type { Account } from "types/common"
import type { Curve3PoolCalculator, ICurve3Pool, IERC20 } from "types/generated"

const log = logger("test:Curve3PoolCalcs")

const curveThreePoolAddress = resolveAddress("CurveThreePool")

const staker1Address = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503"
const threeCrvWhaleAddress1 = "0xbfcf63294ad7105dea65aa58f8ae5be2d9d0952a" // Curve 3Crv Gauge
const threeCrvWhaleAddress2 = "0xd632f22692fac7611d2aa1c0d552930d43caed3b" // Frax Finance: FRAX3CRV-f Token
// 3Crv
// 667,730,831.736980523295783974 // Gauge block 12510000
//  20,148,777.565353658424621863 // Frax  block 12510000
// 100,232,754.859360818168922491 // 3rd   block 12510000
// 234,928,920.907353737365095906 // Gauge block 14955000
// 786,213,997.084826288516095812 // Frax  block 14955000
//  57,461,511.123409734403939120 // 3rd   block 14955000

describe("Curve 3Pool calculations", async () => {
    let staker1: Account
    let threeCrvWhale1: Account
    let threeCrvWhale2: Account
    let threeCrvToken: IERC20
    let threePool: ICurve3Pool
    let poolCalculator: Curve3PoolCalculator
    let usdcToken: IERC20
    let daiToken: IERC20
    let usdtToken: IERC20
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
        threeCrvWhale2 = await impersonateAccount(threeCrvWhaleAddress2)

        const threePoolCalculatorLibrary = await new Curve3PoolCalculatorLibrary__factory(staker1.signer).deploy()
        const curve3PoolCalculatorLibraryAddresses = {
            "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary": threePoolCalculatorLibrary.address,
        }
        poolCalculator = await new Curve3PoolCalculator__factory(curve3PoolCalculatorLibraryAddresses, staker1.signer).deploy()
    }

    const initialise = (owner: Account) => {
        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, owner.signer)
        threePool = ICurve3Pool__factory.connect(curveThreePoolAddress, owner.signer)
        usdcToken = IERC20__factory.connect(USDC.address, owner.signer)
        daiToken = IERC20__factory.connect(DAI.address, owner.signer)
        usdtToken = IERC20__factory.connect(USDT.address, owner.signer)
    }

    const output3PoolBalances = async (when = "", blockTag?: BlockTag) => {
        const daiBal = await threePool.balances(0, { blockTag })
        const usdcBal = (await threePool.balances(1, { blockTag })).mul(simpleToExactAmount(1, 18 - USDC.decimals))
        const usdtBal = (await threePool.balances(2, { blockTag })).mul(simpleToExactAmount(1, 18 - USDT.decimals))

        const threePoolTotalBal = daiBal.add(usdcBal).add(usdtBal)
        log(`3Pool balances ${when}`)
        log(`${usdFormatter(daiBal, 18, 16)} DAI  ${formatUnits(daiBal.mul(10000).div(threePoolTotalBal), 2)}%`)
        log(`${usdFormatter(usdcBal, 18, 16)} USDC ${formatUnits(usdcBal.mul(10000).div(threePoolTotalBal), 2)}%`)
        log(`${usdFormatter(usdtBal, 18, 16)} USDT ${formatUnits(usdtBal.mul(10000).div(threePoolTotalBal), 2)}%`)
        log(`${usdFormatter(threePoolTotalBal, 18, 16)} Total`)
    }

    const deposit3Pool = async (owner: Account, usdcAmount: number | BigNumber) => {
        const usdcScaled = BigNumber.isBigNumber(usdcAmount) ? usdcAmount : simpleToExactAmount(usdcAmount, USDC.decimals)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await threeCrvToken.balanceOf(owner.address)

        const lpEstimated = await threePool.calc_token_amount([0, usdcScaled, 0], true)
        await owner.signer.sendTransaction(
            await threePool.connect(owner.signer).populateTransaction.calc_token_amount([0, usdcScaled, 0], true),
        )

        const [lpCalculated] = await poolCalculator.calcDeposit(usdcScaled, 1)
        await owner.signer.sendTransaction(await poolCalculator.connect(owner.signer).populateTransaction.calcDeposit(usdcScaled, 1))

        expect(usdcBefore, "enough USDC tokens to deposit").to.gte(usdcScaled)

        await threePool.connect(owner.signer).add_liquidity([0, usdcScaled, 0], 0)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await threeCrvToken.balanceOf(owner.address)

        const usdcActual = usdcBefore.sub(usdcAfter)
        const lpActual = lpAfter.sub(lpBefore)
        const lpCalculatedDiff = lpCalculated.sub(lpActual)
        const lpEstimatedDiff = lpEstimated.sub(lpActual)
        const lpEstimatedDiffBps = lpEstimatedDiff.mul(100000000).div(lpActual)

        log(
            `3Pool ${usdFormatter(usdcActual, USDC.decimals)} USDC deposited for ${usdFormatter(
                lpActual,
            )} actual LP\ncalculated LP ${usdFormatter(lpCalculated)} diff ${lpCalculatedDiff}\nestimated LP ${usdFormatter(
                lpEstimated,
            )} diff ${lpEstimatedDiff} ${formatUnits(lpEstimatedDiffBps, 4)} bps`,
        )

        expect(usdcScaled, "requested == actual USDC").to.eq(usdcActual)
        expect(lpCalculated, "calculated <= actual ").to.lte(lpActual)
    }

    const withdraw3Pool = async (owner: Account, usdcAmount: number | BigNumber) => {
        const usdcScaled = BigNumber.isBigNumber(usdcAmount) ? usdcAmount : simpleToExactAmount(usdcAmount, USDC.decimals)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await threeCrvToken.balanceOf(owner.address)

        // estimate LP tokens from USDC
        const lpEstimated = await threePool.calc_token_amount([0, usdcScaled, 0], false)
        await owner.signer.sendTransaction(
            await threePool.connect(owner.signer).populateTransaction.calc_token_amount([0, usdcScaled, 0], false),
        )

        const [lpCalculated] = await poolCalculator.calcWithdraw(usdcScaled, 1)
        await owner.signer.sendTransaction(await poolCalculator.connect(owner.signer).populateTransaction.calcWithdraw(usdcScaled, 1))

        expect(lpBefore, "enough LP tokens (3Crv) to withdraw").to.gte(lpCalculated)

        await threePool.connect(owner.signer).remove_liquidity_imbalance([0, usdcScaled, 0], ethers.constants.MaxUint256)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await threeCrvToken.balanceOf(owner.address)

        const usdcActual = usdcAfter.sub(usdcBefore)
        const lpActual = lpBefore.sub(lpAfter)
        const lpCalculatedDiff = lpCalculated.sub(lpActual)
        const lpEstimatedDiff = lpEstimated.sub(lpActual)
        const lpEstimatedDiffBps = lpActual.gt(0) ? lpEstimatedDiff.mul(100000000).div(lpActual) : BN.from(0)

        log(
            `3Pool ${usdFormatter(usdcActual, USDC.decimals)} USDC withdrawn for ${usdFormatter(
                lpActual,
            )} actual LP\ncalculated LP ${usdFormatter(lpCalculated)} diff ${lpCalculatedDiff}\nestimated LP ${usdFormatter(
                lpEstimated,
            )} diff ${lpEstimatedDiff} ${formatUnits(lpEstimatedDiffBps, 4)} bps`,
        )

        expect(lpCalculated, "calculated >= actual LP tokens").to.gte(lpActual)
        expect(usdcScaled, "requested == actual USDC").to.eq(usdcActual)
    }

    const mint3Pool = async (owner: Account, lpAmount: number | BigNumber) => {
        const lpAmountScaled = BigNumber.isBigNumber(lpAmount) ? lpAmount : simpleToExactAmount(lpAmount)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await threeCrvToken.balanceOf(owner.address)

        // Calculate USDC assets for required LP tokens
        const [usdcCalculated] = await poolCalculator.calcMint(lpAmountScaled, 1)
        await owner.signer.sendTransaction(await poolCalculator.connect(owner.signer).populateTransaction.calcMint(lpAmountScaled, 1))

        expect(usdcBefore, "enough USDC tokens to deposit").to.gte(usdcCalculated)

        await threePool.connect(owner.signer).add_liquidity([0, usdcCalculated, 0], 0)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await threeCrvToken.balanceOf(owner.address)

        const lpActual = lpAfter.sub(lpBefore)
        const usdcActual = usdcBefore.sub(usdcAfter)
        const lpDiff = lpAmountScaled.sub(lpActual)
        const lpDiffBps = lpActual.gt(0) ? lpDiff.mul(100000000).div(lpActual) : BN.from(0)

        log(
            `3Pool calculated ${usdFormatter(usdcCalculated, USDC.decimals)} USDC tokens added for required ${usdFormatter(
                lpAmountScaled,
            )} LP tokens, actual LP ${usdFormatter(lpActual)} diff ${lpDiff} ${formatUnits(lpDiffBps, 4)}`,
        )

        expect(usdcCalculated, "calculated <= actual assets (USDC)").to.lte(usdcActual)
        expect(lpActual, "actual >= required LP tokens").to.gte(lpAmountScaled)
    }

    const redeem3Pool = async (owner: Account, lpAmount: number | BigNumber) => {
        const lpAmountScaled = BigNumber.isBigNumber(lpAmount) ? lpAmount : simpleToExactAmount(lpAmount)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await threeCrvToken.balanceOf(owner.address)

        // Estimate USDC assets received from pool for burning LP tokens
        const usdcEstimated = await threePool.connect(owner.signer).calc_withdraw_one_coin(lpAmountScaled, 1)
        await owner.signer.sendTransaction(
            await threePool.connect(owner.signer).populateTransaction.calc_withdraw_one_coin(lpAmountScaled, 1),
        )

        const [usdcCalculated] = await poolCalculator.calcRedeem(lpAmountScaled, 1)
        await owner.signer.sendTransaction(await poolCalculator.connect(owner.signer).populateTransaction.calcRedeem(lpAmountScaled, 1))

        expect(lpBefore, "enough LP tokens (3Crv) to withdraw").to.gte(lpAmountScaled)

        await threePool.connect(owner.signer).remove_liquidity_one_coin(lpAmountScaled, 1, 0)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await threeCrvToken.balanceOf(owner.address)

        const lpActual = lpBefore.sub(lpAfter)
        const usdcActual = usdcAfter.sub(usdcBefore)
        const usdcCalculatedDiff = usdcCalculated.sub(usdcActual)
        const usdcCalculatedDiffBps = usdcActual.gt(0) ? usdcCalculatedDiff.mul(1000000).div(usdcActual) : BN.from(0)
        const usdcEstimatedDiff = usdcEstimated.sub(usdcActual)
        const usdcEstimatedDiffBps = usdcActual.gt(0) ? usdcEstimatedDiff.mul(1000000).div(usdcActual) : BN.from(0)

        log(
            `3Pool ${lpAmount} LP tokens removed for ${usdFormatter(usdcActual, USDC.decimals)} actual USDC\ncalculated USDC ${usdFormatter(
                usdcCalculated,
                USDC.decimals,
            )} diff ${usdcCalculatedDiff} ${formatUnits(usdcCalculatedDiffBps, 2)} bps\nestimated USDC ${usdFormatter(
                usdcEstimated,
                USDC.decimals,
            )} diff ${usdcEstimatedDiff} ${formatUnits(usdcEstimatedDiffBps, 2)} bps`,
        )

        expect(lpActual, "actual == require LP tokens").to.eq(lpAmountScaled)
        expect(usdcEstimated, "estimated == actual assets (USDC)").to.eq(usdcActual)
        expect(usdcCalculated, "calculated == actual assets (USDC)").to.eq(usdcActual)
    }

    const testCalculations = (blockNumber: number, rebalance3Pool: () => Promise<void>, threeCrvWhale: () => Account) => {
        // The following are only needed for debugging
        after(async () => {
            await output3PoolBalances("after")
        })
        const setup = async () => {
            await reset(blockNumber)
            initialise(staker1)
            await rebalance3Pool()
            await output3PoolBalances("before")
            await usdcToken.connect(staker1.signer).approve(threePool.address, ethers.constants.MaxUint256)
        }
        beforeEach(async () => {
            await loadOrExecFixture(setup)
        })
        const lpAmounts = [BN.from(1), simpleToExactAmount(1, 6), , simpleToExactAmount(1, 12), 1, 10000000]
        lpAmounts.forEach((amount) => {
            it(`Mint ${amount.toLocaleString("en-US")} LP tokens from`, async () => {
                await mint3Pool(staker1, amount)
            })
            it(`Remove ${amount.toLocaleString("en-US")} LP tokens from`, async () => {
                await redeem3Pool(threeCrvWhale(), amount)
            })
        })
        const usdcAmounts = [BN.from(1), 1, 10000000]
        usdcAmounts.forEach((amount) => {
            it(`Deposit ${amount.toLocaleString("en-US")} USDC to`, async () => {
                await deposit3Pool(staker1, amount)
            })
            it(`Withdraw ${amount.toLocaleString("en-US")} USDC tokens from`, async () => {
                await withdraw3Pool(threeCrvWhale(), amount)
            })
        })
        it("3Pool virtual prices", async () => {
            const expectedVirtualPrice = await threePool.get_virtual_price()
            expect(await poolCalculator.getVirtualPrice(), "virtual price").to.eq(expectedVirtualPrice)

            // Get the gas costs
            await staker1.signer.sendTransaction(await threePool.connect(staker1.signer).populateTransaction.get_virtual_price())
            await staker1.signer.sendTransaction(await poolCalculator.connect(staker1.signer).populateTransaction.getVirtualPrice())
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
    context("Underweight USDC in 3Pool", () => {
        testCalculations(14955000, usdcUnderweight3Pool, () => threeCrvWhale2)
    })
    context("Overweight USDC in 3Pool", () => {
        testCalculations(12510000, usdcOverweight3Pool, () => threeCrvWhale1)
    })
    describe(`Balanced 3Pool and balanced Metapool`, () => {
        testCalculations(14720000, balanced3Pool, () => threeCrvWhale2)
    })
    context("Recent block for 3Pool tests", () => {
        const setup = async () => {
            await reset(15132900)
            initialise(staker1)
        }
        beforeEach(async () => {
            await loadOrExecFixture(setup)
        })
        it("Deposit DAI for LP tokens", async () => {
            const daiTokens = simpleToExactAmount(100000)

            const daiBefore = await daiToken.balanceOf(staker1.address)
            const lpBefore = await threeCrvToken.balanceOf(staker1.address)

            const [calculatedLp] = await poolCalculator.calcDeposit(daiTokens, 0)
            await staker1.signer.sendTransaction(await poolCalculator.populateTransaction.calcDeposit(daiTokens, 0))

            await daiToken.connect(staker1.signer).approve(threePool.address, daiTokens)
            await threePool.connect(staker1.signer).add_liquidity([daiTokens, 0, 0], 0)

            const daiAfter = await daiToken.balanceOf(staker1.address)
            const lpAfter = await threeCrvToken.balanceOf(staker1.address)

            expect(daiBefore.sub(daiAfter), "DAI tokens").to.eq(daiTokens)
            expect(lpAfter.sub(lpBefore), "LP tokens").to.eq(calculatedLp)
        })
        it("Mint LP tokens for DAI", async () => {
            const requiredLpTokens = simpleToExactAmount(100000)

            const daiBefore = await daiToken.balanceOf(staker1.address)
            const lpBefore = await threeCrvToken.balanceOf(staker1.address)

            const [daiCalculated] = await poolCalculator.calcMint(requiredLpTokens, 0)
            await staker1.signer.sendTransaction(await poolCalculator.populateTransaction.calcMint(requiredLpTokens, 0))
            log(`Calculated ${daiCalculated} DAI required to mint 100,000 3Crv lp tokens`)

            expect(await daiToken.balanceOf(staker1.address), "DAI bal >= deposit").to.gte(daiCalculated)
            await daiToken.connect(staker1.signer).approve(threePool.address, daiCalculated)
            await threePool.connect(staker1.signer).add_liquidity([daiCalculated, 0, 0], 0)

            const daiAfter = await daiToken.balanceOf(staker1.address)
            const lpAfter = await threeCrvToken.balanceOf(staker1.address)

            expect(daiBefore.sub(daiAfter), "DAI tokens").to.eq(daiCalculated)
            const actualLp = lpAfter.sub(lpBefore)
            const actualLpDiff = actualLp.sub(requiredLpTokens).mul(10000e6).div(requiredLpTokens)
            log(`Actual - requires = ${actualLp.sub(requiredLpTokens)} ${formatUnits(actualLpDiff, 6)} bps`)
            expect(actualLp, "LP tokens").to.gte(requiredLpTokens)
            expect(lpAfter.sub(lpBefore), "actual <= requested + 3e12 LP tokens").to.lte(requiredLpTokens.mul(1000001).div(1000000))
        })
        it("Mint LP tokens for USDC", async () => {
            const requiredLpTokens = simpleToExactAmount(100000)

            const usdcBefore = await usdcToken.balanceOf(staker1.address)
            const lpBefore = await threeCrvToken.balanceOf(staker1.address)

            const [usdcCalculated] = await poolCalculator.calcMint(requiredLpTokens, 1)
            await staker1.signer.sendTransaction(await poolCalculator.populateTransaction.calcMint(requiredLpTokens, 1))
            log(`Calculated ${usdcCalculated} USDC required to mint 100,000 3Crv lp tokens`)

            await usdcToken.connect(staker1.signer).approve(threePool.address, usdcCalculated)
            await threePool.connect(staker1.signer).add_liquidity([0, usdcCalculated, 0], 0)

            const usdcAfter = await usdcToken.balanceOf(staker1.address)
            const lpAfter = await threeCrvToken.balanceOf(staker1.address)

            expect(usdcBefore.sub(usdcAfter), "USDC tokens").to.eq(usdcCalculated)
            const actualLp = lpAfter.sub(lpBefore)
            const actualLpDiff = actualLp.sub(requiredLpTokens).mul(10000e6).div(requiredLpTokens)
            log(`Actual - requires = ${actualLp.sub(requiredLpTokens)} ${formatUnits(actualLpDiff, 6)} bps`)
            expect(actualLp, "LP tokens").to.gte(requiredLpTokens)
            expect(actualLp.sub(requiredLpTokens), "actual - required LP tokens").to.lte(requiredLpTokens.mul(1000001).div(1000000))
        })
        it("Redeem LP tokens for DAI", async () => {
            const lpTokens = simpleToExactAmount(100000)

            const daiBefore = await daiToken.balanceOf(threeCrvWhale1.address)
            const lpBefore = await threeCrvToken.balanceOf(threeCrvWhale1.address)

            const [daiCalculated] = await poolCalculator.calcRedeem(lpTokens, 0)
            await staker1.signer.sendTransaction(await poolCalculator.populateTransaction.calcRedeem(lpTokens, 0))

            await threePool.connect(threeCrvWhale1.signer).remove_liquidity_one_coin(lpTokens, 0, 0)

            const daiAfter = await daiToken.balanceOf(threeCrvWhale1.address)
            const lpAfter = await threeCrvToken.balanceOf(threeCrvWhale1.address)

            expect(daiCalculated, "DAI tokens").to.eq(daiAfter.sub(daiBefore))
            expect(lpBefore.sub(lpAfter), "LP tokens").to.eq(lpTokens)
        })
        it("Redeem LP tokens for USDC", async () => {
            const lpTokens = simpleToExactAmount(2000)

            const usdcBefore = await usdcToken.balanceOf(threeCrvWhale1.address)
            const lpBefore = await threeCrvToken.balanceOf(threeCrvWhale1.address)

            const [usdcCalculated] = await poolCalculator.calcRedeem(lpTokens, 1)
            await staker1.signer.sendTransaction(await poolCalculator.populateTransaction.calcRedeem(lpTokens, 1))

            await threePool.connect(threeCrvWhale1.signer).remove_liquidity_one_coin(lpTokens, 1, 0)

            const usdcAfter = await usdcToken.balanceOf(threeCrvWhale1.address)
            const lpAfter = await threeCrvToken.balanceOf(threeCrvWhale1.address)

            expect(usdcCalculated, "USDC tokens").to.eq(usdcAfter.sub(usdcBefore))
            expect(lpBefore.sub(lpAfter), "LP tokens").to.eq(lpTokens)
        })
        it("Withdraw DAI for DAI", async () => {
            const daiTokens = simpleToExactAmount(100000)

            const daiBefore = await daiToken.balanceOf(threeCrvWhale1.address)
            const lpBefore = await threeCrvToken.balanceOf(threeCrvWhale1.address)

            const [lpCalculated] = await poolCalculator.calcWithdraw(daiTokens, 0)
            await staker1.signer.sendTransaction(await poolCalculator.populateTransaction.calcWithdraw(daiTokens, 0))

            await threePool.connect(threeCrvWhale1.signer).remove_liquidity_imbalance([daiTokens, 0, 0], ethers.constants.MaxUint256)

            const daiAfter = await daiToken.balanceOf(threeCrvWhale1.address)
            const lpAfter = await threeCrvToken.balanceOf(threeCrvWhale1.address)

            expect(daiAfter.sub(daiBefore), "DAI tokens").to.eq(daiTokens)
            expect(lpBefore.sub(lpAfter), "LP tokens").to.eq(lpCalculated)
        })
    })
    context("3Pool mainnet tx replication", () => {
        it("Deposit 308 USDT 0x2d61527b03e0d5e1e24fbf16430016dd20cfca455f2ba442619b41fa031b6376", async () => {
            await reset(15333444)
            const account = await impersonateAccount("0xfa802b94790451c87df953c4215a721c8ec19336")
            initialise(account)
            await output3PoolBalances()

            const threeCrvBefore = await threeCrvToken.balanceOf(account.address)

            const usdtAmount = simpleToExactAmount(308, USDT.decimals)
            const expectedThreeCrvTokens = BN.from("301500744564571495002")

            const [calculated3Crv] = await poolCalculator.calcDeposit(usdtAmount, 2)
            await account.signer.sendTransaction(
                await poolCalculator.connect(account.signer).populateTransaction.calcDeposit(usdtAmount, 2),
            )

            expect(await usdtToken.balanceOf(account.address), "enough USDT to deposit").to.gte(usdtAmount)

            await threePool.add_liquidity([0, 0, usdtAmount], 0)

            const threeCrvAfter = await threeCrvToken.balanceOf(account.address)
            const threeCrvActual = threeCrvAfter.sub(threeCrvBefore)

            expect(threeCrvActual, "actual == expected 3Crv").to.eq(expectedThreeCrvTokens)
            expect(threeCrvActual, "actual == calculated 3Crv").to.eq(calculated3Crv)
        })
    })
})
