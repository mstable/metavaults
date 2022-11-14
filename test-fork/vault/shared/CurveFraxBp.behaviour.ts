import { logTxDetails } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { ONE_DAY } from "@utils/constants"
import { loadOrExecFixture } from "@utils/fork"
import { BN } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Wallet } from "ethers"
import { ethers } from "hardhat"

import type { BigNumber } from "ethers"
import type { Account } from "types/common"
import type { CurveFraxBpBasicMetaVault, ICurveFraxBP, IERC20, IERC4626Vault } from "types/generated"

const log = logger("test:CurveFraxBpVault")

const curveVPScale = BN.from(10).pow(18)

export interface CurveFraxBpContext {
    amounts: {
        initialDeposit: BigNumber
        deposit: BigNumber
        mint: BigNumber
        withdraw: BigNumber
        redeem: BigNumber
    }
    vault: CurveFraxBpBasicMetaVault
    metaVault: IERC4626Vault
    fraxBasePool: ICurveFraxBP
    asset: IERC20
    owner: Account
    fixture: () => Promise<void>
}
export const behaveLikeCurveFraxBpVault = (ctx: () => CurveFraxBpContext): void => {
    const getAssetsFromCrvFraxTokens = async (crvFraxTokens: BN): Promise<BN> => {
        const { vault, fraxBasePool } = ctx()
        const crvFraxTokenScale = await vault.crvFraxTokenScale()
        const assetsPerCrvFrax = await fraxBasePool.calc_withdraw_one_coin(crvFraxTokenScale, await vault.assetPoolIndex())
        return assetsPerCrvFrax.mul(crvFraxTokens).div(crvFraxTokenScale)
    }
    const getMetaVaultSharesFromShares = async (shares: BN): Promise<BN> => {
        const { vault, metaVault } = ctx()
        let metaVaultShares: BN
        const totalMetaVaultShares = await metaVault.balanceOf(vault.address)
        const totalShares = await vault.totalSupply()
        if (totalShares.eq(0)) {
            metaVaultShares = shares
        } else {
            metaVaultShares = shares.mul(totalMetaVaultShares).div(totalShares)
        }
        return metaVaultShares
    }
    const getCrvFraxTokensFromAssets = async (assets: BN): Promise<BN> => {
        const { vault, fraxBasePool } = ctx()
        const fraxBasePoolVP = await fraxBasePool.get_virtual_price()
        const assetScale = await vault.assetScale()
        const crvFraxTokenScale = await vault.crvFraxTokenScale()
        return curveVPScale.mul(assets).mul(crvFraxTokenScale).div(fraxBasePoolVP.mul(assetScale))
    }
    const getSharesFromMetaVaultShares = async (metaVaultShares: BN): Promise<BN> => {
        const { vault, metaVault } = ctx()
        let shares: BN
        const totalMetaVaultShares = await metaVault.balanceOf(vault.address)
        const totalShares = await vault.totalSupply()
        if (totalMetaVaultShares.eq(0)) {
            shares = metaVaultShares
        } else {
            shares = metaVaultShares.mul(totalShares).div(totalMetaVaultShares)
        }
        return shares
    }

    describe("EIP-4626", () => {
        describe("view functions", () => {
            before(async () => {
                await loadOrExecFixture(ctx().fixture)
                const { amounts, owner, vault } = ctx()
                await vault["deposit(uint256,address)"](amounts.initialDeposit, owner.address)
            })
            it("asset()", async () => {
                const { vault, asset } = ctx()
                expect(await vault.asset(), "asset").eq(asset.address)
            })
            it("totalAssets()", async () => {
                const { metaVault, owner, vault } = ctx()
                const totalMetaVaultShares = await metaVault.balanceOf(vault.address)
                const totalCrvFraxTokens = await metaVault.convertToAssets(totalMetaVaultShares)
                const expectedAssets = await getAssetsFromCrvFraxTokens(totalCrvFraxTokens)
                const actualTotalAssets = await vault.totalAssets()
                expect(actualTotalAssets, "totalAssets").eq(expectedAssets)
                log(`total assets ${actualTotalAssets} `)
                log(`total shares ${await vault.totalSupply()} `)

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.totalAssets())
            })
            it("convertToAssets()", async () => {
                const { metaVault, owner, vault, amounts } = ctx()
                const metaVaultShares = await getMetaVaultSharesFromShares(amounts.mint)
                const crvFraxTokens = await metaVault.convertToAssets(metaVaultShares)
                const expectedAssets = await getAssetsFromCrvFraxTokens(crvFraxTokens)
                expect(await vault.convertToAssets(amounts.mint), "convertToAssets").eq(expectedAssets)

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.convertToAssets(metaVaultShares))
            })
            it("convertToShares()", async () => {
                const { metaVault, owner, vault, amounts } = ctx()
                const crvFraxTokens = await getCrvFraxTokensFromAssets(amounts.deposit)
                const metaVaultShares = await metaVault.convertToShares(crvFraxTokens)
                const expectedShares = await getSharesFromMetaVaultShares(metaVaultShares)
                expect(await vault.convertToShares(amounts.deposit), "convertToShares").eq(expectedShares)

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.convertToShares(crvFraxTokens))
            })
            it("maxDeposit()", async () => {
                const { vault, owner } = ctx()
                expect(await vault.maxDeposit(owner.address), "maxDeposit").eq(ethers.constants.MaxUint256)
            })
            it("maxMint()", async () => {
                const { vault, owner } = ctx()
                expect(await vault.maxMint(owner.address), "maxMint").eq(ethers.constants.MaxUint256)
            })
            it("maxRedeem()", async () => {
                const { vault, owner } = ctx()
                expect(await vault.maxRedeem(owner.address), "maxMint").eq(await vault.balanceOf(owner.address))

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.maxRedeem(owner.address))
            })
            it("maxWithdraw()", async () => {
                const { vault, owner } = ctx()
                const ownerShares = await vault.balanceOf(owner.address)
                const expectedAssets = await vault.callStatic["redeem(uint256,address,address)"](ownerShares, owner.address, owner.address)
                expect(await vault.maxWithdraw(owner.address), "maxWithdraw").eq(expectedAssets)

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.maxWithdraw(owner.address))
            })
        })
        describe("preview functions", () => {
            beforeEach(async () => {
                await loadOrExecFixture(ctx().fixture)
                const { amounts, owner, vault } = ctx()
                await vault["deposit(uint256,address)"](amounts.initialDeposit, owner.address)
            })
            it("deposit", async () => {
                const { vault, owner, amounts } = ctx()
                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.previewDeposit(amounts.deposit))

                // Test previewDeposit is the same as deposit at the end of the old block using static calls
                const staticPreviewShares = await vault.previewDeposit(amounts.deposit)
                const staticDepositShares = await vault.callStatic["deposit(uint256,address)"](amounts.deposit, owner.address)
                expect(staticDepositShares, "previewDeposit == static deposit shares").to.eq(staticPreviewShares)
            })
            it("mint", async () => {
                const { amounts, vault, owner } = ctx()
                // Test previewMint is the same as mint at the end of the old block using static calls
                const staticPreviewAssets = await vault.previewMint(amounts.mint)
                const staticMintAssets = await vault.callStatic.mint(amounts.mint, owner.address)
                expect(staticMintAssets, "previewMint == static mint assets").to.eq(staticPreviewAssets)

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.previewMint(amounts.mint))
            })
            it("redeem", async () => {
                const { amounts, vault, owner } = ctx()
                // Test previewRedeem is the same as redeem at the end of the old block using static calls
                const staticPreviewAssets = await vault.previewRedeem(amounts.redeem)
                const staticRedeemAssets = await vault.callStatic["redeem(uint256,address,address)"](
                    amounts.redeem,
                    owner.address,
                    owner.address,
                )
                expect(staticRedeemAssets, "previewRedeem == static redeem assets").to.eq(staticPreviewAssets)

                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.previewRedeem(amounts.redeem))
            })
            it("withdraw", async () => {
                const { amounts, vault, owner } = ctx()
                // Is only used to get gas usage using gasReporter
                await owner.signer.sendTransaction(await vault.populateTransaction.previewWithdraw(amounts.withdraw))

                // Test previewWithdraw is the same as withdraw at the end of the old block using static calls
                const staticPreviewShares = await vault.previewWithdraw(amounts.withdraw)
                const staticWithdrawShares = await vault.callStatic.withdraw(amounts.withdraw, owner.address, owner.address)
                expect(staticWithdrawShares, "previewWithdraw == static withdraw shares").to.eq(staticPreviewShares)
            })
        })
        describe("vault operations", () => {
            before(async () => {
                await loadOrExecFixture(ctx().fixture)
            })
            it("user deposits assets to vault", async () => {
                const { amounts, metaVault, vault, owner } = ctx()
                const receiver = owner.address

                const receiverSharesBefore = await vault.balanceOf(receiver)

                const tx = await vault.connect(owner.signer)["deposit(uint256,address)"](amounts.initialDeposit, receiver)
                await logTxDetails(tx, "deposit")

                const receivedShares = (await vault.balanceOf(receiver)).sub(receiverSharesBefore)

                const receipt = await tx.wait()
                const event = receipt.events.find((e) => e.event === "Deposit" && e.args[1].toLowerCase() === receiver.toLowerCase())
                const sharesMinted = BN.from(event.args[3])

                expect(receivedShares, "Receiver received shares").eq(sharesMinted)

                expect(await vault.totalSupply(), "totalSupply").eq(sharesMinted)
                expect(await vault.totalAssets(), "totalAssets").eq(
                    await getAssetsFromCrvFraxTokens(await metaVault.convertToAssets(await getMetaVaultSharesFromShares(sharesMinted))),
                )
            })
            it("user redeems some shares from vault", async () => {
                const { amounts, metaVault, vault, owner, asset } = ctx()
                await increaseTime(ONE_DAY)
                const receiver = Wallet.createRandom().address

                const totalSharesBefore = await vault.totalSupply()

                const receiverAssetsBefore = await asset.balanceOf(receiver)

                const tx = await vault.connect(owner.signer)["redeem(uint256,address,address)"](amounts.redeem, receiver, owner.address)
                await logTxDetails(tx, "redeem")

                const receivedAssets = (await asset.balanceOf(receiver)).sub(receiverAssetsBefore)

                const receipt = await tx.wait()
                const event = receipt.events.find((e) => e.event === "Withdraw" && e.args[1].toLowerCase() === receiver.toLowerCase())
                const assetsRedeemed = BN.from(event.args[3])

                expect(receivedAssets, "receiver received assets").eq(assetsRedeemed)

                expect(await vault.totalSupply(), "totalSupply").eq(totalSharesBefore.sub(amounts.redeem))
                expect(await vault.totalAssets(), "totalAssets").eq(
                    await getAssetsFromCrvFraxTokens(
                        await metaVault.convertToAssets(await getMetaVaultSharesFromShares(totalSharesBefore.sub(amounts.redeem))),
                    ),
                )
            })
            it("user withdraws some assets from vault", async () => {
                const { amounts, metaVault, vault, owner, asset } = ctx()
                await increaseTime(ONE_DAY)
                const receiver = Wallet.createRandom().address

                const totalSharesBefore = await vault.totalSupply()

                const receiverAssetsBefore = await asset.balanceOf(receiver)

                const tx = await vault.connect(owner.signer).withdraw(amounts.withdraw, receiver, owner.address)
                await logTxDetails(tx, "withdraw")

                const receivedAssets = (await asset.balanceOf(receiver)).sub(receiverAssetsBefore)

                const receipt = await tx.wait()
                const event = receipt.events.find((e) => e.event === "Withdraw" && e.args[1].toLowerCase() === receiver.toLowerCase())
                const sharesUsed = BN.from(event.args[4])

                expect(receivedAssets, "receiver received assets").eq(amounts.withdraw)

                expect(await vault.totalSupply(), "totalSupply").eq(totalSharesBefore.sub(sharesUsed))
                expect(await vault.totalAssets(), "totalAssets").eq(
                    await getAssetsFromCrvFraxTokens(
                        await metaVault.convertToAssets(await getMetaVaultSharesFromShares(totalSharesBefore.sub(sharesUsed))),
                    ),
                )
            })
            it("user mints shares from vault", async () => {
                const { amounts, metaVault, vault, owner } = ctx()
                await increaseTime(ONE_DAY)
                const receiver = owner.address

                const totalSharesBefore = await vault.totalSupply()

                const receiverSharesBefore = await vault.balanceOf(receiver)

                const tx = await vault.connect(owner.signer).mint(amounts.mint, receiver)
                await logTxDetails(tx, "mint")

                const receivedShares = (await vault.balanceOf(receiver)).sub(receiverSharesBefore)

                expect(receivedShares, "Receiver received shares").eq(amounts.mint)

                expect(await vault.totalSupply(), "totalSupply").eq(totalSharesBefore.add(amounts.mint))

                expect(await vault.totalAssets(), "totalAssets").eq(
                    await getAssetsFromCrvFraxTokens(
                        await metaVault.convertToAssets(await getMetaVaultSharesFromShares(totalSharesBefore.add(amounts.mint))),
                    ),
                )
            })
            it("user deposits assets to vault with custom slippage", async () => {
                const { amounts, metaVault, vault, owner } = ctx()
                const receiver = owner.address

                const totalSharesBefore = await vault.totalSupply()
                const receiverSharesBefore = await vault.balanceOf(receiver)

                const tx = await vault.connect(owner.signer)["deposit(uint256,address,uint256)"](amounts.initialDeposit, receiver, 200)
                await logTxDetails(tx, "deposit")

                const receivedShares = (await vault.balanceOf(receiver)).sub(receiverSharesBefore)

                const receipt = await tx.wait()
                const event = receipt.events.find((e) => e.event === "Deposit" && e.args[1].toLowerCase() === receiver.toLowerCase())
                const sharesMinted = BN.from(event.args[3])

                expect(receivedShares, "Receiver received shares").eq(sharesMinted)

                expect(await vault.totalSupply(), "totalSupply").eq(sharesMinted.add(totalSharesBefore))

                expect(await vault.totalAssets(), "totalAssets").eq(
                    await getAssetsFromCrvFraxTokens(
                        await metaVault.convertToAssets(await getMetaVaultSharesFromShares(sharesMinted.add(totalSharesBefore))),
                    ),
                )
            })
            it("user redeems some shares from vault with custom slippage", async () => {
                const { amounts, metaVault, vault, owner, asset } = ctx()
                await increaseTime(ONE_DAY)
                const receiver = Wallet.createRandom().address

                const totalSharesBefore = await vault.totalSupply()

                const receiverAssetsBefore = await asset.balanceOf(receiver)

                const tx = await vault
                    .connect(owner.signer)
                    ["redeem(uint256,address,address,uint256)"](amounts.redeem, receiver, owner.address, 200)
                await logTxDetails(tx, "redeem")

                const receivedAssets = (await asset.balanceOf(receiver)).sub(receiverAssetsBefore)

                const receipt = await tx.wait()
                const event = receipt.events.find((e) => e.event === "Withdraw" && e.args[1].toLowerCase() === receiver.toLowerCase())
                const assetsRedeemed = BN.from(event.args[3])

                expect(receivedAssets, "receiver received assets").eq(assetsRedeemed)

                expect(await vault.totalSupply(), "totalSupply").eq(totalSharesBefore.sub(amounts.redeem))

                expect(await vault.totalAssets(), "totalAssets").eq(
                    await getAssetsFromCrvFraxTokens(
                        await metaVault.convertToAssets(await getMetaVaultSharesFromShares(totalSharesBefore.sub(amounts.redeem))),
                    ),
                )
            })
        })
    })
}
