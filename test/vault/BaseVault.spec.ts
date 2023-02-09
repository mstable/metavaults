import { ZERO_ADDRESS } from "@utils/constants"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import {simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicVault__factory, LightBasicVault__factory } from "types/generated"

import { shouldBehaveLikeBaseVault, testAmounts } from "../shared/BaseVault.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "../shared/VaultManagerRole.behaviour"

import type { BN} from "@utils/math";
import type { ContractFactory, Signer } from "ethers/lib/ethers"
import type { BasicVault, LightBasicVault, MockERC20, MockNexus, VaultManagerRole } from "types/generated"

import type { BaseVaultBehaviourContext } from "../shared/BaseVault.behaviour"

export type BaseVault = LightBasicVault | BasicVault

const defaultAssetToBurn = simpleToExactAmount(0)

const testVault = async <F extends ContractFactory, V extends BaseVault>(factory: { new (signer: Signer): F }) => {
    describe(factory.name, () => {
        /* -- Declare shared variables -- */
        let sa: StandardAccounts
        let mocks: ContractMocks
        let nexus: MockNexus
        let assetToBurn: BN

        // Testing contract
        let vault: BaseVault
        let asset: MockERC20

        /* -- Declare shared functions -- */
        const setup = async () => {
            const accounts = await ethers.getSigners()
            sa = await new StandardAccounts().initAccounts(accounts)
            assetToBurn = assetToBurn ?? defaultAssetToBurn

            mocks = await new ContractMocks().init(sa)
            nexus = mocks.nexus
            asset = mocks.erc20
            // Deploy test contract.
            vault = (await new factory(sa.default.signer).deploy(nexus.address, asset.address)) as V
            await asset.connect(sa.default.signer).approve(vault.address, ethers.constants.MaxUint256)
            // Initialize test contract.
            await vault.initialize(`v${await asset.name()}`, `v${await asset.symbol()}`, sa.vaultManager.address, assetToBurn)
            // set balance or users for the test.
            const assetBalance = await asset.balanceOf(sa.default.address)
            asset.transfer(sa.alice.address, assetBalance.div(2))
        }

        before("init contract", async () => {
            await setup()
        })
        describe("behaviors", async () => {
            const ctx: Partial<BaseVaultBehaviourContext> = {}
            before("init contract", async () => {
                ctx.fixture = async function fixture() {
                    await setup()
                    ctx.vault = vault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(100, await vault.decimals())
                    ctx.dataEmitter = mocks.dataEmitter
                }
            })
            shouldBehaveLikeVaultManagerRole(() => ({ vaultManagerRole: vault as VaultManagerRole, sa }))
            shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
        })

        describe("constructor", async () => {
            it("should properly store valid arguments", async () => {
                expect(await vault.nexus(), "nexus").to.eq(nexus.address)
                expect(await vault.asset(), "asset").to.eq(asset.address)
            })
            it("should fail if asset has zero address", async () => {
                const tx = new factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS)
                await expect(tx).to.be.revertedWith("Asset is zero")
            })
            it("should fail if nexus has zero address", async () => {
                await expect(new factory(sa.default.signer).deploy(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith("Nexus address is zero")
            })
        })

        describe("calling initialize", async () => {
            before(async () => {
                assetToBurn = simpleToExactAmount(10 , await asset.decimals())
                await setup()
            })
            after(async () => {
                assetToBurn = defaultAssetToBurn
            })
            it("should default initializable values ", async () => {
                expect(assetToBurn, "assetToBurn").to.gt(0)

                expect(await vault.name(), "name").to.eq(`v${await asset.name()}`)
                expect(await vault.symbol(), "symbol").to.eq(`v${await asset.symbol()}`)
                expect(await vault.decimals(), "decimals").to.eq(await asset.decimals())
                expect(await vault.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)

                //locked shares
                expect((await vault.balanceOf(vault.address)), "locked shares").to.eq(assetToBurn)
            })
            it("fails if initialize is called more than once", async () => {
                await expect(
                    vault.initialize(`v${await asset.name()}`, `v${await asset.symbol()}`, sa.vaultManager.address, assetToBurn),
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
            it("conversions with totalShares = 0", async () => {
                await setup()
                expect(await vault.totalSupply(), "totalSupply").to.eq(0)
                const testAmount = simpleToExactAmount(100)
                expect(await vault.convertToAssets(testAmount), "convertToAssets").to.eq(testAmount)
                expect(await vault.convertToShares(testAmount), "convertToShares").to.eq(testAmount)
            })
        })
        describe("mint and withdraw should round up", async () => {
            before(async () => {
                // sets approval
                await asset.connect(sa.alice.signer).approve(vault.address, ethers.constants.MaxUint256)
            })
            it("minting shares should round up", async () => {
                const user = sa.alice
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(user.signer).deposit(10, user.address)
                await asset.transfer(vault.address, 1)
            
                const userAssetsBefore = await asset.balanceOf(user.address)
                // asset/share ratio is 11:10. Thus, when minting 3 shares, it would result in 3.33 assets transferred from user
                // According to erc4626 it should round up, thus it should transfer 4 assets
                await vault.connect(user.signer).mint(3, user.address)
                const userAssetsAfter = await asset.balanceOf(user.address)
                expect(userAssetsAfter).to.be.eq(userAssetsBefore.sub(4))
            })
            it("withdrawing assets should round up", async () => {
                const user = sa.alice
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(user.signer).deposit(10, user.address)
                await asset.transfer(vault.address, 1)
            
                const userSharesBefore = await vault.balanceOf(user.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(user.signer).withdraw(3, user.address, user.address)
                const userSharesAfter = await vault.balanceOf(user.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
}

describe("Base Vaults", async () => {
    await testVault<BasicVault__factory, BasicVault>(BasicVault__factory)
    await testVault<LightBasicVault__factory, LightBasicVault>(LightBasicVault__factory)
})
