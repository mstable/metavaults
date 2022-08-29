import { ONE_DAY, ONE_WEEK, ONE_YEAR } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { getTimestampFromTx, increaseTime } from "@utils/time"
import { expect } from "chai"
import { ethers } from "hardhat"
import { ManFeeBasicVault__factory, MockERC20__factory, MockNexus__factory } from "types/generated"

import type { TransactionResponse } from "@ethersproject/providers"
import type { BigNumberish } from "ethers"
import type { ManFeeBasicVault, MockERC20, MockNexus } from "types/generated"

enum AmountType {
    Shares,
    Assets,
}

const feeScale = simpleToExactAmount(1, 18)

// 2% over a year = 0.02 / (60 * 60 * 24 * 365) = 0.000000000634196 (6.3419584e-10) shares per second
const managementFee = simpleToExactAmount(2, 16).div(ONE_YEAR)

describe("Management Fees", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let asset: MockERC20
    let vault: ManFeeBasicVault

    const assertManagementFee = async (
        tx: TransactionResponse,
        lastTxTimestamp: BigNumberish,
        txAmount: BigNumberish,
        amountType: AmountType,
        totalFeeSharesBefore: BigNumberish,
        investorSharesBefore: BigNumberish,
        totalAssetsBefore: BigNumberish,
    ): Promise<{ txFeeShares: BN; totalFeeShares: BN; investorShares: BN; totalAssets: BN; lastTxTimestamp: BN }> => {
        const totalSharesBefore = BN.from(totalFeeSharesBefore).add(investorSharesBefore)

        const currentTxTimestamp = await getTimestampFromTx(tx)
        const periodTime = currentTxTimestamp.sub(lastTxTimestamp)

        const txFeeShares = totalSharesBefore.mul(managementFee).mul(periodTime).div(feeScale)
        const totalFeeSharesAfter = BN.from(totalFeeSharesBefore).add(txFeeShares)
        let txAssets
        let txShares
        if (amountType === AmountType.Shares) {
            txShares = txAmount
            txAssets = totalSharesBefore.gt(0) ? BN.from(txAmount).mul(totalAssetsBefore).div(totalSharesBefore.add(txFeeShares)) : txAmount
        } else {
            txAssets = txAmount
            txShares = totalSharesBefore.gt(0) ? BN.from(txAmount).mul(totalSharesBefore.add(txFeeShares)).div(totalAssetsBefore) : txAmount
        }
        const totalSharesAfter = totalSharesBefore.add(txShares).add(txFeeShares)
        const totalInvestorSharesAfter = BN.from(investorSharesBefore).add(txShares)
        const totalAssetsAfter = BN.from(totalAssetsBefore).add(txAssets)

        if (txFeeShares.gt(0)) {
            await expect(tx).to.emit(vault, "ManagementFee").withArgs(sa.feeReceiver.address, txFeeShares)
        } else {
            await expect(tx).to.not.emit(vault, "ManagementFee")
        }

        if (txFeeShares.gt(0) || totalSharesBefore.eq(0)) {
            expect(await vault.lastManFeeUpdate(), "lastManFeeUpdate current").to.eq(currentTxTimestamp)
        } else {
            // Not enough time passed to earn a fee with the number of vault decimal places
            expect(await vault.lastManFeeUpdate(), "lastManFeeUpdate last").to.eq(lastTxTimestamp)
        }

        expect(await vault.balanceOf(sa.default.address), `investor shares`).to.eq(totalInvestorSharesAfter)
        expect(await vault.balanceOf(sa.feeReceiver.address), `fee receiver shares`).to.eq(totalFeeSharesAfter)
        expect(await vault.totalSupply(), `total shares`).to.eq(totalSharesAfter)
        expect(await vault.totalAssets(), `total assets`).to.eq(BN.from(totalAssetsAfter))

        return {
            txFeeShares,
            totalFeeShares: totalFeeSharesAfter,
            investorShares: totalInvestorSharesAfter,
            totalAssets: totalAssetsAfter,
            lastTxTimestamp: currentTxTimestamp,
        }
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
    }

    const deployFeeVault = async (decimals = 18): Promise<ManFeeBasicVault> => {
        await deployFeeVaultDependencies(decimals)
        vault = await new ManFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)

        await vault.initialize("feeVault", "fv", sa.vaultManager.address, sa.feeReceiver.address, managementFee)

        // Approve vault to transfer assets from default signer
        await asset.approve(vault.address, ethers.constants.MaxUint256)

        return vault
    }

    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
    })
    describe("constructor", async () => {
        before(async () => {
            await deployFeeVaultDependencies()
            vault = await new ManFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        })
        it("should properly store constructor arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "underlying asset").to.eq(asset.address)
            expect(await vault.FEE_SCALE(), "fee scale").to.eq(feeScale)
            expect(await vault.asset(), "asset").to.eq(asset.address)
        })
    })
    describe("calling initialize", async () => {
        before(async () => {
            await deployFeeVaultDependencies(12)
            vault = await new ManFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            await vault.initialize("feeVault", "fv", sa.vaultManager.address, sa.feeReceiver.address, managementFee)
        })
        it("should properly store valid arguments", async () => {
            expect(await vault.symbol(), "symbol").to.eq("fv")
            expect(await vault.name(), "name").to.eq("feeVault")
            expect(await vault.decimals(), "symbol").to.eq(12)

            expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)

            expect(await vault.feeReceiver(), "fee receiver").to.eq(sa.feeReceiver.address)
            expect(await vault.managementFee(), "managementFee").to.eq(managementFee)

            expect(await vault.totalSupply(), "total shares").to.eq(0)
            expect(await vault.totalAssets(), "total assets").to.eq(0)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize("feeVault", "fv", sa.vaultManager.address, sa.feeReceiver.address, managementFee),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
    context("first tx", async () => {
        beforeEach(async () => {
            vault = await deployFeeVault()
            await increaseTime(ONE_DAY)
        })
        it("mint", async () => {
            const mintAmount = simpleToExactAmount(1000)

            const tx = await vault.mint(mintAmount, sa.default.address)

            await assertManagementFee(tx, 0, mintAmount, AmountType.Shares, 0, 0, 0)
        })
        it("deposit", async () => {
            const depositAmount = simpleToExactAmount(1000)

            const tx = await vault.deposit(depositAmount, sa.default.address)

            await assertManagementFee(tx, 0, depositAmount, AmountType.Assets, 0, 0, 0)
        })
    })
    context("1 week since last tx", async () => {
        const firstMintAmount = simpleToExactAmount(1000)
        let firstTxTimestamp: BN
        beforeEach(async () => {
            vault = await deployFeeVault()
            await increaseTime(ONE_DAY)

            const tx = await vault.mint(firstMintAmount, sa.default.address)
            firstTxTimestamp = await getTimestampFromTx(tx)

            await increaseTime(ONE_WEEK)
        })
        it("mint", async () => {
            const secondMintAmount = simpleToExactAmount(2000)

            const tx = await vault.mint(secondMintAmount, sa.default.address)

            await assertManagementFee(tx, firstTxTimestamp, secondMintAmount, AmountType.Shares, 0, firstMintAmount, firstMintAmount)
        })
        it("deposit", async () => {
            const depositAmount = simpleToExactAmount(3000)

            const tx = await vault.deposit(depositAmount, sa.default.address)

            await assertManagementFee(tx, firstTxTimestamp, depositAmount, AmountType.Assets, 0, firstMintAmount, firstMintAmount)
        })
        it("redeem all", async () => {
            const tx = await vault.redeem(firstMintAmount, sa.default.address, sa.default.address)

            await assertManagementFee(tx, firstTxTimestamp, firstMintAmount.mul(-1), AmountType.Shares, 0, firstMintAmount, firstMintAmount)
        })
        it("withdraw partial", async () => {
            const withdrawAmount = simpleToExactAmount(500)
            const tx = await vault.withdraw(withdrawAmount, sa.default.address, sa.default.address)

            await assertManagementFee(tx, firstTxTimestamp, withdrawAmount.mul(-1), AmountType.Assets, 0, firstMintAmount, firstMintAmount)
        })
    })
    context("2 decimals and one block", async () => {
        const decimals = 2
        const firstMintAmount = simpleToExactAmount(1000, decimals)
        let firstTxTimestamp: BN
        beforeEach(async () => {
            vault = await deployFeeVault(decimals)
            await increaseTime(ONE_DAY)

            const tx = await vault.mint(firstMintAmount, sa.default.address)
            firstTxTimestamp = await getTimestampFromTx(tx)

            expect(await asset.decimals(), "asset decimals").to.eq(decimals)
            expect(await vault.decimals(), "vault decimals").to.eq(decimals)
        })
        it("mint next block with no fee", async () => {
            const secondMintAmount = simpleToExactAmount(2000, decimals)

            const tx = await vault.mint(secondMintAmount, sa.default.address)

            const { txFeeShares } = await assertManagementFee(
                tx,
                firstTxTimestamp,
                secondMintAmount,
                AmountType.Shares,
                0,
                firstMintAmount,
                firstMintAmount,
            )
            expect(txFeeShares, "fee shares").to.eq(0)
        })
        it("deposit after a week with fee", async () => {
            await increaseTime(ONE_WEEK)
            const depositAmount = simpleToExactAmount(2000, decimals)

            const tx = await vault.mint(depositAmount, sa.default.address)

            const { txFeeShares } = await assertManagementFee(
                tx,
                firstTxTimestamp,
                depositAmount,
                AmountType.Shares,
                0,
                firstMintAmount,
                firstMintAmount,
            )
            expect(txFeeShares, "fee shares").to.gt(0)
        })
    })
    context("txs in the same block", async () => {
        const firstMintAmount = simpleToExactAmount(1000)
        let firstTxTimestamp: BN
        beforeEach(async () => {
            vault = await deployFeeVault()
            await increaseTime(ONE_DAY)

            // Stop automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [false])
        })
        afterEach(async () => {
            // Restore automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [true])
        })
        it("2 mints", async () => {
            const secondMintAmount = simpleToExactAmount(2000)

            const tx1 = await vault.mint(firstMintAmount, sa.default.address)
            const tx2 = await vault.mint(secondMintAmount, sa.default.address)

            await ethers.provider.send("evm_mine", [])

            expect(tx1.blockNumber, "same block").to.eq(tx2.blockNumber)

            firstTxTimestamp = await getTimestampFromTx(tx1)

            const { txFeeShares } = await assertManagementFee(
                tx2,
                firstTxTimestamp,
                secondMintAmount,
                AmountType.Shares,
                0,
                firstMintAmount,
                firstMintAmount,
            )
            expect(txFeeShares, "fee shares").to.eq(0)
        })
        it("mint and 25% redeem", async () => {
            const redeemAmount = firstMintAmount.div(4)
            const tx1 = await vault.mint(firstMintAmount, sa.default.address)
            const tx2 = await vault.redeem(redeemAmount, sa.default.address, sa.default.address)

            await ethers.provider.send("evm_mine", [])

            expect(tx1.blockNumber, "same block").to.eq(tx2.blockNumber)

            firstTxTimestamp = await getTimestampFromTx(tx1)

            const { txFeeShares } = await assertManagementFee(
                tx2,
                firstTxTimestamp,
                redeemAmount.mul(-1),
                AmountType.Shares,
                0,
                firstMintAmount,
                firstMintAmount,
            )
            expect(txFeeShares, "fee shares").to.eq(0)
        })
        it("mint and full redeem", async () => {
            const redeemAmount = firstMintAmount
            const tx1 = await vault.mint(firstMintAmount, sa.default.address)
            const tx2 = await vault.redeem(redeemAmount, sa.default.address, sa.default.address)

            await ethers.provider.send("evm_mine", [])

            expect(tx1.blockNumber, "same block").to.eq(tx2.blockNumber)

            firstTxTimestamp = await getTimestampFromTx(tx1)

            const { txFeeShares } = await assertManagementFee(
                tx2,
                firstTxTimestamp,
                redeemAmount.mul(-1),
                AmountType.Shares,
                0,
                firstMintAmount,
                firstMintAmount,
            )
            expect(txFeeShares, "fee shares").to.eq(0)
        })
    })
    describe("admin", () => {
        before(async () => {
            await deployFeeVaultDependencies(6)
            vault = await new ManFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            await vault.initialize("feeVault", "fv", sa.vaultManager.address, sa.feeReceiver.address, managementFee)
        })
        it("should set fee receiver", async () => {
            expect(await vault.feeReceiver(), "fee receiver before").to.not.eq(sa.dummy1.address)

            const tx = await vault.connect(sa.governor.signer).setFeeReceiver(sa.dummy1.address)

            await expect(tx).to.emit(vault, "FeeReceiverUpdated").withArgs(sa.dummy1.address)

            expect(await vault.feeReceiver(), "fee receiver after").to.eq(sa.dummy1.address)
        })
        it("vault manager should fail to set management fee", async () => {
            const tx = vault.connect(sa.vaultManager.signer).setFeeReceiver(sa.dummy2.address)
            await expect(tx).to.be.revertedWith("Only governor can execute")
        })
        it("should set management fee", async () => {
            expect(await vault.managementFee(), "fee before").to.eq(managementFee)
            const newManagementFee = managementFee.mul(2)
            const tx = await vault.connect(sa.governor.signer).setManagementFee(newManagementFee)

            await expect(tx).to.emit(vault, "ManagementFeeUpdated").withArgs(newManagementFee)

            expect(await vault.managementFee(), "fee after").to.eq(newManagementFee)
        })
        it("vault manager should fail to set management fee", async () => {
            const tx = vault.connect(sa.vaultManager.signer).setManagementFee(managementFee.mul(3))
            await expect(tx).to.be.revertedWith("Only governor can execute")
        })
        it("should fail to set manage fee > 100%", async () => {
            const tx = vault.connect(sa.governor.signer).setManagementFee(simpleToExactAmount(1, 18).div(ONE_YEAR).add(1))
            await expect(tx).to.revertedWith("Invalid fee/second")
        })
    })
})
