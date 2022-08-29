import { assertBNClose, findContractEvent } from "@utils/assertions"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"

import type { StandardAccounts } from "@utils/machines"
import type { ContractTransaction } from "ethers"
import type { Account } from "types"
import type { AbstractVault,ERC20, IERC20Metadata } from "types/generated"
export interface AbstractVaultBehaviourContext {
    vault: AbstractVault
    asset: ERC20
    sa: StandardAccounts
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
) {
    const variance = BN.from(10)
    const receipt = await tx.wait()
    await expect(tx).to.emit(vault, "Withdraw")
    const withdrawEvent = findContractEvent(receipt, vault.address, "Withdraw")
    expect(withdrawEvent).to.not.equal(undefined)
    expect(withdrawEvent.args.caller, "caller").to.eq(caller.address)
    expect(withdrawEvent.args.receiver, "receiver").to.eq(receiver.address)
    expect(withdrawEvent.args.owner, "owner").to.eq(owner.address)
    assertBNClose(withdrawEvent.args.assets, assets, variance, "assets")
    assertBNClose(withdrawEvent.args.shares, shares, variance, "shares")
}

async function expectRedeem(
    ctx: AbstractVaultBehaviourContext,
    caller: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
) {
    const variance = BN.from(10)
    const dataBefore = await snapshotData(ctx, caller, receiver, owner)
    const tx = await ctx.vault.connect(caller.signer)["redeem(uint256,address,address)"](shares, receiver.address, owner.address)

    await expectWithdrawEvent(ctx.vault, tx, caller, receiver, owner, assets, shares)
    const data = await snapshotData(ctx, caller, receiver, owner)

    assertBNClose(await ctx.vault.maxRedeem(caller.address), data.callerSharesBalance, variance, "max redeem")
    assertBNClose(
        await ctx.vault.maxWithdraw(caller.address),
        await ctx.vault.convertToAssets(data.callerSharesBalance),
        variance,
        "mas withdraw",
    )
    assertBNClose(data.totalAssets, dataBefore.totalAssets.sub(assets), variance, "totalAssets")
    assertBNClose(data.ownerSharesBalance, dataBefore.ownerSharesBalance.sub(shares), variance, "owner shares")
    if (owner.address !== receiver.address) {
        assertBNClose(data.ownerAssetBalance, dataBefore.ownerAssetBalance, variance, "owner assets")
    }

    assertBNClose(data.receiverAssetBalance, dataBefore.receiverAssetBalance.add(assets), variance, "receiver assets")
}

async function expectWithdraw(
    ctx: AbstractVaultBehaviourContext,
    caller: Account,
    receiver: Account,
    owner: Account,
    assets: BN,
    shares: BN,
) {
    const variance = BN.from(10)
    const dataBefore = await snapshotData(ctx, caller, receiver, owner)
    const tx = await ctx.vault.connect(caller.signer).withdraw(assets, receiver.address, owner.address)
    await expectWithdrawEvent(ctx.vault, tx, caller, receiver, owner, assets, shares)
    const data = await snapshotData(ctx, caller, receiver, owner)

    assertBNClose(await ctx.vault.maxRedeem(caller.address), data.callerSharesBalance, variance, "max redeem")
    assertBNClose(
        await ctx.vault.maxWithdraw(caller.address),
        await ctx.vault.convertToAssets(data.callerSharesBalance),
        variance,
        "mas withdraw",
    )
    assertBNClose(data.totalAssets, dataBefore.totalAssets.sub(assets), variance, "totalAssets")
    assertBNClose(data.ownerSharesBalance, dataBefore.ownerSharesBalance.sub(shares), variance, "owner shares")
    if (owner.address !== receiver.address) {
        assertBNClose(data.ownerAssetBalance, dataBefore.ownerAssetBalance, variance, "owner assets")
    }

    assertBNClose(data.receiverAssetBalance, dataBefore.receiverAssetBalance.add(assets), variance, "receiver assets")
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

    beforeEach("init", async () => {
        assetsAmount = simpleToExactAmount(1, await (ctx.asset as unknown as IERC20Metadata).decimals())
        sharesAmount = simpleToExactAmount(1, await (ctx.asset as unknown as IERC20Metadata).decimals())
        alice = ctx.sa.default
        bob = ctx.sa.dummy2
        aliceAssetBalance = await ctx.asset.balanceOf(alice.address)
        aliceSharesBalance = await ctx.vault.balanceOf(alice.address)
        totalSupply = await ctx.vault.totalSupply()
        totalAssets = await ctx.vault.totalAssets()
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
            await ctx.asset.approve(ctx.vault.address, ethers.constants.MaxUint256)
            const shares = await ctx.vault.previewDeposit(assetsAmount)

            expect(await ctx.vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
            expect(await ctx.vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(await ctx.vault.convertToAssets(aliceSharesBalance))
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)
            expect(await ctx.vault.convertToShares(assetsAmount), "convertToShares").to.eq(shares)

            // Test
            const tx = await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Deposit").withArgs(alice.address, alice.address, assetsAmount, shares)
            // expect alice balance to increase
            expect(await ctx.asset.balanceOf(alice.address), "asset balance").to.eq(aliceAssetBalance.sub(assetsAmount))
            expect(await ctx.vault.balanceOf(alice.address), "shares balance").to.eq(aliceSharesBalance.add(shares))
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets.add(assetsAmount))
        })
        it("fails if deposits zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["deposit(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Shares are zero",
            )
        })
        it("fails if receiver is zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["deposit(uint256,address)"](10, ZERO_ADDRESS)).to.be.revertedWith(
                "ERC20: mint to the zero address",
            )
        })
        it("preview deposit if assets is zero", async () => {
            expect(await ctx.vault.connect(ctx.sa.default.signer).previewDeposit(ZERO)).to.eq(ZERO)
        })
    })
    describe("mint", async () => {
        it("should mint shares to the vault", async () => {
            await ctx.asset.approve(ctx.vault.address, ethers.constants.MaxUint256)
            const assets = await ctx.vault.previewMint(sharesAmount)
            const shares = await ctx.vault.previewDeposit(assetsAmount)

            expect(await ctx.vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
            expect(await ctx.vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance)
            // expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(assetsAmount)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)
            expect(await ctx.vault.convertToShares(assets), "convertToShares").to.lte(shares)
            expect(await ctx.vault.convertToAssets(shares), "convertToShares").to.lte(assets)

            const tx = await ctx.vault.connect(alice.signer)["mint(uint256,address)"](shares, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Deposit").withArgs(alice.address, alice.address, assets, shares)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance.add(shares))
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(
                await ctx.vault.convertToAssets(aliceSharesBalance.add(shares)),
            )
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets.add(assets))
            expect(await ctx.vault.totalSupply(), "totalSupply").to.eq(totalSupply.add(shares))
        })
        it("fails if mint zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["mint(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Assets are zero",
            )
        })
        it("fails if receiver is zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["mint(uint256,address)"](10, ZERO_ADDRESS)).to.be.revertedWith(
                "ERC20: mint to the zero address",
            )
        })
    })
    describe("withdraw", async () => {
        it("from the vault, same caller, receiver and owner", async () => {
            await ctx.asset.approve(ctx.vault.address, ethers.constants.MaxUint256)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(await ctx.vault.convertToAssets(aliceSharesBalance))
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
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, assetsAmount)

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(await ctx.vault.convertToAssets(aliceSharesBalance))
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(totalAssets)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(aliceSharesBalance.add(shares))
            aliceAssetBalance = await ctx.asset.balanceOf(alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectWithdraw(ctx, alice, bob, alice, assetsAmount, shares)
        })
        it("from the vault caller != owner, infinite approval", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            await ctx.vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(await ctx.vault.convertToAssets(aliceSharesBalance))
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
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            await ctx.vault.connect(alice.signer).approve(bob.address, assetsAmount)

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(await ctx.vault.convertToAssets(aliceSharesBalance))
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(totalAssets)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)

            // Test
            // Verify events, storage change, balance, etc.
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
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)

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
            await ctx.asset.approve(ctx.vault.address, ethers.constants.MaxUint256)

            const assets = await ctx.vault.previewRedeem(sharesAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max maxRedeem").to.eq(aliceSharesBalance)

            // Given that
            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx, alice, alice, alice, assets, sharesAmount)
        })
        it("from the vault, caller != receiver and caller = owner", async () => {
            // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, assetsAmount)
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
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            await ctx.vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            // Verify events, storage change, balance, etc.
            await expectRedeem(ctx, bob, bob, alice, assetsAmount, sharesAmount)
        })
        it("from the vault, caller != receiver and caller != owner", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, ethers.constants.MaxUint256)
            await ctx.vault.connect(alice.signer).approve(bob.address, sharesAmount)
            const assets = await ctx.vault.previewRedeem(sharesAmount)

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
