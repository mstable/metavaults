import { shouldBehaveLikeBaseVault, testAmounts } from "@test/shared/BaseVault.behaviour"
import { shouldBehaveLikeModule } from "@test/shared/Module.behaviour"
import { shouldBehaveLikeSameAssetUnderlyingsAbstractVault } from "@test/shared/SameAssetUnderlyingsAbstractVault.behaviour"
import { shouldBehaveLikeToken } from "@test/shared/Token.behaviour"
import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount, BN } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicVault__factory, SameAssetUnderlyingsBasicVault__factory } from "types/generated"

import type { BaseVaultBehaviourContext } from "@test/shared/BaseVault.behaviour"
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

const defaultAssetToBurn = simpleToExactAmount(0)

describe("SameAssetUnderlyingsBasicVault", async () => {
    /* -- Declare shared variables -- */
    let sa: StandardAccounts
    let mocks: ContractMocks
    let nexus: MockNexus
    let asset: MockERC20
    let bVault1: BasicVault
    let bVault2: BasicVault
    let bVault3: BasicVault
    let user: Account
    let underlyingVaults: Array<string>
    let assetToBurn: BN

    // Testing contract
    let vault: SameAssetUnderlyingsBasicVault

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        mocks = await new ContractMocks().init(sa)
        nexus = mocks.nexus
        asset = mocks.erc20
        user = sa.dummy1

        assetToBurn = assetToBurn ?? defaultAssetToBurn

        // Deploy dependencies of test contract.
        bVault1 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        await asset.connect(sa.default.signer).approve(bVault1.address, ethers.constants.MaxUint256)
        await bVault1.initialize(`bv1${await asset.name()}`, `bv1${await asset.symbol()}`, sa.vaultManager.address, assetToBurn)

        bVault2 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        await asset.connect(sa.default.signer).approve(bVault2.address, ethers.constants.MaxUint256)
        await bVault2.initialize(`bv2${await asset.name()}`, `bv2${await asset.symbol()}`, sa.vaultManager.address, assetToBurn)

        bVault3 = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        await asset.connect(sa.default.signer).approve(bVault3.address, ethers.constants.MaxUint256)
        await bVault3.initialize(`bv3${await asset.name()}`, `bv3${await asset.symbol()}`, sa.vaultManager.address, assetToBurn)

        underlyingVaults = [bVault1.address, bVault2.address, bVault3.address]

        // Deploy test contract.
        vault = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        await asset.connect(sa.default.signer).approve(vault.address, ethers.constants.MaxUint256)
        // Initialize test contract.
        await vault.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, underlyingVaults, assetToBurn)

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
    describe("constructor", async () => {
        let vaultDeployed: SameAssetUnderlyingsBasicVault
        before("init contract", async () => {
            await setup()
            vaultDeployed = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
        })
        it("should properly store valid arguments", async () => {
            expect(await vaultDeployed.nexus(), "nexus").to.eq(nexus.address)
            expect(await vaultDeployed.asset(), "asset").to.eq(asset.address)
        })
        it("should fail if arguments are wrong", async () => {
            await expect(
                new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(ZERO_ADDRESS, ZERO_ADDRESS),
            ).to.be.revertedWith("Nexus address is zero")
            await expect(
                new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS),
            ).to.be.revertedWith("Asset is zero")
        })
    })
    describe("initialize", async () => {
        let vaultInitialised: SameAssetUnderlyingsBasicVault
        before("init contract", async () => {
            assetToBurn = simpleToExactAmount(10 , await asset.decimals())
            await setup()
            vaultInitialised = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            await asset.connect(sa.default.signer).approve(vaultInitialised.address, ethers.constants.MaxUint256)
        })
        after(async () => {
            assetToBurn = defaultAssetToBurn
        })
        it("should properly store valid arguments", async () => {
            await vaultInitialised.initialize(
                `saub${await asset.name()}`,
                `saub${await asset.symbol()}`,
                sa.vaultManager.address,
                underlyingVaults,
                assetToBurn
            )

            expect(await vaultInitialised.symbol(), "saub symbol").to.eq("saubERC20")
            expect(await vaultInitialised.name(), "saub name").to.eq("saubERC20 Mock")
            expect(await vaultInitialised.decimals(), "saub decimals").to.eq(18)

            expect(await vaultInitialised.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)
            expect(await vaultInitialised.totalSupply(), "totalSupply").to.eq(assetToBurn)
            expect(await vaultInitialised.totalAssets(), "totalAssets").to.eq(assetToBurn)

            expect(await vaultInitialised.resolveVaultIndex(0), "vault index 0").to.eq(bVault1.address)
            expect(await vaultInitialised.resolveVaultIndex(1), "vault index 1").to.eq(bVault2.address)

            expect(await vaultInitialised.activeUnderlyingVaults(), "active underlying vaults").to.eq(3)
            expect(await vaultInitialised.totalUnderlyingVaults(), "total underlying vaults").to.eq(3)
            
            //locked shares
            expect((await vaultInitialised.balanceOf(vaultInitialised.address)), "locked shares").to.eq(assetToBurn)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(
                vault.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, underlyingVaults, assetToBurn),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
        it("fails if initialize is called with no underlying vaults", async () => {
            // Deploy test contract.
            const vaultTemp = await new SameAssetUnderlyingsBasicVault__factory(sa.default.signer).deploy(nexus.address, asset.address)
            // Initialize test contract.
            await expect(
                vaultTemp.initialize(`saub${await asset.name()}`, `saub${await asset.symbol()}`, sa.vaultManager.address, [], assetToBurn),
            ).to.be.revertedWith("No underlying vaults")
        })
    })
    describe("behaviors", async () => {
        before("init contract", async () => {
            await setup()
        })
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
            const ctx: Partial<BaseVaultBehaviourContext> = {}
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup()
                    ctx.vault = vault as unknown as AbstractVault
                    ctx.asset = asset
                    ctx.sa = sa
                    ctx.amounts = testAmounts(100, await asset.decimals())
                    ctx.dataEmitter = mocks.dataEmitter
                }
            })
            shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
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
                    ctx.assetToBurn = defaultAssetToBurn
                }
            })
            shouldBehaveLikeSameAssetUnderlyingsAbstractVault(() => ctx as SameAssetUnderlyingsAbstractVaultBehaviourContext)
        })
    })
})
