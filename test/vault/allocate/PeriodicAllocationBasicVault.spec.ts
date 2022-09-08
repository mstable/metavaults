import { shouldBehaveLikeBaseVault, testAmounts } from "@test/shared/BaseVault.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { assertBNClose } from "@utils/assertions"
import { ZERO_ADDRESS } from "@utils/constants"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicVault__factory, PeriodicAllocationBasicVault__factory } from "types/generated"

import type { BaseVaultBehaviourContext } from "@test/shared/BaseVault.behaviour"
import type { BigNumberish } from "ethers"
import type { Account } from "types"
import type { AbstractVault, BasicVault, MockERC20, MockNexus, PeriodicAllocationBasicVault, VaultManagerRole } from "types/generated"

interface PABVaultData {
    assetPerShare: BN
    totalAssets: BN
    totalSupply: BN
    inVaultAssets: BN
    bVault1Shares: BN
    bVault2Shares: BN
    userShares: BN
}

interface BasicVaultData {
    totalAssets: BN
    totalSupply: BN
}

interface SnapVaultData {
    vaultData: PABVaultData
    bVault1Data: BasicVaultData
    bVault2Data: BasicVaultData
}

const assetsPerShareScale = simpleToExactAmount(1, 26)
const halfMil = simpleToExactAmount(500000)
const oneMil = simpleToExactAmount(1000000)
const tenMil = oneMil.mul(10)
const assetPerShareUpdateThreshold = oneMil
const sourceParams = {
    singleVaultSharesThreshold: BN.from(1000),
    singleSourceVaultIndex: BN.from(0),
}

describe("PeriodicAllocationBasicVault", async () => {
    /* -- Declare shared variables -- */
    let sa: StandardAccounts
    let mocks: ContractMocks
    let nexus: MockNexus
    let asset: MockERC20
    let bVault1: BasicVault
    let bVault2: BasicVault
    let user: Account
    let underlyingVaults: Array<string>

    // Testing contract
    let pabVault: PeriodicAllocationBasicVault

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        mocks = await new ContractMocks().init(sa)
        nexus = mocks.nexus
        asset = mocks.erc20
        user = sa.dummy1

        // Deploy dependencies of test contract.
        bVault1 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        await bVault1.initialize(`bv1${await asset.name()}`, `bv1${await asset.symbol()}`, sa.vaultManager.address)

        bVault2 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        await bVault2.initialize(`bv2${await asset.name()}`, `bv2${await asset.symbol()}`, sa.vaultManager.address)

        underlyingVaults = [bVault1.address, bVault2.address]

        // Deploy test contract.
        pabVault = await new PeriodicAllocationBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        // Initialize test contract.
        await pabVault.initialize(
            `pab${await asset.name()}`,
            `pab${await asset.symbol()}`,
            sa.vaultManager.address,
            underlyingVaults,
            sourceParams,
            assetPerShareUpdateThreshold,
        )

        // transfer assets to users
        await asset.transfer(user.address, simpleToExactAmount(100000000))

        // asset approvals
        await asset.connect(pabVault.signer).approve(bVault1.address, ethers.constants.MaxUint256)
        await asset.connect(pabVault.signer).approve(bVault2.address, ethers.constants.MaxUint256)
        await asset.connect(user.signer).approve(pabVault.address, ethers.constants.MaxUint256)

        // set balance or users for the test.
        const assetBalance = await asset.balanceOf(sa.default.address)
        asset.transfer(sa.alice.address, assetBalance.div(2))
    }

    const snapVault = async (): Promise<SnapVaultData> => {
        return {
            vaultData: {
                assetPerShare: await pabVault.assetsPerShare(),
                totalAssets: await pabVault.totalAssets(),
                totalSupply: await pabVault.totalSupply(),
                inVaultAssets: await asset.balanceOf(pabVault.address),
                bVault1Shares: await bVault1.balanceOf(pabVault.address),
                bVault2Shares: await bVault2.balanceOf(pabVault.address),
                userShares: await pabVault.balanceOf(user.address),
            },
            bVault1Data: {
                totalAssets: await bVault1.totalAssets(),
                totalSupply: await bVault1.totalSupply(),
            },
            bVault2Data: {
                totalAssets: await bVault2.totalAssets(),
                totalSupply: await bVault2.totalSupply(),
            },
        }
    }

    const assertVaultBalances = async (
        data: SnapVaultData,
        assetPerShare: BigNumberish,
        totalAssets: BigNumberish,
        totalSupply: BigNumberish,
        inVaultAssets: BigNumberish,
        bVault1Shares: BigNumberish,
        bVault2Shares: BigNumberish,
        bv1TotalAssets: BigNumberish,
        bv1TotalSupply: BigNumberish,
        bv2TotalAssets: BigNumberish,
        bv2TotalSupply: BigNumberish,
    ) => {
        expect(data.vaultData.assetPerShare, "assetPerShare").to.eq(assetPerShare)
        expect(data.vaultData.totalAssets, "totalAssets").to.eq(totalAssets)
        expect(data.vaultData.totalSupply, "totalSupply").to.eq(totalSupply)
        assertBNClose(data.vaultData.inVaultAssets, BN.from(inVaultAssets), 2, "inVaultAssets")
        assertBNClose(data.vaultData.bVault1Shares, BN.from(bVault1Shares), 2, "bVault1Shares")
        assertBNClose(data.vaultData.bVault2Shares, BN.from(bVault2Shares), 2, "bVault2Shares")

        assertBNClose(data.bVault1Data.totalAssets, BN.from(bv1TotalAssets), 2, "bv1 totalAssets")
        assertBNClose(data.bVault1Data.totalSupply, BN.from(bv1TotalSupply), 2, "bv1 totalSupply")

        assertBNClose(data.bVault2Data.totalAssets, BN.from(bv2TotalAssets), 2, "bv2 totalAssets")
        assertBNClose(data.bVault2Data.totalSupply, BN.from(bv2TotalSupply), 2, "bv2 totalSupply")
    }

    before("init contract", async () => {
        await setup()
    })
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await pabVault.nexus(), "nexus").to.eq(nexus.address)
            expect(await pabVault.asset(), "asset").to.eq(asset.address)
        })
        it("should fail if arguments are wrong", async () => {
            await expect(
                new PeriodicAllocationBasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS),
            ).to.be.revertedWith("Asset is zero")
        })
    })
    describe("initialize", async () => {
        it("should properly store valid arguments", async () => {
            // Basic vaults
            expect(await bVault1.symbol(), "bv1 symbol").to.eq("bv1ERC20")
            expect(await bVault2.symbol(), "bv2 symbol").to.eq("bv2ERC20")
            expect(await bVault1.name(), "bv1 name").to.eq("bv1ERC20 Mock")
            expect(await bVault2.name(), "bv2 name").to.eq("bv2ERC20 Mock")
            expect(await bVault1.decimals(), "bv1 decimals").to.eq(await asset.decimals())
            expect(await bVault2.decimals(), "bv2 decimals").to.eq(await asset.decimals())

            // PAB Vault
            expect(await pabVault.symbol(), "pab symbol").to.eq("pabERC20")
            expect(await pabVault.name(), "pab name").to.eq("pabERC20 Mock")
            expect(await pabVault.decimals(), "pab decimals").to.eq(18)

            expect(await pabVault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)
            expect(await pabVault.assetsPerShare(), "assetsPerShare").to.eq(assetsPerShareScale)
            expect(await pabVault.totalSupply(), "totalSupply").to.eq(0)
            expect(await pabVault.totalAssets(), "totalAssets").to.eq(0)
            expect((await pabVault.sourceParams()).singleVaultSharesThreshold, "singleVaultSharesThreshold").to.eq(1000)
            expect((await pabVault.sourceParams()).singleSourceVaultIndex, "singleSourceVaultIndex").to.eq(0)

            expect(await pabVault.underlyingVaults(0)).to.eq(bVault1.address)
            expect(await pabVault.underlyingVaults(1)).to.eq(bVault2.address)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                pabVault.initialize(
                    `pab${await asset.name()}`,
                    `pab${await asset.symbol()}`,
                    sa.vaultManager.address,
                    underlyingVaults,
                    sourceParams,
                    assetPerShareUpdateThreshold,
                ),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
        it("fails with invalid singleVaultSharesThreshold", async () => {
            // Deploy test contract.
            const pabVaultTemp = await new PeriodicAllocationBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)

            const sourceParamsTemp = {
                singleVaultSharesThreshold: BN.from(10001),
                singleSourceVaultIndex: BN.from(10),
            }

            // Initialize test contract.
            const tx = pabVaultTemp.initialize(
                `pab${await asset.name()}`,
                `pab${await asset.symbol()}`,
                sa.vaultManager.address,
                underlyingVaults,
                sourceParamsTemp,
                assetPerShareUpdateThreshold,
            )

            await expect(tx).to.be.revertedWith("Invalid shares threshold")
        })
        it("fails with invalid singleSourceVaultIndex", async () => {
            // Deploy test contract.
            const pabVaultTemp = await new PeriodicAllocationBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)

            const sourceParamsTemp = {
                singleVaultSharesThreshold: BN.from(1000),
                singleSourceVaultIndex: BN.from(10),
            }

            // Initialize test contract.
            const tx = pabVaultTemp.initialize(
                `pab${await asset.name()}`,
                `pab${await asset.symbol()}`,
                sa.vaultManager.address,
                underlyingVaults,
                sourceParamsTemp,
                assetPerShareUpdateThreshold,
            )

            await expect(tx).to.be.revertedWith("Invalid source vault index")
        })
    })
    describe("behaviors", async () => {
        const ctx: Partial<BaseVaultBehaviourContext> = {}
        before(async () => {
            ctx.fixture = async function fixture() {
                await setup()
                ctx.vault = pabVault as unknown as AbstractVault
                ctx.asset = asset
                ctx.sa = sa
                ctx.amounts = testAmounts(100, await asset.decimals())
            }
        })
        shouldBehaveLikeVaultManagerRole(() => ({ vaultManagerRole: pabVault as VaultManagerRole, sa }))

        shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
    })
    describe("Vault operations", async () => {
        const initialDepositAmount = tenMil

        describe("before settlement", async () => {
            const redeemAmount = oneMil
            const withdrawAmount = oneMil
            const mintAmount = oneMil
            it("deposit 0 should not fail", async () => {
                await setup()
                await pabVault.connect(user.signer).deposit(0, user.address)
                const data = await snapVault()
                // internal balance should not be changed
                await assertVaultBalances(data, assetsPerShareScale, 0, 0, 0, 0, 0, 0, 0, 0, 0)
            })
            it("deposit", async () => {
                await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                const data = await snapVault()

                await assertVaultBalances(
                    data,
                    assetsPerShareScale,
                    initialDepositAmount,
                    initialDepositAmount,
                    initialDepositAmount,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )
            })
            it("redeem", async () => {
                const userSharesBefore = await pabVault.balanceOf(user.address)
                const userAssetsBefore = await asset.balanceOf(user.address)

                await pabVault.connect(user.signer).redeem(redeemAmount, user.address, user.address)
                const data = await snapVault()

                const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                await assertVaultBalances(
                    data,
                    assetsPerShareScale,
                    initialDepositAmount.sub(redeemAmount),
                    initialDepositAmount.sub(redeemAmount),
                    initialDepositAmount.sub(redeemAmount),
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )

                expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(redeemAmount))
                expect(userAssetsRecv, "userAssetsReceived").to.eq(redeemAmount)
            })
            it("withdraw should fail assetsWithdrawn > vaultBalance", async () => {
                const tx = pabVault.connect(user.signer).withdraw(initialDepositAmount.mul(2), user.address, user.address)
                await expect(tx).to.be.revertedWith("not enough assets")
            })
            it("withdraw", async () => {
                const userSharesBefore = await pabVault.balanceOf(user.address)
                const userAssetsBefore = await asset.balanceOf(user.address)

                const dataBefore = await snapVault()
                await pabVault.connect(user.signer).withdraw(withdrawAmount, user.address, user.address)
                const data = await snapVault()

                const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                await assertVaultBalances(
                    data,
                    assetsPerShareScale,
                    dataBefore.vaultData.totalAssets.sub(withdrawAmount),
                    dataBefore.vaultData.totalAssets.sub(withdrawAmount),
                    dataBefore.vaultData.totalAssets.sub(withdrawAmount),
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )

                expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(withdrawAmount))
                expect(userAssetsRecv, "userAssetsReceived").to.eq(withdrawAmount)
            })
            it("mint should not fail with 0 shares", async () => {
                const dataBefore = await snapVault()
                await pabVault.connect(user.signer).mint(0, user.address)
                const data = await snapVault()
                // internal balance should not be changed
                await assertVaultBalances(
                    data,
                    assetsPerShareScale,
                    dataBefore.vaultData.totalAssets,
                    dataBefore.vaultData.totalSupply,
                    dataBefore.vaultData.totalAssets,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )
            })
            it("mint", async () => {
                const userSharesBefore = await pabVault.balanceOf(user.address)
                const userAssetsBefore = await asset.balanceOf(user.address)

                const dataBefore = await snapVault()
                await pabVault.connect(user.signer).mint(mintAmount, user.address)
                const data = await snapVault()

                const userAssetsConsumed = userAssetsBefore.sub(await asset.balanceOf(user.address))

                await assertVaultBalances(
                    data,
                    assetsPerShareScale,
                    dataBefore.vaultData.totalAssets.add(mintAmount),
                    dataBefore.vaultData.totalSupply.add(mintAmount),
                    dataBefore.vaultData.totalAssets.add(mintAmount),
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )

                expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.add(mintAmount))
                expect(userAssetsConsumed, "userAssetsConsumed").to.eq(mintAmount)
            })
        })
        describe("settlement", async () => {
            const belowThresholdWithdrawAmount = halfMil
            const aboveThresholdWithdrawAmount = oneMil.add(oneMil)
            it("fails if wrong vaultIndex", async () => {
                const settlement = {
                    vaultIndex: BN.from(3),
                    assets: oneMil,
                }
                const tx = pabVault.connect(sa.vaultManager.signer).settle([settlement])
                await expect(tx).to.be.revertedWith("Invalid Vault Index")
            })
            it("only vaultManager can settle", async () => {
                const settlement = {
                    vaultIndex: BN.from(0),
                    assets: oneMil,
                }
                const tx = pabVault.connect(user.signer).settle([settlement])
                await expect(tx).to.be.revertedWith("Only vault manager can execute")
            })
            context("settle all assets", async () => {
                describe("in vault1", async () => {
                    beforeEach(async () => {
                        await setup()
                        await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                        const settlement1 = {
                            vaultIndex: BN.from(0),
                            assets: initialDepositAmount,
                        }
                        const settlement2 = {
                            vaultIndex: BN.from(1),
                            assets: BN.from(0),
                        }

                        await pabVault.connect(sa.vaultManager.signer).settle([settlement1, settlement2])
                    })
                    it("it should have correct vault parameters", async () => {
                        const dataAfter = await snapVault()

                        await assertVaultBalances(
                            dataAfter,
                            assetsPerShareScale,
                            initialDepositAmount,
                            initialDepositAmount,
                            0,
                            initialDepositAmount,
                            0,
                            initialDepositAmount,
                            initialDepositAmount,
                            0,
                            0,
                        )

                        expect(dataAfter.vaultData.userShares, "userShares").to.eq(initialDepositAmount)
                    })
                    context("it should correctly source assets with", async () => {
                        it("sharesRedeemed > singleVaultShareThreshold", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            const dataBefore = await snapVault()
                            await pabVault.connect(user.signer).withdraw(aboveThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)
                            const underlyingAssetsWithdraw = aboveThresholdWithdrawAmount

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                dataBefore.vaultData.totalAssets.sub(aboveThresholdWithdrawAmount),
                                dataBefore.vaultData.totalSupply.sub(aboveThresholdWithdrawAmount),
                                underlyingAssetsWithdraw.sub(aboveThresholdWithdrawAmount),
                                initialDepositAmount.sub(underlyingAssetsWithdraw),
                                0,
                                initialDepositAmount.sub(underlyingAssetsWithdraw),
                                initialDepositAmount.sub(underlyingAssetsWithdraw),
                                0,
                                0,
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(aboveThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(aboveThresholdWithdrawAmount)
                        })
                        it("withdraw all assets", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            await pabVault.connect(user.signer).withdraw(initialDepositAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(data, assetsPerShareScale, 0, 0, 0, 0, 0, 0, 0, 0, 0)

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(initialDepositAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(initialDepositAmount)
                        })
                        it("sharesRedeemed < singleVaultShareThreshold and sourceVault = vault1", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            const dataBefore = await snapVault()
                            await pabVault.connect(user.signer).withdraw(belowThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                dataBefore.vaultData.totalAssets.sub(belowThresholdWithdrawAmount),
                                dataBefore.vaultData.totalSupply.sub(belowThresholdWithdrawAmount),
                                0,
                                initialDepositAmount.sub(belowThresholdWithdrawAmount),
                                0,
                                initialDepositAmount.sub(belowThresholdWithdrawAmount),
                                initialDepositAmount.sub(belowThresholdWithdrawAmount),
                                0,
                                0,
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(belowThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(belowThresholdWithdrawAmount)
                        })
                        it("sharesRedeemed < singleVaultShareThreshold and sourceVault = vault2 (empty vault)", async () => {
                            // set single source vault to vault2
                            await pabVault.connect(sa.governor.signer).setSingleSourceVaultIndex(1)
                            expect((await pabVault.sourceParams()).singleSourceVaultIndex).to.eq(1)

                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            const dataBefore = await snapVault()
                            await pabVault.connect(user.signer).withdraw(belowThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)
                            const underlyingAssetsWithdrawBVault1 = belowThresholdWithdrawAmount

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                dataBefore.vaultData.totalAssets.sub(belowThresholdWithdrawAmount),
                                dataBefore.vaultData.totalSupply.sub(belowThresholdWithdrawAmount),
                                underlyingAssetsWithdrawBVault1.sub(belowThresholdWithdrawAmount),
                                initialDepositAmount.sub(underlyingAssetsWithdrawBVault1),
                                0,
                                initialDepositAmount.sub(underlyingAssetsWithdrawBVault1),
                                initialDepositAmount.sub(underlyingAssetsWithdrawBVault1),
                                0,
                                0,
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(belowThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(belowThresholdWithdrawAmount)
                        })
                    })
                })
                describe("in vault1 and vault2 with 70:30 ratio", async () => {
                    const bVault1SettleAmount = oneMil.mul(7)
                    const bVault2SettleAmount = initialDepositAmount.sub(bVault1SettleAmount)
                    beforeEach(async () => {
                        await setup()
                        await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                        const settlement1 = {
                            vaultIndex: BN.from(0),
                            assets: bVault1SettleAmount,
                        }
                        const settlement2 = {
                            vaultIndex: BN.from(1),
                            assets: bVault2SettleAmount,
                        }

                        await pabVault.connect(sa.vaultManager.signer).settle([settlement1, settlement2])
                    })
                    it("it should have correct vault parameters", async () => {
                        const dataAfter = await snapVault()

                        await assertVaultBalances(
                            dataAfter,
                            assetsPerShareScale,
                            initialDepositAmount,
                            initialDepositAmount,
                            0,
                            bVault1SettleAmount,
                            bVault2SettleAmount,
                            bVault1SettleAmount,
                            bVault1SettleAmount,
                            bVault2SettleAmount,
                            bVault2SettleAmount,
                        )

                        expect(dataAfter.vaultData.userShares, "userShares").to.eq(initialDepositAmount)
                    })
                    context("it should correctly source assets with", async () => {
                        it("sharesRedeemed > singleVaultShareThreshold", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            await pabVault.connect(user.signer).withdraw(aboveThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)
                            const totalAssetsWithdraw = aboveThresholdWithdrawAmount
                            const bVault1AssetsWithdraw = totalAssetsWithdraw
                                .mul(bVault1SettleAmount)
                                .div(bVault1SettleAmount.add(bVault2SettleAmount))
                            const bVault2AssetsWithdraw = totalAssetsWithdraw
                                .mul(bVault2SettleAmount)
                                .div(bVault1SettleAmount.add(bVault2SettleAmount))

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                initialDepositAmount.sub(aboveThresholdWithdrawAmount),
                                initialDepositAmount.sub(aboveThresholdWithdrawAmount),
                                bVault1AssetsWithdraw.add(bVault2AssetsWithdraw).sub(aboveThresholdWithdrawAmount),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(aboveThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(aboveThresholdWithdrawAmount)
                        })
                        it("withdraw all assets", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            await pabVault.connect(user.signer).withdraw(initialDepositAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(data, assetsPerShareScale, 0, 0, 0, 0, 0, 0, 0, 0, 0)

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(initialDepositAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(initialDepositAmount)
                        })
                        it("sharesRedeemed < singleVaultShareThreshold and sourceVault = vault1", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            const dataBefore = await snapVault()
                            await pabVault.connect(user.signer).withdraw(belowThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                dataBefore.vaultData.totalAssets.sub(belowThresholdWithdrawAmount),
                                dataBefore.vaultData.totalSupply.sub(belowThresholdWithdrawAmount),
                                0,
                                bVault1SettleAmount.sub(belowThresholdWithdrawAmount),
                                bVault2SettleAmount,
                                bVault1SettleAmount.sub(belowThresholdWithdrawAmount),
                                bVault1SettleAmount.sub(belowThresholdWithdrawAmount),
                                bVault2SettleAmount,
                                bVault2SettleAmount,
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(belowThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(belowThresholdWithdrawAmount)
                        })
                    })
                })
                describe("in vault1 and vault2 with 04:96 ratio", async () => {
                    const bVault1SettleAmount = simpleToExactAmount(400000)
                    const bVault2SettleAmount = initialDepositAmount.sub(bVault1SettleAmount)
                    beforeEach(async () => {
                        await setup()
                        await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                        const settlement1 = {
                            vaultIndex: BN.from(0),
                            assets: bVault1SettleAmount,
                        }
                        const settlement2 = {
                            vaultIndex: BN.from(1),
                            assets: bVault2SettleAmount,
                        }

                        await pabVault.connect(sa.vaultManager.signer).settle([settlement1, settlement2])
                    })
                    it("it should have correct vault parameters", async () => {
                        const dataAfter = await snapVault()

                        await assertVaultBalances(
                            dataAfter,
                            assetsPerShareScale,
                            initialDepositAmount,
                            initialDepositAmount,
                            0,
                            bVault1SettleAmount,
                            bVault2SettleAmount,
                            bVault1SettleAmount,
                            bVault1SettleAmount,
                            bVault2SettleAmount,
                            bVault2SettleAmount,
                        )

                        expect(dataAfter.vaultData.userShares, "userShares").to.eq(initialDepositAmount)
                    })
                    context("it should correctly source assets with", async () => {
                        it("sharesRedeemed < singleVaultShareThreshold and sourceVault = vault1 and vault1Assets < requestedAssets", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            await pabVault.connect(user.signer).withdraw(belowThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)
                            const totalAssetsWithdraw = belowThresholdWithdrawAmount
                            const bVault1AssetsWithdraw = totalAssetsWithdraw
                                .mul(bVault1SettleAmount)
                                .div(bVault1SettleAmount.add(bVault2SettleAmount))
                            const bVault2AssetsWithdraw = totalAssetsWithdraw
                                .mul(bVault2SettleAmount)
                                .div(bVault1SettleAmount.add(bVault2SettleAmount))

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                initialDepositAmount.sub(belowThresholdWithdrawAmount),
                                initialDepositAmount.sub(belowThresholdWithdrawAmount),
                                bVault1AssetsWithdraw.add(bVault2AssetsWithdraw).sub(belowThresholdWithdrawAmount),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(belowThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(belowThresholdWithdrawAmount)
                        })
                    })
                })
            })
            context("settle partial assets", async () => {
                const vaultHasEnoughWithdrawAmount = simpleToExactAmount(300000)
                describe("4% in metaVault and 48-48 in vault1-vault2", async () => {
                    const inVaultSettleAmount = simpleToExactAmount(400000)
                    const bVault1SettleAmount = initialDepositAmount.sub(inVaultSettleAmount).div(2)
                    const bVault2SettleAmount = initialDepositAmount.sub(inVaultSettleAmount).div(2)
                    beforeEach(async () => {
                        await setup()
                        await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                        const settlement1 = {
                            vaultIndex: BN.from(0),
                            assets: bVault1SettleAmount,
                        }
                        const settlement2 = {
                            vaultIndex: BN.from(1),
                            assets: bVault2SettleAmount,
                        }

                        await pabVault.connect(sa.vaultManager.signer).settle([settlement1, settlement2])
                    })
                    it("it should have correct vault parameters", async () => {
                        const dataAfter = await snapVault()

                        await assertVaultBalances(
                            dataAfter,
                            assetsPerShareScale,
                            initialDepositAmount,
                            initialDepositAmount,
                            inVaultSettleAmount,
                            bVault1SettleAmount,
                            bVault2SettleAmount,
                            bVault1SettleAmount,
                            bVault1SettleAmount,
                            bVault2SettleAmount,
                            bVault2SettleAmount,
                        )

                        expect(dataAfter.vaultData.userShares, "userShares").to.eq(initialDepositAmount)
                    })
                    context("it should correctly source assets with", async () => {
                        it("assets withdrawn < in-vault assets", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            await pabVault.connect(user.signer).withdraw(vaultHasEnoughWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                initialDepositAmount.sub(vaultHasEnoughWithdrawAmount),
                                initialDepositAmount.sub(vaultHasEnoughWithdrawAmount),
                                inVaultSettleAmount.sub(vaultHasEnoughWithdrawAmount),
                                bVault1SettleAmount,
                                bVault2SettleAmount,
                                bVault1SettleAmount,
                                bVault1SettleAmount,
                                bVault2SettleAmount,
                                bVault2SettleAmount,
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(vaultHasEnoughWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(vaultHasEnoughWithdrawAmount)
                        })
                        it("withdraw all assets", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            await pabVault.connect(user.signer).withdraw(initialDepositAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(data, assetsPerShareScale, 0, 0, 0, 0, 0, 0, 0, 0, 0)

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(initialDepositAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(initialDepositAmount)
                        })
                        it("assetsWithdrawn > in-vault assets and shareRedeemed < shareThreshold", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            const dataBefore = await snapVault()
                            await pabVault.connect(user.signer).withdraw(belowThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                dataBefore.vaultData.totalAssets.sub(belowThresholdWithdrawAmount),
                                dataBefore.vaultData.totalSupply.sub(belowThresholdWithdrawAmount),
                                0,
                                bVault1SettleAmount.sub(belowThresholdWithdrawAmount.sub(inVaultSettleAmount)),
                                bVault2SettleAmount,
                                bVault1SettleAmount.sub(belowThresholdWithdrawAmount.sub(inVaultSettleAmount)),
                                bVault1SettleAmount.sub(belowThresholdWithdrawAmount.sub(inVaultSettleAmount)),
                                bVault2SettleAmount,
                                bVault2SettleAmount,
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(belowThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(belowThresholdWithdrawAmount)
                        })
                        it("assetsWithdrawn > in-vault assets and shareRedeemed > shareThreshold", async () => {
                            const userSharesBefore = await pabVault.balanceOf(user.address)
                            const userAssetsBefore = await asset.balanceOf(user.address)

                            const dataBefore = await snapVault()
                            await pabVault.connect(user.signer).withdraw(aboveThresholdWithdrawAmount, user.address, user.address)
                            const data = await snapVault()

                            const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)
                            const totalAssetsWithdraw = aboveThresholdWithdrawAmount.sub(inVaultSettleAmount)
                            const bVault1AssetsWithdraw = totalAssetsWithdraw
                                .mul(bVault1SettleAmount)
                                .div(bVault1SettleAmount.add(bVault2SettleAmount))
                            const bVault2AssetsWithdraw = totalAssetsWithdraw
                                .mul(bVault2SettleAmount)
                                .div(bVault1SettleAmount.add(bVault2SettleAmount))

                            await assertVaultBalances(
                                data,
                                assetsPerShareScale,
                                dataBefore.vaultData.totalAssets.sub(aboveThresholdWithdrawAmount),
                                dataBefore.vaultData.totalSupply.sub(aboveThresholdWithdrawAmount),
                                bVault1AssetsWithdraw.add(bVault2AssetsWithdraw).add(inVaultSettleAmount).sub(aboveThresholdWithdrawAmount),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault1SettleAmount.sub(bVault1AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                                bVault2SettleAmount.sub(bVault2AssetsWithdraw),
                            )

                            expect(data.vaultData.userShares, "userShares").to.eq(userSharesBefore.sub(aboveThresholdWithdrawAmount))
                            expect(userAssetsRecv, "userAssetsReceived").to.eq(aboveThresholdWithdrawAmount)
                        })
                    })
                })
            })
        })
        describe("assetPerShare increased by 20%", async () => {
            const depositAmount = oneMil
            const redeemAmount = oneMil
            const withdrawAmount = oneMil
            const mintAmount = oneMil

            const inVaultSettleAmount = oneMil.mul(2)
            const bVault1SettleAmount = initialDepositAmount.sub(inVaultSettleAmount).div(2)
            const bVault2SettleAmount = initialDepositAmount.sub(inVaultSettleAmount).div(2)
            let updatedAssetPerShare: BN

            beforeEach(async () => {
                await setup()
                await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                const settlement1 = {
                    vaultIndex: BN.from(0),
                    assets: bVault1SettleAmount,
                }
                const settlement2 = {
                    vaultIndex: BN.from(1),
                    assets: bVault2SettleAmount,
                }

                await pabVault.connect(sa.vaultManager.signer).settle([settlement1, settlement2])

                // Send some assets to bVault1 to change assetPerShare
                const transferAmount = oneMil.mul(2)
                await asset.transfer(bVault1.address, transferAmount)

                updatedAssetPerShare = initialDepositAmount.add(transferAmount).mul(assetsPerShareScale).div(initialDepositAmount)

                // Update assetPerShare
                await pabVault.connect(sa.vaultManager.signer).updateAssetPerShare()
            })
            it("should have correct assetPerShare", async () => {
                const actualAssetPerShare = await pabVault.assetsPerShare()
                expect(actualAssetPerShare, "new assetPerShare").to.eq(updatedAssetPerShare)
            })
            it("deposit", async () => {
                const userSharesBefore = await pabVault.balanceOf(user.address)
                await pabVault.connect(user.signer).deposit(depositAmount, user.address)

                const userSharesRecv = (await pabVault.balanceOf(user.address)).sub(userSharesBefore)
                const expectedSharesRecv = depositAmount.mul(assetsPerShareScale).div(updatedAssetPerShare)
                expect(userSharesRecv, "userShares").to.eq(expectedSharesRecv)
            })
            it("redeem", async () => {
                const userAssetsBefore = await asset.balanceOf(user.address)
                await pabVault.connect(user.signer).redeem(redeemAmount, user.address, user.address)

                const userAssetsRecv = (await asset.balanceOf(user.address)).sub(userAssetsBefore)
                const expectedAssetsRecv = redeemAmount.mul(updatedAssetPerShare).div(assetsPerShareScale)
                expect(userAssetsRecv, "userAssetsRecv").to.eq(expectedAssetsRecv)
            })
            it("withdraw", async () => {
                const userSharesBefore = await pabVault.balanceOf(user.address)
                await pabVault.connect(user.signer).withdraw(withdrawAmount, user.address, user.address)

                const userSharesConsumed = userSharesBefore.sub(await pabVault.balanceOf(user.address))
                const expectedSharesConsumed = withdrawAmount.mul(assetsPerShareScale).div(updatedAssetPerShare)
                expect(userSharesConsumed, "userSharesConsumed").to.eq(expectedSharesConsumed)
            })
            it("mint", async () => {
                const userAssetsBefore = await asset.balanceOf(user.address)
                await pabVault.connect(user.signer).mint(mintAmount, user.address)

                const userAssetsConsumed = userAssetsBefore.sub(await asset.balanceOf(user.address))
                const expectedAssetsConsumed = mintAmount.mul(updatedAssetPerShare).div(assetsPerShareScale)
                expect(userAssetsConsumed, "userAssetsConsumed").to.eq(expectedAssetsConsumed)
            })
        })
        describe("assetPerShare update should happen correctly", async () => {
            let updatedAssetPerShare: BN
            const belowThresholdAmount = halfMil
            const aboveThresholdAmount = oneMil.mul(2)
            const bVault1SettleAmount = oneMil.mul(7)
            const bVault2SettleAmount = initialDepositAmount.sub(bVault1SettleAmount)
            const transferAmount = oneMil.mul(2)
            beforeEach(async () => {
                await setup()
                await pabVault.connect(user.signer).deposit(initialDepositAmount, user.address)
                const settlement1 = {
                    vaultIndex: BN.from(0),
                    assets: bVault1SettleAmount,
                }
                const settlement2 = {
                    vaultIndex: BN.from(1),
                    assets: bVault2SettleAmount,
                }

                await pabVault.connect(sa.vaultManager.signer).settle([settlement1, settlement2])
            })
            it("when transferAmount < updateThreshold", async () => {
                await pabVault.connect(user.signer).deposit(belowThresholdAmount, user.address)
                expect(await pabVault.assetsPerShare(), "assetPerShare").to.eq(assetsPerShareScale)
                expect(await pabVault.assetsTransferred(), "assetsTransferred").to.eq(belowThresholdAmount)
            })
            it("when transferAmount > updateThreshold", async () => {
                await asset.transfer(bVault1.address, transferAmount)

                updatedAssetPerShare = initialDepositAmount.add(transferAmount).mul(assetsPerShareScale).div(initialDepositAmount)

                await pabVault.connect(user.signer).deposit(aboveThresholdAmount, user.address)
                expect(await pabVault.assetsPerShare(), "assetPerShare").to.eq(updatedAssetPerShare)
                expect(await pabVault.assetsTransferred(), "assetsTransferred").to.eq(0)
            })
            it("when assetPerShareUpdateThreshold = 0", async () => {
                await pabVault.connect(sa.governor.signer).setAssetPerShareUpdateThreshold(0)
                await asset.transfer(bVault1.address, transferAmount)

                const miniDepositAmount = simpleToExactAmount(1)
                await pabVault.connect(user.signer).deposit(miniDepositAmount, user.address)

                updatedAssetPerShare = initialDepositAmount.add(transferAmount).mul(assetsPerShareScale).div(initialDepositAmount)
                expect(await pabVault.assetsPerShare(), "assetPerShare").to.eq(updatedAssetPerShare)
                expect(await pabVault.assetsTransferred(), "assetsTransferred").to.eq(0)
            })
        })
        describe("vault params modify", async () => {
            context("singleVaultSharesThreshold", async () => {
                it("should revert with non-governor call", async () => {
                    const tx = pabVault.setSingleVaultSharesThreshold(100)
                    await expect(tx).to.be.revertedWith("Only governor can execute")
                })
                it("should revert if invalid value", async () => {
                    const tx = pabVault.connect(sa.governor.signer).setSingleVaultSharesThreshold(100000)
                    await expect(tx).to.be.revertedWith("Invalid shares threshold")
                })
                it("should correctly update", async () => {
                    await pabVault.connect(sa.governor.signer).setSingleVaultSharesThreshold(100)
                    expect((await pabVault.sourceParams()).singleVaultSharesThreshold).to.be.eq(100)
                })
            })
            context("setSingleSourceVaultIndex", async () => {
                it("should revert with non-governor call", async () => {
                    const tx = pabVault.setSingleSourceVaultIndex(1)
                    await expect(tx).to.be.revertedWith("Only governor can execute")
                })
                it("should revert if invalid value", async () => {
                    const tx = pabVault.connect(sa.governor.signer).setSingleSourceVaultIndex(3)
                    await expect(tx).to.be.revertedWith("Invalid source vault index")
                })
                it("should correctly update", async () => {
                    await pabVault.connect(sa.governor.signer).setSingleSourceVaultIndex(1)
                    expect((await pabVault.sourceParams()).singleSourceVaultIndex).to.be.eq(1)
                })
            })
            context("assetPerShareUpdateThreshold", async () => {
                it("should revert with non-governor call", async () => {
                    const tx = pabVault.setAssetPerShareUpdateThreshold(100)
                    await expect(tx).to.be.revertedWith("Only governor can execute")
                })
                it("should correctly update", async () => {
                    await pabVault.connect(sa.governor.signer).setAssetPerShareUpdateThreshold(1)
                    expect(await pabVault.assetPerShareUpdateThreshold()).to.be.eq(1)
                })
            })
        })
    })
})
