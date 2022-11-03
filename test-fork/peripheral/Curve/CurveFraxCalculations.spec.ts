import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { crvFRAX, FRAX, resolveAddress, USDC, usdFormatter } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { impersonateAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { BigNumber, ethers } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import * as hre from "hardhat"
import {
    CurveFraxBpCalculator__factory,
    CurveFraxBpCalculatorLibrary__factory,
    ICurveFraxBP__factory,
    IERC20__factory,
} from "types/generated"

import type { BlockTag } from "@nomicfoundation/hardhat-network-helpers/dist/src/types"
import type { Account } from "types/common"
import type { CurveFraxBpCalculator, ICurveFraxBP, IERC20 } from "types/generated"

const log = logger("test:CurveFraxBPCalcs")

const fraxWhaleAddress = "0xd632f22692fac7611d2aa1c0d552930d43caed3b" // Frax Finance: FRAX3CRV-f Token
const usdcWhaleAddress = "0x0a59649758aa4d66e25f08dd01271e891fe52199" // Maker: PSM-USDC-A
const crvFraxWhaleAddress = "0xCFc25170633581Bf896CB6CDeE170e3E3Aa59503" // Curve crvFRAX Gauge

describe("Curve FRAX calculations", async () => {
    let fraxWhale: Account
    let usdcWhale: Account
    let crvFraxWhale: Account
    let crvFraxToken: IERC20
    let fraxBP: ICurveFraxBP
    let fraxToken: IERC20
    let usdcToken: IERC20
    let poolCalculator: CurveFraxBpCalculator
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
        fraxWhale = await impersonateAccount(fraxWhaleAddress)
        usdcWhale = await impersonateAccount(usdcWhaleAddress)
        crvFraxWhale = await impersonateAccount(crvFraxWhaleAddress)

        const library = await new CurveFraxBpCalculatorLibrary__factory(fraxWhale.signer).deploy()
        const libraryAddresses = {
            "contracts/peripheral/Curve/CurveFraxBpCalculatorLibrary.sol:CurveFraxBpCalculatorLibrary": library.address,
        }
        poolCalculator = await new CurveFraxBpCalculator__factory(libraryAddresses, fraxWhale.signer).deploy()
    }

    const initialise = (owner: Account) => {
        crvFraxToken = IERC20__factory.connect(crvFRAX.address, owner.signer)
        fraxBP = ICurveFraxBP__factory.connect(resolveAddress("FraxBP"), owner.signer)
        fraxToken = IERC20__factory.connect(FRAX.address, owner.signer)
        usdcToken = IERC20__factory.connect(USDC.address, owner.signer)
    }

    const outputFraxBPBalances = async (when = "", blockTag?: BlockTag) => {
        const fraxBal = await fraxBP.balances(0, { blockTag })
        const usdcBal = (await fraxBP.balances(1, { blockTag })).mul(simpleToExactAmount(1, 18 - USDC.decimals))

        const totalBal = fraxBal.add(usdcBal)
        log(`FraxBP balances ${when}`)
        log(`${usdFormatter(fraxBal, 18, 16)} FRAX ${formatUnits(fraxBal.mul(10000).div(totalBal), 2)}%`)
        log(`${usdFormatter(usdcBal, 18, 16)} USDC ${formatUnits(usdcBal.mul(10000).div(totalBal), 2)}%`)
        log(`${usdFormatter(totalBal, 18, 16)} Total`)
    }

    const depositFraxBP = async (owner: Account, usdcAmount: number | BigNumber) => {
        const usdcScaled = BigNumber.isBigNumber(usdcAmount) ? usdcAmount : simpleToExactAmount(usdcAmount, USDC.decimals)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await crvFraxToken.balanceOf(owner.address)

        const lpEstimated = await fraxBP.calc_token_amount([0, usdcScaled], true)
        await owner.signer.sendTransaction(await fraxBP.connect(owner.signer).populateTransaction.calc_token_amount([0, usdcScaled], true))

        const [lpCalculated] = await poolCalculator.calcDeposit(usdcScaled, 1)
        await owner.signer.sendTransaction(await poolCalculator.connect(owner.signer).populateTransaction.calcDeposit(usdcScaled, 1))

        expect(usdcBefore, "enough USDC tokens to deposit").to.gte(usdcScaled)

        await fraxBP.connect(owner.signer).add_liquidity([0, usdcScaled], 0)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await crvFraxToken.balanceOf(owner.address)

        const usdcActual = usdcBefore.sub(usdcAfter)
        const lpActual = lpAfter.sub(lpBefore)
        const lpCalculatedDiff = lpCalculated.sub(lpActual)
        const lpEstimatedDiff = lpEstimated.sub(lpActual)
        const lpEstimatedDiffBps = lpActual.gt(0) ? lpEstimatedDiff.mul(100000000).div(lpActual) : BN.from(0)

        log(
            `${usdFormatter(usdcActual, USDC.decimals)} USDC deposited for ${usdFormatter(
                lpActual,
            )} actual LP\ncalculated LP ${usdFormatter(lpCalculated)} diff ${lpCalculatedDiff}\nestimated LP ${usdFormatter(
                lpEstimated,
            )} diff ${lpEstimatedDiff} ${formatUnits(lpEstimatedDiffBps, 4)} bps`,
        )

        expect(usdcScaled, "requested == actual USDC").to.eq(usdcActual)
        expect(lpCalculated, "calculated <= actual ").to.lte(lpActual)
    }

    const withdrawFraxBP = async (owner: Account, usdcAmount: number | BigNumber) => {
        const usdcScaled = BigNumber.isBigNumber(usdcAmount) ? usdcAmount : simpleToExactAmount(usdcAmount, USDC.decimals)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await crvFraxToken.balanceOf(owner.address)

        // estimate LP tokens from USDC
        const lpEstimated = await fraxBP.calc_token_amount([0, usdcScaled], false)
        await owner.signer.sendTransaction(await fraxBP.connect(owner.signer).populateTransaction.calc_token_amount([0, usdcScaled], false))

        const [lpCalculated] = await poolCalculator.calcWithdraw(usdcScaled, 1)
        await owner.signer.sendTransaction(await poolCalculator.connect(owner.signer).populateTransaction.calcWithdraw(usdcScaled, 1))

        expect(lpBefore, "enough LP tokens (crvFRAX) to withdraw").to.gte(lpCalculated)

        await fraxBP.connect(owner.signer).remove_liquidity_imbalance([0, usdcScaled], ethers.constants.MaxUint256)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await crvFraxToken.balanceOf(owner.address)

        const usdcActual = usdcAfter.sub(usdcBefore)
        const lpActual = lpBefore.sub(lpAfter)
        const lpCalculatedDiff = lpCalculated.sub(lpActual)
        const lpEstimatedDiff = lpEstimated.sub(lpActual)
        const lpEstimatedDiffBps = lpActual.gt(0) ? lpEstimatedDiff.mul(1000000).div(lpActual) : BN.from(0)

        log(
            `${usdFormatter(usdcActual, USDC.decimals)} USDC withdrawn for ${usdFormatter(
                lpActual,
            )} actual LP\ncalculated LP ${usdFormatter(lpCalculated)} diff ${lpCalculatedDiff}\nestimated LP ${usdFormatter(
                lpEstimated,
            )} diff ${lpEstimatedDiff} ${formatUnits(lpEstimatedDiffBps, 4)} bps`,
        )

        expect(lpCalculated, "calculated >= actual LP tokens").to.gte(lpActual)
        expect(usdcScaled, "requested == actual USDC").to.eq(usdcActual)
    }

    const mintFraxBP = async (owner: Account, lpAmount: number | BigNumber) => {
        const lpAmountScaled = BigNumber.isBigNumber(lpAmount) ? lpAmount : simpleToExactAmount(lpAmount)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await crvFraxToken.balanceOf(owner.address)

        // Calculate USDC assets for required LP tokens
        const [usdcCalculated] = await poolCalculator.calcMint(lpAmountScaled, 1)

        const unsignedTx = await poolCalculator.connect(owner.signer).populateTransaction.calcMint(lpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(usdcBefore, "enough USDC tokens to deposit").to.gte(usdcCalculated)

        await fraxBP.connect(owner.signer).add_liquidity([0, usdcCalculated], 0)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await crvFraxToken.balanceOf(owner.address)

        const lpActual = lpAfter.sub(lpBefore)
        const usdcActual = usdcBefore.sub(usdcAfter)
        const lpDiff = lpAmountScaled.sub(lpActual)
        const lpDiffBps = lpActual.gt(0) ? lpDiff.mul(100000000).div(lpActual) : BN.from(0)

        log(
            `calculated ${usdFormatter(usdcCalculated, USDC.decimals)} USDC tokens added for required ${usdFormatter(
                lpAmountScaled,
            )} LP tokens, actual LP ${usdFormatter(lpActual)} diff ${lpDiff} ${formatUnits(lpDiffBps, 4)}`,
        )

        expect(usdcCalculated, "calculated <= actual assets (USDC)").to.lte(usdcActual)
        expect(lpActual, "actual >= required LP tokens").to.gte(lpAmountScaled)
    }

    const redeemFraxBP = async (owner: Account, lpAmount: number | BigNumber) => {
        const lpAmountScaled = BigNumber.isBigNumber(lpAmount) ? lpAmount : simpleToExactAmount(lpAmount)

        const usdcBefore = await usdcToken.balanceOf(owner.address)
        const lpBefore = await crvFraxToken.balanceOf(owner.address)

        // Estimate USDC assets received from pool for burning LP tokens
        const usdcEstimated = await fraxBP.connect(owner.signer).calc_withdraw_one_coin(lpAmountScaled, 1)
        let unsignedTx = await fraxBP.connect(owner.signer).populateTransaction.calc_withdraw_one_coin(lpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        const [usdcCalculated] = await poolCalculator.calcRedeem(lpAmountScaled, 1)

        unsignedTx = await poolCalculator.connect(owner.signer).populateTransaction.calcRedeem(lpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(lpBefore, "enough LP tokens (crvFRAX) to withdraw").to.gte(lpAmountScaled)

        await fraxBP.connect(owner.signer).remove_liquidity_one_coin(lpAmountScaled, 1, 0)

        const usdcAfter = await usdcToken.balanceOf(owner.address)
        const lpAfter = await crvFraxToken.balanceOf(owner.address)

        const lpActual = lpBefore.sub(lpAfter)
        const usdcActual = usdcAfter.sub(usdcBefore)
        const usdcCalculatedDiff = usdcCalculated.sub(usdcActual)
        const usdcCalculatedDiffBps = usdcActual.gt(0) ? usdcCalculatedDiff.mul(1000000).div(usdcActual) : BN.from(0)
        const usdcEstimatedDiff = usdcEstimated.sub(usdcActual)
        const usdcEstimatedDiffBps = usdcActual.gt(0) ? usdcEstimatedDiff.mul(1000000).div(usdcActual) : BN.from(0)

        log(
            `${lpAmount} LP tokens removed for ${usdFormatter(usdcActual, USDC.decimals)} actual USDC\ncalculated USDC ${usdFormatter(
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

    const testCalculations = (blockNumber: number, rebalanceFraxBP: () => Promise<void>) => {
        // The following are only needed for debugging
        after(async () => {
            await outputFraxBPBalances("after")
        })
        const setup = async () => {
            await reset(blockNumber)
            initialise(fraxWhale)
            await rebalanceFraxBP()
            await outputFraxBPBalances("before")
            await fraxToken.connect(fraxWhale.signer).approve(fraxBP.address, ethers.constants.MaxUint256)
            await usdcToken.connect(usdcWhale.signer).approve(fraxBP.address, ethers.constants.MaxUint256)
        }
        beforeEach(async () => {
            await loadFixture(setup)
        })
        const lpAmounts = [BN.from(1), BN.from(10), simpleToExactAmount(1, 6), simpleToExactAmount(1, 12), 1, 10000000, 40000000]
        lpAmounts.forEach((amount) => {
            it(`Mint ${amount.toLocaleString("en-US")} LP tokens from`, async () => {
                await mintFraxBP(usdcWhale, amount)
            })
            it(`Remove ${amount.toLocaleString("en-US")} LP tokens from`, async () => {
                await redeemFraxBP(crvFraxWhale, amount)
            })
        })
        const usdcAmounts = [BN.from(1), BN.from(10), simpleToExactAmount(1, 6), 10000000, 40000000]
        usdcAmounts.forEach((amount) => {
            it(`Deposit ${amount.toLocaleString("en-US")} USDC to`, async () => {
                await depositFraxBP(usdcWhale, amount)
            })
            it(`Withdraw ${amount.toLocaleString("en-US")} USDC tokens from`, async () => {
                await withdrawFraxBP(crvFraxWhale, amount)
            })
        })
    }
    const usdcOverweightFraxBP = async () => {
        // Remove 350m FRAX from FraxBP
        await fraxBP.connect(crvFraxWhale.signer).remove_liquidity_one_coin(simpleToExactAmount(350000000), 0, 0)
        // Add 1,000m USDC
        await usdcToken.connect(usdcWhale.signer).approve(fraxBP.address, ethers.constants.MaxUint256)
        await fraxBP.connect(usdcWhale.signer).add_liquidity([0, simpleToExactAmount(1000000000, USDC.decimals)], 0)
    }
    const usdcUnderweightFraxBP = async () => {
        // Add 500m FRAX to FraxBP
        await fraxToken.connect(fraxWhale.signer).approve(fraxBP.address, ethers.constants.MaxUint256)
        await fraxBP.connect(fraxWhale.signer).add_liquidity([simpleToExactAmount(500000000, FRAX.decimals), 0], 0)
        // Remove 245m USDC from FraxBP
        await fraxBP.connect(crvFraxWhale.signer).remove_liquidity_one_coin(simpleToExactAmount(245000000), 1, 0)
    }
    const balancedFraxBP = async () => {
        // Remove 106,812,567 FRAX from FraxBP
        await fraxBP.connect(crvFraxWhale.signer).remove_liquidity_one_coin(simpleToExactAmount(106812567), 0, 0)
    }
    context("Underweight USDC in FraxBP", () => {
        testCalculations(15380000, usdcUnderweightFraxBP)
    })
    context("Overweight USDC in FraxBP", () => {
        testCalculations(15380000, usdcOverweightFraxBP)
    })
    describe(`Balanced FraxBP`, () => {
        testCalculations(15380000, balancedFraxBP)
    })
    context("mainnet tx replication", () => {
        let account: Account
        before(async () => {
            const blockNumber = 15365230
            await reset(blockNumber)
            account = await impersonateAccount("0xfa0dec975ff67eec1b618d1212c1da4dc7799a54")
            initialise(account)
            await outputFraxBPBalances()
        })
        it("Get virtual price", async () => {
            const actualVirtualPrice = await fraxBP.get_virtual_price()
            expect(await poolCalculator.getVirtualPrice(), "virtual price").to.eq(actualVirtualPrice)
        })
        it("Deposit 59,526.32 FRAX 0x74ba222efd158df223d89b87759817422e5ed5ac2361b58580933f83d1950c30", async () => {
            const crvFraxBefore = await crvFraxToken.balanceOf(account.address)

            const fraxAmount = simpleToExactAmount(5952632, 16)
            const expectedCrvFrax = BN.from("59473237525155014681708")

            const [calculatedCrvFrax] = await poolCalculator.calcDeposit(fraxAmount, 0)
            await account.signer.sendTransaction(
                await poolCalculator.connect(account.signer).populateTransaction.calcDeposit(fraxAmount, 0),
            )

            expect(await fraxToken.balanceOf(account.address), "enough FRAX to deposit").to.gte(fraxAmount)

            await fraxBP.add_liquidity([fraxAmount, 0], 0)

            const crvFraxAfter = await crvFraxToken.balanceOf(account.address)
            const crvFraxActual = crvFraxAfter.sub(crvFraxBefore)

            expect(crvFraxActual, "actual == expected crvFrax").to.eq(expectedCrvFrax)
            expect(crvFraxActual, "actual == calculated crvFrax").to.eq(calculatedCrvFrax)
        })
    })
})
