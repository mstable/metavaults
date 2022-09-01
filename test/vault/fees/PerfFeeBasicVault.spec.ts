import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { MockERC20ForceBurnable__factory, MockNexus__factory, PerfFeeBasicVault__factory } from "types/generated"

import type { BigNumberish } from "ethers"
import type { Account } from "types"
import type { MockERC20ForceBurnable, MockNexus, PerfFeeBasicVault } from "types/generated"

const perfAssetsPerShareScale = simpleToExactAmount(1, 26)
const feeScale = simpleToExactAmount(1, 6)
const performanceFee = simpleToExactAmount(4, 2)

interface CheckData {
    investor: string,
    investorShares: BigNumberish,
    totalShares: BigNumberish,
    totalAssets: BigNumberish,
    perfFeesAssetsPerShare?: BigNumberish,
}

describe("Performance Fees", async () => {
    let sa: StandardAccounts
    let feeReceiver: Account
    let nexus: MockNexus
    let asset: MockERC20ForceBurnable
    let vault: PerfFeeBasicVault
    let user: Account

    const checkAndSetDefaultAssetPerShare = (data: CheckData) => {
        if (data.perfFeesAssetsPerShare === undefined) {
            data.perfFeesAssetsPerShare = perfAssetsPerShareScale
        }
    }

    const assertBalances = async (
        test: string,
        data: CheckData
    ) => {
        checkAndSetDefaultAssetPerShare(data)
        const totalVaultAssets = await vault.totalAssets()
        const totalVaultShares = await vault.totalSupply()
        expect(await vault.balanceOf(data.investor), `investor shares ${test}`).to.eq(data.investorShares)
        expect(totalVaultShares, `total shares ${test}`).to.eq(data.totalShares)
        expect(totalVaultAssets, `total assets ${test}`).to.eq(data.totalAssets)
        expect(await vault.perfFeesAssetPerShare(), `perfFees assets/share ${test}`).to.eq(data.perfFeesAssetsPerShare)
    }

    const calculateAssetsPerShare = (data: CheckData): BN => {
        checkAndSetDefaultAssetPerShare(data)
        return BN.from(data.totalShares).gt(0)
            ? BN.from(data.totalAssets).mul(perfAssetsPerShareScale).div(data.totalShares)
            : perfAssetsPerShareScale
    }

    const calculateFeeShares = (data: CheckData, assetsPerShareAfter: BN): BN => {
        checkAndSetDefaultAssetPerShare(data)
        const assetPerShareDiff = assetsPerShareAfter.sub(data.perfFeesAssetsPerShare)
        return assetPerShareDiff.gt(0)
            ? performanceFee.mul(data.totalShares).mul(assetPerShareDiff).div(feeScale.mul(data.perfFeesAssetsPerShare))
            : BN.from(0)
    }

    const assertChargeFee = async (
        data: CheckData
    ) => {
        checkAndSetDefaultAssetPerShare(data)
        await assertBalances("before feeCharge", data)

        const feeSharesBefore = await vault.balanceOf(feeReceiver.address)

        const tx = await vault.connect(sa.vaultManager.signer).chargePerformanceFee()

        const assetsPerShareAfter = calculateAssetsPerShare(data)
        const feeShares = calculateFeeShares(data, assetsPerShareAfter)

        if (feeShares.gt(0)) {
            await expect(tx).to.emit(vault, "PerformanceFee").withArgs(feeReceiver.address, feeShares)
        } else {
            await expect(tx).to.not.emit(vault, "PerformanceFee")
        }
        expect(await vault.balanceOf(feeReceiver.address), "fee shares after").to.eq(feeSharesBefore.add(feeShares))

        const dataAfter = {
            investor: data.investor,
            investorShares: data.investorShares,
            totalShares: feeShares.add(data.totalShares),
            totalAssets: data.totalAssets,
            perfFeesAssetsPerShare: assetsPerShareAfter,
        }

        await assertBalances("after feeCharge", dataAfter)
    }

    const deployFeeVaultDependencies = async (decimals = 18) => {
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)
        asset = await new MockERC20ForceBurnable__factory(sa.default.signer).deploy(
            "USD asset",
            "AST",
            decimals,
            sa.default.address,
            simpleToExactAmount(100000000),
        )
    }

    const deployFeeVault = async (decimals = 18): Promise<PerfFeeBasicVault> => {
        if (!asset) {
            await deployFeeVaultDependencies(decimals)
        }
        vault = await new PerfFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)

        await vault.initialize("feeVault", "fv", sa.vaultManager.address, feeReceiver.address, performanceFee)

        // Approve vault to transfer assets from default signer
        await asset.approve(vault.address, ethers.constants.MaxUint256)

        return vault
    }

    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        feeReceiver = sa.feeReceiver
        user = sa.dummy1
    })

    describe("constructor", async () => {
        before(async () => {
            await deployFeeVault()
        })
        it("should properly store constructor arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "underlying asset").to.eq(asset.address)
            expect(await vault.PERF_ASSETS_PER_SHARE_SCALE(), "assets/share scale").to.eq(perfAssetsPerShareScale)
            expect(await vault.FEE_SCALE(), "fee scale").to.eq(feeScale)
        })
    })
    describe("calling initialize", async () => {
        before(async () => {
            await deployFeeVaultDependencies(12)
            vault = await new PerfFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            await vault.initialize("feeVault", "fv", sa.vaultManager.address, feeReceiver.address, performanceFee)
        })
        it("should properly store valid arguments", async () => {
            expect(await vault.symbol(), "symbol").to.eq("fv")
            expect(await vault.name(), "name").to.eq("feeVault")
            expect(await vault.decimals(), "decimals").to.eq(12)

            expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)

            expect(await vault.feeReceiver(), "fee receiver").to.eq(feeReceiver.address)
            expect(await vault.performanceFee(), "performanceFee").to.eq(performanceFee)
            expect(await vault.perfFeesAssetPerShare(), "assetsPerShare").to.eq(perfAssetsPerShareScale)

            expect(await vault.totalSupply(), "total shares").to.eq(0)
            expect(await vault.totalAssets(), "total assets").to.eq(0)
        })

        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize("feeVault", "fv", sa.vaultManager.address, feeReceiver.address, performanceFee),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
    describe("charge performance fees correctly", async () => {
        context("18 decimal asset", async () => {
            const depositAmt = simpleToExactAmount(1000000)
            beforeEach(async () => {
                vault = await deployFeeVault()
                await asset.transfer(user.address, simpleToExactAmount(20000000))
                await asset.connect(user.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(user.signer).deposit(depositAmt, user.address)
            })
            it("on same asset/share", async () => {
                const data = {
                    investor: user.address,
                    investorShares: depositAmt,
                    totalShares: depositAmt,
                    totalAssets: depositAmt,
                }
                await assertChargeFee(data)
            })
            it("on 10% increased assets/share", async () => {
                const transferAmt = depositAmt.div(10)
                const totalAssets = depositAmt.add(transferAmt)

                // send 10% more assets to vault directly
                await asset.transfer(vault.address, transferAmt)

                const data = {
                    investor: user.address,
                    investorShares: depositAmt,
                    totalShares: depositAmt,
                    totalAssets: totalAssets,
                }
                await assertChargeFee(data)
            })
            it("on 10% decreased assets/share", async () => {
                const burnAmount = depositAmt.div(10)
                const totalAssets = depositAmt.sub(burnAmount)

                // burn 10% asset from vault
                await asset.burnForce(vault.address, burnAmount)

                const data = {
                    investor: user.address,
                    investorShares: depositAmt,
                    totalShares: depositAmt,
                    totalAssets: totalAssets,
                }
                await assertChargeFee(data)
            })
        })
        context("2 decimal asset", async () => {
            const depositAmt = simpleToExactAmount(1000, 2)
            before(async () => {
                vault = await deployFeeVault(2)
                await asset.transfer(user.address, simpleToExactAmount(20000, 2))
                await asset.connect(user.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(user.signer).deposit(depositAmt, user.address)
            })
            it("on initial asset/share", async () => {
                const data = {
                    investor: user.address,
                    investorShares: depositAmt,
                    totalShares: depositAmt,
                    totalAssets: depositAmt,
                }
                await assertChargeFee(data)
            })
            it("on marginally increased asset/share resulting in feeShares = 0", async () => {
                // transfer amount 0.01%
                const transferAmt = depositAmt.div(10000)
                const totalAssets = depositAmt.add(transferAmt)
                const feeShares = await vault.balanceOf(feeReceiver.address)

                // send 0.01% more assets to vault directly
                await asset.transfer(vault.address, transferAmt)

                const data = {
                    investor: user.address,
                    investorShares: depositAmt,
                    totalShares: depositAmt.add(feeShares),
                    totalAssets: totalAssets,
                    perfFeesAssetsPerShare: await vault.perfFeesAssetPerShare(),
                }
                await assertChargeFee(data)
            })
        })
    })
    describe("set Performance fees", async () => {
        const depositAmt = simpleToExactAmount(1000000)
        beforeEach(async () => {
            vault = await deployFeeVault()
            await asset.transfer(user.address, simpleToExactAmount(20000000))
            await asset.connect(user.signer).approve(vault.address, ethers.constants.MaxUint256)
            await vault.connect(user.signer).deposit(depositAmt, user.address)
        })
        it("should fail if callee is not governor", async () => {
            const tx = vault.setPerformanceFee(1000)
            await expect(tx).to.be.revertedWith("Only governor can execute")
        })
        it("should fail if invalid performance fee", async () => {
            const tx = vault.connect(sa.governor.signer).setPerformanceFee(10000000)
            await expect(tx).to.be.revertedWith("Invalid fee")
        })
        it("should charge performance fees first", async () => {
            const transferAmt = depositAmt.div(10)
            const totalAssets = depositAmt.add(transferAmt)

            // send 10% more assets to vault directly
            await asset.transfer(vault.address, transferAmt)

            const data = {
                investor: user.address,
                investorShares: depositAmt,
                totalShares: depositAmt,
                totalAssets: totalAssets
            }
            const feeShares = calculateFeeShares(data, calculateAssetsPerShare(data))

            const newPerfFee = 100
            const tx = vault.connect(sa.governor.signer).setPerformanceFee(newPerfFee)
            await expect(tx).to.emit(vault, "PerformanceFee").withArgs(feeReceiver.address, feeShares)
        })
        it("should emit PerformanceFeeUpdated event and correctly update", async () => {
            const newPerfFee = 100
            const tx = vault.connect(sa.governor.signer).setPerformanceFee(newPerfFee)
            await expect(tx).to.emit(vault, "PerformanceFeeUpdated").withArgs(newPerfFee)
            expect(await vault.performanceFee(), "PerformaceFees").to.eq(newPerfFee)
        })
    })
})