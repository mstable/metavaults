import { shouldBehaveLikeAbstractVault, testAmounts } from "@test/shared/AbstractVault.behaviour"
import { shouldBehaveLikeModule } from "@test/shared/Module.behaviour"
import { shouldBehaveLikeSameAssetUnderlyingsAbstractVault } from "@test/shared/SameAssetUnderlyingsAbstractVault.behaviour"
import { shouldBehaveLikeToken } from "@test/shared/Token.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicVault__factory, SameAssetUnderlyingsBasicVault__factory } from "types/generated"

import type { AbstractVaultBehaviourContext } from "@test/shared/AbstractVault.behaviour"
import type { SameAssetUnderlyingsAbstractVaultBehaviourContext } from "@test/shared/SameAssetUnderlyingsAbstractVault.behaviour"
import type { TokenContext, TokenERC20 } from "@test/shared/Token.behaviour"
import type { Account } from "types"
import type {
    AbstractVault,
    BasicVault,
    MockERC20,
    MockNexus,
    SameAssetUnderlyingsAbstractVault,
    SameAssetUnderlyingsBasicVault,
    VaultManagerRole,
} from "types/generated"

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

        // set balance or users for the test.
        const assetBalance = await asset.balanceOf(sa.default.address)
        asset.transfer(sa.alice.address, assetBalance.div(2))
    }
    before("init contract", async () => {
        await setup()
    })
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await vault.nexus(), "nexus").to.eq(nexus.address)
            expect(await vault.asset(), "asset").to.eq(asset.address)
        })
        it("should fail if arguments are wrong", async () => {
            await expect(
                new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS),
            ).to.be.revertedWith("Asset is zero")
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
            const vaultTemp = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            // Initialize test contract.
            await expect(
                vaultTemp.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, []),
            ).to.be.revertedWith("No underlying vaults")
        })
    })
    describe("behaviors", async () => {
        it("should behave like ImmutableModule ", async () => {
            shouldBehaveLikeModule({ module: vault, sa })
        })
        shouldBehaveLikeVaultManagerRole(() => ({
            vaultManagerRole: vault as unknown as VaultManagerRole,
            sa,
        }))
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
            shouldBehaveLikeToken(() => tokenContext as TokenContext)
        })
        describe("should behave like AbstractVaultBehaviourContext", async () => {
            const ctx: Partial<AbstractVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup()
                    ctx.vault = vault as unknown as AbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(100, await asset.decimals())
                }
            })
            shouldBehaveLikeAbstractVault(() => ctx as AbstractVaultBehaviourContext)
        })
        describe("should behave like SameAssetUnderlyingsAbstractVaultBehaviourContext", async () => {
            const ctx: Partial<SameAssetUnderlyingsAbstractVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup()
                    ctx.vault = vault as unknown as SameAssetUnderlyingsAbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = { initialDeposit: simpleToExactAmount(100, await asset.decimals()) }
                }
            })
            shouldBehaveLikeSameAssetUnderlyingsAbstractVault(() => ctx as SameAssetUnderlyingsAbstractVaultBehaviourContext)
        })
    })
})
