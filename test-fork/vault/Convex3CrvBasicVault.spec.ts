import { config } from "@tasks/deployment/mainnet-config"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { musd3CRV, ThreeCRV } from "@tasks/utils/tokens"
import { SAFE_INFINITY } from "@utils/constants"
import { impersonate, impersonateAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import * as hre from "hardhat"
import {
    AbstractVault,
    Convex3CrvBasicVault__factory,
    Curve3CrvFactoryMetapoolCalculatorLibrary__factory,
    Curve3CrvMetapoolCalculatorLibrary__factory,
    DataEmitter__factory,
    IConvexRewardsPool__factory,
    ICurve3Pool__factory,
    ICurveMetapool__factory,
    IERC20__factory,
} from "types/generated"

import { behaveLikeConvex3CrvVault, snapVault } from "./shared/Convex3Crv.behaviour"

import type { Signer } from "ethers"
import type { Account, Convex3CrvConstructorData, Convex3CrvPool } from "types"
import type {
    Convex3CrvBasicVault,
    Curve3CrvFactoryMetapoolCalculatorLibrary,
    Curve3CrvMetapoolCalculatorLibrary,
    DataEmitter,
    IConvexRewardsPool,
    ICurve3Pool,
    ICurveMetapool,
    IERC20,
} from "types/generated"

import type { Convex3CrvContext } from "./shared/Convex3Crv.behaviour"
import { BaseVaultBehaviourContext } from "@test/shared/BaseVault.behaviour"
import { StandardAccounts } from "@utils/machines"

const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const nexusAddress = resolveAddress("Nexus")
const baseRewardPoolAddress = resolveAddress("CRVRewardsPool")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf"
const threeCrvWhaleAddress = "0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A" // Curve.fi: DAI/USDC/USDT Gauge
const bobAddress = "0x701aEcF92edCc1DaA86c5E7EdDbAD5c311aD720C"
const normalBlock = 14677900

describe("Convex 3Crv Basic Vault", async () => {
    let deployer: Signer
    let owner: Account
    let governor: Account
    let bob: Account
    let threeCrvToken: IERC20
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

        threeCrvToken = IERC20__factory.connect(ThreeCRV.address, deployer)

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

    const createBaseContext = async (constructorData: Convex3CrvConstructorData, slippageData: Convex3CrvPool["slippageData"], initialDeposit: BN): Promise<Partial<BaseVaultBehaviourContext>> => {
        const baseCtx: Partial<BaseVaultBehaviourContext> = {}
        baseCtx.fixture = async function fixture() {
            await setup(normalBlock)
            const vault = await deployVault(constructorData)
            await vault.initialize("Vault Convex mUSD/3CRV", "vcvxmusd3CRV", vaultManagerAddress, slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, SAFE_INFINITY)

            let sa = new StandardAccounts()
            sa.default = owner
            sa.alice = owner
            sa.bob = bob
            sa.governor = governor
            sa.dummy1 = bob

            // TODO - check acceptable levels
            const variances = {
                deposit: "0.02",
                mint: "0.02",
                withdraw: "0.02",
                redeem: "0.02",
                convertToShares: "0.05",
                convertToAssets: "0.05",
                maxWithdraw: "0.02",
                maxRedeem: "0.02",
            }

            baseCtx.vault = vault as unknown as AbstractVault
            baseCtx.asset = threeCrvToken
            baseCtx.sa = sa
            baseCtx.amounts = {
                initialDeposit,
                deposit: initialDeposit.div(4),
                mint: initialDeposit.div(5),
                withdraw: initialDeposit.div(3),
                redeem: initialDeposit.div(6),
            }
            baseCtx.variances = variances
        }
        return baseCtx
    }

    it("deploy and initialize Convex vault for mUSD pool", async () => {
        await setup(normalBlock)
        const musdConvexConstructorData = config.convex3CrvConstructors.musd
        const vault = await deployVault(musdConvexConstructorData)

        expect(await vault.nexus(), "nexus").eq(nexusAddress)

        expect(await vault.metapool(), "metapool").to.equal(musdConvexConstructorData.metapool)
        expect(await vault.metapoolToken(), "metapool token").to.equal(musdConvexConstructorData.metapoolToken)
        expect(await vault.basePool(), "base pool").to.equal(musdConvexConstructorData.basePool)
        expect(await vault.booster(), "booster").to.equal(musdConvexConstructorData.booster)
        expect(await vault.convexPoolId(), "convex Pool Id").to.equal(musdConvexConstructorData.convexPoolId)
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
        expect(data.convex.curveMetapool, "Curve Metapool").eq(musdConvexConstructorData.metapool)
        expect(data.convex.booster, "booster").eq(musdConvexConstructorData.booster)
        expect(data.convex.convexPoolId, "poolId").eq(musdConvexConstructorData.convexPoolId)
        expect(data.convex.metapoolToken, "metapoolToken").eq(musd3CRV.address)
        expect(data.convex.baseRewardPool, "baseRewardPool").eq(baseRewardPoolAddress)

        // Vault balances
        expect(data.vault.balanceOf, "balanceOf").eq(0)
        expect(data.vault.totalAssets, "totalAssets").eq(0)
        expect(data.vault.totalSupply, "totalSupply").eq(0)
    })
    describe("mUSD Convex Vault", () => {
        const initialDeposit = simpleToExactAmount(400000, 18)
        let ctx: Convex3CrvContext
        before(async () => {
            await setup(normalBlock)
            const vault = await deployVault(config.convex3CrvConstructors.musd)
            await vault.initialize("Vault Convex mUSD/3CRV", "vcvxmusd3CRV", vaultManagerAddress, config.convex3CrvPools.musd.slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, SAFE_INFINITY)
            await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)

            ctx = {
                vault: vault.connect(owner.signer),
                owner,
                threePool,
                threeCrvToken,
                metapool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(3),
                    redeem: initialDeposit.div(6),
                },
                baseCtx: await createBaseContext(config.convex3CrvConstructors.musd, config.convex3CrvPools.musd.slippageData, initialDeposit)
            }
        })
        behaveLikeConvex3CrvVault(() => ctx)
    })
    describe("USDP Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(2000, 18)
        before(async () => {
            await setup(15410000)
            const vault = await deployVault(config.convex3CrvConstructors.usdp)
            await vault.initialize("Vault Convex USDP/3CRV", "vcvxUSDP3CRV", vaultManagerAddress, config.convex3CrvPools.usdp.slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, SAFE_INFINITY)
            await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
            ctx = {
                vault: vault.connect(owner.signer),
                owner,
                threePool,
                threeCrvToken,
                metapool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(3),
                    redeem: initialDeposit.div(6),
                },
                baseCtx: await createBaseContext(config.convex3CrvConstructors.usdp, config.convex3CrvPools.usdp.slippageData, initialDeposit)
            }
        })
        behaveLikeConvex3CrvVault(() => ctx)
    })
    describe("FRAX Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        before(async () => {
            await setup(15410000)
            const vault = await deployVault(config.convex3CrvConstructors.frax, true)
            await vault.initialize("Vault Convex FRAX/3CRV", "vcvxFRAX3CRV", vaultManagerAddress, config.convex3CrvPools.frax.slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, SAFE_INFINITY)
            await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
            ctx = {
                vault: vault.connect(owner.signer),
                owner,
                threePool,
                threeCrvToken,
                metapool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(3),
                    redeem: initialDeposit.div(6),
                },
                baseCtx: await createBaseContext(config.convex3CrvConstructors.frax, config.convex3CrvPools.frax.slippageData, initialDeposit)
            }
        })
        behaveLikeConvex3CrvVault(() => ctx)
    })
    describe("BUSD Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        before(async () => {
            await setup(15410000)
            const vault = await deployVault(config.convex3CrvConstructors.busd, true)
            await vault.initialize("Vault Convex BUSD/3CRV", "vcvxBUSD3CRV", vaultManagerAddress, config.convex3CrvPools.busd.slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, SAFE_INFINITY)
            await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
            ctx = {
                vault: vault.connect(owner.signer),
                owner,
                threePool,
                threeCrvToken,
                metapool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(3),
                    redeem: initialDeposit.div(6),
                },
                baseCtx: await createBaseContext(config.convex3CrvConstructors.busd, config.convex3CrvPools.busd.slippageData, initialDeposit)
            }
        })
        behaveLikeConvex3CrvVault(() => ctx)
    })
    describe("LUSD Convex Vault", () => {
        let ctx: Convex3CrvContext
        const initialDeposit = simpleToExactAmount(50000, 18)
        before(async () => {
            await setup(15410000)
            const vault = await deployVault(config.convex3CrvConstructors.lusd, true)
            await vault.initialize("Vault Convex LUSD/3CRV", "vcvxLUSD3CRV", vaultManagerAddress, config.convex3CrvPools.lusd.slippageData)

            threePool = ICurve3Pool__factory.connect(await vault.basePool(), owner.signer)
            metapool = ICurveMetapool__factory.connect(await vault.metapool(), owner.signer)
            baseRewardsPool = IConvexRewardsPool__factory.connect(await vault.baseRewardPool(), owner.signer)

            await threeCrvToken.connect(owner.signer).approve(vault.address, SAFE_INFINITY)
            await vault.connect(owner.signer)["deposit(uint256,address)"](initialDeposit, owner.address)
            ctx = {
                vault: vault.connect(owner.signer),
                owner,
                threePool,
                threeCrvToken,
                metapool,
                baseRewardsPool,
                dataEmitter,
                amounts: {
                    initialDeposit,
                    deposit: initialDeposit.div(4),
                    mint: initialDeposit.div(5),
                    withdraw: initialDeposit.div(3),
                    redeem: initialDeposit.div(6),
                },
                baseCtx: await createBaseContext(config.convex3CrvConstructors.lusd, config.convex3CrvPools.lusd.slippageData, initialDeposit)
            }
        })
        behaveLikeConvex3CrvVault(() => ctx)
    })
})
