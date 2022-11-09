import { config } from "@tasks/deployment/convexFraxBpVaults-config"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { CRV, CVX, crvFRAX, USDC, FRAX } from "@tasks/utils/tokens"
import { ONE_DAY, ONE_WEEK, SAFE_INFINITY } from "@utils/constants"
import { impersonateAccount, loadOrExecFixture } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import * as hre from "hardhat"
import {
    ConvexFraxBpLiquidatorVault__factory,
    CurveFraxBpMetapoolCalculatorLibrary__factory,
    DataEmitter__factory,
    IConvexRewardsPool__factory,
    ICurveFraxBP__factory,
    ICurveMetapool__factory,
    IERC20__factory,
    Nexus__factory,
} from "types/generated"

import { behaveLikeConvexFraxBpVault, snapVault } from "./shared/ConvexFraxBp.behaviour"

import type { Account } from "types/common"
import type { ConvexFraxBpLiquidatorVault, DataEmitter, IConvexRewardsPool, ICurveFraxBP, ICurveMetapool, IERC20 } from "types/generated"

import type { ConvexFraxBpContext } from "./shared/ConvexFraxBp.behaviour"

const keeperAddress = resolveAddress("OperationsSigner")
const governorAddress = resolveAddress("Governor")
const nexusAddress = resolveAddress("Nexus")
const feeReceiver = resolveAddress("mStableDAO")
const ConvexBUSDFraxBpRewardsPoolAddress = resolveAddress("ConvexBUSDFraxBpRewardsPool")
const curveFraxBPAddress = resolveAddress("FraxBP")
const curveBUSDFraxPoolAddress = resolveAddress("CurveBUSDFraxPool")
const booster = resolveAddress("ConvexBooster")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf"
const staker1Address = "0x8c21E8034a67eC06D874DB5e845569FB3f6D3355"
const staker2Address = "0x664d8F8F2417F52CbbF5Bd82Ba82EEfc58a87f07"
const mockLiquidatorAddress = "0x28c6c06298d514db089934071355e5743bf21d60" // Binance 14
const normalBlock = 15931174

describe("Convex FraxBp Liquidator Vault", async () => {
    let keeper: Account
    let governor: Account
    let staker1: Account
    let staker2: Account
    let mockLiquidator: Account
    let crvFraxToken: IERC20
    let crvToken: IERC20
    let cvxToken: IERC20
    let usdcToken: IERC20
    let busdFraxConvexVault: ConvexFraxBpLiquidatorVault
    let fraxBP: ICurveFraxBP
    let metaPool: ICurveMetapool
    let baseRewardsPool: IConvexRewardsPool
    let dataEmitter: DataEmitter
    const { network } = hre

    const donationFee = 10000 // 1%
    const depositAmount = simpleToExactAmount(50000, 18)
    const mintAmount = simpleToExactAmount(50000, 18)
    const initialDepositAmount = depositAmount.mul(4)
    const busdConvexConstructorData = {
        metapool: config.convexFraxBpPools.busd.curveMetapool,
        convexPoolId: config.convexFraxBpPools.busd.convexPoolId,
        booster,
    }

    const setup = async (blockNumber: number) => {
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
        keeper = await impersonateAccount(keeperAddress)
        governor = await impersonateAccount(governorAddress)
        staker1 = await impersonateAccount(staker1Address)
        staker2 = await impersonateAccount(staker2Address)
        mockLiquidator = await impersonateAccount(mockLiquidatorAddress)

        crvFraxToken = IERC20__factory.connect(crvFRAX.address, staker1.signer)
        crvToken = IERC20__factory.connect(CRV.address, staker1.signer)
        cvxToken = IERC20__factory.connect(CVX.address, staker1.signer)
        usdcToken = IERC20__factory.connect(USDC.address, mockLiquidator.signer)
        fraxBP = ICurveFraxBP__factory.connect(curveFraxBPAddress, staker1.signer)
        metaPool = ICurveMetapool__factory.connect(curveBUSDFraxPoolAddress, staker1.signer)
        baseRewardsPool = IConvexRewardsPool__factory.connect(ConvexBUSDFraxBpRewardsPoolAddress, staker1.signer)

        dataEmitter = await new DataEmitter__factory(staker1.signer).deploy()

        // Mock the Liquidator
        const nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor.signer)
        const liquidatorKey = keccak256(toUtf8Bytes("LiquidatorV2"))
        await nexus.connect(governor.signer).proposeModule(liquidatorKey, mockLiquidator.address)
        await increaseTime(ONE_WEEK)
        await nexus.connect(governor.signer).acceptProposedModule(liquidatorKey)
    }

    const deployVault = async () => {
        const calculatorLibrary = await new CurveFraxBpMetapoolCalculatorLibrary__factory(keeper.signer).deploy()
        const libraryAddresses = {
            "contracts/peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol:CurveFraxBpMetapoolCalculatorLibrary":
                calculatorLibrary.address,
        }

        busdFraxConvexVault = await new ConvexFraxBpLiquidatorVault__factory(libraryAddresses, keeper.signer).deploy(
            nexusAddress,
            crvFRAX.address,
            busdConvexConstructorData,
            ONE_DAY.mul(6),
        )
        await busdFraxConvexVault.initialize(
            "Vault Convex mUSD/crvFrax",
            "vcvxmusdCrvFrax",
            vaultManagerAddress,
            config.convexFraxBpPools.busd.slippageData,
            [CRV.address, CVX.address],
            USDC.address,
            feeReceiver,
            donationFee,
        )
    }

    it("deploy and initialize Convex vault for bUSD pool", async () => {
        await setup(normalBlock)

        const calculatorLibrary = await new CurveFraxBpMetapoolCalculatorLibrary__factory(keeper.signer).deploy()
        const libraryAddresses = {
            "contracts/peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol:CurveFraxBpMetapoolCalculatorLibrary":
                calculatorLibrary.address,
        }
        busdFraxConvexVault = await new ConvexFraxBpLiquidatorVault__factory(libraryAddresses, keeper.signer).deploy(
            nexusAddress,
            crvFRAX.address,
            busdConvexConstructorData,
            ONE_DAY.mul(6),
        )

        expect(await busdFraxConvexVault.nexus(), "nexus").eq(nexusAddress)
        expect((await busdFraxConvexVault.metapool()).toLowerCase(), "curve Metapool").to.equal(config.convexFraxBpPools.busd.curveMetapool.toLowerCase())
        expect((await busdFraxConvexVault.metapoolToken()).toLowerCase(), "metapool token").to.equal(config.convexFraxBpPools.busd.curveMetapoolToken.toLowerCase())
        expect(await busdFraxConvexVault.basePool(), "FraxBp pool").to.equal(resolveAddress("FraxBP"))
        expect(await busdFraxConvexVault.booster(), "booster").to.equal(booster)
        expect(await busdFraxConvexVault.convexPoolId(), "convex Pool Id").to.equal(config.convexFraxBpPools.busd.convexPoolId)
        expect(await busdFraxConvexVault.baseRewardPool(), "convex reward pool").to.equal(ConvexBUSDFraxBpRewardsPoolAddress)

        await busdFraxConvexVault.initialize(
            "Vault Convex mUSD/crvFrax",
            "vcvxmusdCrvFrax",
            vaultManagerAddress,
            config.convexFraxBpPools.busd.slippageData,
            [CRV.address, CVX.address],
            USDC.address,
            feeReceiver,
            donationFee,
        )

        const data = await snapVault(busdFraxConvexVault, crvFraxToken, staker1Address, simpleToExactAmount(1), simpleToExactAmount(1))

        // Vault token data
        expect(data.vault.name, "name").eq("Vault Convex mUSD/crvFrax")
        expect(data.vault.symbol, "symbol").eq("vcvxmusdCrvFrax")
        expect(data.vault.decimals, "decimals").eq(18)

        //Vault Slippages
        expect(data.vault.depositSlippage, "deposit slippage").eq(config.convexFraxBpPools.busd.slippageData.deposit)
        expect(data.vault.redeemSlippage, "redeem slippage").eq(config.convexFraxBpPools.busd.slippageData.redeem)
        expect(data.vault.withdrawSlippage, "withdraw slippage").eq(config.convexFraxBpPools.busd.slippageData.withdraw)
        expect(data.vault.mintSlippage, "mint slippage").eq(config.convexFraxBpPools.busd.slippageData.mint)

        // Convex vault specific data
        expect(data.convex.curveMetapool.toLowerCase(), "Curve Metapool").eq(config.convexFraxBpPools.busd.curveMetapool.toLowerCase())
        expect(data.convex.booster, "booster").eq(booster)
        expect(data.convex.convexPoolId, "poolId").eq(config.convexFraxBpPools.busd.convexPoolId)
        expect(data.convex.metapoolToken.toLowerCase(), "metapoolToken").eq(config.convexFraxBpPools.busd.curveMetapoolToken.toLowerCase())
        expect(data.convex.baseRewardPool, "baseRewardPool").eq(ConvexBUSDFraxBpRewardsPoolAddress)

        // Vault rewards
        expect(await busdFraxConvexVault.rewardToken(0), "1st rewards token").to.eq(CRV.address)
        expect(await busdFraxConvexVault.rewardToken(1), "2nd rewards token").to.eq(CVX.address)
        expect(await busdFraxConvexVault.donateToken(CRV.address), "donate token for CRV").to.eq(USDC.address)
        expect(await busdFraxConvexVault.donateToken(CVX.address), "donate token for CVX").to.eq(USDC.address)

        // Vault has approved the liquidator to transfer the reward tokens
        expect(await crvToken.allowance(busdFraxConvexVault.address, mockLiquidator.address), "CRV allowance").to.gt(0)
        expect(await cvxToken.allowance(busdFraxConvexVault.address, mockLiquidator.address), "CVX allowance").to.gt(0)

        // Fees
        expect(await busdFraxConvexVault.feeReceiver(), "fee receiver").to.eq(feeReceiver)
        expect(await busdFraxConvexVault.donationFee(), "donation fee").to.eq(donationFee)
        expect(await busdFraxConvexVault.STREAM_DURATION(), "stream duration").to.eq(ONE_DAY.mul(6))
    })
    describe("behave like Convex FraxBp Vault", () => {
        let ctx: ConvexFraxBpContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        const behaviourSnapshot = async (): Promise<ConvexFraxBpContext> => {
            await setup(normalBlock)
            await deployVault()

            await crvFraxToken.connect(staker1.signer).approve(busdFraxConvexVault.address, SAFE_INFINITY)
            await busdFraxConvexVault.connect(staker1.signer)["deposit(uint256,address)"](initialDepositAmount, staker1.address)

            return {
                vault: busdFraxConvexVault.connect(staker1.signer),
                owner: staker1,
                fraxBasePool: fraxBP,
                crvFraxToken: crvFraxToken,
                metapool: metaPool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(5),
                    redeem: initialDeposit.div(10),
                },
            }
        }
        describe("no streaming", async () => {
            before(async () => {
                ctx = await loadOrExecFixture(behaviourSnapshot)
            })
            behaveLikeConvexFraxBpVault(() => ctx)
        })
        describe("streaming", async () => {
            before(async () => {
                ctx = await loadOrExecFixture(behaviourSnapshot)

                // Donate some tokens so the streaming will start
                const usdcAmount = simpleToExactAmount(1000, USDC.decimals)
                await usdcToken.connect(mockLiquidator.signer).approve(busdFraxConvexVault.address, usdcAmount)
                await busdFraxConvexVault.connect(mockLiquidator.signer).donate(USDC.address, usdcAmount)

                // move forward half a day of the 6 days of streaming
                await increaseTime(ONE_DAY.div(2))
            })

            behaveLikeConvexFraxBpVault(() => ctx)
        })
    })
    describe("reward liquidations", () => {
        before(async () => {
            await setup(normalBlock)

            // Deploy and initialize the vault
            await deployVault()

            await crvFraxToken.connect(staker1.signer).approve(busdFraxConvexVault.address, depositAmount)
            await busdFraxConvexVault.connect(staker1.signer)["deposit(uint256,address)"](depositAmount, staker1.address)

            await crvFraxToken.connect(staker2.signer).approve(busdFraxConvexVault.address, mintAmount)
            await busdFraxConvexVault.connect(staker2.signer).mint(mintAmount, staker2.address)
        })
        it("collect rewards for batch", async () => {
            await increaseTime(ONE_DAY)
            await busdFraxConvexVault.collectRewards()
        })
        it("donate USDC tokens back to vault", async () => {
            const usdcAmount = simpleToExactAmount(1000, USDC.decimals)
            await usdcToken.connect(mockLiquidator.signer).approve(busdFraxConvexVault.address, usdcAmount)
            await busdFraxConvexVault.connect(mockLiquidator.signer).donate(USDC.address, usdcAmount)
        })
    })
    describe("set donate token", () => {
        before(async () => {
            await setup(normalBlock)

            // Deploy and initialize the vault
            await deployVault()
            busdFraxConvexVault = busdFraxConvexVault.connect(keeper.signer)

            expect(await busdFraxConvexVault.donateToken(CRV.address), "donate token before").to.eq(USDC.address)
        })
        describe("should fail", () => {
            it("for non FraxBp token", async () => {
                const tx = busdFraxConvexVault.setDonateToken(CRV.address)
                await expect(tx).to.rejectedWith("donate token not in FraxBP")
            })
            it("if not keeper or governor", async () => {
                const tx = busdFraxConvexVault.connect(staker1.signer).setDonateToken(USDC.address)
                await expect(tx).to.rejectedWith("Only keeper or governor")
            })
        })
        it("to USDC using keeper", async () => {
            const tx = await busdFraxConvexVault.setDonateToken(USDC.address)
            await expect(tx).to.emit(busdFraxConvexVault, "DonateTokenUpdated").withArgs(USDC.address)

            expect(await busdFraxConvexVault.donateToken(USDC.address), "donate token after").to.eq(USDC.address)
        })
        it("to FRAX using keeper", async () => {
            const tx = await busdFraxConvexVault.setDonateToken(FRAX.address)
            await expect(tx).to.emit(busdFraxConvexVault, "DonateTokenUpdated").withArgs(FRAX.address)

            expect(await busdFraxConvexVault.donateToken(FRAX.address), "donate token after").to.eq(FRAX.address)
        })
    })
})
