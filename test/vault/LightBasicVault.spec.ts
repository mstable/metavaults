import { ContractMocks, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { ZERO_ADDRESS } from "@utils/constants"
import { expect } from "chai"
import { ethers } from "hardhat"
import { LightBasicVault__factory, BasicVault__factory } from "types/generated"

import { shouldBehaveLikeAbstractVault } from "../shared/AbstractVault.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "../shared/VaultManagerRole.behaviour"

import type { LightAbstractVault, LightBasicVault, BasicVault, AbstractVault, MockERC20, MockNexus, VaultManagerRole } from "types/generated";

import type { AbstractVaultBehaviourContext } from "../shared/AbstractVault.behaviour";

export type BaseVault = LightBasicVault | BasicVault

const BASIC_VAULT = "BasicVault"
const LIGHT_BASIC_VAULT = "LightBasicVault"

const testVault = async (vaultType: String) => {
    describe(`${vaultType}`, () => {
        /* -- Declare shared variables -- */
        let sa: StandardAccounts
        let mocks: ContractMocks
        let nexus: MockNexus
        let ctxVault: AbstractVaultBehaviourContext
        // Testing contract
        let vault: BaseVault
        let asset: MockERC20

        /* -- Declare shared functions -- */

        const setup = async () => {
            const accounts = await ethers.getSigners()
            sa = await new StandardAccounts().initAccounts(accounts)
            mocks = await new ContractMocks().init(sa)
            nexus = mocks.nexus
            asset = mocks.erc20
            // Deploy test contract.
            if (vaultType == LIGHT_BASIC_VAULT) {
                vault = await new LightBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            } else {
                vault = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            }
            // Initialize test contract.
            await vault.initialize(`v${await asset.name()}`, `v${await asset.symbol()}`, sa.vaultManager.address)
        }

        before("init contract", async () => {
            await setup()
        })
        describe("behaviors", async () => {
            it("should behave like VaultManagerRole ", async () => {
                shouldBehaveLikeVaultManagerRole({
                    vaultManagerRole: vault as unknown as VaultManagerRole,
                    sa: sa,
                })
            })
            if (vaultType == LIGHT_BASIC_VAULT) {
                it("should behave like LightAbstractVault ", async () => {
                    ctxVault = {
                        vault: vault as unknown as LightAbstractVault,
                        asset: asset,
                        sa: sa,
                    }
                    shouldBehaveLikeAbstractVault(ctxVault)
                })
            } else {
                it("should behave like AbstractVault ", async () => {
                    ctxVault = {
                        vault: vault as unknown as AbstractVault,
                        asset: asset,
                        sa: sa,
                    }
                    shouldBehaveLikeAbstractVault(ctxVault)
                })
            }
        })

        describe("constructor", async () => {
            it("should properly store valid arguments", async () => {
                expect(await vault.nexus(), "nexus").to.eq(nexus.address)
                expect(await vault.asset(), "asset").to.eq(asset.address)
            })
            it("should fail if asset has zero address", async () => {
                let tx: Promise<BaseVault>
                if (vaultType == LIGHT_BASIC_VAULT) {
                    tx = new LightBasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS)
                } else {
                    tx = new BasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS)
                }
                await expect(tx).to.be.revertedWith("Asset is zero")
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
}

describe("Base Vaults", async () => {
    await testVault(BASIC_VAULT)
    await testVault(LIGHT_BASIC_VAULT)
})
