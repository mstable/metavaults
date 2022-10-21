import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { ICurve3Pool__factory, IERC20__factory } from "types/generated"

import { logTxDetails } from "./utils/deploy-utils"
import { logger } from "./utils/logger"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"
import { DAI, ThreeCRV, USDC, USDT } from "./utils/tokens"

const log = logger("task:curve")

subtask("curve-add", "Add liquidity to Curve 3Pool")
    .addOptionalParam("dai", "Amount of DAI to add", 0, types.int)
    .addOptionalParam("usdc", "Amount of USDC to add", 0, types.int)
    .addOptionalParam("usdt", "Amount of USDT to add", 0, types.int)
    .addOptionalParam("slippage", "Max allowed slippage as a percentage to 2 decimal places.", 1.0, types.float)
    .addOptionalParam("pool", "Name or address of the Curve pool", "CurveThreePool", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { dai, usdc, usdt, pool, slippage, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const poolAddress = resolveAddress(pool, chain)
        const daiAmount = simpleToExactAmount(dai, DAI.decimals)
        const usdcAmount = simpleToExactAmount(usdc, USDC.decimals)
        const usdtAmount = simpleToExactAmount(usdt, USDT.decimals)

        const totalLiquidity = dai + usdc + usdt
        if (totalLiquidity === 0) throw Error(`Must include DAI, USDC and/or USDT amount(s)`)

        const poolContract = ICurve3Pool__factory.connect(poolAddress, signer)

        const virtualPrice = await poolContract.get_virtual_price()
        // 3Crv = USD / virtual price
        const estimatedLpTokens = simpleToExactAmount(totalLiquidity, 36).div(virtualPrice)
        const slippageScaled = slippage * 100
        const minLpTokens = estimatedLpTokens.mul(10000 - slippageScaled).div(10000)
        log(`min 3Crv LP tokens: ${formatUnits(minLpTokens, ThreeCRV.decimals)}`)
        const tx = await poolContract.add_liquidity([daiAmount, usdcAmount, usdtAmount], minLpTokens)

        await logTxDetails(tx, `Add ${dai} DAI, ${usdc} USDC and ${usdt} USDT to Curve 3Pool`)

        const lpToken = IERC20__factory.connect(ThreeCRV.address, signer)
        const threeCrvBal = await lpToken.balanceOf(signerAddress)
        log(`3Crv balance: ${formatUnits(threeCrvBal, ThreeCRV.decimals)}`)
    })

task("curve-add").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("curve-swap", "Swap tokens using Curve 3Pool")
    .addParam("amount", "Amount to swap from", undefined, types.int)
    .addParam("from", "Token symbol or address that is being swapped from", undefined, types.string)
    .addParam("to", "Token symbol or address that is being swapped to", undefined, types.string)
    .addOptionalParam("slippage", "Max allowed slippage as a percentage to 2 decimal places.", 1.0, types.float)
    .addOptionalParam("pool", "Name or address of the Curve pool", "CurveThreePool", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { amount, from, to, pool, slippage, speed } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)

        const poolAddress = resolveAddress(pool, chain)
        const poolContract = ICurve3Pool__factory.connect(poolAddress, signer)

        const fromToken = resolveToken(from, chain)
        const fromAmount = simpleToExactAmount(amount, fromToken.decimals)
        const toToken = resolveToken(to, chain)

        const indexes = {
            [DAI.address]: 0,
            [USDC.address]: 1,
            [USDT.address]: 2,
        }

        const fromIndex = indexes[fromToken.address]
        const toIndex = indexes[toToken.address]

        const fairAmount = await poolContract.get_dy(fromIndex, toIndex, fromAmount)
        log(`Fair swap of ${amount} ${fromToken.symbol} to ${toToken.symbol} is ${formatUnits(fairAmount, toToken.decimals)}`)
        const slippageScaled = slippage * 100
        const minAmount = fairAmount.mul(10000 - slippageScaled).div(10000)

        const tx = await poolContract.exchange(fromIndex, toIndex, fromAmount, minAmount)

        await logTxDetails(tx, `Swap ${amount} ${fromToken.symbol} to ${toToken.symbol} using pool ${pool.address}`)
    })

task("curve-swap").setAction(async (_, __, runSuper) => {
    await runSuper()
})
