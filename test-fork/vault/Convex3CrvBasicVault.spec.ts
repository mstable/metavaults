import { config } from "@tasks/deployment/convex3CrvVaults-config"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { musd3CRV, ThreeCRV } from "@tasks/utils/tokens"
import shouldBehaveLikeBaseVault, { testAmounts } from "@test/shared/BaseVault.behaviour"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { impersonate, impersonateAccount } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers, Wallet } from "ethers"
import * as hre from "hardhat"
import {
    Convex3CrvBasicVault__factory,
    Curve3CrvFactoryMetapoolCalculatorLibrary__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
    DataEmitter__factory,
    IConvexRewardsPool__factory,
    ICurve3Pool__factory,
    ICurveMetapool__factory,
    IERC20Metadata__factory,
    MockERC20__factory,
} from "types/generated"

import { behaveLikeConvex3CrvVault, snapVault } from "./shared/Convex3Crv.behaviour"

import type { BaseVaultBehaviourContext } from "@test/shared/BaseVault.behaviour"
import type { BN } from "@utils/math"
import type { Signer } from "ethers"
import type { Account, Convex3CrvConstructorData, Convex3CrvPool } from "types"
import type {
    AbstractVault,
    Convex3CrvBasicVault,
    Curve3CrvFactoryMetapoolCalculatorLibrary,
    Curve3CrvMetapoolCalculatorLibrary,
    DataEmitter,
    IConvexRewardsPool,
    ICurve3Pool,
    ICurveMetapool,
    IERC20Metadata,
    MockERC20,
} from "types/generated"

import type { Convex3CrvContext } from "./shared/Convex3Crv.behaviour"

const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const nexusAddress = resolveAddress("Nexus")
const baseRewardPoolAddress = resolveAddress("CRVRewardsPool")
const booster = resolveAddress("ConvexBooster")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf"
const threeCrvWhaleAddress = "0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A" // Curve.fi: DAI/USDC/USDT Gauge
const bobAddress = "0x701aEcF92edCc1DaA86c5E7EdDbAD5c311aD720C"
const normalBlock = 14677900

describe("Convex 3Crv Basic Vault", async () => {
    let deployer: Signer
    let owner: Account
    let governor: Account
    let bob: Account
    let threeCrvToken: IERC20Metadata
    let threePool: ICurve3Pool
    let metapool: ICurveMetapool
    let baseRewardsPool: IConvexRewardsPool
    let dataEmitter: DataEmitter
    let metapoolCalculatorLibrary: Curve3CrvMetapoolCalculatorLibrary
    let factoryMetapoolCalculatorLibrary: Curve3CrvFactoryMetapoolCalculatorLibrary
    const { network } = hre

    const setup = async (blockNumber: number) => {
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
        owner = await impersonateAccount(threeCrvWhaleAddress)
        governor = await impersonateAccount(governorAddress)
        bob = await impersonateAccount(bobAddress)

        threeCrvToken = IERC20Metadata__factory.connect(ThreeCRV.address, deployer)

        dataEmitter = await new DataEmitter__factory(deployer).deploy()

        metapoolCalculatorLibrary = await new Curve3CrvMetapoolCalculatorLibrary__factory(deployer).deploy()
        factoryMetapoolCalculatorLibrary = await new Curve3CrvFactoryMetapoolCalculatorLibrary__factory(deployer).deploy()
    }
    const deployVault = async (constructorData: Convex3CrvConstructorData, factoryMetapool = false): Promise<Convex3CrvBasicVault> => {
        const libraryAddresses =
            factoryMetapool === true
                ? {
                    "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary":
                        factoryMetapoolCalculatorLibrary.address,
                }
                : {
                    "contracts/peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol:Curve3CrvMetapoolCalculatorLibrary":
                        metapoolCalculatorLibrary.address,
                }
        const vault = await new Convex3CrvBasicVault__factory(libraryAddresses, deployer).deploy(
            nexusAddress,
            ThreeCRV.address,
            constructorData,
        )
        return vault
    }

    const createBaseContext = async (
        constructorData: Convex3CrvConstructorData,
        slippageData: Convex3CrvPool["slippageData"],
        initialDeposit: BN,
        name: string,
        symbol: string,
    ): Promise<Partial<BaseVaultBehaviourContext>> => {
        const baseCtx: Partial<BaseVaultBehaviourContext> = {}
        baseCtx.fixture = async function fixture() {
            await setup(normalBlock)
            const vault = await deployVault(constructorData)
            await vault.initialize(name, symbol, vaultManagerAddress, slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)

            const sa = new StandardAccounts()
            sa.default = owner
            sa.alice = owner
            sa.bob = bob
            sa.governor = governor
            sa.dummy1 = bob
            const otherSigner = Wallet.createRandom()
            sa.other = { signer: otherSigner, address: otherSigner.address }

            const variances = {
                deposit: "2",
                mint: "2",
                withdraw: "2",
                redeem: "2",
                convertToShares: "2",
                convertToAssets: "2",
                maxWithdraw: "2",
                maxRedeem: "2",
            }

            baseCtx.vault = vault as unknown as AbstractVault
            baseCtx.asset = threeCrvToken
            baseCtx.sa = sa
            baseCtx.amounts = testAmounts(100, 18)
            baseCtx.variances = variances
            baseCtx.dataEmitter = dataEmitter
        }
        return baseCtx
    }

    it("deploy and initialize Convex vault for mUSD pool", async () => {
        await setup(normalBlock)
        const convexConstructorData = {
            metapool: config.convex3CrvPools.musd.curveMetapool,
            convexPoolId: config.convex3CrvPools.musd.convexPoolId,
            booster,
        }
        const vault = await deployVault(convexConstructorData)

        expect(await vault.nexus(), "nexus").eq(nexusAddress)

        expect(await vault.metapool(), "metapool").to.equal(config.convex3CrvPools.musd.curveMetapool)
        expect(await vault.metapoolToken(), "metapool token").to.equal(config.convex3CrvPools.musd.curveMetapoolToken)
        expect(await vault.basePool(), "base pool").to.equal(resolveAddress("CurveThreePool"))
        expect(await vault.booster(), "booster").to.equal(booster)
        expect(await vault.convexPoolId(), "convex Pool Id").to.equal(convexConstructorData.convexPoolId)
        expect(await vault.baseRewardPool(), "convex reward pool").to.equal(baseRewardPoolAddress)

        await vault.initialize("Vault Convex mUSD/3CRV", "vcvxmusd3CRV", vaultManagerAddress, config.convex3CrvPools.musd.slippageData)

        const data = await snapVault(vault, threeCrvToken, threeCrvWhaleAddress, simpleToExactAmount(1), simpleToExactAmount(1))

        // Vault token data
        expect(data.vault.name, "name").eq("Vault Convex mUSD/3CRV")
        expect(data.vault.symbol, "symbol").eq("vcvxmusd3CRV")
        expect(data.vault.decimals, "decimals").eq(18)

        //Vault Slippages
        expect(data.vault.depositSlippage, "depositSlippage").eq(config.convex3CrvPools.musd.slippageData.deposit)
        expect(data.vault.redeemSlippage, "redeemSlippage").eq(config.convex3CrvPools.musd.slippageData.redeem)
        expect(data.vault.withdrawSlippage, "withdrawSlippage").eq(config.convex3CrvPools.musd.slippageData.withdraw)
        expect(data.vault.mintSlippage, "mintSlippage").eq(config.convex3CrvPools.musd.slippageData.mint)

        // Convex vault specific data
        expect(data.convex.curveMetapool, "Curve Metapool").eq(convexConstructorData.metapool)
        expect(data.convex.booster, "booster").eq(booster)
        expect(data.convex.convexPoolId, "poolId").eq(convexConstructorData.convexPoolId)
        expect(data.convex.metapoolToken, "metapoolToken").eq(musd3CRV.address)
        expect(data.convex.baseRewardPool, "baseRewardPool").eq(baseRewardPoolAddress)

        // Vault balances
        expect(data.vault.balanceOf, "balanceOf").eq(0)
        expect(data.vault.totalAssets, "totalAssets").eq(0)
        expect(data.vault.totalSupply, "totalSupply").eq(0)
    })
    describe("mUSD Convex Vault", () => {
        const initialDeposit = simpleToExactAmount(400000, 18)
        const convexConstructorData = {
            metapool: config.convex3CrvPools.musd.curveMetapool,
            convexPoolId: config.convex3CrvPools.musd.convexPoolId,
            booster,
        }
        describe("should behave like Convex3Crv Vault", async () => {
            let ctx: Convex3CrvContext

            before(async () => {
                await setup(normalBlock)

                const vault = await deployVault(convexConstructorData)
                await vault.initialize(
                    "Vault Convex mUSD/3CRV",
                    "vcvxmusd3CRV",
                    vaultManagerAddress,
                    config.convex3CrvPools.musd.slippageData,
                )

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)

                ctx = {
                    vault: vault.connect(owner.signer),
                    owner,
                    threePool,
                    threeCrvToken,
                    metapool,
                    baseRewardsPool,
                    dataEmitter,
                    convex3CrvCalculatorLibrary: factoryMetapoolCalculatorLibrary,
                    amounts: {
                        initialDeposit,
                        deposit: initialDeposit.div(4),
                        mint: initialDeposit.div(5),
                        withdraw: initialDeposit.div(3),
                        redeem: initialDeposit.div(6),
                    },
                }
            })
            behaveLikeConvex3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Convex3CrvBasicVault
            before(async () => {
                await setup(normalBlock)

                vault = await deployVault(convexConstructorData)
                await vault.initialize(
                    "Vault Convex mUSD/3CRV",
                    "vcvxmusd3CRV",
                    vaultManagerAddress,
                    config.convex3CrvPools.musd.slippageData,
                )

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await threeCrvToken.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
        describe("should behave like BaseVault", async () => {
            let baseCtx: Partial<BaseVaultBehaviourContext>
            before(async () => {
                baseCtx = await createBaseContext(
                    convexConstructorData,
                    config.convex3CrvPools.musd.slippageData,
                    initialDeposit,
                    "Vault Convex mUSD/3CRV",
                    "vcvxmusd3CRV",
                )
            })
            shouldBehaveLikeBaseVault(() => baseCtx as BaseVaultBehaviourContext)
        })
    })
    describe("USDP Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(2000, 18)
        const convexConstructorData = {
            metapool: config.convex3CrvPools.usdp.curveMetapool,
            convexPoolId: config.convex3CrvPools.usdp.convexPoolId,
            booster,
        }
        describe("should behave like Convex3Crv Vault", async () => {
            before(async () => {
                await setup(15410000)
                const vault = await deployVault(convexConstructorData)
                await vault.initialize("Vault Convex USDP/3CRV", "vcvxUSDP3CRV", vaultManagerAddress, config.convex3CrvPools.usdp.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
                ctx = {
                    vault: vault.connect(owner.signer),
                    owner,
                    threePool,
                    threeCrvToken,
                    metapool,
                    baseRewardsPool,
                    dataEmitter,
                    convex3CrvCalculatorLibrary: factoryMetapoolCalculatorLibrary,
                    amounts: {
                        initialDeposit,
                        deposit: initialDeposit.div(4),
                        mint: initialDeposit.div(5),
                        withdraw: initialDeposit.div(3),
                        redeem: initialDeposit.div(6),
                    },
                }
            })
            behaveLikeConvex3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Convex3CrvBasicVault
            before(async () => {
                await setup(15410000)
                vault = await deployVault(convexConstructorData)
                await vault.initialize("Vault Convex USDP/3CRV", "vcvxUSDP3CRV", vaultManagerAddress, config.convex3CrvPools.usdp.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await threeCrvToken.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("FRAX Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        const convexConstructorData = {
            metapool: config.convex3CrvPools.frax.curveMetapool,
            convexPoolId: config.convex3CrvPools.frax.convexPoolId,
            booster,
        }
        describe("should behave like Convex3Crv Vault", async () => {
            before(async () => {
                await setup(15410000)
                const vault = await deployVault(convexConstructorData, true)
                await vault.initialize("Vault Convex FRAX/3CRV", "vcvxFRAX3CRV", vaultManagerAddress, config.convex3CrvPools.frax.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
                ctx = {
                    vault: vault.connect(owner.signer),
                    owner,
                    threePool,
                    threeCrvToken,
                    metapool,
                    baseRewardsPool,
                    dataEmitter,
                    convex3CrvCalculatorLibrary: factoryMetapoolCalculatorLibrary,
                    amounts: {
                        initialDeposit,
                        deposit: initialDeposit.div(4),
                        mint: initialDeposit.div(5),
                        withdraw: initialDeposit.div(3),
                        redeem: initialDeposit.div(6),
                    },
                }
            })
            behaveLikeConvex3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Convex3CrvBasicVault
            before(async () => {
                await setup(15410000)
                vault = await deployVault(convexConstructorData, true)
                await vault.initialize("Vault Convex FRAX/3CRV", "vcvxFRAX3CRV", vaultManagerAddress, config.convex3CrvPools.frax.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await threeCrvToken.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("BUSD Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        const convexConstructorData = {
            metapool: config.convex3CrvPools.busd.curveMetapool,
            convexPoolId: config.convex3CrvPools.busd.convexPoolId,
            booster,
        }
        describe("should behave like Convex3Crv Vault", async () => {
            before(async () => {
                await setup(15410000)
                const vault = await deployVault(convexConstructorData, true)
                await vault.initialize("Vault Convex BUSD/3CRV", "vcvxBUSD3CRV", vaultManagerAddress, config.convex3CrvPools.busd.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
                ctx = {
                    vault: vault.connect(owner.signer),
                    owner,
                    threePool,
                    threeCrvToken,
                    metapool,
                    baseRewardsPool,
                    dataEmitter,
                    convex3CrvCalculatorLibrary: factoryMetapoolCalculatorLibrary,
                    amounts: {
                        initialDeposit,
                        deposit: initialDeposit.div(4),
                        mint: initialDeposit.div(5),
                        withdraw: initialDeposit.div(3),
                        redeem: initialDeposit.div(6),
                    },
                }
            })
            behaveLikeConvex3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Convex3CrvBasicVault
            before(async () => {
                await setup(15410000)
                vault = await deployVault(convexConstructorData, true)
                await vault.initialize("Vault Convex BUSD/3CRV", "vcvxBUSD3CRV", vaultManagerAddress, config.convex3CrvPools.busd.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await threeCrvToken.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("LUSD Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        const convexConstructorData = {
            metapool: config.convex3CrvPools.lusd.curveMetapool,
            convexPoolId: config.convex3CrvPools.lusd.convexPoolId,
            booster,
        }
        describe("should behave like Convex3Crv Vault", async () => {
            before(async () => {
                await setup(15410000)
                const vault = await deployVault(convexConstructorData, true)
                await vault.initialize("Vault Convex LUSD/3CRV", "vcvxLUSD3CRV", vaultManagerAddress, config.convex3CrvPools.lusd.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
                await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
                ctx = {
                    vault: vault.connect(owner.signer),
                    owner,
                    threePool,
                    threeCrvToken,
                    metapool,
                    baseRewardsPool,
                    dataEmitter,
                    convex3CrvCalculatorLibrary: factoryMetapoolCalculatorLibrary,
                    amounts: {
                        initialDeposit,
                        deposit: initialDeposit.div(4),
                        mint: initialDeposit.div(5),
                        withdraw: initialDeposit.div(3),
                        redeem: initialDeposit.div(6),
                    },
                }
            })
            behaveLikeConvex3CrvVault(() => ctx)
        })
        describe("withdraw should round up", async () => {
            let vault: Convex3CrvBasicVault
            before(async () => {
                await setup(15410000)
                vault = await deployVault(convexConstructorData, true)
                await vault.initialize("Vault Convex LUSD/3CRV", "vcvxLUSD3CRV", vaultManagerAddress, config.convex3CrvPools.lusd.slippageData)

                threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
                metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
                baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

                await threeCrvToken.connect(owner.signer).approve(vault.address, ethers.constants.MaxUint256)
            })
            it("withdrawing assets should round up", async () => {
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await threeCrvToken.connect(owner.signer).transfer(vault.address, 1)

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    describe("Curve3CrvFactoryMetapoolCalculatorLibrary", () => {
        let emptyPool: MockERC20
        before("before", async () => {
            await setup(normalBlock)

            emptyPool = await new MockERC20__factory(deployer).deploy("ERC20 Mock", "ERC20", 18, deployerAddress, 0)
        })
        it("fails to calculate deposit in an empty pool", async () => {
            await expect(factoryMetapoolCalculatorLibrary.calcDeposit(ZERO_ADDRESS, emptyPool.address, 500, 0)).to.be.revertedWith(
                "empty pool",
            )
        })
        it("fails to calculate mint in an empty pool", async () => {
            await expect(factoryMetapoolCalculatorLibrary.calcMint(ZERO_ADDRESS, emptyPool.address, 500, 0)).to.be.revertedWith(
                "empty pool",
            )
        })
        it("fails to calculate withdraw in an empty pool", async () => {
            await expect(factoryMetapoolCalculatorLibrary.calcWithdraw(ZERO_ADDRESS, emptyPool.address, 500, 0)).to.be.revertedWith(
                "empty pool",
            )
        })
        it("fails to calculate redeem in an empty pool", async () => {
            await expect(factoryMetapoolCalculatorLibrary.calcRedeem(ZERO_ADDRESS, emptyPool.address, 500, 0)).to.be.revertedWith(
                "empty pool",
            )
        })
        it("converts with ZERO amounts", async () => {
            expect(await factoryMetapoolCalculatorLibrary.convertUsdToBaseLp(ZERO)).to.be.eq(ZERO)
            expect(await factoryMetapoolCalculatorLibrary.convertUsdToMetaLp(ZERO_ADDRESS, ZERO)).to.be.eq(ZERO)
            expect(await factoryMetapoolCalculatorLibrary.convertToBaseLp(ZERO_ADDRESS, ZERO_ADDRESS, ZERO)).to.be.eq(ZERO)
            expect(await factoryMetapoolCalculatorLibrary.convertToMetaLp(ZERO_ADDRESS, ZERO_ADDRESS, ZERO)).to.be.eq(ZERO)
        })
    })
})
