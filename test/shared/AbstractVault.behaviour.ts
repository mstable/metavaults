import { assertBNClose, findContractEvent } from "@utils/assertions"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"

import type { StandardAccounts } from "@utils/machines"
import type { ContractTransaction } from "ethers"
import type { Account } from "types"
import type { AbstractVault, ERC20, IERC20Metadata } from "types/generated"

type Variance = BN | number
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

export const defaultVariances = {
    deposit: BN.from(1),
    mint: BN.from(1),
    withdraw: BN.from(1),
    redeem: BN.from(1),
    convertToShares: BN.from(1),
    convertToAssets: BN.from(1),
    maxWithdraw: BN.from(1),
    maxRedeem: BN.from(1),
}

const snapshotData = async (ctx: AbstractVaultBehaviourContext, caller: Account, receiver: Account, owner: Account): Promise<Data> => {
    return {
        callerAssetBalance: await ctx.asset.balanceOf(caller.address),
        callerSharesBalance: await ctx.vault.balanceOf(caller.address),
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
    caller: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
    variance: Variance = BN.from(10),
) {
    const receipt = await tx.wait()
    await expect(tx).to.emit(vault, "Withdraw")
    const withdrawEvent = findContractEvent(receipt, vault.address, "Withdraw")
    expect(withdrawEvent).to.not.equal(undefined)
    expect(withdrawEvent.args.sender, "sender").to.eq(caller.address)
    expect(withdrawEvent.args.receiver, "receiver").to.eq(receiver.address)
    expect(withdrawEvent.args.owner, "owner").to.eq(owner.address)
    assertBNClose(withdrawEvent.args.assets, assets, variance, "assets")
    assertBNClose(withdrawEvent.args.shares, shares, variance, "shares")
}
async function expectDepositEvent(
    vault: AbstractVault,
    tx: ContractTransaction,
    caller: Account,
    receiver: Account,
    assets: BN,
    shares: BN,
    variance: Variance = BN.from(10),
) {
    // Verify events, storage change, balance, etc.
    const receipt = await tx.wait()
    await expect(tx).to.emit(vault, "Deposit")
    const event = findContractEvent(receipt, vault.address, "Deposit")
    expect(event).to.not.equal(undefined)
    expect(event.args.sender, "sender").to.eq(caller.address)
    expect(event.args.receiver, "receiver").to.eq(receiver.address)
    assertBNClose(event.args.assets, assets, variance, "assets")
    assertBNClose(event.args.shares, shares, variance, "shares")
}

async function expectRedeem(
    ctx: AbstractVaultBehaviourContext,
    caller: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
) {
    const dataBefore = await snapshotData(ctx, caller, receiver, owner)
    const tx = await ctx.vault.connect(caller.signer)["redeem(uint256,address,address)"](shares, receiver.address, owner.address)

    await expectWithdrawEvent(ctx.vault, tx, caller, receiver, owner, assets, shares, ctx.variances.redeem)
    const data = await snapshotData(ctx, caller, receiver, owner)

    assertBNClose(await ctx.vault.maxRedeem(caller.address), data.callerSharesBalance, ctx.variances.maxRedeem, "max redeem")
    assertBNClose(
        await ctx.vault.maxWithdraw(caller.address),
        await ctx.vault.convertToAssets(data.callerSharesBalance),
        ctx.variances.maxWithdraw,
        "max withdraw",
    )
    assertBNClose(data.totalAssets, dataBefore.totalAssets.sub(assets), ctx.variances.redeem, "totalAssets")
    assertBNClose(data.ownerSharesBalance, dataBefore.ownerSharesBalance.sub(shares), ctx.variances.redeem, "owner shares")
    if (owner.address !== receiver.address) {
        assertBNClose(data.ownerAssetBalance, dataBefore.ownerAssetBalance, ctx.variances.redeem, "owner assets")
    }

    assertBNClose(data.receiverAssetBalance, dataBefore.receiverAssetBalance.add(assets), ctx.variances.redeem, "receiver assets")
}

async function expectWithdraw(
    ctx: AbstractVaultBehaviourContext,
    caller: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
) {
    const dataBefore = await snapshotData(ctx, caller, receiver, owner)
    const tx = await ctx.vault.connect(caller.signer).withdraw(assets, receiver.address, owner.address)
    await expectWithdrawEvent(ctx.vault, tx, caller, receiver, owner, assets, shares, ctx.variances.withdraw)
    const data = await snapshotData(ctx, caller, receiver, owner)

    assertBNClose(await ctx.vault.maxRedeem(caller.address), data.callerSharesBalance, ctx.variances.maxRedeem, "max redeem")
    assertBNClose(
        await ctx.vault.maxWithdraw(caller.address),
        await ctx.vault.convertToAssets(data.callerSharesBalance),
        ctx.variances.maxWithdraw,
        "max withdraw",
    )
    assertBNClose(data.totalAssets, dataBefore.totalAssets.sub(assets), ctx.variances.withdraw, "totalAssets")
    assertBNClose(data.ownerSharesBalance, dataBefore.ownerSharesBalance.sub(shares), ctx.variances.withdraw, "owner shares")
    if (owner.address !== receiver.address) {
        assertBNClose(data.ownerAssetBalance, dataBefore.ownerAssetBalance, ctx.variances.withdraw, "owner assets")
    }

    assertBNClose(data.receiverAssetBalance, dataBefore.receiverAssetBalance.add(assets), ctx.variances.withdraw, "receiver assets")
}

export function shouldBehaveLikeAbstractVault(ctx: AbstractVaultBehaviourContext): void {
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

    beforeEach("init", async () => {
        assetsAmount = simpleToExactAmount(1, await (ctx.asset as unknown as IERC20Metadata).decimals())
        sharesAmount = simpleToExactAmount(1, await (ctx.asset as unknown as IERC20Metadata).decimals())
        alice = ctx.sa.alice
        bob = ctx.sa.bob
        aliceAssetBalance = await ctx.asset.balanceOf(alice.address)
        aliceSharesBalance = await ctx.vault.balanceOf(alice.address)
        totalSupply = await ctx.vault.totalSupply()
        totalAssets = await ctx.vault.totalAssets()
        variances = { ...defaultVariances, ...ctx.variances }
        ctx.variances = variances
    })
    it("should properly store valid arguments", async () => {
        expect(await ctx.vault.asset(), "asset").to.eq(ctx.asset.address)
    })
    it("initial values", async () => {
        expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        expect(await ctx.vault.totalSupply(), "totalSupply").to.eq(0)
    })
    describe("deposit", async () => {
        it("should deposit assets to the vault", async () => {
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }

            const shares = await ctx.vault.previewDeposit(assetsAmount)

            expect(await ctx.vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
            expect(await ctx.vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(await ctx.vault.convertToAssets(aliceSharesBalance))
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)
            assertBNClose(await ctx.vault.convertToShares(assetsAmount), shares, variances.convertToShares, "convertToShares")

            // Test
            const tx = await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // Verify events, storage change, balance, etc.
            await expectDepositEvent(ctx.vault, tx, alice, alice, assetsAmount, shares, variances.deposit)
            // expect alice balance to increase
            expect(await ctx.asset.balanceOf(alice.address), "asset balance").to.eq(aliceAssetBalance.sub(assetsAmount))
            expect(await ctx.vault.balanceOf(alice.address), "shares balance").to.eq(aliceSharesBalance.add(shares))
            assertBNClose(await ctx.vault.totalAssets(), totalAssets.add(assetsAmount), variances.convertToShares, "totalAssets")
        })
        it("fails if deposits zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["deposit(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Shares are zero",
            )
        })
        it("fails if receiver is zero", async () => {
            // openzeppelin message "ERC20: mint to the zero address"
            await expect(ctx.vault.connect(ctx.sa.default.signer)["deposit(uint256,address)"](10, ZERO_ADDRESS)).to.be.reverted
        })
        it("preview deposit if assets is zero", async () => {
            expect(await ctx.vault.connect(ctx.sa.default.signer).previewDeposit(ZERO)).to.eq(ZERO)
        })
    })
    describe("mint", async () => {
        it("should mint shares to the vault", async () => {
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }
            const assets = await ctx.vault.previewMint(sharesAmount)
            const shares = await ctx.vault.previewDeposit(assetsAmount)

            expect(await ctx.vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
            expect(await ctx.vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)
            // expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(assetsAmount)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)
            assertBNClose(await ctx.vault.convertToShares(assets), shares, variances.convertToShares, "convertToShares")
            assertBNClose(await ctx.vault.convertToAssets(shares), assets, variances.convertToAssets, "convertToAssets")

            const tx = await ctx.vault.connect(alice.signer)["mint(uint256,address)"](shares, alice.address)
            // Verify events, storage change, balance, etc.
            expectDepositEvent(ctx.vault, tx, alice, alice, assets, shares, variances.deposit)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance.add(shares))
            assertBNClose(
                await ctx.vault.maxWithdraw(alice.address),
                await ctx.vault.convertToAssets(aliceSharesBalance.add(shares)),
                variances.maxWithdraw,
                "max withdraw",
            )

            assertBNClose(await ctx.vault.totalAssets(), totalAssets.add(assets), variances.mint, "totalAssets")
            expect(await ctx.vault.totalSupply(), "totalSupply").to.eq(totalSupply.add(shares))
        })
        it("fails if mint zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["mint(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Assets are zero",
            )
        })
        it("fails if receiver is zero", async () => {
            // openzeppelin message "ERC20: mint to the zero address"
            await expect(ctx.vault.connect(ctx.sa.default.signer)["mint(uint256,address)"](10, ZERO_ADDRESS)).to.be.reverted
        })
    })
    describe("withdraw", async () => {
        it("from the vault, same caller, receiver and owner", async () => {
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }
            assertBNClose(
                await ctx.vault.maxWithdraw(alice.address),
                await ctx.vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            )
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx, alice, alice, alice, assetsAmount, shares)
        })
        it("from the vault, caller != receiver and caller = owner", async () => {
            // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, assetsAmount)
            }
            assertBNClose(
                await ctx.vault.maxWithdraw(alice.address),
                await ctx.vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            )

            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(totalAssets)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            assertBNClose(await ctx.vault.maxRedeem(alice.address), aliceSharesBalance.add(shares), variances.maxRedeem, "max redeem")

            aliceAssetBalance = await ctx.asset.balanceOf(alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx, alice, bob, alice, assetsAmount, shares)
        })
        it("from the vault caller != owner, infinite approval", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }
            await ctx.vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)

            assertBNClose(
                await ctx.vault.maxWithdraw(alice.address),
                await ctx.vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            )

            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.asset.balanceOf(alice.address), "owner assets").to.eq(aliceAssetBalance.sub(assetsAmount))

            const shares = await ctx.vault.previewWithdraw(assetsAmount)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx, bob, bob, alice, assetsAmount, shares)
        })
        it("from the vault, caller != receiver and caller != owner", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }

            assertBNClose(
                await ctx.vault.maxWithdraw(alice.address),
                await ctx.vault.convertToAssets(aliceSharesBalance),
                variances.maxWithdraw,
                "max withdraw",
            ) //maxWithdraw
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            await ctx.vault.connect(alice.signer).approve(bob.address, shares)
            await expectWithdraw(ctx, bob, bob, alice, assetsAmount, shares)
        })
        it("fails if withdraw zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer).withdraw(0, alice.address, alice.address)).to.be.revertedWith(
                "Shares are zero",
            )
        })
        // it("fails if receiver is zero", async () => {
        //     await expect(ctx.vault.connect(ctx.sa.default.signer).withdraw(10, ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
        //         "Invalid beneficiary address",
        //     )
        // })
        it("fail if caller != owner and it has not allowance", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }
            await ctx.vault.connect(alice.signer).approve(bob.address, 0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // Test
            const tx = ctx.vault.connect(bob.signer).withdraw(assetsAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
    describe("redeem", async () => {
        beforeEach("initial state", async () => {
            aliceAssetBalance = await ctx.asset.balanceOf(alice.address)
            aliceSharesBalance = await ctx.vault.balanceOf(alice.address)
            totalSupply = await ctx.vault.totalSupply()
            totalAssets = await ctx.vault.totalAssets()
        })
        it("from the vault, same caller, receiver and owner", async () => {
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assets)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }

            expect(await ctx.vault.maxRedeem(alice.address), "max maxRedeem").to.eq(aliceSharesBalance)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx, alice, alice, alice, assets, sharesAmount)
        })
        it("from the vault, caller != receiver and caller = owner", async () => {
            // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)

            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assetsAmount)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, assetsAmount)
            }
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx, alice, bob, alice, assets, sharesAmount)
        })
        it("from the vault caller != owner, infinite approval", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)

            const assets = await ctx.vault.previewRedeem(sharesAmount)
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assets)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }
            await ctx.vault.connect(alice.signer).approve(bob.address, sharesAmount)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx, bob, bob, alice, assetsAmount, sharesAmount)
        })
        it("from the vault, caller != receiver and caller != owner", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            const assets = await ctx.vault.previewRedeem(sharesAmount)
            if ((await ctx.asset.allowance(alice.address, ctx.vault.address)).lt(assets)) {
                await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            }
            await ctx.vault.connect(alice.signer).approve(bob.address, sharesAmount)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx, bob, bob, alice, assets, sharesAmount)
        })
        it("fails if deposits zero", async () => {
            await expect(
                ctx.vault.connect(ctx.sa.default.signer)["redeem(uint256,address,address)"](0, alice.address, alice.address),
            ).to.be.revertedWith("Assets are zero")
        })
        // it("fails if receiver is zero", async () => {
        //     await expect(
        //         ctx.vault.connect(ctx.sa.default.signer)["redeem(uint256,address,address)"](10, ZERO_ADDRESS, ZERO_ADDRESS),
        //     ).to.be.revertedWith("Invalid beneficiary address")
        // })
        it("fail if caller != owner and it has not allowance", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.vault.connect(alice.signer).approve(bob.address, 0)
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            const tx = ctx.vault.connect(bob.signer)["redeem(uint256,address,address)"](sharesAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
}

export default shouldBehaveLikeAbstractVault
