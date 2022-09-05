import { assertBNClosePercent, findContractEvent } from "@utils/assertions"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"

import type { StandardAccounts } from "@utils/machines"
import type { BN } from "@utils/math"
import type { ContractTransaction } from "ethers"
import type { Account } from "types"
import type { AbstractVault, ERC20, IERC20Metadata } from "types/generated"

type Variance = number | string
type Variances = {
    deposit?: Variance
    mint?: Variance
    withdraw?: Variance
    redeem?: Variance
    convertToShares?: Variance
    convertToAssets?: Variance
    maxWithdraw?: Variance
    maxRedeem?: Variance
}
export interface AbstractVaultBehaviourContext {
    vault: AbstractVault
    asset: ERC20 | IERC20Metadata
    sa: StandardAccounts
    fixture: () => Promise<void>
    variances?: Variances
}

interface Data {
    callerAssetBalance: BN
    callerSharesBalance: BN
    receiverAssetBalance: BN
    receiverSharesBalance: BN
    ownerAssetBalance: BN
    ownerSharesBalance: BN
    totalSupply: BN
    totalAssets: BN
}
const defaultVariances: Variances = {
    deposit: 0,
    mint: 0,
    withdraw: 0,
    redeem: 0,
    convertToShares: 0,
    convertToAssets: 0,
    maxWithdraw: 0,
    maxRedeem: 0,
}

const snapshotData = async (ctx: AbstractVaultBehaviourContext, sender: Account, receiver: Account, owner: Account): Promise<Data> => {
    return {
        callerAssetBalance: await ctx.asset.balanceOf(sender.address),
        callerSharesBalance: await ctx.vault.balanceOf(sender.address),
        receiverAssetBalance: await ctx.asset.balanceOf(receiver.address),
        receiverSharesBalance: await ctx.vault.balanceOf(receiver.address),
        ownerAssetBalance: await ctx.asset.balanceOf(owner.address),
        ownerSharesBalance: await ctx.vault.balanceOf(owner.address),
        totalSupply: await ctx.vault.totalSupply(),
        totalAssets: await ctx.vault.totalAssets(),
    }
}

async function expectWithdrawEvent(
    vault: AbstractVault,
    tx: ContractTransaction,
    sender: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
    variance: Variance = 0,
) {
    const receipt = await tx.wait()
    await expect(tx).to.emit(vault, "Withdraw")
    const withdrawEvent = findContractEvent(receipt, vault.address, "Withdraw")
    expect(withdrawEvent).to.not.equal(undefined)
    expect(withdrawEvent.args.sender, "sender").to.eq(sender.address)
    expect(withdrawEvent.args.receiver, "receiver").to.eq(receiver.address)
    expect(withdrawEvent.args.owner, "owner").to.eq(owner.address)
    assertBNClosePercent(withdrawEvent.args.assets, assets, variance, "assets")
    assertBNClosePercent(withdrawEvent.args.shares, shares, variance, "shares")
}
async function expectDepositEvent(
    vault: AbstractVault,
    tx: ContractTransaction,
    sender: Account,
    receiver: Account,
    assets: BN,
    shares: BN,
    variance: Variance = 0,
) {
    // Verify events, storage change, balance, etc.
    const receipt = await tx.wait()
    await expect(tx).to.emit(vault, "Deposit")
    const event = findContractEvent(receipt, vault.address, "Deposit")
    expect(event).to.not.equal(undefined)
    expect(event.args.sender, "sender").to.eq(sender.address)
    expect(event.args.receiver, "receiver").to.eq(receiver.address)
    assertBNClosePercent(event.args.assets, assets, variance, "assets")
    assertBNClosePercent(event.args.shares, shares, variance, "shares")
}

async function expectRedeem(
    ctx: AbstractVaultBehaviourContext,
    sender: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
) {
    const dataBefore = await snapshotData(ctx, sender, receiver, owner)
    const tx = await ctx.vault.connect(sender.signer)["redeem(uint256,address,address)"](shares, receiver.address, owner.address)

    await expectWithdrawEvent(ctx.vault, tx, sender, receiver, owner, assets, shares, ctx.variances.redeem)
    const data = await snapshotData(ctx, sender, receiver, owner)

    assertBNClosePercent(await ctx.vault.maxRedeem(sender.address), data.callerSharesBalance, ctx.variances.maxRedeem, "max redeem")
    assertBNClosePercent(
        await ctx.vault.maxWithdraw(sender.address),
        await ctx.vault.convertToAssets(data.callerSharesBalance),
        ctx.variances.maxWithdraw,
        "max withdraw",
    )
    assertBNClosePercent(data.totalAssets, dataBefore.totalAssets.sub(assets), ctx.variances.redeem, "totalAssets")
    assertBNClosePercent(data.ownerSharesBalance, dataBefore.ownerSharesBalance.sub(shares), ctx.variances.redeem, "owner shares")
    if (owner.address !== receiver.address) {
        assertBNClosePercent(data.ownerAssetBalance, dataBefore.ownerAssetBalance, ctx.variances.redeem, "owner assets")
    }

    assertBNClosePercent(data.receiverAssetBalance, dataBefore.receiverAssetBalance.add(assets), ctx.variances.redeem, "receiver assets")
}

async function expectWithdraw(
    ctx: AbstractVaultBehaviourContext,
    sender: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
) {
    const dataBefore = await snapshotData(ctx, sender, receiver, owner)
    const tx = await ctx.vault.connect(sender.signer).withdraw(assets, receiver.address, owner.address)
    await expectWithdrawEvent(ctx.vault, tx, sender, receiver, owner, assets, shares, ctx.variances.withdraw)
    const data = await snapshotData(ctx, sender, receiver, owner)

    assertBNClosePercent(await ctx.vault.maxRedeem(sender.address), data.callerSharesBalance, ctx.variances.maxRedeem, "max redeem")
    assertBNClosePercent(
        await ctx.vault.maxWithdraw(sender.address),
        await ctx.vault.convertToAssets(data.callerSharesBalance),
        ctx.variances.maxWithdraw,
        "max withdraw",
    )
    assertBNClosePercent(data.totalAssets, dataBefore.totalAssets.sub(assets), ctx.variances.withdraw, "totalAssets")
    assertBNClosePercent(data.ownerSharesBalance, dataBefore.ownerSharesBalance.sub(shares), ctx.variances.withdraw, "owner shares")
    if (owner.address !== receiver.address) {
        assertBNClosePercent(data.ownerAssetBalance, dataBefore.ownerAssetBalance, ctx.variances.withdraw, "owner assets")
    }

    assertBNClosePercent(data.receiverAssetBalance, dataBefore.receiverAssetBalance.add(assets), ctx.variances.withdraw, "receiver assets")
}

export function shouldBehaveLikeAbstractVault(ctx: () => AbstractVaultBehaviourContext): void {
    let assetsAmount: BN
    let sharesAmount: BN
    let alice: Account
    let bob: Account
    //
    let aliceAssetBalance = ZERO
    let aliceSharesBalance = ZERO
    let totalSupply = ZERO
    let totalAssets = ZERO
    let variances: Variances
    let decimals: number

    beforeEach("init", async () => {
        const { vault, asset, sa } = ctx()

        decimals = await (asset as unknown as IERC20Metadata).decimals()

        assetsAmount = simpleToExactAmount(1, decimals)
        sharesAmount = simpleToExactAmount(1, decimals)
        alice = sa.alice
        bob = sa.bob
        aliceAssetBalance = await asset.balanceOf(alice.address)
        aliceSharesBalance = await vault.balanceOf(alice.address)
        totalSupply = await vault.totalSupply()
        totalAssets = await vault.totalAssets()
        variances = { ...defaultVariances, ...ctx().variances }
        ctx().variances = variances
    })
    describe("store values", async () => {
        it("should properly store valid arguments", async () => {
            const { vault, asset } = ctx()

            expect(await vault.asset(), "asset").to.eq(asset.address)
        })
        it("initial values", async () => {
            const { vault } = ctx()

            expect(await vault.totalAssets(), "totalAssets").to.eq(0)
            expect(await vault.totalSupply(), "totalSupply").to.eq(0)
        })
    })
    describe("deposit", async () => {
        before("initial deposits", async () => {
            const { vault, asset } = ctx()
            // initial deposit so all preview functions take into account liquidity
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, assetsAmount)
            }
            await await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
        })
        it("should deposit assets to the vault", async () => {
            const { vault, asset } = ctx()

            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            const shares = await vault.previewDeposit(assetsAmount)

            expect(await vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
            expect(await vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)

            expect(await vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)
            assertBNClosePercent(
                await vault.maxWithdraw(alice.address),
                await vault.convertToAssets(aliceSharesBalance),
                variances.convertToAssets,
                "max withdraw",
            )

            expect(await vault.totalAssets(), "totalAssets").to.eq(totalAssets)
            assertBNClosePercent(await vault.convertToShares(assetsAmount), shares, variances.convertToShares, "convertToShares")

            // Test
            const tx = await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // Verify events, storage change, balance, etc.
            await expectDepositEvent(vault, tx, alice, alice, assetsAmount, shares, variances.deposit)
            // expect alice balance to increase
            expect(await asset.balanceOf(alice.address), "asset balance").to.eq(aliceAssetBalance.sub(assetsAmount))
            expect(await vault.balanceOf(alice.address), "shares balance").to.eq(aliceSharesBalance.add(shares))
            assertBNClosePercent(await vault.totalAssets(), totalAssets.add(assetsAmount), variances.convertToShares, "totalAssets")
        })
        xit("fails if deposits zero", async () => {
            const { vault, sa } = ctx()

            await expect(vault.connect(sa.default.signer)["deposit(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Shares are zero",
            )
        })
        it("fails if receiver is zero", async () => {
            const { vault, sa } = ctx()

            // openzeppelin message "ERC20: mint to the zero address"
            await expect(vault.connect(sa.default.signer)["deposit(uint256,address)"](10, ZERO_ADDRESS)).to.be.reverted
        })
        it("preview deposit if assets is zero", async () => {
            const { vault, sa } = ctx()

            expect(await vault.connect(sa.default.signer).previewDeposit(ZERO)).to.eq(ZERO)
        })
    })
    describe("mint", async () => {
        it("should mint shares to the vault", async () => {
            const { vault, asset } = ctx()

            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            const assets = await vault.previewMint(sharesAmount)
            const shares = await vault.previewDeposit(assetsAmount)

            expect(await vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
            expect(await vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)
            expect(await vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)
            // expect(await vault.maxWithdraw(alice.address), "max withdraw").to.eq(assetsAmount)
            expect(await vault.totalAssets(), "totalAssets").to.eq(totalAssets)
            assertBNClosePercent(await vault.convertToShares(assetsAmount), shares, variances.convertToShares, "convertToShares")
            assertBNClosePercent(await vault.convertToAssets(sharesAmount), assets, variances.convertToAssets, "convertToAssets")

            const tx = await vault.connect(alice.signer)["mint(uint256,address)"](sharesAmount, alice.address)
            // Verify events, storage change, balance, etc.
            expectDepositEvent(vault, tx, alice, alice, assets, sharesAmount, variances.deposit)
            expect(await vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance.add(sharesAmount))
            assertBNClosePercent(
                await vault.maxWithdraw(alice.address),
                await vault.convertToAssets(aliceSharesBalance.add(sharesAmount)),
                variances.maxWithdraw,
                "max withdraw",
            )

            assertBNClosePercent(await vault.totalAssets(), totalAssets.add(assets), variances.mint, "totalAssets")
            expect(await vault.totalSupply(), "totalSupply").to.eq(totalSupply.add(sharesAmount))
        })
        xit("fails if mint zero", async () => {
            const { vault, sa } = ctx()

            await expect(vault.connect(sa.default.signer)["mint(uint256,address)"](0, alice.address)).to.be.revertedWith("Assets are zero")
        })
        it("fails if receiver is zero", async () => {
            const { vault, sa } = ctx()

            // openzeppelin message "ERC20: mint to the zero address"
            await expect(vault.connect(sa.default.signer)["mint(uint256,address)"](10, ZERO_ADDRESS)).to.be.reverted
        })
    })
    describe("withdraw", async () => {
        it("from the vault, same sender, receiver and owner", async () => {
            const { vault, asset } = ctx()

            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            assertBNClosePercent(
                await vault.maxWithdraw(alice.address),
                await vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            )
            expect(await vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            const shares = await vault.previewWithdraw(assetsAmount)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx(), alice, alice, alice, assetsAmount, shares)
        })
        it("from the vault, sender != receiver and sender = owner", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Alice withdraws assets (sender), Bob receives assets (receiver)
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, assetsAmount)
            }
            assertBNClosePercent(
                await vault.maxWithdraw(alice.address),
                await vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            )

            expect(await vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await vault.totalAssets(), "totalAssets").to.gt(totalAssets)
            const shares = await vault.previewWithdraw(assetsAmount)
            assertBNClosePercent(await vault.maxRedeem(alice.address), aliceSharesBalance.add(shares), variances.maxRedeem, "max redeem")

            aliceAssetBalance = await asset.balanceOf(alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx(), alice, bob, alice, assetsAmount, shares)
        })
        it("from the vault sender != owner, infinite approval", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            await vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)

            assertBNClosePercent(
                await vault.maxWithdraw(alice.address),
                await vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            )

            expect(await vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await asset.balanceOf(alice.address), "owner assets").to.eq(aliceAssetBalance.sub(assetsAmount))

            const shares = await vault.previewWithdraw(assetsAmount)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx(), bob, bob, alice, assetsAmount, shares)
        })
        it("from the vault, sender != receiver and sender != owner", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            assertBNClosePercent(
                await vault.maxWithdraw(alice.address),
                await vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            ) //maxWithdraw
            expect(await vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            const shares = await vault.previewWithdraw(assetsAmount)
            await vault.connect(alice.signer).approve(bob.address, shares)
            await expectWithdraw(ctx(), bob, bob, alice, assetsAmount, shares)
        })
        xit("fails if withdraw zero", async () => {
            const { vault, sa } = ctx()

            await expect(vault.connect(sa.default.signer).withdraw(0, alice.address, alice.address)).to.be.revertedWith("Shares are zero")
        })
        // it("fails if receiver is zero", async () => {
        //     await expect(vault.connect(sa.default.signer).withdraw(10, ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
        //         "Invalid beneficiary address",
        //     )
        // })
        it("fail if sender != owner and it has not allowance", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            await vault.connect(alice.signer).approve(bob.address, 0)

            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // Test
            const tx = vault.connect(bob.signer).withdraw(assetsAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
    describe("redeem", async () => {
        beforeEach("initial state", async () => {
            const { vault, asset } = ctx()

            aliceAssetBalance = await asset.balanceOf(alice.address)
            aliceSharesBalance = await vault.balanceOf(alice.address)
            totalSupply = await vault.totalSupply()
            totalAssets = await vault.totalAssets()
        })
        it("from the vault, same sender, receiver and owner", async () => {
            const { vault, asset } = ctx()

            const assets = await vault.previewRedeem(sharesAmount)

            if ((await asset.allowance(alice.address, vault.address)).lt(assets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            expect(await vault.maxRedeem(alice.address), "max maxRedeem").to.eq(aliceSharesBalance)

            // Given that
            await vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx(), alice, alice, alice, assets, sharesAmount)
        })
        it("from the vault, sender != receiver and sender = owner", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Alice withdraws assets (sender), Bob receives assets (receiver)

            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, assetsAmount)
            }
            const assets = await vault.previewRedeem(sharesAmount)

            expect(await vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)

            // Given that
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx(), alice, bob, alice, assets, sharesAmount)
        })
        it("from the vault sender != owner, infinite approval", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)

            const assets = await vault.previewRedeem(sharesAmount)
            if ((await asset.allowance(alice.address, vault.address)).lt(assets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            await vault.connect(alice.signer).approve(bob.address, sharesAmount)

            await vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx(), bob, bob, alice, assets, sharesAmount)
        })
        it("from the vault, sender != receiver and sender != owner", async () => {
            const { vault, asset } = ctx()

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            const assets = await vault.previewRedeem(sharesAmount)
            if ((await asset.allowance(alice.address, vault.address)).lt(assets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            await vault.connect(alice.signer).approve(bob.address, sharesAmount)

            await vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx(), bob, bob, alice, assets, sharesAmount)
        })
        xit("fails if deposits zero", async () => {
            const { vault, sa } = ctx()

            await expect(
                vault.connect(sa.default.signer)["redeem(uint256,address,address)"](0, alice.address, alice.address),
            ).to.be.revertedWith("Assets are zero")
        })
        // it("fails if receiver is zero", async () => {
        //     await expect(
        //         vault.connect(sa.default.signer)["redeem(uint256,address,address)"](10, ZERO_ADDRESS, ZERO_ADDRESS),
        //     ).to.be.revertedWith("Invalid beneficiary address")
        // })
        it("fail if sender != owner and it has not allowance", async () => {
            const { vault } = ctx()

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            await vault.connect(alice.signer).approve(bob.address, 0)
            const assets = await vault.previewRedeem(sharesAmount)

            await vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            const tx = vault.connect(bob.signer)["redeem(uint256,address,address)"](sharesAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
}

export default shouldBehaveLikeAbstractVault
