/* eslint-disable @typescript-eslint/no-unused-vars */
import { deploy3CrvMetaVaults, deployCommon, deployCore } from "@tasks/deployment"
import { config } from "@tasks/deployment/mainnet-config"
import { logger } from "@tasks/utils/logger"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { assertBNClose } from "@utils/assertions"
import { DEAD_ADDRESS, ONE_HOUR, ONE_WEEK } from "@utils/constants"
import { impersonateAccount, setBalancesToAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import * as hre from "hardhat"
import { ethers } from "hardhat"
import {
    Convex3CrvLiquidatorVault__factory,
    CowSwapDex__factory,
    Curve3CrvBasicMetaVault__factory,
    DataEmitter__factory,
    IERC20Metadata__factory,
    MockGPv2Settlement__factory,
    MockGPv2VaultRelayer__factory,
    PeriodicAllocationPerfFeeMetaVault__factory,
} from "types/generated"

import { CRV, CVX, DAI, logTxDetails, ThreeCRV, USDC, USDT } from "../../tasks/utils"

import type { BigNumber, Signer } from "ethers"
import type {
    Convex3CrvLiquidatorVault,
    Convex3CrvPool,
    CowSwapDex,
    Curve3CrvBasicMetaVault,
    Curve3CrvPool,
    DataEmitter,
    Liquidator,
    MockGPv2VaultRelayer,
    Nexus,
} from "types"
import type { Account, AnyVault } from "types/common"
import type {
    Curve3CrvMetapoolCalculatorLibrary,
    Curve3PoolCalculatorLibrary,
    ERC20,
    IERC20Metadata,
    InstantProxyAdmin,
    PeriodicAllocationPerfFeeMetaVault,
} from "types/generated"

const log = logger("test:savePlus")

// const deployerAddress = resolveAddress("OperationsSigner")
const governorAddress = resolveAddress("Governor")
const feeReceiver = resolveAddress("mStableDAO")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf" //Coinbase 6
const usdtWhaleAddress = "0xd6216fc19db775df9774a6e33526131da7d19a2c"
const staker1Address = "0xA86e412109f77c45a3BC1c5870b880492Fb86A14" // Tokemak: Manager
const staker2Address = "0x701aEcF92edCc1DaA86c5E7EdDbAD5c311aD720C"
const rewardsWhaleAddress = "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2" // FTX Exchange
// const baseRewardPoolAddress = resolveAddress("CRVRewardsPool")
const curveThreePoolAddress = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
const convexBoosterAddress = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31"

async function deployMockAsyncSwapper(deployer: Signer, nexus: Nexus) {
    const gpv2Settlement = await new MockGPv2Settlement__factory(deployer).deploy()
    const relayer = await new MockGPv2VaultRelayer__factory(deployer).deploy(DEAD_ADDRESS)
    await relayer.initialize([
        { from: CRV.address, to: DAI.address, rate: simpleToExactAmount(62, 16) },
        { from: CVX.address, to: DAI.address, rate: simpleToExactAmount(57, 16) },
        { from: CRV.address, to: USDC.address, rate: simpleToExactAmount(61, 4) },
        { from: CVX.address, to: USDC.address, rate: simpleToExactAmount(56, 4) },
        { from: CRV.address, to: USDT.address, rate: simpleToExactAmount(63, 4) },
        { from: CVX.address, to: USDT.address, rate: simpleToExactAmount(58, 4) },
    ])
    const swapper = await new CowSwapDex__factory(deployer).deploy(nexus.address, relayer.address, gpv2Settlement.address)
    return { relayer, swapper }
}

async function proposeAcceptNexusModule(nexus: Nexus, governor: Account, moduleName: string, moduleAddress: string) {
    const moduleKey = keccak256(toUtf8Bytes(moduleName))

    await nexus.connect(governor.signer).proposeModule(moduleKey, moduleAddress)
    await increaseTime(ONE_WEEK)
    await nexus.connect(governor.signer).acceptProposedModule(moduleKey)
}

const assertVaultDeposit = async (staker: Account, asset: IERC20Metadata, vault: AnyVault, depositAmount: BigNumber) => {
    await increaseTime(ONE_HOUR)
    const variance = BN.from(10)
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const sharesPreviewed = await vault.connect(staker.signer).previewDeposit(depositAmount)
    const balanceOf = await asset.balanceOf(staker.address)
    log("🚀 ~ file: savePlus.spec.ts ~ line 94 ~ assertVaultDeposit ~ balanceOf", balanceOf.toString())
    const allowance = await asset.allowance(staker.address, vault.address)
    log("🚀 ~ file: savePlus.spec.ts ~ line 96 ~ assertVaultDeposit ~ allowance", allowance.toString())
    log("🚀 ~ file: savePlus.spec.ts ~ line 96 ~ assertVaultDeposit ~ depositAm", depositAmount.toString())

    const tx = await vault.connect(staker.signer)["deposit(uint256,address)"](depositAmount, staker.address)

    await ethers.provider.send("evm_mine", [])

    await logTxDetails(tx, "deposit")

    const sharesAfter = await vault.balanceOf(staker.address)
    const assetsAfter = await asset.balanceOf(staker.address)
    const sharesMinted = sharesAfter.sub(sharesBefore)

    assertBNClose(sharesMinted, sharesPreviewed, variance, "expected shares minted")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).eq(assetsBefore.sub(depositAmount))
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).gt(sharesBefore)
    // TODO ADD EVALUATION TO EVENTS
}
const assertVaultMint = async (
    staker: Account,
    asset: IERC20Metadata,
    vault: AnyVault,
    dataEmitter: DataEmitter,
    mintAmount: BigNumber,
) => {
    const variance = BN.from(10)
    await increaseTime(ONE_HOUR)
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const assetsPreviewed = await vault.connect(staker.signer).previewMint(mintAmount)

    // Need to get the totalSupply before the mint tx but in the same block
    const tx1 = await dataEmitter.emitStaticCall(vault.address, vault.interface.encodeFunctionData("totalSupply"))

    const tx2 = await vault.connect(staker.signer).mint(mintAmount, staker.address)

    await ethers.provider.send("evm_mine", [])
    const tx1Receipt = await tx1.wait()
    const totalSharesBefore = vault.interface.decodeFunctionResult("totalSupply", tx1Receipt.events[0].args[0])[0]

    await logTxDetails(tx2, "mint")
    const assetsAfter = await asset.balanceOf(staker.address)
    const assetsUsedForMint = assetsBefore.sub(assetsAfter)

    assertBNClose(assetsUsedForMint, assetsPreviewed, variance, "expected assets deposited")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).lt(assetsBefore)
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).eq(sharesBefore.add(mintAmount))
    const totalSharesAfter = await vault.totalSupply()
    expect(totalSharesAfter, "vault supply after").eq(totalSharesBefore.add(mintAmount))
}
const assertVaultWithdraw = async (staker: Account, asset: IERC20Metadata, vault: AnyVault, withdrawAmount: BigNumber) => {
    const variance = BN.from(10)
    await increaseTime(ONE_HOUR)
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const sharesPreviewed = await vault.connect(staker.signer).previewWithdraw(withdrawAmount)

    log("🚀 ~ file: savePlus.spec.ts ~ line 94 ~ assertVaultDeposit ~ assetsBefore", assetsBefore.toString())
    log("🚀 ~ file: savePlus.spec.ts ~ line 94 ~ assertVaultDeposit ~ sharesBefore", sharesBefore.toString())
    log("🚀 ~ file: savePlus.spec.ts ~ line 94 ~ assertVaultDeposit ~ sharesPreviewed", sharesPreviewed.toString())
    log("🚀 ~ file: savePlus.spec.ts ~ line 94 ~ assertVaultDeposit ~ withdrawAmount", withdrawAmount.toString())

    const tx = await vault.connect(staker.signer).withdraw(withdrawAmount, staker.address, staker.address)

    await ethers.provider.send("evm_mine", [])

    await logTxDetails(tx, "withdraw")

    const assetsAfter = await asset.balanceOf(staker.address)
    const sharesAfter = await vault.balanceOf(staker.address)
    const sharesBurned = sharesBefore.sub(sharesAfter)

    assertBNClose(sharesBurned, sharesPreviewed, variance, "expected shares burned")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).eq(assetsBefore.add(withdrawAmount))
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).lt(sharesBefore)
}
const assertVaultRedeem = async (
    staker: Account,
    asset: IERC20Metadata,
    vault: AnyVault,
    dataEmitter: DataEmitter,
    _redeemAmount?: BigNumber,
) => {
    const variance = BN.from(10)
    // Do a full redeem if no redeemAmount passed
    const redeemAmount = _redeemAmount ? _redeemAmount : await vault.balanceOf(staker.address)
    await increaseTime(ONE_HOUR)
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const assetsPreviewed = await vault.connect(staker.signer).previewRedeem(redeemAmount)

    // Need to get the totalSupply before the mint tx but in the same block
    const tx1 = await dataEmitter.emitStaticCall(vault.address, vault.interface.encodeFunctionData("totalSupply"))

    const tx2 = await vault.connect(staker.signer)["redeem(uint256,address,address)"](redeemAmount, staker.address, staker.address)

    await ethers.provider.send("evm_mine", [])
    const tx1Receipt = await tx1.wait()
    const totalSharesBefore = vault.interface.decodeFunctionResult("totalSupply", tx1Receipt.events[0].args[0])[0]

    await logTxDetails(tx2, "redeem")

    const assetsAfter = await asset.balanceOf(staker.address)
    const sharesAfter = await vault.balanceOf(staker.address)
    const assetsRedeemed = assetsAfter.sub(assetsBefore)

    assertBNClose(assetsRedeemed, assetsPreviewed, variance, "expected assets redeemed")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).gt(assetsBefore)
    expect(sharesAfter, `staker ${await vault.symbol()} shares after`).eq(sharesBefore.sub(redeemAmount))
    expect(await vault.totalSupply(), "vault supply after").eq(totalSharesBefore.sub(redeemAmount))
}

const snapConvex3CrvLiquidatorVaults = async (
    vaults: {
        musd: Convex3CrvLiquidatorVault
        frax: Convex3CrvLiquidatorVault
        lusd: Convex3CrvLiquidatorVault
        busd: Convex3CrvLiquidatorVault
    },
    accountAddress: string,
) => {
    const snapVault = async (vault: Convex3CrvLiquidatorVault) => ({
        totalAssets: await vault.totalAssets(),
        totalSupply: await vault.totalSupply(),
        accountBalance: await vault.balanceOf(accountAddress),
    })
    const vaultsData = {
        musd: await snapVault(vaults.musd),
        frax: await snapVault(vaults.frax),
        lusd: await snapVault(vaults.lusd),
        busd: await snapVault(vaults.busd),
    }
    log(`
    musd: {totalAssets:${vaultsData.musd.totalAssets.toString()}, totalSupply:${vaultsData.musd.totalSupply.toString()} , accountBalance:${vaultsData.musd.accountBalance.toString()} }
    frax: {totalAssets:${vaultsData.frax.totalAssets.toString()}, totalSupply:${vaultsData.frax.totalSupply.toString()} , accountBalance:${vaultsData.frax.accountBalance.toString()} }
    lusd: {totalAssets:${vaultsData.lusd.totalAssets.toString()}, totalSupply:${vaultsData.lusd.totalSupply.toString()} , accountBalance:${vaultsData.lusd.accountBalance.toString()} }
    busd:  {totalAssets:${vaultsData.busd.totalAssets.toString()}, totalSupply:${vaultsData.busd.totalSupply.toString()} , accountBalance:${vaultsData.busd.accountBalance.toString()} }
    `)
    return vaultsData
}
const snapPeriodicAllocationPerfFeeMetaVault = async (
    vault: PeriodicAllocationPerfFeeMetaVault,
    users: { user1: string; user2: string },
) => {
    const vaultData = {
        totalSupply: await vault.totalSupply(),
        totalAssets: await vault.totalAssets(),
        assetsPerShare: await vault.assetsPerShare(),
    }
    const usersData = {
        user1Balance: await vault.balanceOf(users.user1),
        user2Balance: await vault.balanceOf(users.user2),
    }
    log(`
    vault: {totalAssets:${vaultData.totalAssets.toString()}, totalSupply:${vaultData.totalSupply.toString()} , assetsPerShare:${vaultData.assetsPerShare.toString()} }
    users: {user1Balance:${usersData.user1Balance.toString()}, user2Balance:${usersData.user2Balance.toString()}}
    `)
    return {
        vault: vaultData,
        users: usersData,
    }
}

describe("Save+ Basic and Meta Vaults", async () => {
    let deployer: Signer
    let governor: Account
    let staker1: Account
    let staker2: Account
    let rewardsWhale: Account
    let vaultManager: Account
    let usdtWhale: Account
    let nexus: Nexus
    let proxyAdmin: InstantProxyAdmin
    let relayer: MockGPv2VaultRelayer
    let swapper: CowSwapDex
    let liquidator: Liquidator
    let threeCrvToken: IERC20Metadata
    let cvxToken: IERC20Metadata
    let crvToken: IERC20Metadata
    let daiToken: IERC20Metadata
    let usdcToken: IERC20Metadata
    let usdtToken: IERC20Metadata
    let threePoolcalculatorLibrary: Curve3PoolCalculatorLibrary
    let metapoolCalculatorLibrary: Curve3CrvMetapoolCalculatorLibrary
    let musdConvexVault: Convex3CrvLiquidatorVault
    let fraxConvexVault: Convex3CrvLiquidatorVault
    let lusdConvexVault: Convex3CrvLiquidatorVault
    let busdConvexVault: Convex3CrvLiquidatorVault
    let PeriodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault
    let daiMetaVault: Curve3CrvBasicMetaVault
    let usdcMetaVault: Curve3CrvBasicMetaVault
    let usdtMetaVault: Curve3CrvBasicMetaVault

    let dataEmitter: DataEmitter
    const { network } = hre

    const setup = async () => {
        // deployer = await impersonate(deployerAddress)
        governor = await impersonateAccount(governorAddress)
        deployer = governor.signer

        staker1 = await impersonateAccount(staker1Address)
        staker2 = await impersonateAccount(staker2Address)
        rewardsWhale = await impersonateAccount(rewardsWhaleAddress)
        vaultManager = await impersonateAccount(vaultManagerAddress)
        usdtWhale = await impersonateAccount(usdtWhaleAddress)

        // Deploy core contracts  (nexus, proxy admin)
        const core = await deployCore(hre, deployer, "instant", governor.address)
        nexus = core.nexus
        proxyAdmin = core.proxyAdmin as InstantProxyAdmin

        // Deploy mocked contracts
        ;({ swapper, relayer } = await deployMockAsyncSwapper(deployer, nexus))

        // Deploy common /  utilities  contracts
        ;({ liquidator } = await deployCommon(hre, deployer, core, null, swapper.address))

        await proposeAcceptNexusModule(nexus, governor, "Liquidator", liquidator.address)
        liquidator = liquidator.connect(governor.signer)

        //  1 - deployConvex3CrvLiquidatorVault,  2 - deployPeriodicAllocationPerfFeeMetaVaults,  3 - deployCurve3CrvMetaVault
        const { convex3CrvVaults, periodicAllocationPerfFeeMetaVault, curve3CrvMetaVaults } = await deploy3CrvMetaVaults(
            hre,
            deployer,
            core,
            vaultManagerAddress,
        )

        //  1.- underlying meta vaults capable of liquidate rewards
        musdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.musd.proxy.address, deployer)
        fraxConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.frax.proxy.address, deployer)
        lusdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.lusd.proxy.address, deployer)
        busdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.busd.proxy.address, deployer)

        // 2.- save plus meta vault
        PeriodicAllocationPerfFeeMetaVault = PeriodicAllocationPerfFeeMetaVault__factory.connect(
            periodicAllocationPerfFeeMetaVault.proxy.address,
            deployer,
        )

        //  3.- 4626 Wrappers of the save plus meta vault
        daiMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.dai.proxy.address, deployer)
        usdcMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.usdc.proxy.address, deployer)
        usdtMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.usdt.proxy.address, deployer)

        // Deploy mocked contracts
        dataEmitter = await new DataEmitter__factory(deployer).deploy()

        threeCrvToken = await IERC20Metadata__factory.connect(ThreeCRV.address, staker1.signer)
        cvxToken = await IERC20Metadata__factory.connect(CVX.address, staker1.signer)
        crvToken = await IERC20Metadata__factory.connect(CRV.address, staker1.signer)
        daiToken = await IERC20Metadata__factory.connect(DAI.address, staker1.signer)
        usdcToken = await IERC20Metadata__factory.connect(USDC.address, staker1.signer)
        usdtToken = await IERC20Metadata__factory.connect(USDT.address, staker1.signer)

        // Mock Balances on our lovely users
        // const threeCRVTokenWhale = "0xd632f22692fac7611d2aa1c0d552930d43caed3b"
        const musdTokenAddress = resolveAddress("mUSD")
        const daiTokenAddress = DAI.address
        const usdcTokenAddress = USDC.address
        const usdtTokenAddress = USDT.address
        const tokensToMockBalance = { musdTokenAddress, usdcTokenAddress, daiTokenAddress, usdtTokenAddress }

        await setBalancesToAccount(staker1, [] as ERC20[], tokensToMockBalance, 10000000000)
        await setBalancesToAccount(staker2, [] as ERC20[], tokensToMockBalance, 10000000000)
        // Stakers approve vaults to take their tokens
        await threeCrvToken.connect(staker1.signer).approve(PeriodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)
        await threeCrvToken.connect(staker2.signer).approve(PeriodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)

        await daiToken.connect(staker1.signer).approve(daiMetaVault.address, ethers.constants.MaxUint256)
        await daiToken.connect(staker2.signer).approve(daiMetaVault.address, ethers.constants.MaxUint256)

        await usdcToken.connect(staker1.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)
        await usdcToken.connect(staker2.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)

        await usdtToken.connect(usdtWhale.signer).transfer(staker1.address, simpleToExactAmount(10000000, USDT.decimals))
        await usdtToken.connect(usdtWhale.signer).transfer(staker2.address, simpleToExactAmount(10000000, USDT.decimals))

        await usdtToken.connect(staker1.signer).approve(usdtMetaVault.address, ethers.constants.MaxUint256)
        await usdtToken.connect(staker2.signer).approve(usdtMetaVault.address, ethers.constants.MaxUint256)
    }
    async function resetNetwork(blockNumber: number) {
        // Only reset if using the in memory hardhat chain
        // No need to reset if using a local fork node
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
    }

    const assertConvex3CrvVaultConfiguration = async (convex3CrvVault: Convex3CrvLiquidatorVault, convex3CrvPool: Convex3CrvPool) => {
        expect(await convex3CrvVault.nexus(), "nexus").eq(nexus.address)
        expect(await convex3CrvVault.metapool(), "curve Metapool").to.equal(convex3CrvPool.curveMetapool)
        expect(await convex3CrvVault.metapoolToken(), "metapool token").to.equal(convex3CrvPool.curveMetapoolToken)
        expect(await convex3CrvVault.basePool(), "3Pool pool").to.equal(curveThreePoolAddress)
        expect(await convex3CrvVault.booster(), "booster").to.equal(convexBoosterAddress)
        expect(await convex3CrvVault.convexPoolId(), "convex Pool Id").to.equal(convex3CrvPool.convexPoolId)
        expect(await convex3CrvVault.baseRewardPool(), "base reward pool").to.equal(convex3CrvPool.convexRewardPool)
    }
    const expectCurve3CrvVaultConfiguration = async (curve3CrvVault: Curve3CrvBasicMetaVault, curve3CrvPool: Curve3CrvPool) => {
        // check a minimum set of configurations
        expect(await curve3CrvVault.nexus(), "nexus").eq(nexus.address)
        expect(await curve3CrvVault.metaVault(), "underlying metaVault").to.equal(PeriodicAllocationPerfFeeMetaVault.address)
        expect(await curve3CrvVault.asset(), "asset").to.equal(curve3CrvPool.asset)
        expect(await curve3CrvVault.name(), "name").to.equal(curve3CrvPool.name)
        expect(await curve3CrvVault.symbol(), "symbol").to.equal(curve3CrvPool.symbol)
        expect(await curve3CrvVault.decimals(), "decimals").to.equal(18)
    }
    before("reset block number", async () => {
        await resetNetwork(14960000)
        await setup()
        // await loadFixture(setup)
    })
    context("deployment check", async () => {
        it("instant admin", async () => {
            expect(await proxyAdmin.owner(), "owner must be governor").to.be.eq(governorAddress)
        })

        describe("Convex 3Crv Liquidator Vaults", async () => {
            it("musd should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(musdConvexVault, config.convex3CrvPools.musd)
            })
            it("BUSD should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(busdConvexVault, config.convex3CrvPools.busd)
            })
            it("frax should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(fraxConvexVault, config.convex3CrvPools.frax)
            })
            it("lusd should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(lusdConvexVault, config.convex3CrvPools.lusd)
            })
        })
        it("Curve Convex 3Crv Meta Vault", async () => {
            // constructor
            expect(await PeriodicAllocationPerfFeeMetaVault.nexus(), "nexus").eq(nexus.address)
            expect(await PeriodicAllocationPerfFeeMetaVault.asset(), "asset").to.equal(config.PeriodicAllocationPerfFeeMetaVault.asset)

            // initialize
            expect(await PeriodicAllocationPerfFeeMetaVault.name(), "name").to.equal(config.PeriodicAllocationPerfFeeMetaVault.name)
            expect(await PeriodicAllocationPerfFeeMetaVault.symbol(), "symbol").to.equal(config.PeriodicAllocationPerfFeeMetaVault.symbol)
            expect(await PeriodicAllocationPerfFeeMetaVault.decimals(), "decimals").to.equal(18)
            expect(await PeriodicAllocationPerfFeeMetaVault.vaultManager(), "vaultManager").to.equal(vaultManager.address)
            expect(await PeriodicAllocationPerfFeeMetaVault.performanceFee(), "performanceFee").to.equal(
                config.PeriodicAllocationPerfFeeMetaVault.performanceFee,
            )
            expect(await PeriodicAllocationPerfFeeMetaVault.feeReceiver(), "feeReceiver").to.equal(feeReceiver)
            // TODO - validate the order is correct
            expect(await PeriodicAllocationPerfFeeMetaVault.underlyingVaults(0), "underlyingVaults 0").to.equal(musdConvexVault.address)
            expect(await PeriodicAllocationPerfFeeMetaVault.underlyingVaults(1), "underlyingVaults 1").to.equal(fraxConvexVault.address)
            expect(await PeriodicAllocationPerfFeeMetaVault.underlyingVaults(2), "underlyingVaults 2").to.equal(lusdConvexVault.address)
            expect(await PeriodicAllocationPerfFeeMetaVault.underlyingVaults(3), "underlyingVaults 3").to.equal(busdConvexVault.address)
            expect(await PeriodicAllocationPerfFeeMetaVault.assetPerShareUpdateThreshold(), "assetPerShareUpdateThreshold").to.equal(
                config.PeriodicAllocationPerfFeeMetaVault.assetPerShareUpdateThreshold,
            )
            const sourceParams = await PeriodicAllocationPerfFeeMetaVault.sourceParams()
            expect(sourceParams.singleSourceVaultIndex, "singleSourceVaultIndex").to.equal(
                config.PeriodicAllocationPerfFeeMetaVault.sourceParams.singleSourceVaultIndex,
            )
            expect(sourceParams.singleVaultSharesThreshold, "singleVaultSharesThreshold").to.equal(
                config.PeriodicAllocationPerfFeeMetaVault.sourceParams.singleVaultSharesThreshold,
            )
        })

        // 4626 Wrappers that facilitate deposit / withdraw USDC | DAI| USDT
        describe("Curve 3Crv Meta Vaults", async () => {
            it("dai should properly store valid arguments", async () => {
                await expectCurve3CrvVaultConfiguration(daiMetaVault, config.curve3CrvMetaVault.dai)
            })
            it("usdc should properly store valid arguments", async () => {
                await expectCurve3CrvVaultConfiguration(usdcMetaVault, config.curve3CrvMetaVault.usdc)
            })
            it("usdt should properly store valid arguments", async () => {
                await expectCurve3CrvVaultConfiguration(usdtMetaVault, config.curve3CrvMetaVault.usdt)
            })
        })
    })
    context("PeriodicAllocationPerfFeeMetaVault", async () => {
        describe("basic flow", () => {
            it.skip("deposit 3Crv", async () => {
                await assertVaultDeposit(
                    staker1,
                    threeCrvToken,
                    PeriodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(50000, ThreeCRV.decimals),
                )
            })
            it.skip("mint shares", async () => {
                await assertVaultMint(
                    staker1,
                    threeCrvToken,
                    PeriodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(40000, ThreeCRV.decimals),
                )
            })
            it.skip("partial withdraw", async () => {
                await assertVaultWithdraw(
                    staker1,
                    threeCrvToken,
                    PeriodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(60000, ThreeCRV.decimals),
                )
            })
            it.skip("partial redeem", async () => {
                await assertVaultRedeem(
                    staker1,
                    threeCrvToken,
                    PeriodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(7000, ThreeCRV.decimals),
                )
            })
        })
        describe("settlement flow", () => {
            let convex3CrvLiquidatorVaultsDataBefore
            let PeriodicAllocationPerfFeeMetaVaultDataBefore

            beforeEach("beforeEach", async () => {
                convex3CrvLiquidatorVaultsDataBefore = await snapConvex3CrvLiquidatorVaults(
                    {
                        musd: musdConvexVault,
                        frax: fraxConvexVault,
                        lusd: lusdConvexVault,
                        busd: busdConvexVault,
                    },
                    PeriodicAllocationPerfFeeMetaVault.address,
                )

                PeriodicAllocationPerfFeeMetaVaultDataBefore = await snapPeriodicAllocationPerfFeeMetaVault(
                    PeriodicAllocationPerfFeeMetaVault,
                    {
                        user1: staker1Address,
                        user2: staker2Address,
                    },
                )
            })
            it("deposit 3Crv", async () => {
                await assertVaultDeposit(
                    staker1,
                    threeCrvToken,
                    PeriodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(17000, ThreeCRV.decimals),
                )
            })
            it("settles to underlying vaults", async () => {
                // check underlying assets balance before
                log("data before")

                const totalAssets = await PeriodicAllocationPerfFeeMetaVault.totalAssets()

                log(`totalAssets.div(4):  ${totalAssets.div(4).toString()}`)
                // Settle evenly to underlying assets
                const musdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(4) }
                const fraxSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(4) }
                const lusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(4) }
                const busdSettlement = { vaultIndex: BN.from(3), assets: totalAssets.div(4) }

                await PeriodicAllocationPerfFeeMetaVault.connect(vaultManager.signer).settle([
                    musdSettlement,
                    fraxSettlement,
                    lusdSettlement,
                    busdSettlement,
                ])

                // TODO - it might be missing an event on PeriodicAllocationAbstractVault.settle

                log("data after")

                const convex3CrvLiquidatorVaultsDataAfter = await snapConvex3CrvLiquidatorVaults(
                    {
                        musd: musdConvexVault,
                        frax: fraxConvexVault,
                        lusd: lusdConvexVault,
                        busd: busdConvexVault,
                    },
                    PeriodicAllocationPerfFeeMetaVault.address,
                )

                const PeriodicAllocationPerfFeeMetaVaultDataAfter = await snapPeriodicAllocationPerfFeeMetaVault(
                    PeriodicAllocationPerfFeeMetaVault,
                    {
                        user1: staker1Address,
                        user2: staker2Address,
                    },
                )

                expect(PeriodicAllocationPerfFeeMetaVaultDataBefore.vault.totalSupply, "vault total supply does not change").to.eq(
                    PeriodicAllocationPerfFeeMetaVaultDataAfter.vault.totalSupply,
                )
                expect(PeriodicAllocationPerfFeeMetaVaultDataBefore.vault.totalAssets, "vault total assets changes").to.gt(
                    PeriodicAllocationPerfFeeMetaVaultDataAfter.vault.totalAssets,
                )
                expect(PeriodicAllocationPerfFeeMetaVaultDataBefore.vault.assetsPerShare, "vault assets per share changes").to.gt(
                    PeriodicAllocationPerfFeeMetaVaultDataAfter.vault.assetsPerShare,
                )
            })
        })
    })
    context("Curve3CrvBasicMetaVault", async () => {
        const depositAmount = 50000
        const mintAmount = 40000

        before("reset block number", async () => {
            await resetNetwork(14960000)
            await setup()
            // await loadFixture(setup)
        })
        describe("basic flow", () => {
            it("deposit erc20Token", async () => {
                await assertVaultDeposit(staker1, daiToken, daiMetaVault, simpleToExactAmount(depositAmount, DAI.decimals))
                await assertVaultDeposit(staker1, usdcToken, usdcMetaVault, simpleToExactAmount(depositAmount, USDC.decimals))
                await assertVaultDeposit(staker1, usdtToken, usdtMetaVault, simpleToExactAmount(depositAmount, USDT.decimals))
            })
            it("mint shares", async () => {
                await assertVaultMint(staker1, daiToken, daiMetaVault, dataEmitter, simpleToExactAmount(mintAmount, ThreeCRV.decimals))
                await assertVaultMint(staker1, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(mintAmount, ThreeCRV.decimals))
                await assertVaultMint(staker1, usdtToken, usdtMetaVault, dataEmitter, simpleToExactAmount(mintAmount, ThreeCRV.decimals))
            })
            it("partial withdraw", async () => {
                await assertVaultWithdraw(staker1, daiToken, daiMetaVault, simpleToExactAmount(60000, DAI.decimals))
                await assertVaultWithdraw(staker1, usdcToken, usdcMetaVault, simpleToExactAmount(60000, USDC.decimals))
                await assertVaultWithdraw(staker1, usdtToken, usdtMetaVault, simpleToExactAmount(60000, USDT.decimals))
            })
            it("partial redeem", async () => {
                await assertVaultRedeem(staker1, daiToken, daiMetaVault, dataEmitter, simpleToExactAmount(7000, ThreeCRV.decimals))
                await assertVaultRedeem(staker1, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(7000, ThreeCRV.decimals))
                await assertVaultRedeem(staker1, usdtToken, usdtMetaVault, dataEmitter, simpleToExactAmount(7000, ThreeCRV.decimals))
            })
        })
        describe.skip("settlement flow", () => {
            let convex3CrvLiquidatorVaultsDataBefore
            let PeriodicAllocationPerfFeeMetaVaultDataBefore

            beforeEach("beforeEach", async () => {
                convex3CrvLiquidatorVaultsDataBefore = await snapConvex3CrvLiquidatorVaults(
                    {
                        musd: musdConvexVault,
                        frax: fraxConvexVault,
                        lusd: lusdConvexVault,
                        busd: busdConvexVault,
                    },
                    PeriodicAllocationPerfFeeMetaVault.address,
                )

                PeriodicAllocationPerfFeeMetaVaultDataBefore = await snapPeriodicAllocationPerfFeeMetaVault(
                    PeriodicAllocationPerfFeeMetaVault,
                    {
                        user1: staker1Address,
                        user2: staker2Address,
                    },
                )
            })
            xit("deposit 3Crv", async () => {
                await assertVaultDeposit(
                    staker1,
                    threeCrvToken,
                    PeriodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(17000, ThreeCRV.decimals),
                )
            })
            xit("settles to underlying vaults", async () => {
                // check underlying assets balance before
                log("data before")

                const totalAssets = await PeriodicAllocationPerfFeeMetaVault.totalAssets()

                log(`totalAssets.div(4):  ${totalAssets.div(4).toString()}`)
                // Settle evenly to underlying assets
                const musdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(4) }
                const fraxSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(4) }
                const lusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(4) }
                const busdSettlement = { vaultIndex: BN.from(3), assets: totalAssets.div(4) }

                await PeriodicAllocationPerfFeeMetaVault.connect(vaultManager.signer).settle([
                    musdSettlement,
                    fraxSettlement,
                    lusdSettlement,
                    busdSettlement,
                ])

                // TODO - it might be missing an event on PeriodicAllocationAbstractVault.settle

                log("data after")

                const convex3CrvLiquidatorVaultsDataAfter = await snapConvex3CrvLiquidatorVaults(
                    {
                        musd: musdConvexVault,
                        frax: fraxConvexVault,
                        lusd: lusdConvexVault,
                        busd: busdConvexVault,
                    },
                    PeriodicAllocationPerfFeeMetaVault.address,
                )

                const PeriodicAllocationPerfFeeMetaVaultDataAfter = await snapPeriodicAllocationPerfFeeMetaVault(
                    PeriodicAllocationPerfFeeMetaVault,
                    {
                        user1: staker1Address,
                        user2: staker2Address,
                    },
                )

                expect(PeriodicAllocationPerfFeeMetaVaultDataBefore.vault.totalSupply, "vault total supply does not change").to.eq(
                    PeriodicAllocationPerfFeeMetaVaultDataAfter.vault.totalSupply,
                )
                expect(PeriodicAllocationPerfFeeMetaVaultDataBefore.vault.totalAssets, "vault total assets changes").to.gt(
                    PeriodicAllocationPerfFeeMetaVaultDataAfter.vault.totalAssets,
                )
                expect(PeriodicAllocationPerfFeeMetaVaultDataBefore.vault.assetsPerShare, "vault assets per share changes").to.gt(
                    PeriodicAllocationPerfFeeMetaVaultDataAfter.vault.assetsPerShare,
                )
            })
        })
    })
})
