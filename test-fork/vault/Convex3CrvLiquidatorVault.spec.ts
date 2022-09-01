import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { config } from "@tasks/deployment/mainnet-config"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { CRV, CVX, DAI, ThreeCRV } from "@tasks/utils/tokens"
import { ONE_DAY, ONE_WEEK, SAFE_INFINITY } from "@utils/constants"
import { impersonate, impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import * as hre from "hardhat"
import {
    Convex3CrvLiquidatorVault__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
    DataEmitter__factory,
    IConvexRewardsPool__factory,
    ICurve3Pool__factory,
    ICurveMetapool__factory,
    IERC20__factory,
    Nexus__factory,
} from "types/generated"

import { behaveLikeConvex3CrvVault, snapVault } from "./shared/Convex3Crv.behaviour"

import type { Signer } from "ethers"
import type { Account } from "types/common"
import type { Convex3CrvLiquidatorVault, DataEmitter, IConvexRewardsPool, ICurve3Pool, ICurveMetapool, IERC20 } from "types/generated"

import type { Convex3CrvContext } from "./shared/Convex3Crv.behaviour"

const deployerAddress = resolveAddress("OperationsSigner")
const governorAddress = resolveAddress("Governor")
const nexusAddress = resolveAddress("Nexus")
const feeReceiver = resolveAddress("mStableDAO")
const baseRewardPoolAddress = resolveAddress("CRVRewardsPool")
const curveThreePoolAddress = resolveAddress("CurveThreePool")
const curveMUSDPoolAddress = resolveAddress("CurveMUSDPool")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf"
const staker1Address = "0x85eB61a62701be46479C913717E8d8FAD42b398d"
const staker2Address = "0x701aEcF92edCc1DaA86c5E7EdDbAD5c311aD720C"
const mockLiquidatorAddress = "0x28c6c06298d514db089934071355e5743bf21d60" // Binance 14
const normalBlock = 14677900

describe("Convex 3Crv Liquidator Vault", async () => {
    let deployer: Signer
    let governor: Account
    let staker1: Account
    let staker2: Account
    let mockLiquidator: Account
    let threeCrvToken: IERC20
    let crvToken: IERC20
    let cvxToken: IERC20
    let daiToken: IERC20
    let musdConvexVault: Convex3CrvLiquidatorVault
    let threePool: ICurve3Pool
    let metaPool: ICurveMetapool
    let baseRewardsPool: IConvexRewardsPool
    let dataEmitter: DataEmitter
    const { network } = hre

    const donationFee = 10000 // 1%
    const depositAmount = simpleToExactAmount(100000, 18)
    const mintAmount = simpleToExactAmount(100000, 18)
    const initialDepositAmount = depositAmount.mul(4)

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
        deployer = await impersonate(deployerAddress)
        governor = await impersonateAccount(governorAddress)
        staker1 = await impersonateAccount(staker1Address)
        staker2 = await impersonateAccount(staker2Address)
        mockLiquidator = await impersonateAccount(mockLiquidatorAddress)

        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, staker1.signer)
        crvToken = IERC20__factory.connect(CRV.address, staker1.signer)
        cvxToken = IERC20__factory.connect(CVX.address, staker1.signer)
        daiToken = IERC20__factory.connect(DAI.address, mockLiquidator.signer)
        threePool = ICurve3Pool__factory.connect(curveThreePoolAddress, staker1.signer)
        metaPool = ICurveMetapool__factory.connect(curveMUSDPoolAddress, staker1.signer)
        baseRewardsPool = IConvexRewardsPool__factory.connect(baseRewardPoolAddress, staker1.signer)

        dataEmitter = await new DataEmitter__factory(staker1.signer).deploy()
    }
    const deployVault = async () => {
        const calculatorLibrary = await new Curve3CrvMetapoolCalculatorLibrary__factory(deployer).deploy()
        const libraryAddresses = {
            "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary":
                calculatorLibrary.address,
        }
        musdConvexVault = await new Convex3CrvLiquidatorVault__factory(libraryAddresses, deployer).deploy(
            nexusAddress,
            ThreeCRV.address,
            config.convex3CrvConstructors.musd,
            ONE_DAY.mul(6),
        )
        await musdConvexVault.initialize(
            "Vault Convex mUSD/3CRV",
            "vcvxmusd3CRV",
            vaultManagerAddress,
            config.convex3CrvPools.musd.slippageData,
            [CRV.address, CVX.address],
            DAI.address,
            feeReceiver,
            donationFee,
        )
    }

    it("deploy and initialize Convex vault for mUSD pool", async () => {
        await setup(normalBlock)
        const calculatorLibrary = await new Curve3CrvMetapoolCalculatorLibrary__factory(deployer).deploy()
        const libraryAddresses = {
            "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary":
                calculatorLibrary.address,
        }
        musdConvexVault = await new Convex3CrvLiquidatorVault__factory(libraryAddresses, deployer).deploy(
            nexusAddress,
            ThreeCRV.address,
            config.convex3CrvConstructors.musd,
            ONE_DAY.mul(6),
        )

        expect(await musdConvexVault.nexus(), "nexus").eq(nexusAddress)
        expect(await musdConvexVault.metapool(), "curve Metapool").to.equal(config.convex3CrvConstructors.musd.metapool)
        expect(await musdConvexVault.metapoolToken(), "metapool token").to.equal(config.convex3CrvConstructors.musd.metapoolToken)
        expect(await musdConvexVault.basePool(), "3Pool pool").to.equal(config.convex3CrvConstructors.musd.basePool)
        expect(await musdConvexVault.booster(), "booster").to.equal(config.convex3CrvConstructors.musd.booster)
        expect(await musdConvexVault.convexPoolId(), "convex Pool Id").to.equal(config.convex3CrvConstructors.musd.convexPoolId)
        expect(await musdConvexVault.baseRewardPool(), "convex reward pool").to.equal(baseRewardPoolAddress)

        await musdConvexVault.initialize(
            "Vault Convex mUSD/3CRV",
            "vcvxmusd3CRV",
            vaultManagerAddress,
            config.convex3CrvPools.musd.slippageData,
            [CRV.address, CVX.address],
            DAI.address,
            feeReceiver,
            donationFee,
        )

        const data = await snapVault(musdConvexVault, threeCrvToken, staker1Address, simpleToExactAmount(1), simpleToExactAmount(1))

        // Vault token data
        expect(data.vault.name, "name").eq("Vault Convex mUSD/3CRV")
        expect(data.vault.symbol, "symbol").eq("vcvxmusd3CRV")
        expect(data.vault.decimals, "decimals").eq(18)

        //Vault Slippages
        expect(data.vault.depositSlippage, "deposit slippage").eq(config.convex3CrvPools.musd.slippageData.deposit)
        expect(data.vault.redeemSlippage, "redeem slippage").eq(config.convex3CrvPools.musd.slippageData.redeem)
        expect(data.vault.withdrawSlippage, "withdraw slippage").eq(config.convex3CrvPools.musd.slippageData.withdraw)
        expect(data.vault.mintSlippage, "mint slippage").eq(config.convex3CrvPools.musd.slippageData.mint)

        // Convex vault specific data
        expect(data.convex.curveMetapool, "Curve Metapool").eq(config.convex3CrvConstructors.musd.metapool)
        expect(data.convex.booster, "booster").eq(config.convex3CrvConstructors.musd.booster)
        expect(data.convex.convexPoolId, "poolId").eq(config.convex3CrvConstructors.musd.convexPoolId)
        expect(data.convex.metapoolToken, "metapoolToken").eq(config.convex3CrvConstructors.musd.metapoolToken)
        expect(data.convex.baseRewardPool, "baseRewardPool").eq(baseRewardPoolAddress)

        // Vault rewards
        expect(await musdConvexVault.rewardToken(0), "1st rewards token").to.eq(CRV.address)
        expect(await musdConvexVault.rewardToken(1), "2nd rewards token").to.eq(CVX.address)

        // Vault has approved the liquidator to transfer the reward tokens
        const liquidatorAddress = resolveAddress("Liquidator")
        expect(await crvToken.allowance(musdConvexVault.address, liquidatorAddress), "CRV allowance").to.gt(0)
        expect(await cvxToken.allowance(musdConvexVault.address, liquidatorAddress), "CVX allowance").to.gt(0)

        // Fees
        expect(await musdConvexVault.feeReceiver(), "fee receiver").to.eq(feeReceiver)
        expect(await musdConvexVault.donationFee(), "donation fee").to.eq(donationFee)
        expect(await musdConvexVault.STREAM_DURATION(), "stream duration").to.eq(ONE_DAY.mul(6))
    })
    describe("behave like Convex 3Crv Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        const behaviourSnapshot = async (): Promise<Convex3CrvContext> => {
            await setup(normalBlock)
            await deployVault()

            await threeCrvToken.connect(staker1.signer).approve(musdConvexVault.address, SAFE_INFINITY)
            await musdConvexVault.connect(staker1.signer)["deposit(uint256,address)"](initialDepositAmount, staker1.address)

            return {
                vault: musdConvexVault.connect(staker1.signer),
                owner: staker1,
                threePool,
                threeCrvToken,
                metapool: metaPool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(3),
                    redeem: initialDeposit.div(6),
                },
            }
        }
        describe("no streaming", async () => {
            before(async () => {
                ctx = await loadFixture(behaviourSnapshot)
            })
            behaveLikeConvex3CrvVault(() => ctx)
        })
        describe("streaming", async () => {
            before(async () => {
                ctx = await loadFixture(behaviourSnapshot)

                // Donate some tokens so the streaming will start
                const daiAmount = simpleToExactAmount(1000, DAI.decimals)
                await daiToken.connect(mockLiquidator.signer).approve(musdConvexVault.address, daiAmount)
                await musdConvexVault.connect(mockLiquidator.signer).donate(DAI.address, daiAmount)

                // move forward half a day of the 6 days of streaming
                await increaseTime(ONE_DAY.div(2))
            })

            behaveLikeConvex3CrvVault(() => ctx)
        })
    })
    describe("reward liquidations", () => {
        before(async () => {
            await setup(normalBlock)

            // Mock the Liquidator
            const nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor.signer)
            const liquidatorKey = keccak256(toUtf8Bytes("Liquidator"))
            await nexus.connect(governor.signer).proposeModule(liquidatorKey, mockLiquidator.address)
            await increaseTime(ONE_WEEK)
            await nexus.connect(governor.signer).acceptProposedModule(liquidatorKey)

            // Deploy and initialize the vault
            await deployVault()

            // Vault has approved the liquidator to transfer the reward tokens
            expect(await crvToken.allowance(musdConvexVault.address, mockLiquidator.address), "CRV allowance").to.gt(0)
            expect(await cvxToken.allowance(musdConvexVault.address, mockLiquidator.address), "CVX allowance").to.gt(0)

            await threeCrvToken.connect(staker1.signer).approve(musdConvexVault.address, depositAmount)
            await musdConvexVault.connect(staker1.signer)["deposit(uint256,address)"](depositAmount, staker1.address)

            await threeCrvToken.connect(staker2.signer).approve(musdConvexVault.address, mintAmount)
            await musdConvexVault.connect(staker2.signer).mint(mintAmount, staker2.address)
        })
        it("collect rewards for batch", async () => {
            await increaseTime(ONE_DAY)
            await musdConvexVault.collectRewards()
        })
        it("donate DAI tokens back to vault", async () => {
            const daiAmount = simpleToExactAmount(1000, DAI.decimals)
            await daiToken.connect(mockLiquidator.signer).approve(musdConvexVault.address, daiAmount)
            await musdConvexVault.connect(mockLiquidator.signer).donate(DAI.address, daiAmount)
        })
    })
})