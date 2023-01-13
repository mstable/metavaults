import { deployContract } from "@tasks/utils"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { DAI, ThreeCRV, USDC, USDT } from "@tasks/utils/tokens"
import { impersonate, impersonateAccount } from "@utils/fork"
import { simpleToExactAmount, BN } from "@utils/math"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import {
    BasicVault__factory,
    Curve3CrvBasicMetaVault__factory,
    Curve3PoolCalculatorLibrary__factory,
    ICurve3Pool__factory,
    IERC20__factory,
    IERC4626Vault__factory,
} from "types/generated"

import { behaveLikeCurve3CrvVault } from "./shared/Curve3Crv.behaviour"

import type { Signer } from "ethers"
import type { Account } from "types"
import type { Curve3CrvBasicMetaVault, ICurve3Pool, IERC20, IERC4626Vault } from "types/generated"

import type { Curve3CrvContext } from "./shared/Curve3Crv.behaviour"

const deployerAddress = resolveAddress("OperationsSigner")
const governorAddress = resolveAddress("Governor")
const nexusAddress = resolveAddress("Nexus")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf"
const daiUserAddress = "0x075e72a5edf65f0a5f44699c7654c1a76941ddc8" // 250M at block 14810528
const usdcUserAddress = "0x0A59649758aa4d66E25f08Dd01271e891fe52199" // Maker: PSM-USDC-A
const usdtUserAddress = "0x5754284f345afc66a98fbb0a0afe71e0f007b949" // Tether Treasury

const normalBlock = 14810528

const slippageData = {
    redeem: 101,
    deposit: 10,
    withdraw: 11,
    mint: 10,
}
const defaultAssetToBurn = simpleToExactAmount(0)

describe("Curve 3Crv Basic Vault", async () => {
    let deployer: Signer
    let governor: Account
    let threeCrvToken: IERC20
    let threePool: ICurve3Pool
    let metaVault: IERC4626Vault
    let assetToBurn: BN
    let curve3PoolCalculatorLibraryAddresses

    const commonSetup = async (blockNumber: number) => {
        if (network.name === "hardhat") {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber,
                        },
                    },
                ],
            })
        }
        deployer = await impersonate(deployerAddress)
        governor = await impersonateAccount(governorAddress)

        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, deployer)
        threePool = ICurve3Pool__factory.connect(resolveAddress("CurveThreePool"), deployer)

        assetToBurn = assetToBurn ?? defaultAssetToBurn

        const underlyingVault = await new BasicVault__factory(deployer).deploy(nexusAddress, ThreeCRV.address)
        await underlyingVault.initialize("Vault Convex mUSD/3CRV", "vcvxmusd3CRV", vaultManagerAddress, defaultAssetToBurn)

        metaVault = await IERC4626Vault__factory.connect(underlyingVault.address, deployer)

        const threePoolCalculatorLibrary = await new Curve3PoolCalculatorLibrary__factory(deployer).deploy()
        curve3PoolCalculatorLibraryAddresses = {
            "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary": threePoolCalculatorLibrary.address,
        }
    }

    const deployVault = async (asset: IERC20, owner: Account, decimals: number): Promise<Curve3CrvBasicMetaVault> => {
        const vault = await new Curve3CrvBasicMetaVault__factory(curve3PoolCalculatorLibraryAddresses, deployer).deploy(
            nexusAddress,
            asset.address,
            metaVault.address,
        )
        await asset.connect(owner.signer).transfer(deployerAddress, simpleToExactAmount(100000, decimals))
        await asset.connect(deployer).approve(vault.address, ethers.constants.MaxUint256)

        await vault.initialize("3Pooler Meta Vault", "3PMV", vaultManagerAddress, slippageData, assetToBurn)

        // Set allowances
        await asset.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(vault.signer).approve(metaVault.address, ethers.constants.MaxUint256)
        await threeCrvToken.connect(vault.signer).approve(metaVault.address, ethers.constants.MaxUint256)

        return vault.connect(owner.signer)
    }
    const testAmounts = (amount: number, decimals = 18) => {
        return {
            deposit: simpleToExactAmount(amount, decimals),
            mint: simpleToExactAmount(amount, decimals),
            withdraw: simpleToExactAmount(amount, decimals),
            redeem: simpleToExactAmount(amount, decimals),
            initialDeposit: simpleToExactAmount(amount, decimals).mul(4),
        }
    }
    const ctx = <Curve3CrvContext>{}
    describe("initialize", () => {
        let vault: Curve3CrvBasicMetaVault
        beforeEach("before", async () => {
            await commonSetup(normalBlock)

            vault = await deployContract<Curve3CrvBasicMetaVault>(
                new Curve3CrvBasicMetaVault__factory(curve3PoolCalculatorLibraryAddresses, deployer),
                "Curve3CrvBasicMetaVault",
                [nexusAddress, DAI.address, metaVault.address],
            )

            let daiToken = IERC20__factory.connect(DAI.address, deployer)
            let daiWhale = await impersonateAccount(daiUserAddress)

            await daiToken.connect(daiWhale.signer).transfer(deployerAddress, simpleToExactAmount(100000, DAI.decimals))
            await daiToken.connect(deployer).approve(vault.address, ethers.constants.MaxUint256)
            assetToBurn = defaultAssetToBurn
        })
        it("curve 3Crv Meta Vault", async () => {
            assetToBurn = simpleToExactAmount(10 , DAI.decimals)

            await vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn)

            // Vault token data
            expect(await vault.name(), "name").eq("3Pooler Meta Vault (DAI)")
            expect(await vault.symbol(), "symbol").eq("3pDAI")
            expect(await vault.decimals(), "decimals").eq(18)

            //Vault Slippages
            expect(await vault.depositSlippage(), "depositSlippage").eq(slippageData.deposit)
            expect(await vault.redeemSlippage(), "redeemSlippage").eq(slippageData.redeem)
            expect(await vault.withdrawSlippage(), "withdrawSlippage").eq(slippageData.withdraw)
            expect(await vault.mintSlippage(), "mintSlippage").eq(slippageData.mint)

            // Vault balances
            expect(await vault.balanceOf(deployer.getAddress()), "balanceOf").eq(0)
            expect(await vault.totalAssets(), "totalAssets").to.gt(0)
            expect(await vault.totalSupply(), "totalSupply").to.gt(0)

            //locked shares
            expect((await vault.balanceOf(vault.address)), "locked shares").to.gt(0)
        })
        it("only initialize once", async () => {
            await vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn)

            await expect(
                vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn),
                "initialize twice",
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
        it("fails with wrong slippage data", async () => {
            const basisScale = await vault.BASIS_SCALE()
            const wrongAmount = basisScale.add(1).toNumber()
            const correctSlippageData = {
                redeem: 101,
                deposit: 99,
                withdraw: 11,
                mint: 10,
            }
            let slippageData = { ...correctSlippageData, deposit: wrongAmount }
            await expect(
                vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn),
                "initialize twice",
            ).to.be.revertedWith("Invalid deposit slippage")
            slippageData = { ...correctSlippageData, mint: wrongAmount }
            await expect(
                vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn),
                "initialize twice",
            ).to.be.revertedWith("Invalid mint slippage")
            slippageData = { ...correctSlippageData, withdraw: wrongAmount }
            await expect(
                vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn),
                "initialize twice",
            ).to.be.revertedWith("Invalid withdraw slippage")
            slippageData = { ...correctSlippageData, redeem: wrongAmount }
            await expect(
                vault.initialize("3Pooler Meta Vault (DAI)", "3pDAI", vaultManagerAddress, slippageData, assetToBurn),
                "initialize twice",
            ).to.be.revertedWith("Invalid redeem slippage")
        })
    })

    describe("DAI 3Pooler Vault", () => {
        describe("should behave like Curve3Crv Vault", async () => {
            before(() => {
                // Anonymous functions cannot be used as fixtures so can't use arrow function
                ctx.fixture = async function fixture() {
                    await commonSetup(normalBlock)

                    // Reset ctx values from commonSetup
                    ctx.threePool = threePool
                    ctx.metaVault = metaVault
                    ctx.governor = governor

                    // Asset specific values
                    ctx.owner = await impersonateAccount(daiUserAddress)
                    ctx.asset = IERC20__factory.connect(DAI.address, ctx.owner.signer)
                    ctx.amounts = testAmounts(100000, DAI.decimals)

                    // Deploy new Curve3CrvBasicMetaVault
                    ctx.vault = await deployVault(ctx.asset, ctx.owner, DAI.decimals)
                }
            })
            behaveLikeCurve3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Curve3CrvBasicMetaVault
            let owner: Account
            let asset: IERC20
            before(async () => {
                await commonSetup(normalBlock)
                owner = await impersonateAccount(daiUserAddress)
                asset = IERC20__factory.connect(DAI.address, owner.signer)
                vault = await deployVault(asset, owner, DAI.decimals)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await asset.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("USDC 3Pooler Vault", () => {
        describe("should behave like Curve3Crv Vault", async () => {
            before(() => {
                // Anonymous functions cannot be used as fixtures so can't use arrow function
                ctx.fixture = async function fixture() {
                    await commonSetup(normalBlock)

                    // Reset ctx values from commonSetup
                    ctx.threePool = threePool
                    ctx.metaVault = metaVault
                    ctx.governor = governor

                    // Asset specific values
                    ctx.owner = await impersonateAccount(usdcUserAddress)
                    ctx.asset = IERC20__factory.connect(USDC.address, ctx.owner.signer)
                    ctx.amounts = testAmounts(100000, USDC.decimals)

                    // Deploy new Curve3CrvBasicMetaVault
                    ctx.vault = await deployVault(ctx.asset, ctx.owner, USDC.decimals)
                }
            })
            behaveLikeCurve3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Curve3CrvBasicMetaVault
            let owner: Account
            let asset: IERC20
            before(async () => {
                await commonSetup(normalBlock)
                owner = await impersonateAccount(usdcUserAddress)
                asset = IERC20__factory.connect(USDC.address, owner.signer)
                vault = await deployVault(asset, owner, USDC.decimals)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await asset.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("USDT 3Pooler Vault", () => {
        describe("should behave like Curve3Crv Vault", async () => {
            before(() => {
                // Anonymous functions cannot be used as fixtures so can't use arrow function
                ctx.fixture = async function fixture() {
                    await commonSetup(normalBlock)

                    // Reset ctx values from commonSetup
                    ctx.threePool = threePool
                    ctx.metaVault = metaVault
                    ctx.governor = governor

                    // Asset specific values
                    ctx.owner = await impersonateAccount(usdtUserAddress)
                    ctx.asset = IERC20__factory.connect(USDT.address, ctx.owner.signer)
                    ctx.amounts = testAmounts(100000, USDT.decimals)

                    // Deploy new Curve3CrvBasicMetaVault
                    ctx.vault = await deployVault(ctx.asset, ctx.owner, USDT.decimals)
                }
            })
            behaveLikeCurve3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Curve3CrvBasicMetaVault
            let owner: Account
            let asset: IERC20
            before(async () => {
                await commonSetup(normalBlock)
                owner = await impersonateAccount(usdtUserAddress)
                asset = IERC20__factory.connect(USDT.address, owner.signer)
                vault = await deployVault(asset, owner, USDT.decimals)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await asset.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("validations", () => {
        before(async () => {
            await commonSetup(normalBlock)
        })

        it("constructor should fail if asset is not in 3Pool", async () => {
            const busdAddress = "0x4fabb145d64652a948d72533023f6e7a623c7c53"
            const tx = new Curve3CrvBasicMetaVault__factory(curve3PoolCalculatorLibraryAddresses, deployer).deploy(
                nexusAddress,
                busdAddress,
                metaVault.address,
            )
            await expect(tx).to.be.revertedWith("Underlying asset not in 3Pool")
        })
    })
})
