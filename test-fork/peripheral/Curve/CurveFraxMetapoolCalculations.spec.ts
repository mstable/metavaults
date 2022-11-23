import { alUSD, alUsdFraxBp, crvFRAX, FRAX, resolveAddress, USDC, usdFormatter } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { impersonateAccount, loadOrExecFixture } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import * as hre from "hardhat"
import {
    CurveFraxBpMetapoolCalculatorLibrary__factory,
    ICurveFraxBP__factory,
    ICurveMetapool__factory,
    IERC20__factory,
} from "types/generated"

import type { Account } from "types/common"
import type { CurveFraxBpMetapoolCalculatorLibrary, ICurveFraxBP, ICurveMetapool, IERC20 } from "types/generated"

const log = logger("test:FraxBpMetapoolCalcs")

const fraxBpPoolAddress = resolveAddress("FraxBP")
const alUsdFraxBpPoolAddress = "0xb30da2376f63de30b42dc055c93fa474f31330a5"

const usdcWhaleAddress = "0x0A59649758aa4d66E25f08Dd01271e891fe52199" // Maker: PSM-USDC-A
const alUsdWhaleAddress = "0x9735F7d3Ea56b454b24fFD74C58E9bD85cfaD31B" // Alchemix Finance: Three Pool Asset Manager
const alUsdFraxBpWhaleAddress = "0x740BA8aa0052E07b925908B380248cb03f3DE5cB" // alUSDFRAXB3CRV-f-gauge
const fraxBpWhaleAddress = "0xCFc25170633581Bf896CB6CDeE170e3E3Aa59503" // crvFRAX-gauge

describe("Curve FRAX Metapool calculations", async () => {
    let fraxBpWhale: Account
    let alUsdWhale: Account
    let usdcWhale: Account
    let alUsdFraxBpWhale: Account
    let fraxBpToken: IERC20
    let fraxBp: ICurveFraxBP
    let calculatorLibrary: CurveFraxBpMetapoolCalculatorLibrary
    let alUsdFraxBpMetapool: ICurveMetapool
    let alUsdFraxBpToken: IERC20
    let alUsdToken: IERC20
    let usdcToken: IERC20
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
        fraxBpWhale = await impersonateAccount(fraxBpWhaleAddress)
        alUsdWhale = await impersonateAccount(alUsdWhaleAddress)
        usdcWhale = await impersonateAccount(usdcWhaleAddress)
        alUsdFraxBpWhale = await impersonateAccount(alUsdFraxBpWhaleAddress)

        calculatorLibrary = await new CurveFraxBpMetapoolCalculatorLibrary__factory(fraxBpWhale.signer).deploy()
    }

    const initialise = (owner: Account) => {
        fraxBpToken = IERC20__factory.connect(crvFRAX.address, owner.signer)
        fraxBp = ICurveFraxBP__factory.connect(fraxBpPoolAddress, owner.signer)
        alUsdFraxBpMetapool = ICurveMetapool__factory.connect(alUsdFraxBpPoolAddress, owner.signer)
        alUsdFraxBpToken = IERC20__factory.connect(alUsdFraxBp.address, owner.signer)
        alUsdToken = IERC20__factory.connect(alUSD.address, owner.signer)
        usdcToken = IERC20__factory.connect(USDC.address, owner.signer)
    }

    const outputFraxBpBalances = async (when = "") => {
        const fraxBal = await fraxBp.balances(0)
        const usdcBal = await fraxBp.balances(1)

        const totalBal = fraxBal.add(usdcBal.mul(1e12))
        log(`\nFRAX Base Pool balances ${when}`)
        log(`${usdFormatter(fraxBal, FRAX.decimals)} FRAX ${formatUnits(fraxBal.mul(10000).div(totalBal), 2)}%`)
        log(`${usdFormatter(usdcBal, USDC.decimals)} USDC ${formatUnits(usdcBal.mul(10000).div(totalBal.div(1e12)), 2)}%`)
        log(`${usdFormatter(totalBal)} Total`)
    }

    const outputMetapoolBalances = async (when = "") => {
        const alUsdBal = await alUsdFraxBpMetapool.balances(0)
        const fraxBpBal = await alUsdFraxBpMetapool.balances(1)

        const metapoolTotalBal = alUsdBal.add(fraxBpBal)
        log(`\nalUsdFraxBp Metapool balances ${when}`)
        log(`${usdFormatter(alUsdBal)} alUSD ${formatUnits(alUsdBal.mul(10000).div(metapoolTotalBal), 2)}%`)
        log(`${usdFormatter(fraxBpBal)} crvFrax ${formatUnits(fraxBpBal.mul(10000).div(metapoolTotalBal), 2)}%`)
        log(`${usdFormatter(metapoolTotalBal)} Total`)
    }

    const depositMetapool = async (metapoolToken: IERC20, owner: Account, fraxBpAmount: number) => {
        const fraxBpScaled = simpleToExactAmount(fraxBpAmount)

        const fraxBpBefore = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        const [metapoolLpCalculated] = await calculatorLibrary.calcDeposit(
            alUsdFraxBpMetapool.address,
            alUsdFraxBpToken.address,
            fraxBpScaled,
            1,
        )
        const unsignedTx = await calculatorLibrary
            .connect(owner.signer)
            .populateTransaction.calcDeposit(alUsdFraxBpMetapool.address, alUsdFraxBpToken.address, fraxBpScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(fraxBpBefore, "enough base pool LP tokens (crvFRAX) to deposit").to.gte(fraxBpScaled)

        await fraxBpToken.connect(owner.signer).approve(alUsdFraxBpMetapool.address, fraxBpScaled)
        await alUsdFraxBpMetapool.connect(owner.signer).add_liquidity([0, fraxBpScaled], 0)

        const fraxBpAfter = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const fraxBpActual = fraxBpBefore.sub(fraxBpAfter)
        const metapoolLpActual = metapoolLpAfter.sub(metapoolLpBefore)
        const metapoolLpDiff = metapoolLpCalculated.sub(metapoolLpActual)
        const metapoolLpDiffBps = metapoolLpDiff.mul(1000000).div(metapoolLpActual)

        log(
            `alUSD+FraxBp ${usdFormatter(fraxBpScaled)} crvFRAX deposited for ${usdFormatter(
                metapoolLpActual,
            )} actual LP, calculated LP ${usdFormatter(metapoolLpCalculated)} diff ${metapoolLpDiff} ${formatUnits(
                metapoolLpDiffBps,
                2,
            )} bps`,
        )

        expect(fraxBpScaled, "requested == actual crvFRAX deposited").to.eq(fraxBpActual)
        expect(metapoolLpCalculated, "calculated <= actual Metapool LP tokens (alUSDFRAXB3CRV-f) minted").lte(metapoolLpActual)
    }

    const withdrawMetapool = async (metapoolToken: IERC20, owner: Account, fraxBpAmount: number) => {
        const fraxBpScaled = simpleToExactAmount(fraxBpAmount)

        const fraxBpBefore = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        const [metapoolLpCalculated] = await calculatorLibrary.calcWithdraw(
            alUsdFraxBpMetapool.address,
            alUsdFraxBpToken.address,
            fraxBpScaled,
            1,
        )
        const unsignedTx = await calculatorLibrary
            .connect(owner.signer)
            .populateTransaction.calcWithdraw(alUsdFraxBpMetapool.address, alUsdFraxBpToken.address, fraxBpScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        log(`Metapool LP (crvFRAX) balance ${usdFormatter(await metapoolToken.balanceOf(owner.address))}`)

        await alUsdFraxBpMetapool.connect(owner.signer).remove_liquidity_imbalance([0, fraxBpScaled], ethers.constants.MaxUint256)

        const fraxBpAfter = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const fraxBpActual = fraxBpAfter.sub(fraxBpBefore)
        const metapoolLpActual = metapoolLpBefore.sub(metapoolLpAfter)
        const metapoolLpDiff = metapoolLpCalculated.sub(metapoolLpActual)
        const metapoolLpDiffBps = metapoolLpDiff.mul(100000000).div(metapoolLpActual)

        log(
            `${usdFormatter(fraxBpScaled)} crvFRAX withdrawn for ${usdFormatter(metapoolLpActual)} actual LP, calculated LP ${usdFormatter(
                metapoolLpCalculated,
            )} diff ${metapoolLpDiff} ${formatUnits(metapoolLpDiffBps, 4)} bps`,
        )

        expect(fraxBpScaled, "requested == actual crvFRAX withdrawn").to.eq(fraxBpActual)
        expect(metapoolLpCalculated, "calculated >= actual Metapool LP tokens (crvFRAX) burnt").gte(metapoolLpActual)
    }

    const mintMetapool = async (metapoolToken: IERC20, owner: Account, lpAmount: number) => {
        const lpAmountScaled = simpleToExactAmount(lpAmount)

        const fraxBpBefore = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        // Calculate crvFRAX to deposit for the required metapool LP tokens
        const [fraxBpCalculated] = await calculatorLibrary.calcMint(
            alUsdFraxBpMetapool.address,
            alUsdFraxBpToken.address,
            lpAmountScaled,
            1,
        )

        const unsignedTx = await calculatorLibrary
            .connect(owner.signer)
            .populateTransaction.calcMint(alUsdFraxBpMetapool.address, alUsdFraxBpToken.address, lpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(fraxBpBefore, "enough crvFRAX tokens to deposit").to.gte(fraxBpCalculated)

        await fraxBpToken.connect(owner.signer).approve(alUsdFraxBpMetapool.address, fraxBpCalculated)
        await alUsdFraxBpMetapool.connect(owner.signer).add_liquidity([0, fraxBpCalculated], 0)

        const fraxBpAfter = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const lpActual = metapoolLpAfter.sub(metapoolLpBefore)
        const fraxBpActual = fraxBpBefore.sub(fraxBpAfter)
        const lpDiff = lpAmountScaled.sub(lpActual)
        const lpDiffBps = lpDiff.mul(100000000).div(lpActual)

        log(
            `calculated ${usdFormatter(fraxBpCalculated)} crvFRAX tokens added for required ${usdFormatter(
                lpAmountScaled,
            )} metapool LP tokens, actual LP ${usdFormatter(lpActual)} diff ${lpDiff} ${formatUnits(lpDiffBps, 4)}`,
        )

        expect(fraxBpActual, "calculated == actual assets (crvFRAX)").to.eq(fraxBpCalculated)
        expect(lpActual, "actual >= required metapool LP tokens").to.gte(lpAmountScaled)
    }

    const redeemMetapool = async (metapoolToken: IERC20, owner: Account, lpAmount: number) => {
        const metapoolLpAmountScaled = simpleToExactAmount(lpAmount)

        const fraxBpBefore = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpBefore = await metapoolToken.balanceOf(owner.address)

        // Estimate USDC assets received from pool for burning LP tokens
        const threeCrvEstimated = await alUsdFraxBpMetapool.connect(owner.signer).calc_withdraw_one_coin(metapoolLpAmountScaled, 1)
        let unsignedTx = await alUsdFraxBpMetapool
            .connect(owner.signer)
            .populateTransaction.calc_withdraw_one_coin(metapoolLpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        const [threeCrvCalculated] = await calculatorLibrary.calcRedeem(
            alUsdFraxBpMetapool.address,
            alUsdFraxBpToken.address,
            metapoolLpAmountScaled,
            1,
        )

        unsignedTx = await calculatorLibrary
            .connect(owner.signer)
            .populateTransaction.calcRedeem(alUsdFraxBpMetapool.address, alUsdFraxBpToken.address, metapoolLpAmountScaled, 1)
        await owner.signer.sendTransaction(unsignedTx)

        expect(metapoolLpBefore, "enough metapool LP tokens to withdraw").to.gte(metapoolLpAmountScaled)

        await alUsdFraxBpMetapool.connect(owner.signer).remove_liquidity_one_coin(metapoolLpAmountScaled, 1, 0)

        const fraxBpAfter = await fraxBpToken.balanceOf(owner.address)
        const metapoolLpAfter = await metapoolToken.balanceOf(owner.address)

        const lpActual = metapoolLpBefore.sub(metapoolLpAfter)
        const fraxCrvActual = fraxBpAfter.sub(fraxBpBefore)
        const fraxBpEstimatedDiff = threeCrvEstimated.sub(fraxCrvActual)
        const fraxBpEstimatedDiffBps = fraxBpEstimatedDiff.mul(100000000).div(fraxCrvActual)
        const fraxBpCalculatedDiff = threeCrvCalculated.sub(fraxCrvActual)
        const fraxBpCalculatedDiffBps = fraxBpCalculatedDiff.mul(100000000).div(fraxCrvActual)

        log(
            `FraxBP ${usdFormatter(metapoolLpAmountScaled)} metapool LP tokens removed for ${usdFormatter(
                fraxCrvActual,
            )} actual crvFRAX\ncalculated crvFRAX ${usdFormatter(threeCrvCalculated)} diff ${fraxBpCalculatedDiff} ${formatUnits(
                fraxBpCalculatedDiffBps,
                4,
            )} bps\nestimated crvFRAX ${usdFormatter(threeCrvEstimated)} diff ${fraxBpEstimatedDiff} ${formatUnits(
                fraxBpEstimatedDiffBps,
                4,
            )} bps`,
        )

        expect(lpActual, "actual == require metapool LP tokens").to.eq(metapoolLpAmountScaled)
        expect(threeCrvEstimated, "estimated == actual assets (crvFRAX)").to.eq(fraxCrvActual)
        expect(threeCrvCalculated, "calculated == actual assets (crvFRAX)").to.eq(fraxCrvActual)
    }

    const testCalculations = (blockNumber: number, rebalanceFraxBP: () => Promise<void>, rebalanceMetapool: () => Promise<void>) => {
        const setup = async () => {
            await reset(blockNumber)
            initialise(fraxBpWhale)
            await rebalanceFraxBP()
            await rebalanceMetapool()
            await outputFraxBpBalances()
            await outputMetapoolBalances("before")
            await usdcToken.connect(fraxBpWhale.signer).approve(fraxBp.address, ethers.constants.MaxUint256)
        }
        beforeEach(async () => {
            await loadOrExecFixture(setup)
        })
        after(async () => {
            await outputFraxBpBalances()
            await outputMetapoolBalances("after")
        })
        it("Deposit 4m crvFRAX to Metapool", async () => {
            await depositMetapool(alUsdFraxBpToken, fraxBpWhale, 4000000)
        })
        it("Withdraw 100k crvFrax from Metapool", async () => {
            await withdrawMetapool(alUsdFraxBpToken, alUsdFraxBpWhale, 100000)
        })
        it("Mint 10m Metapool LP tokens from crvFRAX", async () => {
            await mintMetapool(alUsdFraxBpToken, fraxBpWhale, 40000000)
        })
        it("Redeem 1m LP tokens from Metapool for crvFRAX", async () => {
            await redeemMetapool(alUsdFraxBpToken, alUsdFraxBpWhale, 1000000)
        })
        it("Convert 100 metapool LP tokens to base pool lp tokens (crvFRAX)", async () => {
            const metapoolLpTokens = simpleToExactAmount(100)
            const crvFraxTokens = await calculatorLibrary["convertToBaseLp(address,address,uint256)"](
                alUsdFraxBpMetapool.address,
                alUsdFraxBp.address,
                metapoolLpTokens,
            )
            log(`${usdFormatter(metapoolLpTokens)} Metapool LP = ${usdFormatter(crvFraxTokens)} crvFRAX`)
            expect(crvFraxTokens, "crvFRAX > Metapool LP").gt(metapoolLpTokens)

            await fraxBpWhale.signer.sendTransaction(
                await calculatorLibrary
                    .connect(fraxBpWhale.signer)
                    .populateTransaction["convertToBaseLp(address,address,uint256)"](
                        alUsdFraxBpMetapool.address,
                        alUsdFraxBp.address,
                        metapoolLpTokens,
                    ),
            )
        })
        it("Convert 100 base pool lp tokens crvFRAX to metapool lp tokens", async () => {
            const crvFraxTokens = simpleToExactAmount(100)
            const metapoolLpTokens = await calculatorLibrary["convertToMetaLp(address,address,uint256)"](
                alUsdFraxBpMetapool.address,
                alUsdFraxBp.address,
                crvFraxTokens,
            )
            log(`${usdFormatter(crvFraxTokens)} crvFRAX = ${usdFormatter(metapoolLpTokens)} Metapool LP`)
            expect(crvFraxTokens, "crvFRAX > Metapool LP").gt(metapoolLpTokens)

            await fraxBpWhale.signer.sendTransaction(
                await calculatorLibrary
                    .connect(fraxBpWhale.signer)
                    .populateTransaction["convertToMetaLp(address,address,uint256)"](
                        alUsdFraxBpMetapool.address,
                        alUsdFraxBp.address,
                        crvFraxTokens,
                    ),
            )
        })
        it("Metapool virtual prices", async () => {
            const expectedMetapoolVP = await alUsdFraxBpMetapool.get_virtual_price()
            const expectedFraxBpVP = await fraxBp.get_virtual_price()
            const [actualMetapoolVP, actual3PoolVP] = await calculatorLibrary.getVirtualPrices(
                alUsdFraxBpMetapool.address,
                alUsdFraxBp.address,
            )
            expect(actualMetapoolVP, "Metapool virtual price").to.eq(expectedMetapoolVP)
            expect(actual3PoolVP, "FraxBP virtual price").to.eq(expectedFraxBpVP)

            await fraxBpWhale.signer.sendTransaction(
                await alUsdFraxBpMetapool.connect(fraxBpWhale.signer).populateTransaction.get_virtual_price(),
            )
            await fraxBpWhale.signer.sendTransaction(
                await calculatorLibrary
                    .connect(fraxBpWhale.signer)
                    .populateTransaction.getVirtualPrices(alUsdFraxBpMetapool.address, alUsdFraxBp.address),
            )
        })
    }
    const usdcOverweight3Pool = async () => {
        // Add 60m USDC
        await usdcToken.connect(usdcWhale.signer).approve(fraxBp.address, ethers.constants.MaxUint256)
        await fraxBp.connect(usdcWhale.signer).add_liquidity([0, simpleToExactAmount(60000000, USDC.decimals)], 0)
    }
    const usdcUnderweightFraxBP = async () => {
        // Remove 2m USDC from FraxBP
        await fraxBp.connect(fraxBpWhale.signer).remove_liquidity_one_coin(simpleToExactAmount(2000000), 1, 0)
    }
    const balancedFraxBP = async () => {
        // already balanced if using block 15335000
    }
    const fraxBpOverweightMetapool = async () => {
        // Add 9m crvFRAX to Metapool
        console.log(`fraxBpWhale1 crvFrax bal ${formatUnits(await fraxBpToken.balanceOf(fraxBpWhale.address))}`)
        await fraxBpToken.connect(fraxBpWhale.signer).approve(alUsdFraxBpMetapool.address, ethers.constants.MaxUint256)
        await alUsdFraxBpMetapool.connect(fraxBpWhale.signer).add_liquidity([0, simpleToExactAmount(9000000)], 0)
    }
    const fraxBpUnderweightMetapool = async () => {
        // Add 20m alUSD to Metapool
        await alUsdToken.connect(alUsdWhale.signer).approve(alUsdFraxBpMetapool.address, ethers.constants.MaxUint256)
        await alUsdFraxBpMetapool.connect(alUsdWhale.signer).add_liquidity([simpleToExactAmount(20000000), 0], 0)
        // Remove 2m crvFrax
        await alUsdFraxBpMetapool.connect(alUsdFraxBpWhale.signer).remove_liquidity_one_coin(simpleToExactAmount(2000000), 1, 0)
    }
    const balancedMetapool = async () => {
        // Add 2m FraxBP LP tokens (crvFRAX) to Metapool
        await fraxBpToken.connect(fraxBpWhale.signer).approve(alUsdFraxBpMetapool.address, ethers.constants.MaxUint256)
        await alUsdFraxBpMetapool.connect(fraxBpWhale.signer).add_liquidity([0, simpleToExactAmount(2184600)], 0)
    }

    context("underweight USDC in FraxBp", () => {
        const blockNumber = 15938000
        describe(`overweight crvFRAX in Metapool`, () => {
            testCalculations(blockNumber, usdcUnderweightFraxBP, fraxBpOverweightMetapool)
        })
        describe(`underweight crvFRAX in Metapool`, () => {
            testCalculations(blockNumber, usdcUnderweightFraxBP, fraxBpUnderweightMetapool)
        })
    })
    context("overweight USDC in FraxBp", () => {
        const blockNumber = 15236966
        describe(`overweight crvFRAX in Metapool`, () => {
            testCalculations(blockNumber, usdcOverweight3Pool, fraxBpOverweightMetapool)
        })
        describe(`underweight crvFRAX in Metapool`, () => {
            testCalculations(blockNumber, usdcOverweight3Pool, fraxBpUnderweightMetapool)
        })
    })
    describe(`balanced FraxBp and balanced Metapool`, () => {
        testCalculations(15335000, balancedFraxBP, balancedMetapool)
    })
})
