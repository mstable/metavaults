import { assertBNClosePercent } from "@utils/assertions"
import { DEAD_ADDRESS } from "@utils/constants"
import { impersonate, loadOrExecFixture } from "@utils/fork"
import { ContractMocks } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "ethers"
import { AbstractVault__factory, BasicVault__factory } from "types/generated"

import type { StandardAccounts } from "@utils/machines"
import type { Account } from "types"
import type { BasicVault, ERC20, IERC20Metadata, SameAssetUnderlyingsAbstractVault } from "types/generated"

type Variance = number | string
type Variances = {
    rebalance?: Variance
    rebalancebVault0?: Variance
    rebalancebVault1?: Variance
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
    rebalance: 0,
    rebalancebVault0: 0,
    rebalancebVault1: 0,
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
const calculateSharesRedeemTo = (swaps: Array<Swap>, vaultIndex: number) =>
    swaps
        .filter((s) => s.toVaultIndex === vaultIndex)
        .map((s) => s.shares)
        .reduce(sumBN, BN.from(0))

const snapVault = async (ctx: SameAssetUnderlyingsAbstractVaultBehaviourContext): Promise<SnapVaultData> => {
    const { vault, sa } = ctx
    const underlyingVault0Address = await vault.underlyingVaults(0)
    const underlyingVault1Address = await vault.underlyingVaults(1)

    const bVault0: BasicVault = BasicVault__factory.connect(underlyingVault0Address, sa.default.signer)
    const bVault1: BasicVault = BasicVault__factory.connect(underlyingVault1Address, sa.default.signer)

    const snap = {
        vaultData: {
            totalAssets: await vault.totalAssets(),
            totalSupply: await vault.totalSupply(),
            aliceShares: await vault.balanceOf(sa.alice.address),
            bobShares: await vault.balanceOf(sa.bob.address),
        },
        bVault0Data: {
            totalAssets: await bVault0.totalAssets(),
            totalSupply: await bVault0.totalSupply(),
            vaultMaxWithdraw: await bVault0.maxWithdraw(vault.address),
            vaultShares: await bVault0.balanceOf(vault.address),
        },
        bVault1Data: {
            totalAssets: await bVault1.totalAssets(),
            totalSupply: await bVault1.totalSupply(),
            vaultMaxWithdraw: await bVault1.maxWithdraw(vault.address),
            vaultShares: await bVault1.balanceOf(vault.address),
        },
    }
    if (snap.bVault0Data.totalAssets.lt(snap.bVault0Data.vaultMaxWithdraw)) {
        // TODO  - temporary fix totalAssets should never be lt vaultMaxWithdraw
        console.log(
            `== warning: bVault0Data totalAssets ${snap.bVault0Data.totalAssets.toString()}, vaultMaxWithdraw ${snap.bVault0Data.vaultMaxWithdraw.toString()}, diff ${snap.bVault0Data.vaultMaxWithdraw
                .sub(snap.bVault0Data.totalAssets)
                .toString()} `,
        )
        snap.bVault0Data.vaultMaxWithdraw = snap.bVault0Data.totalAssets
    }
    if (snap.bVault1Data.totalAssets.lt(snap.bVault1Data.vaultMaxWithdraw)) {
        // TODO  - temporary fix totalAssets should never be lt vaultMaxWithdraw
        console.log(
            `== warning: bVault1Data totalAssets ${snap.bVault1Data.totalAssets.toString()}, vaultMaxWithdraw ${snap.bVault1Data.vaultMaxWithdraw.toString()}, diff ${snap.bVault1Data.vaultMaxWithdraw
                .sub(snap.bVault1Data.totalAssets)
                .toString()} `,
        )
        // temporary fix
        snap.bVault1Data.vaultMaxWithdraw = snap.bVault1Data.totalAssets
    }
    if (snap.bVault0Data.totalSupply.lt(snap.bVault0Data.vaultShares)) {
        console.log(
            `== warning: bVault0Data totalSupply ${snap.bVault0Data.totalSupply.toString()}, vaultShares ${snap.bVault0Data.vaultShares.toString()}, diff ${snap.bVault0Data.vaultShares
                .sub(snap.bVault0Data.totalSupply)
                .toString()} `,
        )
    }
    if (snap.bVault1Data.totalSupply.lt(snap.bVault1Data.vaultShares)) {
        console.log(
            `== warning: bVault1Data totalSupply ${snap.bVault1Data.totalSupply.toString()}, vaultShares ${snap.bVault1Data.vaultShares.toString()}, diff ${snap.bVault1Data.vaultShares
                .sub(snap.bVault1Data.totalSupply)
                .toString()} `,
        )
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
    const bVaultAddress = await vault.underlyingVaults(vaultIndex)
    const bVault = BasicVault__factory.connect(bVaultAddress, sa.default.signer)

    let vaultAssetsDeposit = calculateAssetsDeposit(swaps, vaultIndex)
    let vaultAssetsWithdraw = calculateAssetsWithdraw(swaps, vaultIndex)
    const vaultSharesRedeem = calculateSharesRedeem(swaps, vaultIndex)
    const vaultSharesRedeemTo = calculateSharesRedeemTo(swaps, vaultIndex)
    // console.log(`🚀 ~ calculateVaultDataSwap ~ vaultAssetsDeposit ${vaultAssetsDeposit.toString()}, vaultAssetsWithdraw ${vaultAssetsWithdraw.toString()},
    // vaultSharesRedeem ${vaultSharesRedeem.toString()}, vaultSharesRedeemTo ${vaultSharesRedeemTo.toString()}`)

    // underlying vault  , state changes after re-balance
    vaultAssetsDeposit = vaultAssetsDeposit.add(await bVault.previewMint(vaultSharesRedeemTo))
    vaultAssetsWithdraw = vaultAssetsWithdraw.add(await bVault.previewRedeem(vaultSharesRedeem))

    // TODO - temporary fix , there might be an error with previewRedeem as it is the same used by maxWithdraw
    if (vaultAssetsWithdraw.gt(bVaultDataBefore.totalAssets)) {
        console.log(`🚀 ~ calculateVaultDataSwap ~ vaultAssetsDeposit ${vaultAssetsDeposit.toString()}, vaultAssetsWithdraw ${vaultAssetsWithdraw.toString()}, 
    bVaultDataBefore.totalAssets ${bVaultDataBefore.totalAssets.toString()}`)
        vaultAssetsWithdraw = bVaultDataBefore.totalAssets
    }

    const totalAssets = bVaultDataBefore.totalAssets.sub(vaultAssetsWithdraw).add(vaultAssetsDeposit)
    const totalSupply = await bVault.convertToShares(totalAssets)
    const vaultSharesDelta = vaultAssetsDeposit.sub(vaultAssetsWithdraw)
    const vaultShares = bVaultDataBefore.vaultShares.add(
        (await bVault.convertToShares(vaultSharesDelta.abs())).mul(vaultSharesDelta.isNegative() ? -1 : 1),
    )

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

    // vault total assets might change a little
    assertBNClosePercent(dataBefore.vaultData.totalAssets, dataAfter.vaultData.totalAssets, variances.rebalance, "vault totalAssets")
    assertBNClosePercent(dataBefore.vaultData.totalSupply, dataAfter.vaultData.totalSupply, variances.rebalance, "vault totalSupply")

    // underlying vault 1 , state changes after re-balance
    assertBNClosePercent(
        dataAfter.bVault0Data.totalAssets,
        expectedVault0Data.totalAssets,
        variances.rebalancebVault0,
        "underlying vault 0 totalAssets",
    )
    assertBNClosePercent(
        dataAfter.bVault0Data.totalSupply,
        expectedVault0Data.totalSupply,
        variances.rebalancebVault0,
        "underlying vault 0 totalSupply",
    )
    assertBNClosePercent(
        dataAfter.bVault0Data.vaultShares,
        expectedVault0Data.vaultShares,
        variances.rebalancebVault0,
        "underlying vault 0 balanceOf",
    )

    // underlying vault 2 , state changes after re-balance
    assertBNClosePercent(
        dataAfter.bVault1Data.totalAssets,
        expectedVault1Data.totalAssets,
        variances.rebalancebVault1,
        "underlying vault 1 totalAssets",
    )
    assertBNClosePercent(
        dataAfter.bVault1Data.totalSupply,
        expectedVault1Data.totalSupply,
        variances.rebalancebVault1,
        "underlying vault 1 totalSupply",
    )
    assertBNClosePercent(
        dataAfter.bVault1Data.vaultShares,
        expectedVault1Data.vaultShares,
        variances.rebalancebVault1,
        "underlying vault 1 balanceOf",
    )

    expect(dataBefore.vaultData.aliceShares, "alice shares should not change").to.eq(dataAfter.vaultData.aliceShares)
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

        const underlyingVault0Address = await vault.underlyingVaults(0)
        const underlyingVault1Address = await vault.underlyingVaults(1)

        bVault0 = BasicVault__factory.connect(underlyingVault0Address, sa.default.signer)
        bVault1 = BasicVault__factory.connect(underlyingVault1Address, sa.default.signer)
        mocks = await new ContractMocks().init(sa)
    })
    beforeEach("init", async () => {
        const { sa } = ctx()
        alice = sa.alice
        ctx().variances = { ...defaultVariances, ...ctx().variances }
    })
    describe("store values", async () => {
        it("should properly store valid arguments", async () => {
            const { vault } = ctx()
            expect(await vault.underlyingVaultsLength(), "underlying vaults length").to.gt(0)
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
            await await vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // simulate settlement to underlying vault
            const vaultSigner = await impersonate(vault.address, true)

            await bVault0.connect(vaultSigner).deposit(assetsAmount, vault.address)
        })
        it("totalAssets", async () => {
            const { vault, asset, sa } = ctx()
            const underlyingVaultsLen = (await vault.underlyingVaultsLength()).toNumber()
            let expectedTotalAssets = await asset.balanceOf(vault.address)
            for (let i = 0; i < underlyingVaultsLen; i++) {
                const uvAddress = await vault.underlyingVaults(i)
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
                const underlyingVaultsLen = await vault.underlyingVaultsLength()
                const swap = {
                    fromVaultIndex: underlyingVaultsLen,
                    toVaultIndex: 0,
                    assets: 0,
                    shares: 0,
                }
                const tx = vault.connect(sa.vaultManager.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Invalid from vault index")
            })
            it("should fail on invalid toVaultIndex", async () => {
                const { vault, sa } = ctx()
                const underlyingVaultsLen = await vault.underlyingVaultsLength()
                const swap = {
                    fromVaultIndex: 0,
                    toVaultIndex: underlyingVaultsLen,
                    assets: 0,
                    shares: 0,
                }
                const tx = vault.connect(sa.vaultManager.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Invalid to vault index")
            })
            context("using assets", async () => {
                it("100% from vault0 to vault1", async () => {
                    // const { vault, sa } = ctx()
                    const dataBefore = await snapVault(ctx())
                    const fromVaultIndex = 0
                    // TODO - WARNING - maxWithdraw should do the job but it is not
                    const swap = { fromVaultIndex, toVaultIndex: 1, assets: dataBefore.bVault0Data.vaultMaxWithdraw, shares: BN.from(0) }
                    const swaps = [swap]
                    await expectRebalance(ctx(), swaps)
                })
                it("50% from vault1 to vault0", async () => {
                    const { vault, sa } = ctx()
                    const fromVaultIndex = 1
                    const fromUvAddress = await vault.underlyingVaults(fromVaultIndex)
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
                    // TODO - WARNING - not working as expected
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
                let bVaultNewIndex: number
                before(async () => {
                    const { vault, sa, asset } = ctx()
                    const nexus = mocks.nexus
                    bVaultNewIndex = (await vault.underlyingVaultsLength()).toNumber()
                    console.log(
                        "🚀 ~ file: SameAssetUnderlyingsAbstractVault.behaviour.ts ~ line 360 ~ before ~ bVaultNewIndex",
                        bVaultNewIndex,
                    )
                    bVaultNew = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
                    await bVaultNew.initialize(`bv3${await asset.name()}`, `bv3${await asset.symbol()}`, sa.vaultManager.address)

                    const tx = vault.connect(sa.vaultManager.signer).addVault(bVaultNew.address)
                    await expect(tx).to.emit(vault, "AddedVault").withArgs(bVaultNewIndex, bVaultNew.address)
                })
                it("should be able to rebalance to newly added vault", async () => {
                    const { vault } = ctx()
                    const swap1 = {
                        fromVaultIndex: 0,
                        toVaultIndex: bVaultNewIndex,
                        assets: BN.from(0),
                        shares: (await bVault0.balanceOf(vault.address)).mul(90).div(100),
                    }
                    const swap2 = {
                        fromVaultIndex: 1,
                        toVaultIndex: bVaultNewIndex,
                        assets: BN.from(0),
                        shares: (await bVault1.balanceOf(vault.address)).mul(90).div(100),
                    }
                    const swaps = [swap1, swap2]
                    // await vault.connect(sa.vaultManager.signer).rebalance(swaps)
                    await expectRebalance(ctx(), swaps)

                    // expect(await bVaultNew.totalAssets(), "bVaultNew totalAssets").to.eq(await vault.totalAssets())
                    // expect(await bVaultNew.totalSupply(), "bVaultNew totalSupply").to.eq(await bVaultNew.balanceOf(vault.address))
                })
                it("should be able to rebalance from newly added vault", async () => {
                    const { vault } = ctx()
                    const swap = {
                        fromVaultIndex: bVaultNewIndex,
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
    })
}

export default shouldBehaveLikeSameAssetUnderlyingsAbstractVault
