import { shouldBehaveLikeBaseVault, testAmounts } from "@test/shared/BaseVault.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { assertBNClose } from "@utils/assertions"
import { ONE_DAY, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { loadOrExecFixture } from "@utils/fork"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { getTimestampFromTx, increaseTime } from "@utils/time"
import { expect } from "chai"
import { ethers } from "hardhat"
import {
    BasicDexSwap__factory,
    DataEmitter__factory,
    Liquidator__factory,
    LiquidatorStreamBasicVault__factory,
    MockERC20__factory,
    MockNexus__factory,
} from "types/generated"

import type { TransactionResponse } from "@ethersproject/providers"
import type { BaseVaultBehaviourContext } from "@test/shared/BaseVault.behaviour"
import type { BigNumberish } from "ethers"
import type {
    AbstractVault,
    BasicDexSwap,
    DataEmitter,
    Liquidator,
    LiquidatorStreamBasicVault,
    MockERC20,
    MockNexus,
    VaultManagerRole,
} from "types/generated"

describe("Streamed Liquidator Vault", async () => {
    let sa: StandardAccounts
    let dataEmitter: DataEmitter
    let nexus: MockNexus
    let asset: MockERC20
    let rewards1: MockERC20
    let rewards2: MockERC20
    let swapper: BasicDexSwap
    let liquidator: Liquidator
    let vault: LiquidatorStreamBasicVault
    let assetToBurn: BN

    const streamPerSecondScale = simpleToExactAmount(1, 18)
    const defaultAssetToBurn = simpleToExactAmount(0)

    const assertStreamedShares = async (
        tx: TransactionResponse,
        lastTxTimestamp: BigNumberish,
        txShares: BigNumberish,
        streamedSharesBefore: BigNumberish,
        ownerSharesBefore: BigNumberish,
    ): Promise<{ streamedShares: BN; lastTxTimestamp: BN }> => {
        const totalSharesBefore = BN.from(streamedSharesBefore).add(ownerSharesBefore)

        const stream = await vault.shareStream()
        const currentTxTimestamp = await getTimestampFromTx(tx)
        const burnTime = currentTxTimestamp.lte(stream.end)
            ? currentTxTimestamp.sub(lastTxTimestamp)
            : BN.from(stream.end).sub(lastTxTimestamp)

        let burntShares = BN.from(0)
        if (BN.from(lastTxTimestamp).lt(stream.end)) {
            expect(stream.last, "stream last").to.eq(currentTxTimestamp)
            burntShares = stream.sharesPerSecond.mul(burnTime).div(streamPerSecondScale)

            await expect(tx).to.emit(vault, "Withdraw").withArgs(sa.default.address, ZERO_ADDRESS, vault.address, 0, burntShares)
        }

        expect(await vault.streamedShares(), "streamed shares").to.eq(BN.from(streamedSharesBefore).sub(burntShares))

        expect(await vault.balanceOf(sa.default.address), "owner shares after").to.eq(BN.from(ownerSharesBefore).add(txShares))
        assertBNClose(await vault.balanceOf(vault.address), BN.from(streamedSharesBefore).sub(burntShares), 3)
        assertBNClose(await vault.totalSupply(), totalSharesBefore.add(txShares).sub(burntShares), 3)

        return {
            streamedShares: burntShares,
            lastTxTimestamp: currentTxTimestamp,
        }
    }

    const assertDonation = async (
        lastTxTimestamp: BigNumberish,
        txAmount: BigNumberish,
        ownerSharesBefore: BigNumberish,
        streamedSharesBefore: BigNumberish,
        totalAssetsBefore: BigNumberish,
    ) => {
        const tokenToDonate = await vault.donateToken(ZERO_ADDRESS)
        expect(asset.address, "Token to donate").to.be.eq(tokenToDonate)
        // Donate
        // Donate
        const tx = await vault.donate(asset.address, txAmount)

        const currentTxTimestamp = await getTimestampFromTx(tx)
        const remainingStreamSeconds = BN.from(currentTxTimestamp).sub(lastTxTimestamp).lt(ONE_DAY)
            ? BN.from(lastTxTimestamp).add(ONE_DAY).sub(currentTxTimestamp)
            : BN.from(0)
        const remainingStreamShares = remainingStreamSeconds.mul(streamedSharesBefore).div(ONE_DAY)

        const newStreamedShares = BN.from(totalAssetsBefore).gt(0)
            ? BN.from(txAmount).mul(ownerSharesBefore).div(totalAssetsBefore)
            : BN.from(txAmount)
        const streamedSharesAfter = BN.from(remainingStreamShares).add(newStreamedShares)

        // Transfer of assets to vault
        await expect(tx).to.emit(asset, "Transfer").withArgs(sa.default.address, vault.address, txAmount)
        // Mint of vault's streamed shares
        await expect(tx).to.emit(vault, "Transfer").withArgs(ZERO_ADDRESS, vault.address, newStreamedShares)

        // Deposit event for streamed shares
        await expect(tx).to.emit(vault, "Deposit").withArgs(sa.default.address, vault.address, txAmount, newStreamedShares)

        const duration = ONE_DAY
        const sharesPerSecond = streamedSharesAfter.mul(simpleToExactAmount(1)).div(duration)

        const stream = await vault.shareStream()
        expect(stream.last, "stream last").to.eq(currentTxTimestamp)
        expect(stream.end, "stream end").to.eq(currentTxTimestamp.add(duration))
        // expect(stream.sharesPerSecond, "stream sharesPerSecond").to.eq(sharesPerSecond)
        assertBNClose(stream.sharesPerSecond, sharesPerSecond, 3)

        // expect(await vault.streamedShares(), "streamed shares after").to.eq(streamedSharesAfter)
        assertBNClose(await vault.streamedShares(), streamedSharesAfter, 3)

        expect(await vault.balanceOf(sa.default.address), "owner shares after").to.eq(ownerSharesBefore)
        // expect(await vault.balanceOf(vault.address), "stream shares after").to.eq(streamedSharesAfter)
        assertBNClose(await vault.balanceOf(vault.address), streamedSharesAfter, 3)
        assertBNClose(await vault.totalSupply(), BN.from(ownerSharesBefore).add(streamedSharesAfter), 3)
        expect(await vault.totalAssets(), "total assets after").to.eq(BN.from(totalAssetsBefore).add(txAmount))
    }

    const deployFeeVaultDependencies = async (decimals = 18) => {
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)
        asset = await new MockERC20__factory(sa.default.signer).deploy(
            "USD asset",
            "AST",
            decimals,
            sa.default.address,
            simpleToExactAmount(100000000),
        )

        // Deploy mock rewards
        rewards1 = await new MockERC20__factory(sa.default.signer).deploy(
            "Reward 1",
            "R1",
            18,
            sa.default.address,
            simpleToExactAmount(100000),
        )

        rewards2 = await new MockERC20__factory(sa.default.signer).deploy(
            "Reward 2",
            "R2",
            6,
            sa.default.address,
            simpleToExactAmount(200000),
        )

        // Deploy mock swapper
        swapper = await new BasicDexSwap__factory(sa.default.signer).deploy(nexus.address)
        await swapper.initialize([
            // R1/A1 exchange rate of 2 means 1 R1 = 2 A1
            // 18 -> 6 means 18 decimals to 6 decimals
            { from: rewards1.address, to: asset.address, rate: simpleToExactAmount(2, 18) }, // R1/A1 2; 18 -> 18
            { from: rewards2.address, to: asset.address, rate: simpleToExactAmount(3, 30) }, // R2/A1 3; 6 -> 18
        ])

        // Deploy test Liquidator
        liquidator = await new Liquidator__factory(sa.default.signer).deploy(nexus.address)
        await liquidator.initialize(swapper.address, ZERO_ADDRESS)
        await nexus.setLiquidatorV2(liquidator.address)
    }

    const setup = async (decimals = 18): Promise<LiquidatorStreamBasicVault> => {
        dataEmitter = await new DataEmitter__factory(sa.default.signer).deploy()
        assetToBurn = assetToBurn ?? defaultAssetToBurn

        await deployFeeVaultDependencies(decimals)
        vault = await new LiquidatorStreamBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address, ONE_DAY)

        // Approve vault to transfer assets from default signer
        await asset.approve(vault.address, ethers.constants.MaxUint256)
        await vault.initialize("feeVault", "fv", sa.vaultManager.address, [rewards1.address, rewards2.address], assetToBurn)

        // set balance or users for the test.
        const assetBalance = await asset.balanceOf(sa.default.address)
        asset.transfer(sa.alice.address, assetBalance.div(2))
        return vault
    }

    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        vault = await setup()
    })
    describe("constructor", async () => {
        it("should properly store constructor arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "underlying asset").to.eq(asset.address)
            expect(await vault.asset(), "asset").to.eq(asset.address)
        })
        it("should fail if arguments are wrong", async () => {
            await expect(
                new LiquidatorStreamBasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, ONE_DAY),
            ).to.be.revertedWith("Asset is zero")
        })
        it("should fail if nexus has zero address", async () => {
            await expect(
                new LiquidatorStreamBasicVault__factory(sa.default.signer).deploy(ZERO_ADDRESS, ZERO_ADDRESS, ONE_DAY),
            ).to.be.revertedWith("Nexus address is zero")
        })
    })
    describe("behaviors", async () => {
        shouldBehaveLikeVaultManagerRole(() => ({ vaultManagerRole: vault as VaultManagerRole, sa }))

        describe("should behave like AbstractVaultBehaviourContext before stream vault shares", async () => {
            const ctx: Partial<BaseVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function beforeStream() {
                    await setup()
                    ctx.vault = vault as unknown as AbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(100, await asset.decimals())
                    ctx.dataEmitter = dataEmitter
                }
            })
            shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
        })
        describe("should behave like AbstractVaultBehaviourContext while streaming vault shares", async () => {
            const ctx: Partial<BaseVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function whileStreaming() {
                    await setup()
                    ctx.vault = vault as unknown as AbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(1000, await asset.decimals())
                    ctx.dataEmitter = dataEmitter

                    await vault.deposit(ctx.amounts.initialDeposit, sa.alice.address)

                    const donatedAssets = simpleToExactAmount(200)
                    await vault.donate(asset.address, donatedAssets)

                    await increaseTime(ONE_HOUR.mul(3))
                }
            })
            shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
        })
        describe("should behave like AbstractVaultBehaviourContext after streaming vault shares", async () => {
            const ctx: Partial<BaseVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function afterStream() {
                    await setup()
                    ctx.vault = vault as unknown as AbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(100000, await asset.decimals())
                    ctx.dataEmitter = dataEmitter

                    await vault.deposit(ctx.amounts.initialDeposit, sa.alice.address)
                    await vault.donate(asset.address, simpleToExactAmount(2000))
                    await increaseTime(ONE_HOUR.mul(3))
                    await vault.deposit(simpleToExactAmount(2000), sa.bob.address)
                    await increaseTime(ONE_DAY)
                }
            })
            shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
        })
    })

    describe("calling initialize", async () => {
        before(async () => {
            await deployFeeVaultDependencies(12)
            assetToBurn = simpleToExactAmount(10 , await asset.decimals())
            vault = await new LiquidatorStreamBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address, ONE_DAY)
            await asset.connect(sa.default.signer).approve(vault.address, ethers.constants.MaxUint256)
            await vault.initialize("feeVault", "fv", sa.vaultManager.address, [rewards1.address, rewards2.address], assetToBurn)
        })
        after(async () => {
            assetToBurn = defaultAssetToBurn
        })
        it("should properly store valid arguments", async () => {
            expect(assetToBurn, "assetToBurn").to.gt(0)

            const stream = await vault.shareStream()
            expect(stream.last, "stream last").to.eq(0)
            expect(stream.end, "stream end").to.eq(0)
            expect(stream.sharesPerSecond, "stream sharesPerSecond").to.eq(0)

            expect(await vault.symbol(), "symbol").to.eq("fv")
            expect(await vault.name(), "name").to.eq("feeVault")
            expect(await vault.decimals(), "symbol").to.eq(12)

            expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)

            expect(await vault.totalSupply(), "total shares").to.eq(assetToBurn)
            expect(await vault.totalAssets(), "total assets").to.eq(assetToBurn)

            //locked shares
            expect((await vault.balanceOf(vault.address)), "locked shares").to.eq(assetToBurn)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize("feeVault", "fv", sa.vaultManager.address, [rewards1.address, rewards2.address], assetToBurn),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
    describe("read only functions", async () => {
        it("donate token is the underlying asset for any reward token", async () => {
            expect(await vault.donateToken(ZERO_ADDRESS), "donateToken").to.eq(await vault.asset())
            expect(await vault.donateToken(rewards1.address), "donateToken").to.eq(await vault.asset())
            expect(await vault.donateToken(rewards2.address), "donateToken").to.eq(await vault.asset())
        })
    })
    const beforeEachFixture = async function fixture() {
        vault = await setup()
        await increaseTime(ONE_DAY)
    }
    context("no streamed shares", async () => {
        beforeEach(async () => {
            await loadOrExecFixture(beforeEachFixture)
        })
        it("mint", async () => {
            const mintAmount = simpleToExactAmount(1000)

            const tx = await vault.mint(mintAmount, sa.default.address)

            await assertStreamedShares(tx, 0, mintAmount, 0, 0)
        })
        it("deposit", async () => {
            const depositAmount = simpleToExactAmount(1000)

            const tx = await vault.deposit(depositAmount, sa.default.address)

            await assertStreamedShares(tx, 0, depositAmount, 0, 0)
        })
        it("mint and partial redeem", async () => {
            const mintAmount = simpleToExactAmount(1000)

            await vault.mint(mintAmount, sa.default.address)
            await increaseTime(ONE_DAY)
            const txAmount = mintAmount.div(3)
            const tx = await vault.redeem(txAmount, sa.default.address, sa.default.address)

            await assertStreamedShares(tx, 0, txAmount.mul(-1), 0, mintAmount)
        })
        it("mint and partial withdraw", async () => {
            const mintAmount = simpleToExactAmount(1000)

            await vault.mint(mintAmount, sa.default.address)
            await increaseTime(ONE_DAY)
            const txAmount = mintAmount.div(4)
            const tx = await vault.withdraw(txAmount, sa.default.address, sa.default.address)

            await assertStreamedShares(tx, 0, txAmount.mul(-1), 0, mintAmount)
        })
    })
    context("currently streaming shares", async () => {
        let lastTxTimestamp: BN
        let streamSharesBefore: BN
        const initialShares = simpleToExactAmount(10000)
        beforeEach(async () => {
            await loadOrExecFixture(beforeEachFixture)
            // Deposit some assets
            await vault.deposit(initialShares, sa.default.address)

            // First donation
            const tx = await vault.donate(asset.address, simpleToExactAmount(200))
            lastTxTimestamp = await getTimestampFromTx(tx)
            streamSharesBefore = await vault.streamedShares()

            await increaseTime(ONE_HOUR)
        })
        it("mint", async () => {
            const mintAmount = simpleToExactAmount(3000)

            const tx = await vault.mint(mintAmount, sa.default.address)

            await assertStreamedShares(tx, lastTxTimestamp, mintAmount, streamSharesBefore, initialShares)
        })
        it.skip("deposit", async () => {
            const depositAmount = simpleToExactAmount(1000)
            const txShareAmount = await vault.previewDeposit(depositAmount)

            const tx = await vault.deposit(depositAmount, sa.default.address)

            await assertStreamedShares(tx, lastTxTimestamp, txShareAmount, streamSharesBefore, initialShares)
        })
        it("partial redeem", async () => {
            const redeemAmount = simpleToExactAmount(8000)

            const tx = await vault.redeem(redeemAmount, sa.default.address, sa.default.address)

            await assertStreamedShares(tx, lastTxTimestamp, redeemAmount.mul(-1), streamSharesBefore, initialShares)
        })
        it("full redeem", async () => {
            const tx = await vault.redeem(initialShares, sa.default.address, sa.default.address)

            await assertStreamedShares(tx, lastTxTimestamp, initialShares.mul(-1), streamSharesBefore, initialShares)
        })
    })
    context("after stream has ended", async () => {
        let lastTxTimestamp: BN
        let streamSharesBefore: BN
        const initialShares = simpleToExactAmount(5000)
        beforeEach(async () => {
            await loadOrExecFixture(beforeEachFixture)
            // Deposit some assets
            await vault.deposit(initialShares, sa.default.address)

            // First donation
            const tx = await vault.donate(asset.address, simpleToExactAmount(200))
            lastTxTimestamp = await getTimestampFromTx(tx)
            streamSharesBefore = await vault.streamedShares()

            // increase time by 3 days so its 2 days after the stream has ended
            await increaseTime(ONE_DAY.mul(3))
        })
        it("mint", async () => {
            const mintAmount = simpleToExactAmount(20000)

            const tx = await vault.mint(mintAmount, sa.default.address)

            await assertStreamedShares(tx, lastTxTimestamp, mintAmount, streamSharesBefore, initialShares)
        })
        it("full redeem", async () => {
            const tx = await vault.redeem(initialShares, sa.default.address, sa.default.address)

            await assertStreamedShares(tx, lastTxTimestamp, initialShares.mul(-1), streamSharesBefore, initialShares)
        })
    })
    context("donated shares", () => {
        beforeEach(async () => {
            await loadOrExecFixture(beforeEachFixture)
        })

        it("fails if the donated token is not the underlying asset", async () => {
            const txAmount = simpleToExactAmount(300)
            await expect(vault.donate(rewards1.address, txAmount)).to.revertedWith("Donated token not asset")
        })
        it("before staker shares", async () => {
            const txAmount = simpleToExactAmount(300)

            await assertDonation(0, txAmount, 0, 0, 0)
        })
        it("after owner has shares", async () => {
            const ownerSharesBefore = simpleToExactAmount(11111)
            await vault.deposit(ownerSharesBefore, sa.default.address)
            await increaseTime(60)
            const txAmount = simpleToExactAmount(500)

            await assertDonation(0, txAmount, ownerSharesBefore, 0, ownerSharesBefore)
        })
        it("after appreciation of owner shares", async () => {
            const ownerSharesBefore = simpleToExactAmount(1000)
            const totalAssetsBefore = ownerSharesBefore.mul(11).div(10)
            await vault.deposit(ownerSharesBefore, sa.default.address)
            await increaseTime(60)
            // Appreciate the assets per share by 10%
            await asset.transfer(vault.address, ownerSharesBefore.div(10))
            const txAmount = simpleToExactAmount(500)

            await assertDonation(0, txAmount, ownerSharesBefore, 0, totalAssetsBefore)
        })
        it("second donation near start of first stream", async () => {
            const ownerSharesBefore = simpleToExactAmount(100)
            await vault.deposit(ownerSharesBefore, sa.default.address)
            await increaseTime(ONE_WEEK)
            const firstDonationAmount = simpleToExactAmount(24)

            // First donation
            const tx = await vault.donate(asset.address, firstDonationAmount)
            const lastTxTimestamp = await getTimestampFromTx(tx)

            await increaseTime(ONE_HOUR)
            const secondDonationAmount = simpleToExactAmount(2)

            await assertDonation(
                lastTxTimestamp,
                secondDonationAmount,
                ownerSharesBefore,
                firstDonationAmount,
                ownerSharesBefore.add(firstDonationAmount),
            )
        })
        it("second donation near end of first stream", async () => {
            const ownerSharesBefore = simpleToExactAmount(100)
            await vault.deposit(ownerSharesBefore, sa.default.address)
            await increaseTime(ONE_WEEK)
            const firstDonationAmount = simpleToExactAmount(24)

            // First donation
            const tx = await vault.donate(asset.address, firstDonationAmount)
            const lastTxTimestamp = await getTimestampFromTx(tx)

            await increaseTime(ONE_DAY.sub(ONE_HOUR))
            const secondDonationAmount = simpleToExactAmount(2)

            await assertDonation(
                lastTxTimestamp,
                secondDonationAmount,
                ownerSharesBefore,
                firstDonationAmount,
                ownerSharesBefore.add(firstDonationAmount),
            )
        })
        it("second donation at end of first stream", async () => {
            const ownerSharesBefore = simpleToExactAmount(100)
            await vault.deposit(ownerSharesBefore, sa.default.address)
            await increaseTime(ONE_WEEK)
            const firstDonationAmount = simpleToExactAmount(24)

            // First donation
            const tx = await vault.donate(asset.address, firstDonationAmount)
            const lastTxTimestamp = await getTimestampFromTx(tx)

            await increaseTime(ONE_DAY)
            const secondDonationAmount = simpleToExactAmount(2)

            await assertDonation(
                lastTxTimestamp,
                secondDonationAmount,
                ownerSharesBefore,
                firstDonationAmount,
                ownerSharesBefore.add(firstDonationAmount),
            )
        })
        it("second donation after end of first stream", async () => {
            const ownerSharesBefore = simpleToExactAmount(100)
            await vault.deposit(ownerSharesBefore, sa.default.address)
            await increaseTime(ONE_WEEK)
            const firstDonationAmount = simpleToExactAmount(24)

            // First donation
            const tx = await vault.donate(asset.address, firstDonationAmount)
            const lastTxTimestamp = await getTimestampFromTx(tx)

            await increaseTime(ONE_DAY.add(ONE_HOUR))
            const secondDonationAmount = simpleToExactAmount(2)

            await assertDonation(
                lastTxTimestamp,
                secondDonationAmount,
                ownerSharesBefore,
                firstDonationAmount,
                ownerSharesBefore.add(firstDonationAmount),
            )
        })
        it("fails if donated token is not the underlying asset", async () => {
            const tx = vault.donate(rewards1.address, ZERO_ADDRESS)
            await expect(tx).to.be.revertedWith("Donated token not asset")
        })
    })
    context("2 decimals and one block", async () => {
        const decimals = 2
        const firstMintAmount = simpleToExactAmount(1000, decimals)
        beforeEach(async () => {
            vault = await setup(decimals)
            await increaseTime(ONE_DAY)

            await vault.mint(firstMintAmount, sa.default.address)

            expect(await asset.decimals(), "asset decimals").to.eq(decimals)
            expect(await vault.decimals(), "vault decimals").to.eq(decimals)
        })
    })
    context("admin", async () => {
        describe("addReward", async () => {
            it("fails if callee is not governor", async () => {
                const tx = vault.connect(sa.dummy1.signer).addRewards([ZERO_ADDRESS])
                await expect(tx).to.be.revertedWith("Only governor can execute")
            })
            it("fails if module liquidator is not set", async () => {
                await nexus.setLiquidatorV2(ZERO_ADDRESS)
                const tx = vault.connect(sa.governor.signer).addRewards([ZERO_ADDRESS])
                await expect(tx).to.be.revertedWith("invalid Liquidator V2")
            })
            it("adds new rewards", async () => {
                nexus.setLiquidatorV2(liquidator.address)
                const mocks = await new ContractMocks().init(sa)

                const newRewards = [mocks.dai.address, mocks.usdc.address]
                const rewardTokensBefore = await vault.rewardTokens()
                // Add rewards
                const tx = vault.connect(sa.governor.signer).addRewards(newRewards)
                // Verify
                await expect(tx).to.emit(vault, "RewardAdded").withArgs(mocks.dai.address, rewardTokensBefore.length)
                await expect(tx)
                    .to.emit(vault, "RewardAdded")
                    .withArgs(mocks.usdc.address, rewardTokensBefore.length + 1)

                const rewardTokensAfter = await vault.rewardTokens()
                // Rewards are added
                expect(rewardTokensAfter[rewardTokensAfter.length - 2]).to.equal(mocks.dai.address)
                expect(rewardTokensAfter[rewardTokensAfter.length - 1]).to.equal(mocks.usdc.address)
                // Reward tokens have allowance for the liquidator.
                const rewardTokenAAllowance = await MockERC20__factory.connect(mocks.dai.address, sa.default.signer).allowance(
                    vault.address,
                    liquidator.address,
                )
                const rewardTokenBAllowance = await MockERC20__factory.connect(mocks.usdc.address, sa.default.signer).allowance(
                    vault.address,
                    liquidator.address,
                )

                expect(rewardTokenAAllowance, "rewards token allowance").to.be.eq(ethers.constants.MaxUint256)
                expect(rewardTokenBAllowance, "rewards token allowance").to.be.eq(ethers.constants.MaxUint256)
            })
        })
    })
})
