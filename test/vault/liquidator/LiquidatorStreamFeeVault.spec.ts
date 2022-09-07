import { shouldBehaveLikeAbstractVault, testAmounts } from "@test/shared/AbstractVault.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { assertBNClose } from "@utils/assertions"
import { ONE_DAY, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { getTimestampFromTx, increaseTime } from "@utils/time"
import { expect } from "chai"
import { ethers } from "hardhat"
import {
    BasicDexSwap__factory,
    Liquidator__factory,
    LiquidatorStreamFeeBasicVault__factory,
    MockERC20__factory,
    MockNexus__factory,
} from "types/generated"

import { shouldBehaveLikeLiquidatorStreamFeeAbstractVault } from "../../shared/LiquidatorStreamFeeAbstractVault.behaviour"

import type { TransactionResponse } from "@ethersproject/providers"
import type { AbstractVaultBehaviourContext } from "@test/shared/AbstractVault.behaviour"
import type { BigNumberish } from "ethers"
import type {
    AbstractVault,
    BasicDexSwap,
    Liquidator,
    LiquidatorStreamFeeBasicVault,
    MockERC20,
    MockNexus,
    VaultManagerRole,
} from "types/generated"

const defaultDonationFee = 10000 // 1%

describe("Streamed Liquidator Fee Vault", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let asset: MockERC20
    let rewards1: MockERC20
    let rewards2: MockERC20
    let swapper: BasicDexSwap
    let liquidator: Liquidator
    let vault: LiquidatorStreamFeeBasicVault

    const assertStreamedShares = async (
        tx: TransactionResponse,
        lastTxTimestamp: BigNumberish,
        txShares: BigNumberish,
        streamedSharesBefore: BigNumberish,
        investorSharesBefore: BigNumberish,
    ): Promise<{ streamedShares: BN; lastTxTimestamp: BN }> => {
        const totalSharesBefore = BN.from(streamedSharesBefore).add(investorSharesBefore)

        const currentTxTimestamp = await getTimestampFromTx(tx)
        const periodTime = currentTxTimestamp.sub(lastTxTimestamp)

        let burntShares = BN.from(0)
        const stream = await vault.shareStream()
        if (BN.from(lastTxTimestamp).lt(stream.end)) {
            expect(stream.last, "stream last").to.eq(currentTxTimestamp)
            burntShares = stream.sharesPerSecond.mul(periodTime)

            await expect(tx).to.emit(vault, "Burn").withArgs(vault.address, burntShares)
            await expect(tx).to.emit(vault, "Withdraw").withArgs(vault.address, ZERO_ADDRESS, 0, burntShares)
        }

        expect(await vault.streamedShares(), "streamed shares").to.eq(BN.from(streamedSharesBefore).sub(burntShares))

        expect(await vault.balanceOf(sa.default.address), "investor shares after").to.eq(BN.from(investorSharesBefore).add(txShares))
        expect(await vault.balanceOf(vault.address), "stream shares after").to.eq(BN.from(streamedSharesBefore).sub(burntShares))
        expect(await vault.totalSupply(), "total shares after").to.eq(totalSharesBefore.add(txShares).sub(burntShares))

        return {
            streamedShares: burntShares,
            lastTxTimestamp: currentTxTimestamp,
        }
    }

    const assertDonation = async (
        lastTxTimestamp: BigNumberish,
        txAmount: BigNumberish,
        investorSharesBefore: BigNumberish,
        streamedSharesBefore: BigNumberish,
        feeSharesBefore: BigNumberish,
        totalAssetsBefore: BigNumberish,
    ) => {
        // Donate
        const tx = await vault.donate(asset.address, txAmount)

        const currentTxTimestamp = await getTimestampFromTx(tx)
        const remainingStreamSeconds = BN.from(currentTxTimestamp).sub(lastTxTimestamp).lt(ONE_DAY)
            ? BN.from(lastTxTimestamp).add(ONE_DAY).sub(currentTxTimestamp)
            : BN.from(0)
        const remainingStreamShares = remainingStreamSeconds.mul(streamedSharesBefore).div(ONE_DAY)

        const newShares = BN.from(totalAssetsBefore).gt(0)
            ? BN.from(txAmount).mul(BN.from(investorSharesBefore).add(feeSharesBefore)).div(totalAssetsBefore)
            : BN.from(txAmount)
        const newFeeShares = newShares.div(100)
        const feeAssets = BN.from(txAmount).div(100)
        const newStreamShares = newShares.sub(newFeeShares)
        const feeSharesAfter = newFeeShares.add(feeSharesBefore)
        const streamedSharesAfter = BN.from(remainingStreamShares).add(newStreamShares)

        // Transfer event of assets to vault
        await expect(tx).to.emit(asset, "Transfer").withArgs(sa.default.address, vault.address, txAmount)
        // Mint event of fee shares
        await expect(tx).to.emit(vault, "Transfer").withArgs(ZERO_ADDRESS, sa.feeReceiver.address, newFeeShares)
        // Mint event of vault's streamed shares
        await expect(tx).to.emit(vault, "Transfer").withArgs(ZERO_ADDRESS, vault.address, newStreamShares)

        // Deposit event for streamed shares
        await expect(tx)
            .to.emit(vault, "Deposit")
            .withArgs(sa.default.address, vault.address, BN.from(txAmount).sub(feeAssets), newStreamShares)
        // Deposit events for fee
        await expect(tx).to.emit(vault, "Deposit").withArgs(sa.default.address, sa.feeReceiver.address, feeAssets, newFeeShares)

        const duration = ONE_DAY
        const sharesPerSecond = streamedSharesAfter.mul(simpleToExactAmount(1)).div(duration)

        const stream = await vault.shareStream()
        expect(stream.last, "stream last").to.eq(currentTxTimestamp)
        expect(stream.end, "stream end").to.eq(currentTxTimestamp.add(duration))
        // expect(stream.sharesPerSecond, "stream sharesPerSecond").to.eq(sharesPerSecond)
        assertBNClose(stream.sharesPerSecond, sharesPerSecond, 3)

        assertBNClose(await vault.streamedShares(), streamedSharesAfter, 3)

        expect(await vault.balanceOf(sa.default.address), "investor shares after").to.eq(investorSharesBefore)
        assertBNClose(await vault.balanceOf(vault.address), streamedSharesAfter, 3)
        assertBNClose(await vault.balanceOf(sa.feeReceiver.address), feeSharesAfter, 3)
        assertBNClose(await vault.totalSupply(), BN.from(investorSharesBefore).add(streamedSharesAfter).add(feeSharesAfter), 3)
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
        await nexus.setLiquidator(liquidator.address)
    }

    const setup = async (decimals = 18): Promise<LiquidatorStreamFeeBasicVault> => {
        await deployFeeVaultDependencies(decimals)
        vault = await new LiquidatorStreamFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address, ONE_DAY)

        await vault.initialize(
            "feeVault",
            "fv",
            sa.vaultManager.address,
            [rewards1.address, rewards2.address],
            sa.feeReceiver.address,
            defaultDonationFee,
        )
        // Approve vault to transfer assets from default signer
        await asset.approve(vault.address, ethers.constants.MaxUint256)
        // set balance or users for the test.
        const assetBalance = await asset.balanceOf(sa.default.address)
        asset.transfer(sa.alice.address, assetBalance.div(2))
        return vault
    }

    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
    })
    describe("behaviors", async () => {
        before(async () => {
            vault = await setup()
        })
        it("should behave like LiquidatorStreamFeeAbstractVault ", async () => {
            shouldBehaveLikeLiquidatorStreamFeeAbstractVault({ sa, vault })
        })
        shouldBehaveLikeVaultManagerRole(() => ({ vaultManagerRole: vault as VaultManagerRole, sa }))

        describe("should behave like AbstractVaultBehaviourContext", async () => {
            const ctx: Partial<AbstractVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup()
                    ctx.vault = vault as unknown as AbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(100, await asset.decimals())
                }
            })
            shouldBehaveLikeAbstractVault(() => ctx as AbstractVaultBehaviourContext)
        })
    })
    describe("constructor", async () => {
        before(async () => {
            await deployFeeVaultDependencies()
            vault = await new LiquidatorStreamFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address, ONE_DAY)
        })
        it("should properly store constructor arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "underlying asset").to.eq(asset.address)
            expect(await vault.asset(), "asset").to.eq(asset.address)
            expect(await vault.FEE_SCALE(), "fee scale").to.eq(simpleToExactAmount(1, 6))
        })
        it("should fail if arguments are wrong", async () => {
            await expect(
                new LiquidatorStreamFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, ONE_DAY),
            ).to.be.revertedWith("Asset is zero")
        })
    })
    describe("calling initialize", async () => {
        before(async () => {
            await deployFeeVaultDependencies(12)
            vault = await new LiquidatorStreamFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address, ONE_DAY)
            await vault.initialize(
                "feeVault",
                "fv",
                sa.vaultManager.address,
                [rewards1.address, rewards2.address],
                sa.feeReceiver.address,
                defaultDonationFee,
            )
        })
        it("should properly store valid arguments", async () => {
            const stream = await vault.shareStream()
            expect(stream.last, "stream last").to.eq(0)
            expect(stream.end, "stream end").to.eq(0)
            expect(stream.sharesPerSecond, "stream sharesPerSecond").to.eq(0)

            expect(await vault.feeReceiver(), "fee receiver").to.eq(sa.feeReceiver.address)
            const fee = await vault.donationFee()
            expect(fee, "donation fee").to.eq(defaultDonationFee)
            const feeScale = await vault.FEE_SCALE()
            expect(BN.from(fee).mul(100).div(feeScale), "1% donation fee").to.eq(1)

            expect(await vault.symbol(), "symbol").to.eq("fv")
            expect(await vault.name(), "name").to.eq("feeVault")
            expect(await vault.decimals(), "symbol").to.eq(12)

            expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)

            expect(await vault.totalSupply(), "total shares").to.eq(0)
            expect(await vault.totalAssets(), "total assets").to.eq(0)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize(
                    "feeVault",
                    "fv",
                    sa.vaultManager.address,
                    [rewards1.address, rewards2.address],
                    sa.feeReceiver.address,
                    defaultDonationFee,
                ),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
    context("no streamed shares", async () => {
        beforeEach(async () => {
            vault = await setup()
            await increaseTime(ONE_DAY)
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
    context("donated shares", () => {
        beforeEach(async () => {
            vault = await setup()
            await increaseTime(ONE_WEEK)
        })
        it("before investor shares", async () => {
            const txAmount = simpleToExactAmount(300)

            await assertDonation(0, txAmount, 0, 0, 0, 0)
        })
        it("after investor shares", async () => {
            const investorSharesBefore = simpleToExactAmount(11111)
            await vault.deposit(investorSharesBefore, sa.default.address)
            await increaseTime(60)
            const txAmount = simpleToExactAmount(500)

            await assertDonation(0, txAmount, investorSharesBefore, 0, 0, investorSharesBefore)
        })
        it("after appreciation of investor shares", async () => {
            const investorSharesBefore = simpleToExactAmount(1000)
            const totalAssetsBefore = investorSharesBefore.mul(11).div(10)
            await vault.deposit(investorSharesBefore, sa.default.address)
            await increaseTime(60)
            // Appreciate the assets per share by 10%
            await asset.transfer(vault.address, investorSharesBefore.div(10))
            const txAmount = simpleToExactAmount(500)

            await assertDonation(0, txAmount, investorSharesBefore, 0, 0, totalAssetsBefore)
        })
        it("second donation near start of first stream", async () => {
            const investorSharesBefore = simpleToExactAmount(100)
            await vault.deposit(investorSharesBefore, sa.default.address)
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
                investorSharesBefore,
                firstDonationAmount.mul(99).div(100),
                firstDonationAmount.div(100),
                investorSharesBefore.add(firstDonationAmount),
            )
        })
        it("second donation near end of first stream", async () => {
            const investorSharesBefore = simpleToExactAmount(100)
            await vault.deposit(investorSharesBefore, sa.default.address)
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
                investorSharesBefore,
                firstDonationAmount.mul(99).div(100),
                firstDonationAmount.div(100),
                investorSharesBefore.add(firstDonationAmount),
            )
        })
        it("second donation at end of first stream", async () => {
            const investorSharesBefore = simpleToExactAmount(100)
            await vault.deposit(investorSharesBefore, sa.default.address)
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
                investorSharesBefore,
                firstDonationAmount.mul(99).div(100),
                firstDonationAmount.div(100),
                investorSharesBefore.add(firstDonationAmount),
            )
        })
        it("second donation after end of first stream", async () => {
            const investorSharesBefore = simpleToExactAmount(100)
            await vault.deposit(investorSharesBefore, sa.default.address)
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
                investorSharesBefore,
                firstDonationAmount.mul(99).div(100),
                firstDonationAmount.div(100),
                investorSharesBefore.add(firstDonationAmount),
            )
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
})
