import { deployContract } from "@tasks/utils"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { crvFRAX, USDC, FRAX } from "@tasks/utils/tokens"
import { impersonate, impersonateAccount } from "@utils/fork"
import { simpleToExactAmount, BN } from "@utils/math"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import {
    BasicVault__factory,
    CurveFraxBpBasicMetaVault__factory,
    CurveFraxBpCalculatorLibrary__factory,
    ICurveFraxBP__factory,
    IERC20__factory,
    IERC4626Vault__factory,
} from "types/generated"

import { behaveLikeCurveFraxBpVault } from "./shared/CurveFraxBp.behaviour"

import type { Signer } from "ethers"
import type { Account } from "types"
import type { CurveFraxBpBasicMetaVault, ICurveFraxBP, IERC20, IERC4626Vault } from "types/generated"

import type { CurveFraxBpContext } from "./shared/CurveFraxBp.behaviour"

const deployerAddress = resolveAddress("OperationsSigner")
const nexusAddress = resolveAddress("Nexus")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf"
const fraxUserAddress = "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2" // ~350M at block 15966213
const usdcUserAddress = "0x0A59649758aa4d66E25f08Dd01271e891fe52199" // Maker: PSM-USDC-A

const normalBlock = 15966213

const slippageData = {
    redeem: 101,
    deposit: 99,
    withdraw: 110,
    mint: 100,
}
const defaultAssetToBurn = simpleToExactAmount(0)

describe("Curve FraxBp Basic Vault", async () => {
    let deployer: Signer
    let crvFraxToken: IERC20
    let fraxBasePool: ICurveFraxBP
    let metaVault: IERC4626Vault
    let assetToBurn: BN
    let curveFraxBpCalculatorLibraryAddresses

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

        crvFraxToken = IERC20__factory.connect(crvFRAX.address, deployer)
        fraxBasePool = ICurveFraxBP__factory.connect(resolveAddress("FraxBP"), deployer)

        assetToBurn = assetToBurn ?? defaultAssetToBurn

        const underlyingVault = await new BasicVault__factory(deployer).deploy(nexusAddress, crvFRAX.address)
        await underlyingVault.initialize("Vault Convex bUSD/crvFrax", "vcvxbusdCrvFrax", vaultManagerAddress, defaultAssetToBurn)
        metaVault = await IERC4626Vault__factory.connect(underlyingVault.address, deployer)

        const fraxBasePoolCalculatorLibrary = await new CurveFraxBpCalculatorLibrary__factory(deployer).deploy()
        curveFraxBpCalculatorLibraryAddresses = {
            "contracts/peripheral/Curve/CurveFraxBpCalculatorLibrary.sol:CurveFraxBpCalculatorLibrary": fraxBasePoolCalculatorLibrary.address,
        }
    }

    it("initialize Curve FraxBp Meta Vault", async () => {
        await commonSetup(normalBlock)
        const vault = await deployContract<CurveFraxBpBasicMetaVault>(
            new CurveFraxBpBasicMetaVault__factory(curveFraxBpCalculatorLibraryAddresses, deployer),
            "CurveFraxBpBasicMetaVault",
            [nexusAddress, USDC.address, metaVault.address],
        )

        let usdcToken = IERC20__factory.connect(USDC.address, deployer)
        let usdcWhale = await impersonateAccount(usdcUserAddress)

        await usdcToken.connect(usdcWhale.signer).transfer(deployerAddress, simpleToExactAmount(100000, USDC.decimals))
        await usdcToken.connect(deployer).approve(vault.address, ethers.constants.MaxUint256)

        assetToBurn = simpleToExactAmount(10 , USDC.decimals)

        await vault.initialize("FraxBp Meta Vault (USDC)", "fraxBpUSDC", vaultManagerAddress, slippageData, assetToBurn)

        // Vault token data
        expect(await vault.name(), "name").eq("FraxBp Meta Vault (USDC)")
        expect(await vault.symbol(), "symbol").eq("fraxBpUSDC")
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

        //reset
        assetToBurn = defaultAssetToBurn
    })
    const deployVault = async (asset: IERC20, owner: Account, decimals: number): Promise<CurveFraxBpBasicMetaVault> => {
        const vault = await new CurveFraxBpBasicMetaVault__factory(curveFraxBpCalculatorLibraryAddresses, deployer).deploy(
            nexusAddress,
            asset.address,
            metaVault.address,
        )
        await asset.connect(owner.signer).transfer(deployerAddress, simpleToExactAmount(100000, decimals))
        await asset.connect(deployer).approve(vault.address, ethers.constants.MaxUint256)

        await vault.initialize("FraxBp Meta Vault", "FraxBpMV", vaultManagerAddress, slippageData, assetToBurn)

        // Set allowances
        await asset.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(vault.signer).approve(metaVault.address, ethers.constants.MaxUint256)
        await crvFraxToken.connect(vault.signer).approve(metaVault.address, ethers.constants.MaxUint256)

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
    const ctx = <CurveFraxBpContext>{}
    describe("FRAX FraxBP Vault", () => {
        describe("should behave like Curve FraxBp Vault", async () => {
            before(() => {
                // Anonymous functions cannot be used as fixtures so can't use arrow function
                ctx.fixture = async function fixture() {
                    await commonSetup(normalBlock)

                    // Reset ctx values from commonSetup
                    ctx.fraxBasePool = fraxBasePool
                    ctx.metaVault = metaVault

                    // Asset specific values
                    ctx.owner = await impersonateAccount(fraxUserAddress)
                    ctx.asset = IERC20__factory.connect(FRAX.address, ctx.owner.signer)
                    ctx.amounts = testAmounts(100000, FRAX.decimals)

                    // Deploy new CurveFraxBpBasicMetaVault
                    ctx.vault = await deployVault(ctx.asset, ctx.owner, FRAX.decimals)
                }
            })
            behaveLikeCurveFraxBpVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: CurveFraxBpBasicMetaVault
            let owner: Account
            let asset: IERC20
            before(async () => {
                await commonSetup(normalBlock)
                owner = await impersonateAccount(fraxUserAddress)
                asset = IERC20__factory.connect(FRAX.address, owner.signer)
                vault = await deployVault(asset, owner, FRAX.decimals)
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
    describe("USDC FraxBP Vault", () => {
        describe("should behave like Curve FraxBp Vault", async () => {
            before(() => {
                // Anonymous functions cannot be used as fixtures so can't use arrow function
                ctx.fixture = async function fixture() {
                    await commonSetup(normalBlock)

                    // Reset ctx values from commonSetup
                    ctx.fraxBasePool = fraxBasePool
                    ctx.metaVault = metaVault

                    // Asset specific values
                    ctx.owner = await impersonateAccount(usdcUserAddress)
                    ctx.asset = IERC20__factory.connect(USDC.address, ctx.owner.signer)
                    ctx.amounts = testAmounts(100000, USDC.decimals)

                    // Deploy new CurveFraxBpBasicMetaVault
                    ctx.vault = await deployVault(ctx.asset, ctx.owner, USDC.decimals)
                }
            })
            behaveLikeCurveFraxBpVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: CurveFraxBpBasicMetaVault
            let owner: Account
            let asset: IERC20
            before(async () => {
                await commonSetup(normalBlock)
                owner = await impersonateAccount(usdcUserAddress)
                asset = IERC20__factory.connect(USDC.address, owner.signer)
                vault = await deployVault(asset, owner, USDC.decimals)p
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
})
