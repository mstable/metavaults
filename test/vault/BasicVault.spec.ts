import { ContractMocks, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicVault__factory } from "types/generated"

import { shouldBehaveLikeAbstractVault } from "../shared/AbstractVault.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "../shared/VaultManagerRole.behaviour"

import type { AbstractVault, BasicVault, MockERC20, MockNexus, VaultManagerRole } from "types/generated"

import type { AbstractVaultBehaviourContext } from "../shared/AbstractVault.behaviour"
describe("BasicVault", () => {
    /* -- Declare shared variables -- */
    let sa: StandardAccounts
    let mocks: ContractMocks
    let nexus: MockNexus
    let ctxVault: AbstractVaultBehaviourContext
    // Testing contract
    let vault: BasicVault
    let asset: MockERC20

    /* -- Declare shared functions -- */

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        mocks = await new ContractMocks().init(sa)
        nexus = mocks.nexus
        asset = mocks.erc20
        // Deploy test contract.
        vault = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        // Initialize test contract.
        await vault.initialize(`v${await asset.name()}`, `v${await asset.symbol()}`, sa.vaultManager.address)

        // set balance or users for the test.
        const assetBalance = await asset.balanceOf(sa.default.address)
        asset.transfer(sa.alice.address, assetBalance.div(2))
    }

    before("init contract", async () => {
        await setup()
        ctxVault = {
            vault: vault as unknown as AbstractVault,
            asset: asset,
            sa: sa,
            fixture: async () => {},
        }
    })
    describe("behaviors", async () => {
        shouldBehaveLikeVaultManagerRole(() => ({
            vaultManagerRole: vault as VaultManagerRole,
            sa,
        }))

        shouldBehaveLikeAbstractVault(() => ctxVault)
        /**
             it("should behave like Initializable ", async () => {
                     await shouldBehaveLikeInitializable(ctx)
                 })
                 it("should behave like VaultManagerRole ", async () => {
                    await shouldBehaveLikeVaultManagerRole(ctx)
                })
                 it("should behave like ImmutableModule ", async () => {
                    await shouldBehaveLikeImmutableModule(ctx)
                })
                 it("should behave like ModuleKeys ", async () => {
                    await shouldBehaveLikeModuleKeys(ctx)
                })
                 it("should behave like InitializableToken ", async () => {
                    await shouldBehaveLikeInitializableToken(ctx)
                })
                 it("should behave like InitializableTokenDetails ", async () => {
                    await shouldBehaveLikeInitializableTokenDetails(ctx)
                })
                 it("should behave like AbstractToken ", async () => {
                    await shouldBehaveLikeAbstractToken(ctx)
                })
    */
    })

    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "asset").to.eq(asset.address)
        })
    })

    describe("calling initialize", async () => {
        it("should default initializable values ", async () => {
            expect(await vault.name(), "name").to.eq(`v${await asset.name()}`)
            expect(await vault.symbol(), "symbol").to.eq(`v${await asset.symbol()}`)
            expect(await vault.decimals(), "decimals").to.eq(await asset.decimals())
            expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize(`v${await asset.name()}`, `v${await asset.symbol()}`, sa.vaultManager.address),
                "init call twice",
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
    describe("read only functions", async () => {
        it("totalAssets should vaults assets balance", async () => {
            // sets approval
            await asset.connect(sa.default.signer).approve(vault.address, ethers.constants.MaxUint256)

            const initialAssets = await vault.totalAssets()
            const assets = simpleToExactAmount(10, await asset.decimals())

            // Deposit assets in vault
            await vault.connect(sa.default.signer).deposit(assets, sa.default.address)
            expect(await vault.totalAssets(), "totalAssets should increase").to.eq(initialAssets.add(assets))

            // Withdraw assets from vault
            await vault.connect(sa.default.signer).withdraw(assets.div(2), sa.default.address, sa.default.address)
            expect(await vault.totalAssets(), "totalAssets should decrease").to.eq(initialAssets.add(assets).sub(assets.div(2)))
        })
    })
})
