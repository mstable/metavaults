import { assertBNClosePercent } from "@utils/assertions"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { loadOrExecFixture } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"

import type { StandardAccounts } from "@utils/machines"
import type { BN } from "@utils/math"
import type { BytesLike } from "ethers/lib/utils"
import type { Account } from "types"
import type { AbstractVault, Convex3CrvAbstractVault, DataEmitter, IERC20, IERC20Metadata, LightAbstractVault } from "types/generated"

export type BaseAbstractVault = AbstractVault | LightAbstractVault

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
type Amounts = {
    initialDeposit: BN
    deposit: BN
    mint: BN
    withdraw: BN
    redeem: BN
}
export interface BaseVaultBehaviourContext {
    vault: BaseAbstractVault
    asset: IERC20 & IERC20Metadata
    sa: StandardAccounts
    fixture: () => Promise<void>
    amounts: Amounts
    variances?: Variances
    dataEmitter: DataEmitter
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

/// Calls a number of view functions in the same block as a transaction is executed
const bundleInBlock = async (
    dataEmitter: DataEmitter,
    vault: AbstractVault,
    rawTx: BytesLike,
    previewEncodedData: BytesLike,
    sender: Account,
    receiverOrOwner: Account,
) => {
    const sharesBefore = await vault.balanceOf(receiverOrOwner.address)

    // Step 1 : Stop auto mining a new block with every transaction
    await ethers.provider.send("evm_setAutomine", [false])

    // Step 2 : Send each view function call as a transaction so it will be included in the same block as the transaction.

    // Get the preview result before the tx in the same block
    const tx1 = await dataEmitter.emitStaticCall(vault.address, previewEncodedData)
    // get the assets in the vault for the receiver for deposit/mint or owner for withdraw/redeem
    const tx2 = await dataEmitter.emitStaticCall(
        vault.address,
        vault.interface.encodeFunctionData("maxWithdraw", [receiverOrOwner.address]),
    )
    // Get the vault's total shares
    const tx3 = await dataEmitter.emitStaticCall(vault.address, vault.interface.encodeFunctionData("totalSupply"))

    // Step 3 : Send the transaction
    const tx = await sender.signer.sendTransaction({ to: vault.address, data: rawTx })

    // Step 4 : Mine the view function calls and the transaction in the same block
    await ethers.provider.send("evm_mine", [])

    // Step 5 : Decode the results of the view function calls
    // All the preview functions have the same result encoding so previewMint will work for all
    const previewResult = vault.interface.decodeFunctionResult("previewMint", (await tx1.wait()).events[0].args[0])[0]
    const vaultAssetsBefore = vault.interface.decodeFunctionResult("maxWithdraw", (await tx2.wait()).events[0].args[0])[0]
    const totalSupplyBefore = vault.interface.decodeFunctionResult("totalSupply", (await tx3.wait()).events[0].args[0])[0]

    return {
        tx,
        previewResult,
        totalSupplyBefore,
        sharesBefore,
        vaultAssetsBefore,
    }
}

export function shouldBehaveLikeBaseVault(ctx: () => BaseVaultBehaviourContext): void {
    let alice: Account
    let bob: Account
    let other: Account
    let aliceAssetBalanceBefore = ZERO
    let totalAssetsBefore = ZERO
    before(async () => {
        const { fixture } = ctx()
        await loadOrExecFixture(fixture)
        const { sa } = ctx()
        alice = sa.alice
        bob = sa.bob
        other = sa.other
    })
    beforeEach("init", async () => {
        const { vault, asset } = ctx()
        aliceAssetBalanceBefore = await asset.balanceOf(alice.address)
        totalAssetsBefore = await vault.totalAssets()
        ctx().variances = { ...defaultVariances, ...ctx().variances }
    })
    describe("empty vault", async () => {
        it("should be initialized", async () => {
            const { vault, asset } = ctx()
            expect(await vault.asset(), "asset").to.eq(asset.address)
            expect(await vault.decimals(), "decimals").to.gte(0)
            expect(await vault.totalSupply(), "total shares").to.eq(0)
            expect(await vault.totalAssets(), "total assets").to.eq(0)
        })
    })
    describe("deposit", async () => {
        before("initial deposits", async () => {
            const { vault, asset, amounts } = ctx()
            const assetsAmount = amounts.initialDeposit
            // initial deposit so all preview functions take into account liquidity
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, assetsAmount)
            }
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
        })
        afterEach(async () => {
            // Restore automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [true])
        })
        it("max deposit", async () => {
            const { vault } = ctx()
            expect(await vault.maxDeposit(alice.address), "max deposit").to.eq(ethers.constants.MaxUint256)
        })
        it("conversions", async () => {
            const { amounts, variances, vault } = ctx()
            const estimatedShares = await vault.previewDeposit(amounts.deposit)
            assertBNClosePercent(
                await vault.convertToShares(amounts.deposit),
                estimatedShares,
                variances.convertToShares,
                "convertToShares",
            )
            assertBNClosePercent(
                await vault.convertToAssets(estimatedShares),
                amounts.deposit,
                variances.convertToAssets,
                "convertToAssets",
            )
        })
        const assertDeposit = async (sender: Account, receiver: Account, assets: BN) => {
            const { asset, dataEmitter, variances, vault } = ctx()

            const assetsBefore = await asset.balanceOf(sender.address)

            const previewEncodedData = vault.interface.encodeFunctionData("previewDeposit", [assets])
            // If the vault has deposit overrides
            const rawTx = vault["deposit(uint256,address)"]
                ? (vault as unknown as Convex3CrvAbstractVault).interface.encodeFunctionData("deposit(uint256,address)", [
                      assets,
                      receiver.address,
                  ])
                : vault.interface.encodeFunctionData("deposit", [assets, receiver.address])
            const {
                tx,
                previewResult: shares,
                vaultAssetsBefore,
                sharesBefore,
                totalSupplyBefore,
            } = await bundleInBlock(dataEmitter, vault, rawTx, previewEncodedData, sender, receiver)

            // events from the deposit
            await expect(tx).to.emit(vault, "Deposit").withArgs(sender.address, receiver.address, assets, shares)
            await expect(tx).to.emit(asset, "Transfer").withArgs(sender.address, vault.address, assets)

            expect(await vault.maxRedeem(receiver.address), "receiver max redeem").to.eq(sharesBefore.add(shares))
            assertBNClosePercent(
                await vault.maxWithdraw(receiver.address),
                vaultAssetsBefore.add(assets),
                variances.maxWithdraw,
                "receiver max withdraw",
            )

            assertBNClosePercent(await vault.totalAssets(), totalAssetsBefore.add(assets), variances.maxWithdraw, "total assets")
            expect(await vault.totalSupply(), "total supply").to.eq(totalSupplyBefore.add(shares))

            expect(await asset.balanceOf(sender.address), "sender asset balance").to.eq(assetsBefore.sub(assets))
            expect(await vault.balanceOf(receiver.address), "receiver shares balance").to.eq(sharesBefore.add(shares))
        }
        it("deposit assets to the vault, sender = receiver", async () => {
            const { asset, amounts, vault } = ctx()
            const assets = amounts.deposit
            if ((await asset.allowance(alice.address, vault.address)).lt(assets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            await assertDeposit(alice, alice, assets)
        })
        it("deposit assets to the vault, sender != receiver", async () => {
            const { asset, amounts, vault } = ctx()
            const assets = amounts.deposit
            if ((await asset.allowance(alice.address, vault.address)).lt(assets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            await assertDeposit(alice, bob, assets)
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
        afterEach(async () => {
            // Restore automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [true])
        })
        it("max mint", async () => {
            const { vault } = ctx()
            expect(await vault.maxMint(alice.address), "max mint").to.eq(ethers.constants.MaxUint256)
        })
        it("conversions", async () => {
            const { amounts, variances, vault } = ctx()
            const estimatedAssets = await vault.previewMint(amounts.mint)
            assertBNClosePercent(await vault.convertToShares(estimatedAssets), amounts.mint, variances.convertToShares, "convertToShares")
            assertBNClosePercent(await vault.convertToAssets(amounts.mint), estimatedAssets, variances.convertToAssets, "convertToAssets")
        })
        const assertMint = async (sender: Account, receiver: Account, shares: BN) => {
            const { asset, dataEmitter, variances, vault } = ctx()

            const previewEncodedData = vault.interface.encodeFunctionData("previewMint", [shares])
            const rawTx = vault.interface.encodeFunctionData("mint", [shares, receiver.address])
            const {
                tx,
                previewResult: assets,
                vaultAssetsBefore,
                sharesBefore,
                totalSupplyBefore,
            } = await bundleInBlock(dataEmitter, vault, rawTx, previewEncodedData, sender, receiver)

            // events from the mint
            await expect(tx).to.emit(vault, "Deposit").withArgs(sender.address, receiver.address, assets, shares)
            await expect(tx).to.emit(asset, "Transfer").withArgs(sender.address, vault.address, assets)

            expect(await vault.maxRedeem(receiver.address), "receiver max redeem").to.eq(sharesBefore.add(shares))
            // TODO why is this sometimes off by 1 for the LiquidatorStreamVault tests?
            // assertBNClose(await vault.maxWithdraw(receiver.address), vaultAssetsBefore.add(assets), 1, "receiver max withdraw")
            assertBNClosePercent(
                await vault.maxWithdraw(receiver.address),
                vaultAssetsBefore.add(assets),
                variances.maxWithdraw,
                "receiver max withdraw",
            )

            assertBNClosePercent(await vault.totalAssets(), totalAssetsBefore.add(assets), variances.maxWithdraw, "total assets")
            expect(await vault.totalSupply(), "totalSupply").to.eq(totalSupplyBefore.add(shares))

            expect(await asset.balanceOf(sender.address), "sender asset balance").to.gte(aliceAssetBalanceBefore.sub(assets))
            expect(await vault.balanceOf(receiver.address), "receiver shares balance").to.eq(sharesBefore.add(shares))
        }
        it("mint shares to the vault, sender = receiver", async () => {
            const { asset, amounts, vault } = ctx()
            const shares = amounts.mint

            const estimatedAssets = await vault.previewMint(shares)
            if ((await asset.allowance(alice.address, vault.address)).lt(estimatedAssets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            await assertMint(alice, alice, shares)
        })
        it("mint shares to the vault, sender != receiver", async () => {
            const { asset, amounts, vault } = ctx()
            const shares = amounts.mint

            const estimatedAssets = await vault.previewMint(shares)
            if ((await asset.allowance(alice.address, vault.address)).lt(estimatedAssets)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }

            await assertMint(alice, bob, shares)
        })
        it("fails if receiver is zero", async () => {
            const { vault, sa } = ctx()
            // openzeppelin message "ERC20: mint to the zero address"
            await expect(vault.connect(sa.default.signer)["mint(uint256,address)"](10, ZERO_ADDRESS)).to.be.reverted
        })
        it("preview mint if shares is zero", async () => {
            const { vault, sa } = ctx()

            expect(await vault.connect(sa.default.signer).previewMint(ZERO)).to.eq(ZERO)
        })
    })
    describe("withdraw", async () => {
        before(async () => {
            const { amounts, asset, vault } = ctx()
            await asset.connect(alice.signer).approve(vault.address, 0)
            await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            await vault.connect(alice.signer)["deposit(uint256,address)"](amounts.initialDeposit, alice.address)
        })
        afterEach(async () => {
            // Restore automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [true])
        })
        it("conversions", async () => {
            const { amounts, variances, vault } = ctx()
            const estimatedShares = await vault.previewWithdraw(amounts.withdraw)
            assertBNClosePercent(
                await vault.convertToShares(amounts.withdraw),
                estimatedShares,
                variances.convertToShares,
                "convertToShares",
            )
            assertBNClosePercent(
                await vault.convertToAssets(estimatedShares),
                amounts.withdraw,
                variances.convertToAssets,
                "convertToAssets",
            )
        })
        const assertWithdraw = async (sender: Account, receiver: Account, owner: Account, assets: BN) => {
            const { asset, dataEmitter, variances, vault } = ctx()
            const assetsBefore = await asset.balanceOf(receiver.address)

            const previewEncodedData = vault.interface.encodeFunctionData("previewWithdraw", [assets])
            const rawTx = vault.interface.encodeFunctionData("withdraw", [assets, receiver.address, owner.address])
            const {
                tx,
                previewResult: shares,
                vaultAssetsBefore,
                sharesBefore,
                totalSupplyBefore,
            } = await bundleInBlock(dataEmitter, vault, rawTx, previewEncodedData, sender, owner)

            // events from the deposit
            await expect(tx).to.emit(vault, "Withdraw").withArgs(sender.address, receiver.address, owner.address, assets, shares)
            await expect(tx).to.emit(asset, "Transfer").withArgs(vault.address, receiver.address, assets)

            expect(await vault.maxRedeem(owner.address), "owner max redeem").to.eq(sharesBefore.sub(shares))
            assertBNClosePercent(
                await vault.maxWithdraw(owner.address),
                vaultAssetsBefore.sub(assets),
                variances.maxWithdraw,
                "owner max withdraw",
            )

            assertBNClosePercent(await vault.totalAssets(), totalAssetsBefore.sub(assets), variances.maxWithdraw, "total assets")
            expect(await vault.totalSupply(), "totalSupply").to.eq(totalSupplyBefore.sub(shares))

            expect(await asset.balanceOf(receiver.address), "receiver asset balance").to.eq(assetsBefore.add(assets))
            expect(await vault.balanceOf(owner.address), "owner shares balance").to.eq(sharesBefore.sub(shares))
        }
        it("from the vault, same sender, receiver and owner", async () => {
            const { amounts } = ctx()
            await assertWithdraw(alice, alice, alice, amounts.withdraw)
        })
        it("from the vault, sender != receiver and sender = owner", async () => {
            const { amounts } = ctx()
            await assertWithdraw(alice, bob, alice, amounts.withdraw)
        })
        it("from the vault sender != owner, infinite approval", async () => {
            const { amounts, vault } = ctx()
            await vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)
            await assertWithdraw(bob, bob, alice, amounts.withdraw)
        })
        it("from the vault sender != owner, limited approval", async () => {
            const { amounts, vault } = ctx()
            await vault.connect(alice.signer).approve(bob.address, 0)
            const shares = await vault.previewWithdraw(amounts.withdraw)
            await vault.connect(alice.signer).approve(bob.address, shares)
            await assertWithdraw(bob, bob, alice, amounts.withdraw)
        })
        it("from the vault, sender != receiver and sender != owner", async () => {
            const { vault } = ctx()
            await vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)
            await assertWithdraw(bob, other, alice, ctx().amounts.withdraw)
        })
        it("fail if sender != owner and it has not allowance", async () => {
            const { vault, asset, amounts } = ctx()
            const assetsAmount = amounts.withdraw
            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            }
            await vault.connect(alice.signer).approve(bob.address, 0)
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)

            const tx = vault.connect(bob.signer).withdraw(assetsAmount, bob.address, alice.address)

            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
    describe("redeem", async () => {
        before(async () => {
            const { amounts, asset, vault } = ctx()
            await asset.connect(alice.signer).approve(vault.address, 0)
            await asset.connect(alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            await vault.connect(alice.signer)["deposit(uint256,address)"](amounts.initialDeposit, alice.address)
        })
        afterEach(async () => {
            // Restore automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [true])
        })
        it("conversions", async () => {
            const { amounts, variances, vault } = ctx()
            const estimatedAssets = await vault.previewRedeem(amounts.redeem)
            assertBNClosePercent(await vault.convertToShares(estimatedAssets), amounts.redeem, variances.convertToShares, "convertToShares")
            assertBNClosePercent(await vault.convertToAssets(amounts.redeem), estimatedAssets, variances.convertToAssets, "convertToAssets")
        })
        const assertRedeem = async (sender: Account, receiver: Account, owner: Account, shares: BN) => {
            const { asset, dataEmitter, variances, vault } = ctx()

            const assetsBefore = await asset.balanceOf(receiver.address)

            const previewEncodedData = vault.interface.encodeFunctionData("previewRedeem", [shares])
            // If the vault has redeem overrides
            const rawTx = vault["redeem(uint256,address,address)"]
                ? (vault as unknown as Convex3CrvAbstractVault).interface.encodeFunctionData("redeem(uint256,address,address)", [
                      shares,
                      receiver.address,
                      owner.address,
                  ])
                : vault.interface.encodeFunctionData("redeem", [shares, receiver.address, owner.address])
            const {
                tx,
                previewResult: assets,
                vaultAssetsBefore,
                sharesBefore,
                totalSupplyBefore,
            } = await bundleInBlock(dataEmitter, vault, rawTx, previewEncodedData, sender, owner)

            // events from the deposit
            await expect(tx).to.emit(vault, "Withdraw").withArgs(sender.address, receiver.address, owner.address, assets, shares)
            await expect(tx).to.emit(asset, "Transfer").withArgs(vault.address, receiver.address, assets)

            expect(await vault.maxRedeem(owner.address), "owner max redeem").to.eq(sharesBefore.sub(shares))
            assertBNClosePercent(
                await vault.maxWithdraw(owner.address),
                vaultAssetsBefore.sub(assets),
                variances.maxWithdraw,
                "owner max withdraw",
            )

            assertBNClosePercent(await vault.totalAssets(), totalAssetsBefore.sub(assets), variances.maxWithdraw, "total assets")
            expect(await vault.totalSupply(), "totalSupply").to.eq(totalSupplyBefore.sub(shares))

            expect(await asset.balanceOf(receiver.address), "receiver asset balance").to.eq(assetsBefore.add(assets))
            expect(await vault.balanceOf(owner.address), "owner shares balance").to.eq(sharesBefore.sub(shares))
        }
        it("from the vault, same sender, receiver and owner", async () => {
            await assertRedeem(alice, alice, alice, ctx().amounts.redeem)
        })
        it("from the vault, sender != receiver and sender = owner", async () => {
            await assertRedeem(alice, bob, alice, ctx().amounts.redeem)
        })
        it("from the vault sender != owner, infinite approval", async () => {
            const { amounts, vault } = ctx()
            await vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)
            await assertRedeem(bob, bob, alice, amounts.redeem)
        })
        it("from the vault sender != owner, limited approval", async () => {
            const { amounts, vault } = ctx()
            await vault.connect(alice.signer).approve(bob.address, 0)
            await vault.connect(alice.signer).approve(bob.address, amounts.redeem)
            await assertRedeem(bob, bob, alice, amounts.redeem)
        })
        it("from the vault, sender != receiver and sender != owner", async () => {
            const { amounts, vault } = ctx()
            await vault.connect(alice.signer).approve(bob.address, ethers.constants.MaxUint256)
            await assertRedeem(bob, other, alice, amounts.redeem)
        })
        it("fail if sender != owner and it has not allowance", async () => {
            const { vault, amounts } = ctx()
            const sharesAmount = amounts.redeem

            // Alice deposits assets (owner), Bob withdraws assets (sender), Bob receives assets (receiver)
            await vault.connect(alice.signer).approve(bob.address, 0)

            const assets = await vault.previewRedeem(sharesAmount)
            await vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            const tx = vault.connect(bob.signer)["redeem(uint256,address,address)"](sharesAmount, bob.address, alice.address)

            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
        it("all", async () => {
            const shares = await ctx().vault.balanceOf(alice.address)
            await assertRedeem(alice, alice, alice, shares)
        })
    })
    describe("pausable operations", async () => {
        it("pause fails on nonGovernor call", async () => {
            const { vault, sa } = ctx()
            const tx = vault.connect(sa.alice.signer).pause()
            await expect(tx).to.be.revertedWith("Only governor can execute")
        })
        it("pause successfull on governor call", async () => {
            const { vault, sa } = ctx()
            expect(await vault.paused()).to.not.equal(true)
            const tx = vault.connect(sa.governor.signer).pause()
            await expect(tx).to.emit(vault, "Paused").withArgs(sa.governor.address)
            expect(await vault.paused()).to.equal(true)
        })
        it("unpause fails on nonGovernor call", async () => {
            const { vault, sa } = ctx()
            const tx = vault.connect(sa.alice.signer).unpause()
            await expect(tx).to.be.revertedWith("Only governor can execute")
        })
        it("unpause successfull on governor call", async () => {
            const { vault, sa } = ctx()
            expect(await vault.paused()).to.not.equal(false)
            const tx = vault.connect(sa.governor.signer).unpause()
            await expect(tx).to.emit(vault, "Unpaused").withArgs(sa.governor.address)
            expect(await vault.paused()).to.equal(false)
        })
        context("vault paused", async () => {
            before(async () => {
                const { vault, asset, amounts, sa } = ctx()
                const assetsAmount = amounts.initialDeposit

                // initial deposit so that maxFunctions do not return ZERO by default
                if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                    await asset.connect(alice.signer).approve(vault.address, assetsAmount)
                }
                await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)

                // Pause vault
                await vault.connect(sa.governor.signer).pause()
            })
            it("should revert on deposit, mint, redeem and withdraw calls", async () => {
                const { vault, amounts } = ctx()
                expect(await vault.paused()).to.equal(true)

                const depositTx = vault.connect(alice.signer)["deposit(uint256,address)"](amounts.deposit, alice.address)
                await expect(depositTx).to.be.revertedWith("Pausable: paused")

                const mintTx = vault.connect(alice.signer)["mint(uint256,address)"](amounts.mint, alice.address)
                await expect(mintTx).to.be.revertedWith("Pausable: paused")

                const withdrawTx = vault
                    .connect(alice.signer)
                    ["withdraw(uint256,address,address)"](amounts.withdraw, alice.address, alice.address)
                await expect(withdrawTx).to.be.revertedWith("Pausable: paused")

                const redeemTx = vault
                    .connect(alice.signer)
                    ["redeem(uint256,address,address)"](amounts.redeem, alice.address, alice.address)
                await expect(redeemTx).to.be.revertedWith("Pausable: paused")
            })
            it("should return 0 on max 4626 functions", async () => {
                const { vault } = ctx()
                expect(await vault.paused()).to.equal(true)
                expect(await vault.balanceOf(alice.address)).to.not.equal(ZERO)

                expect(await vault.maxDeposit(alice.address)).to.equal(ZERO)
                expect(await vault.maxMint(alice.address)).to.equal(ZERO)
                expect(await vault.maxWithdraw(alice.address)).to.equal(ZERO)
                expect(await vault.maxRedeem(alice.address)).to.equal(ZERO)
            })
            after(async () => {
                const { vault, sa } = ctx()
                // Unpause vault
                await vault.connect(sa.governor.signer).unpause()
            })
        })
    })
}

export const testAmounts = (amount: number, assetDecimals = 18, vaultDecimals = 18): Amounts => {
    return {
        initialDeposit: simpleToExactAmount(amount, assetDecimals).mul(6),
        deposit: simpleToExactAmount(amount, assetDecimals),
        mint: simpleToExactAmount(amount, vaultDecimals),
        withdraw: simpleToExactAmount(amount, assetDecimals),
        redeem: simpleToExactAmount(amount, vaultDecimals),
    }
}

export default shouldBehaveLikeBaseVault
