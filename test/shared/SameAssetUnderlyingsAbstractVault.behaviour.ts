import { assertBNClose } from "@utils/assertions"
import { DEAD_ADDRESS } from "@utils/constants"
import { impersonate, loadOrExecFixture, stopImpersonate } from "@utils/fork"
import { ContractMocks } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "ethers"
import { network } from "hardhat"
import { AbstractVault__factory, BasicVault__factory, Convex3CrvLiquidatorVault__factory } from "types/generated"

import type { StandardAccounts } from "@utils/machines"
import type { Account } from "types"
import type { BasicVault, ERC20, IERC20Metadata, SameAssetUnderlyingsAbstractVault } from "types/generated"

type Variance = BN
type Variances = {
    totalAssets?: Variance
    totalSupply?: Variance
    bVault0?: Variance
    bVault1?: Variance
}
type Amounts = {
    initialDeposit: BN
}
export interface SameAssetUnderlyingsAbstractVaultBehaviourContext {
    vault: SameAssetUnderlyingsAbstractVault
    asset: ERC20 | IERC20Metadata
    sa: StandardAccounts
    fixture: () => Promise<void>
    amounts: Amounts
    variances?: Variances
}

// --------
interface VaultData {
    totalAssets: BN
    totalSupply: BN
    aliceShares: BN
    bobShares: BN
}
interface BasicVaultData {
    totalAssets: BN
    totalSupply: BN
    vaultMaxWithdraw: BN
    vaultShares: BN
}

interface SnapVaultData {
    vaultData: VaultData
    bVault0Data: BasicVaultData
    bVault1Data: BasicVaultData
}
// --------
const defaultVariances: Variances = {
    totalAssets: BN.from(1),
    totalSupply: BN.from(1),
    bVault0: BN.from(1),
    bVault1: BN.from(1),
}
type Swap = {
    fromVaultIndex: number
    toVaultIndex: number
    assets: BN
    shares: BN
}
const sumBN = (previousValue: BN, currentValue: BN) => previousValue.add(currentValue)

const calculateAssetsWithdraw = (swaps: Array<Swap>, vaultIndex: number) =>
    swaps
        .filter((s) => s.fromVaultIndex === vaultIndex)
        .map((s) => s.assets)
        .reduce(sumBN, BN.from(0))
const calculateAssetsDeposit = (swaps: Array<Swap>, vaultIndex: number) =>
    swaps
        .filter((s) => s.toVaultIndex === vaultIndex)
        .map((s) => s.assets)
        .reduce(sumBN, BN.from(0))
//
const calculateSharesRedeem = (swaps: Array<Swap>, vaultIndex: number) =>
    swaps
        .filter((s) => s.fromVaultIndex === vaultIndex)
        .map((s) => s.shares)
        .reduce(sumBN, BN.from(0))
const calculateSharesMint = (swaps: Array<Swap>, vaultIndex: number) =>
    swaps
        .filter((s) => s.toVaultIndex === vaultIndex)
        .map((s) => s.shares)
        .reduce(sumBN, BN.from(0))

const snapVault = async (ctx: SameAssetUnderlyingsAbstractVaultBehaviourContext): Promise<SnapVaultData> => {
    const { vault, sa } = ctx
    const underlyingVault0Address = await vault.resolveVaultIndex(0)
    const underlyingVault1Address = await vault.resolveVaultIndex(1)

    const bVault0: BasicVault = BasicVault__factory.connect(underlyingVault0Address, sa.default.signer)
    const bVault1: BasicVault = BasicVault__factory.connect(underlyingVault1Address, sa.default.signer)

    const snap = {
        vaultData: {
            totalAssets: await vault.totalAssets(),
            totalSupply: await vault.totalSupply(),
            aliceShares: await vault.maxWithdraw(sa.alice.address),
            bobShares: await vault.maxRedeem(sa.bob.address),
        },
        bVault0Data: {
            totalAssets: await bVault0.totalAssets(),
            totalSupply: await bVault0.totalSupply(),
            vaultMaxWithdraw: await bVault0.maxWithdraw(vault.address),
            vaultShares: await bVault0.maxRedeem(vault.address),
        },
        bVault1Data: {
            totalAssets: await bVault1.totalAssets(),
            totalSupply: await bVault1.totalSupply(),
            vaultMaxWithdraw: await bVault1.maxWithdraw(vault.address),
            vaultShares: await bVault1.maxRedeem(vault.address),
        },
    }
    return snap
}

const calculateVaultDataSwap = async (
    ctx: SameAssetUnderlyingsAbstractVaultBehaviourContext,
    swaps: Array<Swap>,
    vaultIndex: number,
    bVaultDataBefore: BasicVaultData,
) => {
    const { vault, sa } = ctx
    const bVaultAddress = await vault.resolveVaultIndex(vaultIndex)
    const bVault = Convex3CrvLiquidatorVault__factory.connect(bVaultAddress, sa.default.signer)

    const vaultAssetsDeposit = calculateAssetsDeposit(swaps, vaultIndex)
    const vaultAssetsWithdraw = calculateAssetsWithdraw(swaps, vaultIndex)
    let vaultSharesMint = calculateSharesMint(swaps, vaultIndex)
    let vaultSharesRedeem = calculateSharesRedeem(swaps, vaultIndex)

    vaultSharesMint = vaultSharesMint.add(await bVault.previewDeposit(vaultAssetsDeposit))
    vaultSharesRedeem = vaultSharesRedeem.add(await bVault.previewWithdraw(vaultAssetsWithdraw))

    const vaultSharesDelta = vaultSharesMint.sub(vaultSharesRedeem)
    let totalSupply = bVaultDataBefore.totalSupply.add(vaultSharesDelta)
    totalSupply = totalSupply.isNegative() ? BN.from(0) : totalSupply

    const totalAssets = await bVault.previewMint(totalSupply)

    const vaultShares = bVaultDataBefore.vaultShares.add(vaultSharesDelta)

    return { totalAssets, totalSupply, vaultShares }
}

async function expectRebalance(ctx: SameAssetUnderlyingsAbstractVaultBehaviourContext, swaps: Array<Swap>) {
    const { vault, sa, variances } = ctx
    const dataBefore = await snapVault(ctx)
    const expectedVault0Data = await calculateVaultDataSwap(ctx, swaps, 0, dataBefore.bVault0Data)
    const expectedVault1Data = await calculateVaultDataSwap(ctx, swaps, 1, dataBefore.bVault1Data)

    // Perform the rebalance
    await vault.connect(sa.vaultManager.signer).rebalance(swaps)

    const dataAfter = await snapVault(ctx)

    // vault total assets is not 100% accurate, totalSupply is the best guess
    assertBNClose(dataBefore.vaultData.totalAssets, dataAfter.vaultData.totalAssets, variances.totalAssets, "vault totalAssets")
    assertBNClose(dataBefore.vaultData.totalSupply, dataAfter.vaultData.totalSupply, variances.totalSupply, "vault totalSupply")
    // underlying vault 1 , state changes after re-balance
    assertBNClose(dataAfter.bVault0Data.totalAssets, expectedVault0Data.totalAssets, variances.bVault0, "underlying vault 0 totalAssets")
    assertBNClose(dataAfter.bVault0Data.totalSupply, expectedVault0Data.totalSupply, variances.bVault0, "underlying vault 0 totalSupply")
    assertBNClose(dataAfter.bVault0Data.vaultShares, expectedVault0Data.vaultShares, variances.bVault0, "underlying vault 0 vaultShares")

    assertBNClose(dataAfter.bVault1Data.totalAssets, expectedVault1Data.totalAssets, variances.bVault1, "underlying vault 1 totalAssets")
    assertBNClose(dataAfter.bVault1Data.totalSupply, expectedVault1Data.totalSupply, variances.bVault1, "underlying vault 1 totalSupply")
    assertBNClose(dataAfter.bVault1Data.vaultShares, expectedVault1Data.vaultShares, variances.bVault1, "underlying vault 1 vaultShares")
}

export function shouldBehaveLikeSameAssetUnderlyingsAbstractVault(ctx: () => SameAssetUnderlyingsAbstractVaultBehaviourContext): void {
    let alice: Account
    let bVault0: BasicVault
    let bVault1: BasicVault
    let mocks: ContractMocks

    before(async () => {
        const { fixture } = ctx()
        await loadOrExecFixture(fixture)
        const { vault, sa } = ctx()

        const underlyingVault0Address = await vault.resolveVaultIndex(0)
        const underlyingVault1Address = await vault.resolveVaultIndex(1)

        bVault0 = BasicVault__factory.connect(underlyingVault0Address, sa.default.signer)
        bVault1 = BasicVault__factory.connect(underlyingVault1Address, sa.default.signer)
        mocks = await new ContractMocks().init(sa)

        alice = sa.alice
        ctx().variances = { ...defaultVariances, ...ctx().variances }
    })
    describe("store values", async () => {
        it("should properly store valid arguments", async () => {
            const { vault } = ctx()
            expect(await vault.activeUnderlyingVaults(), "active underlying vaults").to.gt(0)
            expect(await vault.totalUnderlyingVaults(), "total underlying vaults").to.gt(0)
        })
    })
    describe("read only functions", async () => {
        before("initial deposits", async () => {
            const { vault, asset, amounts } = ctx()
            const assetsAmount = amounts.initialDeposit
            // initial deposit so all preview functions take into account liquidity
            if ((await asset.allowance(alice.address, vault.address)).lt(assetsAmount)) {
                await asset.connect(alice.signer).approve(vault.address, assetsAmount)
            }
            await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // simulate settlement to underlying vault
            const vaultSigner = await impersonate(vault.address, true)
            await bVault0.connect(vaultSigner).deposit(assetsAmount, vault.address)
            if (network.name == "anvil") {
                await stopImpersonate(vault.address)
            }
        })
        it("totalAssets", async () => {
            const { vault, asset, sa } = ctx()
            const activeUnderlyingVaults = (await vault.activeUnderlyingVaults()).toNumber()
            let expectedTotalAssets = await asset.balanceOf(vault.address)
            for (let i = 0; i < activeUnderlyingVaults; i++) {
                const uvAddress = await vault.resolveVaultIndex(i)
                const underlyingVault = AbstractVault__factory.connect(uvAddress, sa.default.signer)
                expectedTotalAssets = expectedTotalAssets.add(await underlyingVault.maxWithdraw(vault.address))
            }
            expect(expectedTotalAssets, "total assets").to.be.eq(await vault.totalAssets())
        })
    })
    describe("vault management", async () => {
        describe("rebalance", async () => {
            it("should fail if callee is not vaultManager", async () => {
                const { vault, sa } = ctx()
                const swap = {
                    fromVaultIndex: 0,
                    toVaultIndex: 0,
                    assets: 0,
                    shares: 0,
                }
                const tx = vault.connect(sa.alice.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Only vault manager can execute")
            })
            it("should fail on invalid fromVaultIndex", async () => {
                const { vault, sa } = ctx()
                const activeUnderlyingVaults = await vault.activeUnderlyingVaults()
                const swap = {
                    fromVaultIndex: activeUnderlyingVaults,
                    toVaultIndex: 0,
                    assets: 0,
                    shares: 0,
                }
                const tx = vault.connect(sa.vaultManager.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Inactive from vault")
            })
            it("should fail on invalid toVaultIndex", async () => {
                const { vault, sa } = ctx()
                const activeUnderlyingVaults = await vault.activeUnderlyingVaults()
                const swap = {
                    fromVaultIndex: 0,
                    toVaultIndex: activeUnderlyingVaults,
                    assets: 0,
                    shares: 0,
                }
                const tx = vault.connect(sa.vaultManager.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Inactive to vault")
            })
            context("using assets", async () => {
                it("100% from vault0 to vault1", async () => {
                    const dataBefore = await snapVault(ctx())
                    const fromVaultIndex = 0
                    const swap = {
                        fromVaultIndex,
                        toVaultIndex: 1,
                        assets: dataBefore[`bVault${fromVaultIndex}Data`].vaultMaxWithdraw,
                        shares: BN.from(0),
                    }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
                it("50% from vault1 to vault0", async () => {
                    const { vault, sa } = ctx()
                    const fromVaultIndex = 1
                    const fromUvAddress = await vault.resolveVaultIndex(fromVaultIndex)
                    const fromUnderlyingVault = AbstractVault__factory.connect(fromUvAddress, sa.default.signer)
                    const assets = await fromUnderlyingVault.maxWithdraw(vault.address)

                    const swap = { fromVaultIndex, toVaultIndex: 0, assets: assets.div(2), shares: BN.from(0) }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
            })
            context("using shares", async () => {
                it("100% from vault0 to vault1", async () => {
                    const dataBefore = await snapVault(ctx())
                    expect(dataBefore.bVault0Data.vaultShares, "bVault0 balance of vault").to.be.gt(0)

                    const swap = { fromVaultIndex: 0, toVaultIndex: 1, assets: BN.from(0), shares: dataBefore.bVault0Data.vaultShares }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
                it("50% from vault1 to vault0", async () => {
                    const dataBefore = await snapVault(ctx())
                    expect(dataBefore.bVault1Data.vaultShares, "bVault1 balance of vault").to.be.gt(0)

                    const swap = {
                        fromVaultIndex: 1,
                        toVaultIndex: 0,
                        assets: BN.from(0),
                        shares: dataBefore.bVault1Data.vaultShares.div(2),
                    }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
            })
            context("using assets and shares both", async () => {
                it("100% from vault0 to vault1", async () => {
                    const dataBefore = await snapVault(ctx())
                    expect(dataBefore.bVault0Data.vaultShares, "bVault0 balance of vault").to.be.gt(0)
                    const shares = dataBefore.bVault0Data.vaultShares.div(2)
                    const assets = dataBefore.bVault0Data.vaultMaxWithdraw.div(2)

                    const swap = { fromVaultIndex: 0, toVaultIndex: 1, assets: assets, shares: shares }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
                it("50% from vault1 to vault0", async () => {
                    const dataBefore = await snapVault(ctx())
                    expect(dataBefore.bVault1Data.vaultShares, "bVault1 balance of vault").to.be.gt(0)
                    const shares = dataBefore.bVault1Data.vaultShares.div(4)
                    const assets = await bVault1.previewMint(shares)

                    const swap = { fromVaultIndex: 1, toVaultIndex: 0, assets: assets, shares: shares }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
            })
        })
        describe("add vault", async () => {
            it("should fail if callee is not vault manger", async () => {
                const { vault, sa } = ctx()
                const tx = vault.connect(sa.alice.signer).addVault(DEAD_ADDRESS)
                await expect(tx).to.be.revertedWith("Only vault manager can execute")
            })
            it("should fail on mismatching asset", async () => {
                const { vault, sa } = ctx()

                const assetNew = mocks.dai
                const nexus = mocks.nexus
                const bVaultNew = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, assetNew.address)
                await bVaultNew.initialize(`bv3${await assetNew.name()}`, `bv3${await assetNew.symbol()}`, sa.vaultManager.address)

                const tx = vault.connect(sa.vaultManager.signer).addVault(bVaultNew.address)
                await expect(tx).to.be.revertedWith("Invalid vault asset")
            })
            context("success", async () => {
                let bVaultNew: BasicVault
                let activeUnderlyingVaultsBefore: number
                let totalUnderlyingVaultsBefore: number
                before(async () => {
                    const { vault, sa, asset } = ctx()
                    const nexus = mocks.nexus
                    activeUnderlyingVaultsBefore = (await vault.activeUnderlyingVaults()).toNumber()
                    totalUnderlyingVaultsBefore = (await vault.totalUnderlyingVaults()).toNumber()

                    console.log(`active vaults ${activeUnderlyingVaultsBefore}`)
                    console.log(`total vaults ${totalUnderlyingVaultsBefore}`)

                    bVaultNew = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
                    await bVaultNew.initialize(`bv3${await asset.name()}`, `bv3${await asset.symbol()}`, sa.vaultManager.address)

                    const tx = await vault.connect(sa.vaultManager.signer).addVault(bVaultNew.address)

                    await expect(tx).to.emit(vault, "AddedVault").withArgs(totalUnderlyingVaultsBefore, bVaultNew.address)
                    expect(await vault.activeUnderlyingVaults(), "active underlying vaults after").to.eq(activeUnderlyingVaultsBefore + 1)
                    expect(await vault.totalUnderlyingVaults(), "total underlying vaults after").to.eq(totalUnderlyingVaultsBefore + 1)
                })
                it("validate new vault", async () => {
                    const { vault } = ctx()

                    expect(await vault.activeUnderlyingVaults(), "active underlying vaults after").to.eq(activeUnderlyingVaultsBefore + 1)
                    expect(await vault.totalUnderlyingVaults(), "total underlying vaults after").to.eq(totalUnderlyingVaultsBefore + 1)
                })
                it("should be able to rebalance to newly added vault", async () => {
                    const { vault } = ctx()
                    const swap1 = {
                        fromVaultIndex: 0,
                        toVaultIndex: totalUnderlyingVaultsBefore,
                        assets: BN.from(0),
                        shares: await bVault0.maxRedeem(vault.address),
                    }
                    const swap2 = {
                        fromVaultIndex: 1,
                        toVaultIndex: totalUnderlyingVaultsBefore,
                        assets: BN.from(0),
                        shares: await bVault1.maxRedeem(vault.address),
                    }
                    const swaps = [swap1, swap2]
                    await expectRebalance(ctx(), swaps)
                })
                it("should be able to rebalance from newly added vault", async () => {
                    const { vault } = ctx()
                    const swap = {
                        fromVaultIndex: totalUnderlyingVaultsBefore,
                        toVaultIndex: 1,
                        assets: BN.from(0),
                        shares: await bVaultNew.balanceOf(vault.address),
                    }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)

                    expect(await bVaultNew.totalAssets(), "bVaultNew totalAssets").to.eq(0)
                    expect(await bVaultNew.totalSupply(), "bVaultNew totalSupply").to.eq(0)
                    expect(await bVaultNew.balanceOf(vault.address), "bv3 shares").to.eq(0)
                })
                it("should be able to independently deposit to new vault", async () => {
                    const { sa, asset } = ctx()
                    const totalAssetsBefore = await bVaultNew.totalAssets()
                    const totalSupplyBefore = await bVaultNew.totalSupply()
                    const balanceOfBefore = await bVaultNew.balanceOf(sa.alice.address)

                    const independentAmount = simpleToExactAmount(100, await asset.decimals())
                    await asset.connect(sa.alice.signer).approve(bVaultNew.address, ethers.constants.MaxUint256)
                    await bVaultNew.connect(sa.alice.signer).deposit(independentAmount, sa.alice.address)

                    expect(await bVaultNew.totalAssets(), "bVaultNew totalAssets").to.eq(totalAssetsBefore.add(independentAmount))
                    expect(await bVaultNew.totalSupply(), "bVaultNew totalSupply").to.eq(totalSupplyBefore.add(independentAmount))
                    expect(await bVaultNew.balanceOf(sa.alice.address), "bv3 user shares").to.eq(balanceOfBefore.add(independentAmount))
                })
            })
        })
        describe("remove vault", async () => {
            it("should fail if callee is not governor", async () => {
                const { vault, sa } = ctx()
                const tx = vault.connect(sa.alice.signer).removeVault(0)
                await expect(tx).to.be.revertedWith("Only governor can execute")
            })
            it("should fail if index is out of range", async () => {
                const { vault, sa } = ctx()
                const activeUnderlyingVaults = await vault.activeUnderlyingVaults()
                const tx = vault.connect(sa.governor.signer).removeVault(activeUnderlyingVaults)
                await expect(tx).to.be.revertedWith("Invalid from vault index")
            })
            context("success", async () => {
                let bVaultNew: BasicVault
                let activeUnderlyingVaultsBefore: number
                let totalUnderlyingVaultsBefore: number
                beforeEach(async () => {
                    const { asset, fixture, sa, vault } = ctx()
                    const nexus = mocks.nexus

                    await loadOrExecFixture(fixture)

                    bVaultNew = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
                    await bVaultNew.initialize(`bvNew${await asset.name()}`, `bvNew${await asset.symbol()}`, sa.vaultManager.address)

                    await vault.connect(sa.vaultManager.signer).addVault(bVaultNew.address)

                    activeUnderlyingVaultsBefore = (await vault.activeUnderlyingVaults()).toNumber()
                    totalUnderlyingVaultsBefore = (await vault.totalUnderlyingVaults()).toNumber()

                    expect(await vault.resolveVaultIndex(0), "#0 vault before").to.eq(bVault0.address)
                    expect(await vault.resolveVaultIndex(1), "#1 vault before").to.eq(bVault1.address)
                    expect(await vault.resolveVaultIndex(totalUnderlyingVaultsBefore - 1), "#2 vault before").to.eq(bVaultNew.address)
                })
                it("should be able to remove first vault with zero balance", async () => {
                    const { vault, sa } = ctx()

                    const tx = vault.connect(sa.governor.signer).removeVault(0)

                    await expect(tx).to.emit(vault, "RemovedVault").withArgs(0, bVault0.address)

                    await expect(vault.resolveVaultIndex(0), "#0 vault after").to.rejectedWith("Inactive vault")
                    expect(await vault.resolveVaultIndex(1), "#1 vault after").to.eq(bVault1.address)
                    expect(await vault.resolveVaultIndex(totalUnderlyingVaultsBefore - 1), "added vault after").to.eq(bVaultNew.address)

                    expect(await vault.activeUnderlyingVaults(), "# active vaults after").to.eq(activeUnderlyingVaultsBefore - 1)
                    expect(await vault.totalUnderlyingVaults(), "# total vaults after").to.eq(totalUnderlyingVaultsBefore)
                })
                it("should be able to remove second vault with zero balance", async () => {
                    const { vault, sa } = ctx()

                    const tx = vault.connect(sa.governor.signer).removeVault(1)

                    await expect(tx).to.emit(vault, "RemovedVault").withArgs(1, bVault1.address)

                    expect(await vault.resolveVaultIndex(0), "#0 vault after").to.eq(bVault0.address)
                    await expect(vault.resolveVaultIndex(1), "#1 vault after").to.rejectedWith("Inactive vault")
                    expect(await vault.resolveVaultIndex(totalUnderlyingVaultsBefore - 1), "added vault after").to.eq(bVaultNew.address)

                    expect(await vault.activeUnderlyingVaults(), "# active vaults after").to.eq(activeUnderlyingVaultsBefore - 1)
                    expect(await vault.totalUnderlyingVaults(), "# total vaults after").to.eq(totalUnderlyingVaultsBefore)
                })
                it("should be able to remove last vault with zero balance", async () => {
                    const { vault, sa } = ctx()

                    const tx = vault.connect(sa.governor.signer).removeVault(activeUnderlyingVaultsBefore - 1)

                    await expect(tx)
                        .to.emit(vault, "RemovedVault")
                        .withArgs(totalUnderlyingVaultsBefore - 1, bVaultNew.address)

                    expect(await vault.resolveVaultIndex(0), "#0 vault after").to.eq(bVault0.address)
                    expect(await vault.resolveVaultIndex(1), "#1 vault after").to.eq(bVault1.address)
                    await expect(vault.resolveVaultIndex(totalUnderlyingVaultsBefore - 1), "added vault after").to.rejectedWith(
                        "Inactive vault",
                    )

                    expect(await vault.activeUnderlyingVaults(), "# active vaults after").to.eq(activeUnderlyingVaultsBefore - 1)
                    expect(await vault.totalUnderlyingVaults(), "# total vaults after").to.eq(totalUnderlyingVaultsBefore)
                })
                it("should be able to remove first vault with balance", async () => {
                    const { amounts, asset, vault, sa, variances } = ctx()
                    const dataBefore = await snapVault(ctx())
                    const assetBalanceOfVaultBefore = await asset.balanceOf(vault.address)
                    if ((await asset.allowance(alice.address, vault.address)).lt(amounts.initialDeposit)) {
                        await asset.connect(alice.signer).approve(vault.address, amounts.initialDeposit)
                    }
                    await vault.connect(alice.signer)["deposit(uint256,address)"](amounts.initialDeposit, alice.address)
                    // simulate settlement to underlying vault
                    const vaultSigner = await impersonate(vault.address, true)
                    await bVault0.connect(vaultSigner).deposit(amounts.initialDeposit, vault.address)
                    if (network.name == "anvil") {
                        await stopImpersonate(vault.address)
                    }

                    const bVault0MaxWithdrawAfter = await bVault0.maxWithdraw(vault.address)
                    assertBNClose(
                        bVault0MaxWithdrawAfter,
                        dataBefore.bVault0Data.vaultMaxWithdraw.add(amounts.initialDeposit),
                        variances.bVault0,
                        "assets in underlying vault before",
                    )
                    expect(await asset.balanceOf(vault.address), "meta vault asset balance before").to.eq(0)

                    const tx = vault.connect(sa.governor.signer).removeVault(0)

                    const assetBalanceOfVaultAfter = await asset.balanceOf(vault.address)

                    await expect(tx).to.emit(vault, "RemovedVault").withArgs(0, bVault0.address)

                    await expect(vault.resolveVaultIndex(0), "#0 vault after").to.rejectedWith("Inactive vault")
                    expect(await vault.resolveVaultIndex(1), "#1 vault after").to.eq(bVault1.address)
                    expect(await vault.resolveVaultIndex(totalUnderlyingVaultsBefore - 1), "added vault after").to.eq(bVaultNew.address)

                    expect(await vault.activeUnderlyingVaults(), "# active vaults after").to.eq(activeUnderlyingVaultsBefore - 1)
                    expect(await vault.totalUnderlyingVaults(), "# total vaults after").to.eq(totalUnderlyingVaultsBefore)

                    expect(await bVault0.maxWithdraw(vault.address), "assets in underlying vault after").to.eq(0)

                    assertBNClose(
                        assetBalanceOfVaultAfter,
                        assetBalanceOfVaultBefore,
                        variances.totalAssets,
                        "meta vault asset balance after",
                    )
                })
            })
        })
    })
}

export default shouldBehaveLikeSameAssetUnderlyingsAbstractVault
