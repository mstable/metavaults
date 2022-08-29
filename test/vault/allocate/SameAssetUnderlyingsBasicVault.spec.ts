import { shouldBehaveLikeModule } from "@test/shared/Module.behaviour"
import { shouldBehaveLikeToken } from "@test/shared/Token.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { MAX_UINT256 } from "@utils/constants"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicVault__factory, SameAssetUnderlyingsBasicVault__factory } from "types/generated"

import { impersonate } from "../../../test-utils/fork"

import type { TokenContext, TokenERC20 } from "@test/shared/Token.behaviour"
import type { BN } from "@utils/math"
import type { BigNumberish, ContractTransaction } from "ethers"
import type { Account } from "types"
import type { BasicVault, MockERC20, MockNexus, SameAssetUnderlyingsBasicVault, VaultManagerRole } from "types/generated"

interface VaultData {
    totalAssets: BN
    totalSupply: BN
    bVault1Shares: BN
    bVault2Shares: BN
    userShares: BN
}

interface BasicVaultData {
    totalAssets: BN
    totalSupply: BN
}

interface SnapVaultData {
    vaultData: VaultData
    bVault1Data: BasicVaultData
    bVault2Data: BasicVaultData
}

interface Balances {
    totalAssets: BigNumberish
    totalSupply: BigNumberish
    bVault1Shares: BigNumberish
    bVault2Shares: BigNumberish
    bv1TotalAssets: BigNumberish
    bv1TotalSupply: BigNumberish
    bv2TotalAssets: BigNumberish
    bv2TotalSupply: BigNumberish
}

const oneMil = simpleToExactAmount(1000000)

describe("SameAssetUnderlyingsBasicVault", async () => {
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
    let vault: SameAssetUnderlyingsBasicVault

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
        vault = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        // Initialize test contract.
        await vault.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, underlyingVaults)

        // transfer assets to users
        await asset.transfer(user.address, simpleToExactAmount(100000000))

        // asset approvals
        await asset.connect(vault.signer).approve(bVault1.address, ethers.constants.MaxUint256)
        await asset.connect(vault.signer).approve(bVault2.address, ethers.constants.MaxUint256)
        await asset.connect(user.signer).approve(vault.address, ethers.constants.MaxUint256)
    }

    const snapVault = async (): Promise<SnapVaultData> => {
        return {
            vaultData: {
                totalAssets: await vault.totalAssets(),
                totalSupply: await vault.totalSupply(),
                bVault1Shares: await bVault1.balanceOf(vault.address),
                bVault2Shares: await bVault2.balanceOf(vault.address),
                userShares: await vault.balanceOf(user.address),
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

    const assertVaultBalances = async (data: SnapVaultData, balances: Balances) => {
        expect(data.vaultData.totalAssets, "totalAssets").to.eq(balances.totalAssets)
        expect(data.vaultData.totalSupply, "totalSupply").to.eq(balances.totalSupply)
        expect(data.vaultData.bVault1Shares, "bVault1Shares").to.eq(balances.bVault1Shares)
        expect(data.vaultData.bVault2Shares, "bVault2Shares").to.eq(balances.bVault2Shares)

        expect(data.bVault1Data.totalAssets, "bv1 totalAssets").to.eq(balances.bv1TotalAssets)
        expect(data.bVault1Data.totalSupply, "bv1 totalSupply").to.eq(balances.bv1TotalSupply)

        expect(data.bVault2Data.totalAssets, "bv2 totalAssets").to.eq(balances.bv2TotalAssets)
        expect(data.bVault2Data.totalSupply, "bv2 totalSupply").to.eq(balances.bv2TotalSupply)
    }

    before("init contract", async () => {
        await setup()
    })
    describe("behaviors", async () => {
        it("should behave like ImmutableModule ", async () => {
            shouldBehaveLikeModule({ module: vault, sa })
        })
        it("should behave like VaultManagerRole", async () => {
            shouldBehaveLikeVaultManagerRole({ vaultManagerRole: vault as unknown as VaultManagerRole, sa })
        })
        describe("should behave like ERC20", async () => {
            const tokenContext: Partial<TokenContext> = {
                maxAmount: MAX_UINT256,
            }
            // As this tests has custom beforeEach behavior it needs to be wrapped by a test scope (context or describe)
            // To avoid NPE any setup configuration needs to be set within a before or beforeEach
            beforeEach(async () => {
                tokenContext.sender = sa.default
                tokenContext.spender = sa.alice
                tokenContext.recipient = sa.bob

                await asset.connect(sa.default.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(sa.default.signer).mint(simpleToExactAmount(100), sa.default.address)

                tokenContext.token = vault as unknown as TokenERC20
            })
            shouldBehaveLikeToken(tokenContext as TokenContext)
        })
    })
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "asset").to.eq(asset.address)
        })
    })
    describe("initialize", async () => {
        before("init contract", async () => {
            await setup()
        })
        it("should properly store valid arguments", async () => {
            // Basic vaults
            expect(await bVault1.symbol(), "bv1 symbol").to.eq("bv1ERC20")
            expect(await bVault2.symbol(), "bv2 symbol").to.eq("bv2ERC20")
            expect(await bVault1.name(), "bv1 name").to.eq("bv1ERC20 Mock")
            expect(await bVault2.name(), "bv2 name").to.eq("bv2ERC20 Mock")
            expect(await bVault1.decimals(), "bv1 decimals").to.eq(await asset.decimals())
            expect(await bVault2.decimals(), "bv2 decimals").to.eq(await asset.decimals())

            // saub Vault
            expect(await vault.symbol(), "saub symbol").to.eq("saubERC20")
            expect(await vault.name(), "saub name").to.eq("saubERC20 Mock")
            expect(await vault.decimals(), "saub decimals").to.eq(18)

            expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)
            expect(await vault.totalSupply(), "totalSupply").to.eq(0)
            expect(await vault.totalAssets(), "totalAssets").to.eq(0)

            expect(await vault.underlyingVaults(0)).to.eq(bVault1.address)
            expect(await vault.underlyingVaults(1)).to.eq(bVault2.address)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, underlyingVaults),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
        it("fails if initialize is called with no underlying vaults", async () => {
            // Deploy test contract.
            let vaultTemp = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            // Initialize test contract.
            await expect(
                vaultTemp.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, [])
            ).to.be.revertedWith("No underlying vaults")
        })
    })
    describe("Vault operations", async () => {
        before("init contract", async () => {
            await setup()
        })

        const initialDepositAmount = oneMil.mul(10)

        describe("rebalance", async () => {
            before(async () => {
                await vault.connect(user.signer).deposit(initialDepositAmount, user.address)
                const vaultSigner = await impersonate(vault.address, true)
                await bVault1.connect(vaultSigner).deposit(initialDepositAmount, vault.address)
            })
            it("should fail if callee is not vaultManager", async () => {
                const swap = {
                    fromVaultIndex: 3,
                    toVaultIndex: 0,
                    assets: oneMil,
                    shares: 0,
                }
                const tx = vault.connect(user.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Only vault manager can execute")
            })
            it("should fail on invalid fromVaultIndex", async () => {
                const swap = {
                    fromVaultIndex: 3,
                    toVaultIndex: 0,
                    assets: oneMil,
                    shares: 0,
                }
                const tx = vault.connect(sa.vaultManager.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Invalid from vault index")
            })
            it("should fail on invalid toVaultIndex", async () => {
                const swap = {
                    fromVaultIndex: 0,
                    toVaultIndex: 3,
                    assets: oneMil,
                    shares: 0,
                }
                const tx = vault.connect(sa.vaultManager.signer).rebalance([swap])
                await expect(tx).to.be.revertedWith("Invalid to vault index")
            })
            it("initial vault state have correct params", async () => {
                const data = await snapVault()

                const balances = {
                    totalAssets: initialDepositAmount,
                    totalSupply: initialDepositAmount,
                    bVault1Shares: initialDepositAmount,
                    bVault2Shares: 0,
                    bv1TotalAssets: initialDepositAmount,
                    bv1TotalSupply: initialDepositAmount,
                    bv2TotalAssets: 0,
                    bv2TotalSupply: 0,
                }
                await assertVaultBalances(data, balances)
                expect(data.vaultData.userShares, "userShares").to.eq(initialDepositAmount)
            })
            context("using assets", async () => {
                it("100% from vault1 to vault2", async () => {
                    const swap = {
                        fromVaultIndex: 0,
                        toVaultIndex: 1,
                        assets: initialDepositAmount,
                        shares: 0,
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: 0,
                        bVault2Shares: initialDepositAmount,
                        bv1TotalAssets: 0,
                        bv1TotalSupply: 0,
                        bv2TotalAssets: initialDepositAmount,
                        bv2TotalSupply: initialDepositAmount,
                    }
                    await assertVaultBalances(data, balances)
                })
                it("50% from vault2 to vault1", async () => {
                    const transferAmount = initialDepositAmount.div(2)
                    const swap = {
                        fromVaultIndex: 1,
                        toVaultIndex: 0,
                        assets: transferAmount,
                        shares: 0,
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: transferAmount,
                        bVault2Shares: initialDepositAmount.sub(transferAmount),
                        bv1TotalAssets: transferAmount,
                        bv1TotalSupply: transferAmount,
                        bv2TotalAssets: initialDepositAmount.sub(transferAmount),
                        bv2TotalSupply: initialDepositAmount.sub(transferAmount),
                    }
                    await assertVaultBalances(data, balances)
                })
            })
            context("using shares", async () => {
                it("100% from vault1 to vault2", async () => {
                    const swap = {
                        fromVaultIndex: 0,
                        toVaultIndex: 1,
                        assets: 0,
                        shares: await bVault1.balanceOf(vault.address),
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: 0,
                        bVault2Shares: initialDepositAmount,
                        bv1TotalAssets: 0,
                        bv1TotalSupply: 0,
                        bv2TotalAssets: initialDepositAmount,
                        bv2TotalSupply: initialDepositAmount,
                    }
                    await assertVaultBalances(data, balances)
                })
                it("50% from vault2 to vault1", async () => {
                    const transferAmount = (await bVault2.balanceOf(vault.address)).div(2)
                    const swap = {
                        fromVaultIndex: 1,
                        toVaultIndex: 0,
                        assets: 0,
                        shares: transferAmount,
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: transferAmount,
                        bVault2Shares: initialDepositAmount.sub(transferAmount),
                        bv1TotalAssets: transferAmount,
                        bv1TotalSupply: transferAmount,
                        bv2TotalAssets: initialDepositAmount.sub(transferAmount),
                        bv2TotalSupply: initialDepositAmount.sub(transferAmount),
                    }
                    await assertVaultBalances(data, balances)
                })
            })
            context("using assets and shares both", async () => {
                it("100% from vault1 to vault2", async () => {
                    const transferAmount = (await bVault1.balanceOf(vault.address)).div(2)
                    const swap = {
                        fromVaultIndex: 0,
                        toVaultIndex: 1,
                        assets: transferAmount,
                        shares: transferAmount,
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: 0,
                        bVault2Shares: initialDepositAmount,
                        bv1TotalAssets: 0,
                        bv1TotalSupply: 0,
                        bv2TotalAssets: initialDepositAmount,
                        bv2TotalSupply: initialDepositAmount,
                    }
                    await assertVaultBalances(data, balances)
                })
                it("50% vault2 to vault1", async () => {
                    const transferAmount = (await bVault2.balanceOf(vault.address)).div(4)
                    const swap = {
                        fromVaultIndex: 1,
                        toVaultIndex: 0,
                        assets: transferAmount,
                        shares: transferAmount,
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: transferAmount.mul(2),
                        bVault2Shares: transferAmount.mul(2),
                        bv1TotalAssets: transferAmount.mul(2),
                        bv1TotalSupply: transferAmount.mul(2),
                        bv2TotalAssets: transferAmount.mul(2),
                        bv2TotalSupply: transferAmount.mul(2),
                    }
                    await assertVaultBalances(data, balances)
                })
            })
        })
        describe("add vault", async () => {
            it("should fail if callee is not vault manger", async () => {
                const assetNew = mocks.dai
                const bVault3 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
                await bVault3.initialize(`bv3${await asset.name()}`, `bv3${await assetNew.symbol()}`, sa.vaultManager.address)

                const tx = vault.addVault(bVault3.address)
                await expect(tx).to.be.revertedWith("Only vault manager can execute")
            })
            it("should fail on mismatching asset", async () => {
                const assetNew = mocks.dai
                const bVault3 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, assetNew.address)
                await bVault3.initialize(`bv3${await assetNew.name()}`, `bv3${await assetNew.symbol()}`, sa.vaultManager.address)

                const tx = vault.connect(sa.vaultManager.signer).addVault(bVault3.address)
                await expect(tx).to.be.revertedWith("Invalid vault asset")
            })
            context("success", async () => {
                let tx: Promise<ContractTransaction>
                let bVault3: BasicVault
                before(async () => {
                    bVault3 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
                    await bVault3.initialize(`bv3${await asset.name()}`, `bv3${await asset.symbol()}`, sa.vaultManager.address)

                    tx = vault.connect(sa.vaultManager.signer).addVault(bVault3.address)
                })
                it("should emit AddedVault event", async () => {
                    await expect(tx).to.emit(vault, "AddedVault").withArgs(2, bVault3.address)
                })
                it("should be able to rebalance to newly added vault", async () => {
                    const swap1 = {
                        fromVaultIndex: 0,
                        toVaultIndex: 2,
                        assets: 0,
                        shares: await bVault1.balanceOf(vault.address),
                    }
                    const swap2 = {
                        fromVaultIndex: 1,
                        toVaultIndex: 2,
                        assets: 0,
                        shares: await bVault2.balanceOf(vault.address),
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap1, swap2])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: 0,
                        bVault2Shares: 0,
                        bv1TotalAssets: 0,
                        bv1TotalSupply: 0,
                        bv2TotalAssets: 0,
                        bv2TotalSupply: 0,
                    }
                    await assertVaultBalances(data, balances)
                    expect(await bVault3.totalAssets(), "bVault3 totalAssets").to.eq(initialDepositAmount)
                    expect(await bVault3.totalSupply(), "bVault3 totalSupply").to.eq(initialDepositAmount)
                    expect(await bVault3.balanceOf(vault.address), "bv3 shares").to.eq(initialDepositAmount)
                })
                it("should be able to rebalance from newly added vault", async () => {
                    const swap = {
                        fromVaultIndex: 2,
                        toVaultIndex: 1,
                        assets: 0,
                        shares: await bVault3.balanceOf(vault.address),
                    }
                    await vault.connect(sa.vaultManager.signer).rebalance([swap])
                    const data = await snapVault()

                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: 0,
                        bVault2Shares: initialDepositAmount,
                        bv1TotalAssets: 0,
                        bv1TotalSupply: 0,
                        bv2TotalAssets: initialDepositAmount,
                        bv2TotalSupply: initialDepositAmount,
                    }
                    await assertVaultBalances(data, balances)
                    expect(await bVault3.totalAssets(), "bVault3 totalAssets").to.eq(0)
                    expect(await bVault3.totalSupply(), "bVault3 totalSupply").to.eq(0)
                    expect(await bVault3.balanceOf(vault.address), "bv3 shares").to.eq(0)
                })
                it("should be able to independently deposit to new vault", async () => {
                    const independentAmount = oneMil
                    await asset.connect(user.signer).approve(bVault3.address, ethers.constants.MaxUint256)
                    await bVault3.connect(user.signer).deposit(independentAmount, user.address)

                    const data = await snapVault()
                    const balances = {
                        totalAssets: initialDepositAmount,
                        totalSupply: initialDepositAmount,
                        bVault1Shares: 0,
                        bVault2Shares: initialDepositAmount,
                        bv1TotalAssets: 0,
                        bv1TotalSupply: 0,
                        bv2TotalAssets: initialDepositAmount,
                        bv2TotalSupply: initialDepositAmount,
                    }
                    await assertVaultBalances(data, balances)
                    expect(await bVault3.totalAssets(), "bVault3 totalAssets").to.eq(independentAmount)
                    expect(await bVault3.totalSupply(), "bVault3 totalSupply").to.eq(independentAmount)
                    expect(await bVault3.balanceOf(user.address), "bv3 user shares").to.eq(independentAmount)
                })
            })
        })
    })
})
