import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { deploy3CrvMetaVaults, deployCommon, deployCore } from "@tasks/deployment"
import { config } from "@tasks/deployment/mainnet-config"
import { logger } from "@tasks/utils/logger"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { shouldBehaveLikeAbstractVault } from "@test/shared/AbstractVault.behaviour"
import { assertBNClose, assertBNClosePercent, findContractEvent } from "@utils/assertions"
import { DEAD_ADDRESS, ONE_HOUR, ONE_WEEK } from "@utils/constants"
import { impersonateAccount, setBalancesToAccount } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import * as hre from "hardhat"
import { ethers } from "hardhat"
import {
    BasicDexSwap__factory,
    Convex3CrvLiquidatorVault__factory,
    CowSwapDex__factory,
    Curve3CrvBasicMetaVault__factory,
    DataEmitter__factory,
    IERC20__factory,
    IERC20Metadata__factory,
    MockGPv2Settlement__factory,
    MockGPv2VaultRelayer__factory,
    PeriodicAllocationPerfFeeMetaVault__factory,
} from "types/generated"

import { buildDonateTokensInput, CRV, CVX, DAI, logTxDetails, ThreeCRV, USDC, usdFormatter, USDT } from "../../tasks/utils"

import type { AbstractVaultBehaviourContext } from "@test/shared/AbstractVault.behaviour"
import type { BigNumber, ContractTransaction, Signer } from "ethers"
import type {
    Convex3CrvLiquidatorVault,
    Convex3CrvPool,
    CowSwapDex,
    Curve3CrvBasicMetaVault,
    Curve3CrvPool,
    DataEmitter,
    Liquidator,
    Nexus,
} from "types"
import type { Account, AnyVault } from "types/common"
import type { AbstractVault, ERC20, IERC20Metadata, InstantProxyAdmin, PeriodicAllocationPerfFeeMetaVault } from "types/generated"

const log = logger("test:savePlus")

const governorAddress = resolveAddress("Governor")
const feeReceiver = resolveAddress("mStableDAO")
const vaultManagerAddress = "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf" //Coinbase 6
const usdtWhaleAddress = "0xd6216fc19db775df9774a6e33526131da7d19a2c"
const staker1Address = "0xA86e412109f77c45a3BC1c5870b880492Fb86A14" // Tokemak: Manager
const staker2Address = "0x701aEcF92edCc1DaA86c5E7EdDbAD5c311aD720C"
const rewardsWhaleAddress = "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2" // FTX Exchange
const curveThreePoolAddress = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
const convexBoosterAddress = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31"

type Settlement = { vaultIndex: BN; assets: BN }
interface Convex3CrvLiquidatorVaults {
    musd: Convex3CrvLiquidatorVault
    frax: Convex3CrvLiquidatorVault
    lusd: Convex3CrvLiquidatorVault
    busd: Convex3CrvLiquidatorVault
}
interface Curve3CrvBasicMetaVaults {
    dai: Curve3CrvBasicMetaVault
    usdc: Curve3CrvBasicMetaVault
    usdt: Curve3CrvBasicMetaVault
}
interface Settlements {
    musd: Settlement
    frax: Settlement
    lusd: Settlement
    busd: Settlement
}

async function deployMockSyncSwapper(deployer: Signer, nexus: Nexus) {
    const exchanges = [
        { from: CRV.address, to: DAI.address, rate: simpleToExactAmount(62, 16) },
        { from: CVX.address, to: DAI.address, rate: simpleToExactAmount(57, 16) },
        { from: CRV.address, to: USDC.address, rate: simpleToExactAmount(61, 4) },
        { from: CVX.address, to: USDC.address, rate: simpleToExactAmount(56, 4) },
        { from: CRV.address, to: USDT.address, rate: simpleToExactAmount(63, 4) },
        { from: CVX.address, to: USDT.address, rate: simpleToExactAmount(58, 4) },
    ]
    const swapper = await new BasicDexSwap__factory(deployer).deploy(nexus.address)
    await swapper.initialize(exchanges)
    return swapper
}
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
    const totalAssetsBefore = await vault.totalAssets()

    const sharesPreviewed = await vault.connect(staker.signer).previewDeposit(depositAmount)

    const tx = await vault.connect(staker.signer)["deposit(uint256,address)"](depositAmount, staker.address)

    await ethers.provider.send("evm_mine", [])

    await logTxDetails(tx, `deposit ${depositAmount} assets`)

    await expect(tx).to.emit(vault, "Deposit").withArgs(staker.address, staker.address, depositAmount, sharesPreviewed)

    const sharesAfter = await vault.balanceOf(staker.address)
    const assetsAfter = await asset.balanceOf(staker.address)
    const sharesMinted = sharesAfter.sub(sharesBefore)

    assertBNClose(sharesMinted, sharesPreviewed, variance, "expected shares minted")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).eq(assetsBefore.sub(depositAmount))
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).gt(sharesBefore)
    assertBNClosePercent(await vault.totalAssets(), totalAssetsBefore.add(depositAmount), "0.1", "totalAssets")
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
    log(`Assets deposited from mint of 70,000 shares ${usdFormatter(assetsPreviewed, 18, 14, 18)}`)

    // Need to get the totalSupply before the mint tx but in the same block
    const tx1 = await dataEmitter.emitStaticCall(vault.address, vault.interface.encodeFunctionData("totalSupply"))

    const tx2 = await vault.connect(staker.signer).mint(mintAmount, staker.address)

    await ethers.provider.send("evm_mine", [])

    const tx1Receipt = await tx1.wait()
    const totalSharesBefore = vault.interface.decodeFunctionResult("totalSupply", tx1Receipt.events[0].args[0])[0]

    await logTxDetails(tx2, `mint ${mintAmount} shares`)

    await expect(tx2).to.emit(vault, "Deposit").withArgs(staker.address, staker.address, assetsPreviewed, mintAmount)
    const assetsAfter = await asset.balanceOf(staker.address)
    const assetsUsedForMint = assetsBefore.sub(assetsAfter)

    assertBNClose(assetsUsedForMint, assetsPreviewed, variance, "expected assets deposited")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).lt(assetsBefore)
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).eq(sharesBefore.add(mintAmount))
    expect(await vault.totalSupply(), "vault supply after").eq(totalSharesBefore.add(mintAmount))
}
const assertVaultWithdraw = async (staker: Account, asset: IERC20Metadata, vault: AnyVault, _withdrawAmount?: BigNumber) => {
    const variance = BN.from(10)
    await increaseTime(ONE_HOUR)
    const withdrawAmount = _withdrawAmount ? _withdrawAmount : await vault.convertToAssets(await vault.balanceOf(staker.address))
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const sharesPreviewed = await vault.connect(staker.signer).previewWithdraw(withdrawAmount)

    const tx = await vault.connect(staker.signer).withdraw(withdrawAmount, staker.address, staker.address)

    await ethers.provider.send("evm_mine", [])

    await logTxDetails(tx, `withdraw ${withdrawAmount} assets`)

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

    await logTxDetails(tx2, `redeem ${usdFormatter(redeemAmount)} shares`)

    const assetsAfter = await asset.balanceOf(staker.address)
    const sharesAfter = await vault.balanceOf(staker.address)
    const assetsRedeemed = assetsAfter.sub(assetsBefore)
    log(
        `assertVaultRedeem  redeemAmount ${redeemAmount.toString()} assetsBefore ${assetsBefore.toString()}, assetsRedeemed ${assetsRedeemed.toString()}, assetsAfter ${assetsAfter.toString()}`,
    )
    assertBNClose(assetsRedeemed, assetsPreviewed, variance, "expected assets redeemed")
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).gt(assetsBefore)
    expect(sharesAfter, `staker ${await vault.symbol()} shares after`).eq(sharesBefore.sub(redeemAmount))
    expect(await vault.totalSupply(), "vault supply after").eq(totalSharesBefore.sub(redeemAmount))
}

const snapConvex3CrvLiquidatorVaults = async (vaults: Convex3CrvLiquidatorVaults, account: Account, metaVaultAddress: string) => {
    // reward tokens
    const crvToken = IERC20__factory.connect(CRV.address, account.signer)
    const cvxToken = IERC20__factory.connect(CVX.address, account.signer)

    const snapVault = async (vault: Convex3CrvLiquidatorVault) => ({
        totalAssets: await vault.totalAssets(),
        totalSupply: await vault.totalSupply(),
        metaVaultBalance: await vault.balanceOf(metaVaultAddress),
        feeReceiverBalance: await vault.balanceOf(await vault.feeReceiver()),
        // rewards
        crvBalance: await crvToken.balanceOf(vault.address),
        cvxBalance: await cvxToken.balanceOf(vault.address),
        // fees
        STREAM_DURATION: await vault.STREAM_DURATION(),
        STREAM_PER_SECOND_SCALE: await vault.STREAM_PER_SECOND_SCALE(),
        shareStream: await vault.shareStream(),
        feeReceiver: await vault.feeReceiver(),
    })
    const vaultsData = {
        musd: await snapVault(vaults.musd),
        frax: await snapVault(vaults.frax),
        lusd: await snapVault(vaults.lusd),
        busd: await snapVault(vaults.busd),
    }
    log(`
    musd: { totalAssets: ${vaultsData.musd.totalAssets.toString()}, totalSupply: ${vaultsData.musd.totalSupply.toString()} , metaVaultBalance: ${vaultsData.musd.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.musd.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.musd.crvBalance.toString()} , cvxBalance: ${vaultsData.musd.cvxBalance.toString()} , 
            STREAM_DURATION: ${vaultsData.musd.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.musd.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.musd.shareStream.toString()} , feeReceiver: ${vaultsData.musd.feeReceiver.toString()} 
        }
    frax: { totalAssets: ${vaultsData.frax.totalAssets.toString()}, totalSupply: ${vaultsData.frax.totalSupply.toString()} , metaVaultBalance: ${vaultsData.frax.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.frax.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.frax.crvBalance.toString()} , cvxBalance: ${vaultsData.frax.cvxBalance.toString()} 
            STREAM_DURATION: ${vaultsData.frax.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.frax.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.frax.shareStream.toString()} , feeReceiver: ${vaultsData.frax.feeReceiver.toString()}             
        }
    lusd: { totalAssets: ${vaultsData.lusd.totalAssets.toString()}, totalSupply: ${vaultsData.lusd.totalSupply.toString()} , metaVaultBalance: ${vaultsData.lusd.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.lusd.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.lusd.crvBalance.toString()} , cvxBalance: ${vaultsData.lusd.cvxBalance.toString()} 
            STREAM_DURATION: ${vaultsData.lusd.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.lusd.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.lusd.shareStream.toString()} , feeReceiver: ${vaultsData.lusd.feeReceiver.toString()}         
        }
    busd: { totalAssets: ${vaultsData.busd.totalAssets.toString()}, totalSupply: ${vaultsData.busd.totalSupply.toString()} , metaVaultBalance: ${vaultsData.busd.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.busd.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.busd.crvBalance.toString()} , cvxBalance: ${vaultsData.busd.cvxBalance.toString()} 
            STREAM_DURATION: ${vaultsData.busd.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.busd.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.busd.shareStream.toString()} , feeReceiver: ${vaultsData.busd.feeReceiver.toString()}             
        }
    `)
    return vaultsData
}
const snapPeriodicAllocationPerfFeeMetaVault = async (
    vault: PeriodicAllocationPerfFeeMetaVault,
    account: Account,
    curve3CrvBasicMetaVaults: Curve3CrvBasicMetaVaults,
    // users: { user1: string; user2: string },
) => {
    const assetToken = IERC20__factory.connect(await vault.asset(), account.signer)

    const vaultData = {
        totalSupply: await vault.totalSupply(),
        totalAssets: await vault.totalAssets(),
        assetsPerShare: await vault.assetsPerShare(),
        internalBalance: await assetToken.balanceOf(vault.address),
    }
    const usersData = {
        user1Balance: await vault.balanceOf(account.address),
        // user2Balance: await vault.balanceOf(users.user2),
    }
    let curve3CrvBasicMetaVaultsData = undefined
    if (curve3CrvBasicMetaVaults) {
        curve3CrvBasicMetaVaultsData = {
            daiVaultBalance: await vault.balanceOf(curve3CrvBasicMetaVaults.dai.address),
            usdcVaultBalance: await vault.balanceOf(curve3CrvBasicMetaVaults.usdc.address),
            usdtVaultBalance: await vault.balanceOf(curve3CrvBasicMetaVaults.usdt.address),
        }
    }
    // users: {user1Balance: ${usersData.user1Balance.toString()}, user2Balance:${usersData.user2Balance.toString()}}
    log(`
    vault: { totalAssets: ${vaultData.totalAssets.toString()}, totalSupply: ${vaultData.totalSupply.toString()} , assetsPerShare: ${vaultData.assetsPerShare.toString()},  internalBalance: ${vaultData.internalBalance.toString()}}
    users: { user1Balance: ${usersData.user1Balance.toString()} }
    `)
    if (curve3CrvBasicMetaVaultsData) {
        log(`curve3CrvBasicMetaVaults: { daiVaultBalance: ${curve3CrvBasicMetaVaultsData.daiVaultBalance.toString()}, usdcVaultBalance: ${curve3CrvBasicMetaVaultsData.usdcVaultBalance.toString()}, usdtVaultBalance: ${curve3CrvBasicMetaVaultsData.usdtVaultBalance.toString()} }
        `)
    }
    return {
        vault: vaultData,
        users: usersData,
        curve3CrvBasicMetaVaults: curve3CrvBasicMetaVaultsData,
    }
}
const snapCurve3CrvBasicMetaVaults = async (vaults: Curve3CrvBasicMetaVaults, accountAddress: string) => {
    const snapVault = async (vault: Curve3CrvBasicMetaVault) => ({
        totalAssets: await vault.totalAssets(),
        totalSupply: await vault.totalSupply(),
        accountBalance: await vault.balanceOf(accountAddress),
    })
    const vaultsData = {
        dai: await snapVault(vaults.dai),
        usdc: await snapVault(vaults.usdc),
        usdt: await snapVault(vaults.usdt),
    }
    log(`
    dai: {totalAssets: ${vaultsData.dai.totalAssets.toString()}, totalSupply: ${vaultsData.dai.totalSupply.toString()} , accountBalance: ${vaultsData.dai.accountBalance.toString()} }
    usdc: {totalAssets: ${vaultsData.usdc.totalAssets.toString()}, totalSupply: ${vaultsData.usdc.totalSupply.toString()} , accountBalance: ${vaultsData.usdc.accountBalance.toString()} }
    usdt: {totalAssets: ${vaultsData.usdt.totalAssets.toString()}, totalSupply: ${vaultsData.usdt.totalSupply.toString()} , accountBalance: ${vaultsData.usdt.accountBalance.toString()} }
    `)
    return vaultsData
}

const snapshotVaults = async (
    convex3CrvLiquidatorVaults: Convex3CrvLiquidatorVaults,
    periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault,
    curve3CrvBasicMetaVaults: Curve3CrvBasicMetaVaults,
    account: Account,
) => {
    const accountAddress = account.address
    return {
        convex3CrvLiquidatorVaults: await snapConvex3CrvLiquidatorVaults(
            convex3CrvLiquidatorVaults,
            account,
            periodicAllocationPerfFeeMetaVault.address,
        ),
        periodicAllocationPerfFeeMetaVault: await snapPeriodicAllocationPerfFeeMetaVault(
            periodicAllocationPerfFeeMetaVault,
            account,
            curve3CrvBasicMetaVaults,
        ),
        curve3CrvBasicMetaVaults: await snapCurve3CrvBasicMetaVaults(curve3CrvBasicMetaVaults, accountAddress),
    }
}
const assertVaultSettle = async (
    vaultManager: Account,
    convex3CrvLiquidatorVaults: Convex3CrvLiquidatorVaults,
    periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault,
    curve3CrvBasicMetaVaults: Curve3CrvBasicMetaVaults,
    settlements: Settlements,
    account: Account,
) => {
    const vaultsDataBefore = await snapshotVaults(
        convex3CrvLiquidatorVaults,
        periodicAllocationPerfFeeMetaVault,
        curve3CrvBasicMetaVaults,
        account,
    )
    const totalAssetsSettle = settlements.musd.assets.add(settlements.frax.assets.add(settlements.busd.assets.add(settlements.lusd.assets)))
    log(`Total assets to settle ${usdFormatter(totalAssetsSettle, 18, 14, 18)}`)

    const tx = await periodicAllocationPerfFeeMetaVault
        .connect(vaultManager.signer)
        .settle([settlements.musd, settlements.frax, settlements.lusd, settlements.busd])
    await logTxDetails(tx, "settle to 4 underlying vaults")

    const vaultsDataAfter = await snapshotVaults(
        convex3CrvLiquidatorVaults,
        periodicAllocationPerfFeeMetaVault,
        curve3CrvBasicMetaVaults,
        account,
    )

    expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.internalBalance, "vault internal balance").to.eq(
        vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.internalBalance.sub(totalAssetsSettle),
    )

    expect(vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "vault total supply does not change").to.eq(
        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply,
    )
    // after settlement due to fees, slippage and market conditions the total assets and assets per share are slightly less
    expect(vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "vault total assets changes").to.gt(
        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
    )
    expect(vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.assetsPerShare, "vault assets per share changes").to.gt(
        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.assetsPerShare,
    )
    assertBNClosePercent(
        vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
        "0.2",
        "totalAssets after settlement",
    )
    assertBNClosePercent(
        vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.assetsPerShare,
        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.assetsPerShare,
        "0.2",
        "assetsPerShare after settlement",
    )

    // expect underlying vaults to be settle
    function expectConvex3CrvLiquidatorVaultSettlement(vaultName: string) {
        expect(vaultsDataBefore.convex3CrvLiquidatorVaults[vaultName].totalSupply, `${vaultName} vault total supply increases`).to.lt(
            vaultsDataAfter.convex3CrvLiquidatorVaults[vaultName].totalSupply,
        )
        expect(vaultsDataBefore.convex3CrvLiquidatorVaults[vaultName].totalAssets, `${vaultName} vault total assets increases`).to.lt(
            vaultsDataAfter.convex3CrvLiquidatorVaults[vaultName].totalAssets,
        )
        expect(
            vaultsDataBefore.convex3CrvLiquidatorVaults[vaultName].metaVaultBalance,
            `metavault balance increases on ${vaultName} vault`,
        ).to.lt(vaultsDataAfter.convex3CrvLiquidatorVaults[vaultName].metaVaultBalance)
        assertBNClosePercent(
            vaultsDataBefore.convex3CrvLiquidatorVaults[vaultName].totalAssets.add(settlements.musd.assets),
            vaultsDataAfter.convex3CrvLiquidatorVaults[vaultName].totalAssets,
            "0.5",
            `${vaultName} totalSupply after settlement`,
        )
    }
    expectConvex3CrvLiquidatorVaultSettlement("musd")
    expectConvex3CrvLiquidatorVaultSettlement("frax")
    expectConvex3CrvLiquidatorVaultSettlement("lusd")
    expectConvex3CrvLiquidatorVaultSettlement("busd")
}

describe("Save+ Basic and Meta Vaults", async () => {
    let sa: StandardAccounts
    let deployer: Signer
    let governor: Account
    let rewardsWhale: Account
    let vaultManager: Account
    let usdtWhale: Account
    let staker1: Account
    let staker2: Account
    // core smart contracts
    let nexus: Nexus
    let proxyAdmin: InstantProxyAdmin
    // common smart contracts
    let swapper: CowSwapDex
    let liquidator: Liquidator
    // external smart contracts
    let threeCrvToken: IERC20Metadata
    let cvxToken: IERC20Metadata
    let crvToken: IERC20Metadata
    let daiToken: IERC20Metadata
    let usdcToken: IERC20Metadata
    let usdtToken: IERC20Metadata
    // mstable underlying vaults  <= => convex
    let musdConvexVault: Convex3CrvLiquidatorVault
    let fraxConvexVault: Convex3CrvLiquidatorVault
    let lusdConvexVault: Convex3CrvLiquidatorVault
    let busdConvexVault: Convex3CrvLiquidatorVault
    // meta vault  <= => mstable underlying vaults
    let periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault
    // 4626 vaults  <= => meta vault
    let daiMetaVault: Curve3CrvBasicMetaVault
    let usdcMetaVault: Curve3CrvBasicMetaVault
    let usdtMetaVault: Curve3CrvBasicMetaVault

    // custom types to ease unit testing
    let curve3CrvBasicMetaVaults: Curve3CrvBasicMetaVaults
    let convex3CrvLiquidatorVaults: Convex3CrvLiquidatorVaults

    let dataEmitter: DataEmitter
    const { network } = hre

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        governor = await impersonateAccount(governorAddress)
        deployer = governor.signer

        staker1 = await impersonateAccount(staker1Address)
        staker2 = await impersonateAccount(staker2Address)
        sa.alice = staker1
        sa.bob = staker2

        rewardsWhale = await impersonateAccount(rewardsWhaleAddress)
        vaultManager = await impersonateAccount(vaultManagerAddress)
        usdtWhale = await impersonateAccount(usdtWhaleAddress)

        // Deploy core contracts  (nexus, proxy admin)
        const core = await deployCore(hre, deployer, "instant", governor.address)
        nexus = core.nexus
        proxyAdmin = core.proxyAdmin as InstantProxyAdmin

        // Deploy mocked contracts
        ;({ swapper } = await deployMockAsyncSwapper(deployer, nexus))
        const syncSwapper = await deployMockSyncSwapper(deployer, nexus)

        // Deploy common /  utilities  contracts
        ;({ liquidator } = await deployCommon(hre, deployer, core, syncSwapper.address, swapper.address))

        await proposeAcceptNexusModule(nexus, governor, "Liquidator", liquidator.address)
        liquidator = liquidator.connect(governor.signer)

        //  1 - deployConvex3CrvLiquidatorVault,  2 - deployPeriodicAllocationPerfFeeMetaVaults,  3 - deployCurve3CrvMetaVault
        const {
            convex3CrvVaults,
            periodicAllocationPerfFeeMetaVault: periodicAllocationPerfFeeVault,
            curve3CrvMetaVaults,
        } = await deploy3CrvMetaVaults(hre, deployer, core, vaultManagerAddress)

        //  1.- underlying meta vaults capable of liquidate rewards
        musdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.musd.proxy.address, deployer)
        fraxConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.frax.proxy.address, deployer)
        lusdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.lusd.proxy.address, deployer)
        busdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.busd.proxy.address, deployer)

        // 2.- save plus meta vault
        periodicAllocationPerfFeeMetaVault = PeriodicAllocationPerfFeeMetaVault__factory.connect(
            periodicAllocationPerfFeeVault.proxy.address,
            deployer,
        )

        //  3.- 4626 Wrappers of the save plus meta vault
        daiMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.dai.proxy.address, deployer)
        usdcMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.usdc.proxy.address, deployer)
        usdtMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.usdt.proxy.address, deployer)

        // Deploy mocked contracts
        dataEmitter = await new DataEmitter__factory(deployer).deploy()

        threeCrvToken = IERC20Metadata__factory.connect(ThreeCRV.address, staker1.signer)
        cvxToken = IERC20Metadata__factory.connect(CVX.address, rewardsWhale.signer)
        crvToken = IERC20Metadata__factory.connect(CRV.address, rewardsWhale.signer)
        daiToken = IERC20Metadata__factory.connect(DAI.address, staker1.signer)
        usdcToken = IERC20Metadata__factory.connect(USDC.address, staker1.signer)
        usdtToken = IERC20Metadata__factory.connect(USDT.address, staker1.signer)

        // Mock Balances on our lovely users
        const musdTokenAddress = resolveAddress("mUSD")
        const daiTokenAddress = DAI.address
        const usdcTokenAddress = USDC.address
        const usdtTokenAddress = USDT.address
        const tokensToMockBalance = { musdTokenAddress, usdcTokenAddress, daiTokenAddress, usdtTokenAddress }

        await setBalancesToAccount(staker1, [] as ERC20[], tokensToMockBalance, 10000000000)
        await setBalancesToAccount(staker2, [] as ERC20[], tokensToMockBalance, 10000000000)

        // Mock balances on swappers to simulate swaps
        cvxToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        crvToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        daiToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        usdcToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        usdtToken.transfer(syncSwapper.address, simpleToExactAmount(10000))

        cvxToken.transfer(swapper.address, simpleToExactAmount(10000))
        crvToken.transfer(swapper.address, simpleToExactAmount(10000))
        daiToken.transfer(swapper.address, simpleToExactAmount(10000))
        usdcToken.transfer(swapper.address, simpleToExactAmount(10000))
        usdtToken.transfer(swapper.address, simpleToExactAmount(10000))

        // Stakers approve vaults to take their tokens
        await threeCrvToken.connect(staker1.signer).approve(periodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)
        await threeCrvToken.connect(staker2.signer).approve(periodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)

        await daiToken.connect(staker1.signer).approve(daiMetaVault.address, ethers.constants.MaxUint256)
        await daiToken.connect(staker2.signer).approve(daiMetaVault.address, ethers.constants.MaxUint256)

        await usdcToken.connect(staker1.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)
        await usdcToken.connect(staker2.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)

        await usdtToken.connect(usdtWhale.signer).transfer(staker1.address, simpleToExactAmount(10000000, USDT.decimals))
        await usdtToken.connect(usdtWhale.signer).transfer(staker2.address, simpleToExactAmount(10000000, USDT.decimals))

        await usdtToken.connect(staker1.signer).approve(usdtMetaVault.address, ethers.constants.MaxUint256)
        await usdtToken.connect(staker2.signer).approve(usdtMetaVault.address, ethers.constants.MaxUint256)

        // custom types to ease  unit testing
        convex3CrvLiquidatorVaults = {
            musd: musdConvexVault,
            frax: fraxConvexVault,
            lusd: lusdConvexVault,
            busd: busdConvexVault,
        }
        curve3CrvBasicMetaVaults = {
            dai: daiMetaVault,
            usdc: usdcMetaVault,
            usdt: usdtMetaVault,
        }
    }
    const resetNetwork = async (blockNumber: number) => {
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
        const rewardTokens = await convex3CrvVault.rewardTokens()
        expect(await convex3CrvVault.nexus(), "nexus").eq(nexus.address)
        expect(await convex3CrvVault.metapool(), "curve Metapool").to.equal(convex3CrvPool.curveMetapool)
        expect(await convex3CrvVault.metapoolToken(), "metapool token").to.equal(convex3CrvPool.curveMetapoolToken)
        expect(await convex3CrvVault.basePool(), "3Pool pool").to.equal(curveThreePoolAddress)
        expect(await convex3CrvVault.booster(), "booster").to.equal(convexBoosterAddress)
        expect(await convex3CrvVault.convexPoolId(), "convex Pool Id").to.equal(convex3CrvPool.convexPoolId)
        expect(await convex3CrvVault.baseRewardPool(), "base reward pool").to.equal(convex3CrvPool.convexRewardPool)
        expect(rewardTokens[0], "reward tokens").to.equal(convex3CrvPool.rewardTokens[0])
        expect(rewardTokens[1], "reward tokens").to.equal(convex3CrvPool.rewardTokens[1])
    }
    const assertCurve3CrvVaultConfiguration = async (curve3CrvVault: Curve3CrvBasicMetaVault, curve3CrvPool: Curve3CrvPool) => {
        // check a minimum set of configurations
        expect(await curve3CrvVault.nexus(), "nexus").eq(nexus.address)
        expect(await curve3CrvVault.metaVault(), "underlying metaVault").to.equal(periodicAllocationPerfFeeMetaVault.address)
        expect(await curve3CrvVault.asset(), "asset").to.equal(curve3CrvPool.asset)
        expect(await curve3CrvVault.name(), "name").to.equal(curve3CrvPool.name)
        expect(await curve3CrvVault.symbol(), "symbol").to.equal(curve3CrvPool.symbol)
        expect(await curve3CrvVault.decimals(), "decimals").to.equal(18)
    }
    const simulateConvexRewardsDonation = async () => {
        await crvToken.connect(rewardsWhale.signer).transfer(musdConvexVault.address, simpleToExactAmount(100))
        await crvToken.connect(rewardsWhale.signer).transfer(fraxConvexVault.address, simpleToExactAmount(100))
        await crvToken.connect(rewardsWhale.signer).transfer(busdConvexVault.address, simpleToExactAmount(100))
        await crvToken.connect(rewardsWhale.signer).transfer(lusdConvexVault.address, simpleToExactAmount(100))
        await cvxToken.connect(rewardsWhale.signer).transfer(musdConvexVault.address, simpleToExactAmount(150))
        await cvxToken.connect(rewardsWhale.signer).transfer(fraxConvexVault.address, simpleToExactAmount(150))
        await cvxToken.connect(rewardsWhale.signer).transfer(busdConvexVault.address, simpleToExactAmount(150))
        await cvxToken.connect(rewardsWhale.signer).transfer(lusdConvexVault.address, simpleToExactAmount(150))
    }
    const snapLiquidator = async () => {
        const crvBalance = await crvToken.balanceOf(liquidator.address)
        const cvxBalance = await cvxToken.balanceOf(liquidator.address)
        const purchaseTokenBalance = await daiToken.balanceOf(liquidator.address)
        const pendingCrv = await liquidator.pendingRewards(CRV.address, DAI.address)
        const pendingCvx = await liquidator.pendingRewards(CVX.address, DAI.address)

        return { crvBalance, cvxBalance, purchaseTokenBalance, pendingCrv, pendingCvx }
    }
    const assertLiquidatorCollectRewards = async (vaults: Array<string>) => {
        // simulate convex sends rewards to convex3CrvLiquidatorVaults when calling collectRewards()
        await simulateConvexRewardsDonation()
        await increaseTime(ONE_WEEK)
        const liqDataBefore = await snapLiquidator()

        const rewardsAddress = [CRV.address.toLowerCase(), CVX.address.toLowerCase()]
        // When collects rewards from all vaults
        const tx = await liquidator.collectRewards(vaults)

        // Then rewards are transfer to the liquidator
        const receipt = await tx.wait()
        const collectedRewardsEvent = findContractEvent(receipt, liquidator.address, "CollectedRewards")

        // Expect rewards to be CRV or CVX only
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[0][0].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[0][1].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[1][0].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[1][1].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[2][0].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[2][1].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[3][0].toLowerCase()), "reward token").to.eq(true)
        expect(rewardsAddress.includes(collectedRewardsEvent.args.rewardTokens[3][1].toLowerCase()), "reward token").to.eq(true)

        log(`CollectedRewards rewards {
                        musd: { rewards[0]: ${collectedRewardsEvent.args.rewards[0][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[0][1].toString()} }
                        frax: { rewards[0]: ${collectedRewardsEvent.args.rewards[1][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[1][1].toString()} }
                        lusd: { rewards[0]: ${collectedRewardsEvent.args.rewards[2][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[2][1].toString()} }
                        busd: { rewards[0]: ${collectedRewardsEvent.args.rewards[3][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[3][1].toString()} }
                     }`)

        const liqDataAfter = await snapLiquidator()
        expect(liqDataAfter.crvBalance, "liquidator crv balance").to.be.gt(liqDataBefore.crvBalance)
        expect(liqDataAfter.cvxBalance, "liquidator cvx balance").to.be.gt(liqDataBefore.crvBalance)

        log(`liquidatorBalances {
                        crv: { before: ${liqDataBefore.crvBalance.toString()}, after: ${liqDataAfter.crvBalance.toString()} }
                        cvx: { before: ${liqDataBefore.cvxBalance.toString()}, after: ${liqDataAfter.cvxBalance.toString()} }
                     }`)
    }
    const assertLiquidatorSwap = async () => {
        const liqDataBefore = await snapLiquidator()

        // make sure liquidator has rewards to swap
        expect(liqDataBefore.crvBalance, "liquidator crv balance").to.be.gt(0)
        expect(liqDataBefore.cvxBalance, "liquidator cvx balance").to.be.gt(0)
        expect(liqDataBefore.crvBalance, "liquidator crv pending").to.be.eq(liqDataBefore.pendingCrv.rewards)
        expect(liqDataBefore.cvxBalance, "liquidator cvx pending").to.be.eq(liqDataBefore.pendingCvx.rewards)
        expect(liqDataBefore.purchaseTokenBalance, "liquidator dai balance").to.be.eq(0)

        // When Swap CRV for DAI
        let tx = await liquidator.connect(governor.signer).swap(CRV.address, DAI.address, 0, "0x")
        await expect(tx).to.emit(liquidator, "Swapped")

        // When Swap CVX for DAI
        tx = await liquidator.connect(governor.signer).swap(CVX.address, DAI.address, 0, "0x")
        await expect(tx).to.emit(liquidator, "Swapped")

        // Then
        const liqDataAfter = await snapLiquidator()
        expect(liqDataAfter.crvBalance, "liquidator crv balance").to.be.eq(0)
        expect(liqDataAfter.cvxBalance, "liquidator cvx balance").to.be.eq(0)
        expect(liqDataAfter.pendingCrv.rewards, "liquidator crv pending").to.be.eq(0)
        expect(liqDataAfter.pendingCvx.rewards, "liquidator cvx pending").to.be.eq(0)
        expect(liqDataAfter.purchaseTokenBalance, "liquidator dai balance").to.be.gt(0)
    }
    const assertLiquidatorDonateTokens = async (assets: IERC20Metadata[], vaultsAddress: string[]): Promise<ContractTransaction> => {
        const { rewardTokens, purchaseTokens, vaults } = await buildDonateTokensInput(deployer, vaultsAddress)
        const tx = liquidator.connect(governor.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
        for (let i = 0; i < vaultsAddress.length; i++) {
            await expect(tx, `asset ${i}`).to.emit(assets[i], "Transfer")
        }
        await expect(tx).to.emit(liquidator, "DonatedAssets")
        return tx
    }
    before("reset block number", async () => {
        await resetNetwork(14960000)
        if (network.name === "Hardhat") {
            await loadFixture(setup)
        } else {
            await setup()
        }
    })
    context("deployment check", async () => {
        describe("proxy instant admin", async () => {
            it("owner is the multisig governor", async () => {
                expect(await proxyAdmin.owner(), "owner must be governor").to.be.eq(governorAddress)
            })
            it("is the admin of all vaults proxies", async () => {
                expect(await proxyAdmin.getProxyAdmin(musdConvexVault.address), "musd vault proxy admin").to.be.eq(proxyAdmin.address)
                expect(await proxyAdmin.getProxyAdmin(fraxConvexVault.address), "frax vault proxy admin").to.be.eq(proxyAdmin.address)
                expect(await proxyAdmin.getProxyAdmin(lusdConvexVault.address), "lusd vault proxy admin").to.be.eq(proxyAdmin.address)
                expect(await proxyAdmin.getProxyAdmin(busdConvexVault.address), "busd vault proxy admin").to.be.eq(proxyAdmin.address)
            })
        })
        describe("Convex 3Crv Liquidator Vaults", async () => {
            it("musd should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(musdConvexVault, config.convex3CrvPools.musd)
            })
            it("busd should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(busdConvexVault, config.convex3CrvPools.busd)
            })
            it("frax should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(fraxConvexVault, config.convex3CrvPools.frax)
            })
            it("lusd should properly store valid arguments", async () => {
                await assertConvex3CrvVaultConfiguration(lusdConvexVault, config.convex3CrvPools.lusd)
            })
        })
        describe("Curve Convex 3Crv Meta Vault", async () => {
            it("constructor data", async () => {
                expect(await periodicAllocationPerfFeeMetaVault.nexus(), "nexus").eq(nexus.address)
                expect(await periodicAllocationPerfFeeMetaVault.asset(), "asset").to.equal(config.periodicAllocationPerfFeeMetaVault.asset)
            })

            it("initialize data", async () => {
                // initialize
                expect(await periodicAllocationPerfFeeMetaVault.name(), "name").to.equal(config.periodicAllocationPerfFeeMetaVault.name)
                expect(await periodicAllocationPerfFeeMetaVault.symbol(), "symbol").to.equal(
                    config.periodicAllocationPerfFeeMetaVault.symbol,
                )
                expect(await periodicAllocationPerfFeeMetaVault.decimals(), "decimals").to.equal(18)
                expect(await periodicAllocationPerfFeeMetaVault.vaultManager(), "vaultManager").to.equal(vaultManager.address)
                expect(await periodicAllocationPerfFeeMetaVault.performanceFee(), "performanceFee").to.equal(
                    config.periodicAllocationPerfFeeMetaVault.performanceFee,
                )
                expect(await periodicAllocationPerfFeeMetaVault.feeReceiver(), "feeReceiver").to.equal(feeReceiver)

                expect(await periodicAllocationPerfFeeMetaVault.underlyingVaults(0), "underlyingVaults 0").to.equal(musdConvexVault.address)
                expect(await periodicAllocationPerfFeeMetaVault.underlyingVaults(1), "underlyingVaults 1").to.equal(fraxConvexVault.address)
                expect(await periodicAllocationPerfFeeMetaVault.underlyingVaults(2), "underlyingVaults 2").to.equal(lusdConvexVault.address)
                expect(await periodicAllocationPerfFeeMetaVault.underlyingVaults(3), "underlyingVaults 3").to.equal(busdConvexVault.address)
                expect(await periodicAllocationPerfFeeMetaVault.assetPerShareUpdateThreshold(), "assetPerShareUpdateThreshold").to.equal(
                    config.periodicAllocationPerfFeeMetaVault.assetPerShareUpdateThreshold,
                )
                const sourceParams = await periodicAllocationPerfFeeMetaVault.sourceParams()
                expect(sourceParams.singleSourceVaultIndex, "singleSourceVaultIndex").to.equal(
                    config.periodicAllocationPerfFeeMetaVault.sourceParams.singleSourceVaultIndex,
                )
                expect(sourceParams.singleVaultSharesThreshold, "singleVaultSharesThreshold").to.equal(
                    config.periodicAllocationPerfFeeMetaVault.sourceParams.singleVaultSharesThreshold,
                )
            })
        })
        describe("Curve 3Crv Meta Vaults", async () => {
            // 4626 Wrappers that facilitate deposit / withdraw USDC | DAI| USDT
            it("dai should properly store valid arguments", async () => {
                await assertCurve3CrvVaultConfiguration(daiMetaVault, config.curve3CrvMetaVault.dai)
            })
            it("usdc should properly store valid arguments", async () => {
                await assertCurve3CrvVaultConfiguration(usdcMetaVault, config.curve3CrvMetaVault.usdc)
            })
            it("usdt should properly store valid arguments", async () => {
                await assertCurve3CrvVaultConfiguration(usdtMetaVault, config.curve3CrvMetaVault.usdt)
            })
        })
    })
    context("behaviors", async () => {
        context("should behave like AbstractVault", async () => {
            describe("periodicAllocationPerfFeeMetaVault", async () => {
                let ctxVault: Partial<AbstractVaultBehaviourContext> = {}
                before(async () => {
                    ctxVault = {
                        vault: periodicAllocationPerfFeeMetaVault as unknown as AbstractVault,
                        asset: threeCrvToken,
                        sa: sa,
                        fixture: async () => {},
                    }
                })
                shouldBehaveLikeAbstractVault(() => ctxVault as AbstractVaultBehaviourContext)
            })
            describe("convex3CrvLiquidatorVault - musd", async () => {
                let ctxVault: Partial<AbstractVaultBehaviourContext> = {}

                before(async () => {
                    ctxVault = {
                        vault: musdConvexVault as unknown as AbstractVault,
                        asset: threeCrvToken,
                        sa: sa,
                        fixture: async () => {},
                        variances: {
                            deposit: 0.0001,
                            mint: 0.02,
                            withdraw: 0.0006,
                            redeem: 0.0003,
                            convertToAssets: 0.04,
                            convertToShares: 0.04,
                            maxWithdraw: 0.0006,
                            maxRedeem: 0.02,
                        },
                    }
                })

                shouldBehaveLikeAbstractVault(() => ctxVault as AbstractVaultBehaviourContext)
                // FIXME
                // behavior is not the same on the following scenarios
                //     1) deposit - fails if deposits zero:
                //       AssertionError: Expected transaction to be reverted with reason 'Shares are zero', but it reverted without a reason

                //    2) mint - fails if mint zero:
                //       AssertionError: Expected transaction to be reverted with reason 'Assets are zero', but it reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)

                //    3) withdraw - fails if withdraw zero:
                //       AssertionError: Expected transaction to be reverted with reason 'Shares are zero', but it didn't revert

                //    4) redeem - fails if deposits zero:
                //       AssertionError: Expected transaction to be reverted with reason 'Assets are zero', but it didn't revert
            })
            describe("curve3CrvBasicMetaVault - dai", async () => {
                let ctxVault: Partial<AbstractVaultBehaviourContext> = {}
                before(async () => {
                    ctxVault = {
                        vault: daiMetaVault as unknown as AbstractVault,
                        asset: daiToken,
                        sa: sa,
                        variances: {
                            deposit: 0.0001,
                            mint: 0.005,
                            withdraw: 0.0001,
                            redeem: 0.0001,
                            convertToAssets: 0.06,
                            convertToShares: 0.06,
                            maxWithdraw: 0.0001,
                            maxRedeem: 0.007,
                        },
                        fixture: async () => {},
                    }
                })
                shouldBehaveLikeAbstractVault(() => ctxVault as AbstractVaultBehaviourContext)
                // FIXME -
                //         1) deposit - fails if deposits zero:
                //         AssertionError: Expected transaction to be reverted with reason 'Shares are zero', but it reverted without a reason

                //    2) mint - fails if mint zero:
                //         AssertionError: Expected transaction to be reverted with reason 'Assets are zero', but it reverted with reason 'too much slippage'

                //    3) withdraw - fails if withdraw zero:
                //         AssertionError: Expected transaction to be reverted with reason 'Shares are zero', but it didn't revert

                //    4) redeem - fails if deposits zero:
                //         AssertionError: Expected transaction to be reverted with reason 'Assets are zero', but it didn't revert
            })
        })
    })
    context("PeriodicAllocationPerfFeeMetaVault", async () => {
        let vaultsDataBefore
        before("reset block number", async () => {
            // await resetNetwork(14960000)
            if (network.name === "Hardhat") {
                await loadFixture(setup)
            } else {
                await setup()
            }
        })
        beforeEach("snap data", async () => {
            vaultsDataBefore = await snapshotVaults(
                convex3CrvLiquidatorVaults,
                periodicAllocationPerfFeeMetaVault,
                curve3CrvBasicMetaVaults,
                staker1,
            )
        })
        describe("basic flow", () => {
            it("deposit 3Crv", async () => {
                await assertVaultDeposit(
                    staker1,
                    threeCrvToken,
                    periodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(50000, ThreeCRV.decimals),
                )
            })
            it("mint shares", async () => {
                await assertVaultMint(
                    staker1,
                    threeCrvToken,
                    periodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(70000, ThreeCRV.decimals),
                )
            })
            it("partial withdraw", async () => {
                await assertVaultWithdraw(
                    staker1,
                    threeCrvToken,
                    periodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(60000, ThreeCRV.decimals),
                )
            })
            it("partial redeem", async () => {
                await assertVaultRedeem(
                    staker1,
                    threeCrvToken,
                    periodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(7000, ThreeCRV.decimals),
                )
            })
            it("total redeem", async () => {
                await assertVaultRedeem(staker1, threeCrvToken, periodicAllocationPerfFeeMetaVault, dataEmitter)
                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    staker1,
                )
                // Expect all liquidity to be removed
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.users.user1Balance, "user balance").to.be.eq(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault total supply").to.be.eq(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault total assets").to.be.eq(0)
            })
        })
        describe("full flow with settlement", () => {
            describe("before settlement", () => {
                it("deposit 3Crv", async () => {
                    await assertVaultDeposit(
                        staker1,
                        threeCrvToken,
                        periodicAllocationPerfFeeMetaVault,
                        simpleToExactAmount(50000, ThreeCRV.decimals),
                    )

                    // Expect underlying vaults with 0 balance until settlement
                    const vaultsDataAfter = await snapshotVaults(
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        staker1,
                    )
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.musd.totalSupply, "musd vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.frax.totalSupply, "frax vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.lusd.totalSupply, "lusd vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.busd.totalSupply, "busd vault totalSupply").to.be.eq(0)
                })
                it("mint shares", async () => {
                    await assertVaultMint(
                        staker1,
                        threeCrvToken,
                        periodicAllocationPerfFeeMetaVault,
                        dataEmitter,
                        simpleToExactAmount(70000, ThreeCRV.decimals),
                    )
                    // Expect underlying vaults with 0 balance until settlement
                    const vaultsDataAfter = await snapshotVaults(
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        staker1,
                    )
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.musd.totalSupply, "musd vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.frax.totalSupply, "frax vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.lusd.totalSupply, "lusd vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.busd.totalSupply, "busd vault totalSupply").to.be.eq(0)
                })
                it("settles to underlying vaults", async () => {
                    const totalAssets = await periodicAllocationPerfFeeMetaVault.totalAssets()
                    // Settle evenly to underlying assets
                    log(`Total assets in Meta Vault ${usdFormatter(totalAssets, 18, 14, 18)}`)
                    log(`${usdFormatter(totalAssets.div(4), 18, 14, 18)} assets to each underlying vault`)
                    const musdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(4) }
                    const fraxSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(4) }
                    const lusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(4) }
                    const busdSettlement = { vaultIndex: BN.from(3), assets: totalAssets.div(4) }
                    const settlements = { musd: musdSettlement, frax: fraxSettlement, lusd: lusdSettlement, busd: busdSettlement }
                    await assertVaultSettle(
                        vaultManager,
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        settlements,
                        staker1,
                    )
                })
            })
            describe("liquidation", async () => {
                it("collect rewards", async () => {
                    await assertLiquidatorCollectRewards([
                        convex3CrvLiquidatorVaults.musd.address,
                        convex3CrvLiquidatorVaults.frax.address,
                        convex3CrvLiquidatorVaults.busd.address,
                        convex3CrvLiquidatorVaults.lusd.address, // 3
                    ])
                })
                it("swap rewards for tokens to donate", async () => {
                    // Given that all underlying vaults are setup to donate DAI
                    // Swap CRV, CVX for DAI and evaluate balances on liquidator
                    await assertLiquidatorSwap()
                })
                it("donate purchased tokens", async () => {
                    // Given the liquidator has purchased tokens
                    const liqDataBefore = await snapLiquidator()
                    expect(liqDataBefore.purchaseTokenBalance, "liquidator dai balance").to.be.gt(0)
                    // The fee receiver has 0 shares up to now as no donations have been triggered yet
                    expect(vaultsDataBefore.convex3CrvLiquidatorVaults.musd.feeReceiverBalance, "musd vault feeReceiverBalance").to.be.eq(0)
                    expect(vaultsDataBefore.convex3CrvLiquidatorVaults.frax.feeReceiverBalance, "frax vault feeReceiverBalance").to.be.eq(0)
                    expect(vaultsDataBefore.convex3CrvLiquidatorVaults.lusd.feeReceiverBalance, "lusd vault feeReceiverBalance").to.be.eq(0)
                    expect(vaultsDataBefore.convex3CrvLiquidatorVaults.busd.feeReceiverBalance, "busd vault feeReceiverBalance").to.be.eq(0)
                    // When tokens are donated
                    await assertLiquidatorDonateTokens(
                        [daiToken, daiToken, daiToken, daiToken],
                        [musdConvexVault.address, fraxConvexVault.address, busdConvexVault.address, lusdConvexVault.address],
                    )
                    const liqDataAfter = await snapLiquidator()
                    const vaultsDataAfter = await snapshotVaults(
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        staker1,
                    )
                    //  Then fee receiver must change
                    expect(liqDataAfter.purchaseTokenBalance, "liquidator dai balance decreased").to.be.eq(0)
                    // The fee receiver gets some shares after donation.
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.musd.feeReceiverBalance, "musd vault feeReceiverBalance").to.be.gt(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.frax.feeReceiverBalance, "frax vault feeReceiverBalance").to.be.gt(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.lusd.feeReceiverBalance, "lusd vault feeReceiverBalance").to.be.gt(0)
                    expect(vaultsDataAfter.convex3CrvLiquidatorVaults.busd.feeReceiverBalance, "busd vault feeReceiverBalance").to.be.gt(0)
                })
            })
            describe("after settlement", () => {
                it("partial withdraw", async () => {
                    // FIXME - this is still failing
                    await assertVaultWithdraw(
                        staker1,
                        threeCrvToken,
                        periodicAllocationPerfFeeMetaVault,
                        simpleToExactAmount(60000, ThreeCRV.decimals),
                    )
                })
                it("partial redeem", async () => {
                    await assertVaultRedeem(
                        staker1,
                        threeCrvToken,
                        periodicAllocationPerfFeeMetaVault,
                        dataEmitter,
                        simpleToExactAmount(7000, ThreeCRV.decimals),
                    )
                })
                it("total redeem", async () => {
                    await assertVaultRedeem(staker1, threeCrvToken, periodicAllocationPerfFeeMetaVault, dataEmitter)
                    const vaultsDataAfter = await snapshotVaults(
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        staker1,
                    )

                    expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.users.user1Balance, "user balance").to.be.eq(0)
                    expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault total supply").to.be.eq(0)
                    // FIXME - it is still failing
                    // FIXME - this scenario is still failing
                    assertBNClose(
                        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                        BN.from(0),
                        simpleToExactAmount(12),
                        "meta vault total assets",
                    )
                })
            })
        })
    })
    context("Curve3CrvBasicMetaVault", async () => {
        let vaultsDataBefore

        before("reset block number", async () => {
            // await resetNetwork(14960000)
            if (network.name === "Hardhat") {
                await loadFixture(setup)
            } else {
                await setup()
            }
        })
        beforeEach("snap data", async () => {
            vaultsDataBefore = await snapshotVaults(
                convex3CrvLiquidatorVaults,
                periodicAllocationPerfFeeMetaVault,
                curve3CrvBasicMetaVaults,
                staker1,
            )
        })
        describe("basic flow", () => {
            it("deposit erc20Token", async () => {
                // Given the periodicAllocationPerfFeeMetaVault total supply is 0
                expect(vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "metavault supply").to.be.eq(0)

                // When deposit via 4626MetaVault
                await assertVaultDeposit(staker1, daiToken, daiMetaVault, simpleToExactAmount(50000, DAI.decimals))
                await assertVaultDeposit(staker1, usdcToken, usdcMetaVault, simpleToExactAmount(50000, USDC.decimals))
                await assertVaultDeposit(staker1, usdtToken, usdtMetaVault, simpleToExactAmount(50000, USDT.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    staker1,
                )
                // Then periodicAllocationPerfFeeMetaVault supply increases
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault totalAssets").to.be.gt(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault totalSupply").to.be.gt(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.internalBalance, "meta vault internalBalance").to.be.gt(0)

                // The 4626MetaVault's shares on the meta vault increases
                const { curve3CrvBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.daiVaultBalance, "meta vault dai vault balance").to.be.gt(0)
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.gt(0)
                expect(dataAfter.usdtVaultBalance, "meta vault usdt vault balance").to.be.gt(0)
                // no change on underlying vaults
            })
            it("mint shares", async () => {
                // When mint via 4626MetaVault
                await assertVaultMint(staker1, daiToken, daiMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))
                await assertVaultMint(staker1, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))
                await assertVaultMint(staker1, usdtToken, usdtMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    staker1,
                )
                // Then periodicAllocationPerfFeeMetaVault supply increases
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault totalAssets").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                )
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault totalSupply").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalSupply,
                )
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.internalBalance, "meta vault internalBalance").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.internalBalance,
                )

                // The 4626MetaVault's shares on the meta vault increases
                const { curve3CrvBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.daiVaultBalance, "meta vault dai vault balance").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.daiVaultBalance,
                )
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdcVaultBalance,
                )
                expect(dataAfter.usdtVaultBalance, "meta vault usdt vault balance").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdtVaultBalance,
                )
                // no change on underlying vaults
            })
            it("partial withdraw", async () => {
                await assertVaultWithdraw(staker1, daiToken, daiMetaVault, simpleToExactAmount(60000, DAI.decimals))
                await assertVaultWithdraw(staker1, usdcToken, usdcMetaVault, simpleToExactAmount(60000, USDC.decimals))
                await assertVaultWithdraw(staker1, usdtToken, usdtMetaVault, simpleToExactAmount(60000, USDT.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    staker1,
                )
                // The 4626MetaVault's shares on the meta vault decreases
                const { curve3CrvBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.daiVaultBalance, "meta vault dai vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.daiVaultBalance,
                )
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdcVaultBalance,
                )
                expect(dataAfter.usdtVaultBalance, "meta vault usdt vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdtVaultBalance,
                )
                // no change on underlying vaults
            })
            it("partial redeem", async () => {
                await assertVaultRedeem(staker1, daiToken, daiMetaVault, dataEmitter, simpleToExactAmount(7000, ThreeCRV.decimals))
                await assertVaultRedeem(staker1, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(7000, ThreeCRV.decimals))
                await assertVaultRedeem(staker1, usdtToken, usdtMetaVault, dataEmitter, simpleToExactAmount(7000, ThreeCRV.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    staker1,
                )
                // The 4626MetaVault's shares on the meta vault decreases
                const { curve3CrvBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.daiVaultBalance, "meta vault dai vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.daiVaultBalance,
                )
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdcVaultBalance,
                )
                expect(dataAfter.usdtVaultBalance, "meta vault usdt vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdtVaultBalance,
                )
                // no change on underlying vaults
            })
            it("total redeem", async () => {
                await assertVaultRedeem(staker1, daiToken, daiMetaVault, dataEmitter)
                await assertVaultRedeem(staker1, usdcToken, usdcMetaVault, dataEmitter)
                await assertVaultRedeem(staker1, usdtToken, usdtMetaVault, dataEmitter)

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    staker1,
                )

                // 4626
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.dai.accountBalance, "dai vault user balance").to.be.eq(0)
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.dai.totalSupply, "dai vault total supply").to.be.eq(0)
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.dai.totalAssets, "dai vault total assets").to.be.eq(0)

                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdc.accountBalance, "usdc vault user balance").to.be.eq(0)
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdc.totalSupply, "usdc vault total supply").to.be.eq(0)
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdc.totalAssets, "usdc vault total assets").to.be.eq(0)

                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdt.accountBalance, "usdt vault user balance").to.be.eq(0)
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdt.totalSupply, "usdt vault total supply").to.be.eq(0)
                expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdt.totalAssets, "usdt vault total assets").to.be.eq(0)

                // metavault
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault total supply").to.be.eq(0)
                // FIXME - this scenario is still failing
                assertBNClose(
                    vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                    BN.from(0),
                    simpleToExactAmount(12),
                    "meta vault total assets",
                )
            })
        })
        describe("full flow with settlement", () => {
            describe("before settlement", () => {
                it("deposit erc20Token", async () => {
                    await assertVaultDeposit(staker1, daiToken, daiMetaVault, simpleToExactAmount(50000, DAI.decimals))
                    await assertVaultDeposit(staker1, usdcToken, usdcMetaVault, simpleToExactAmount(50000, USDC.decimals))
                    await assertVaultDeposit(staker1, usdtToken, usdtMetaVault, simpleToExactAmount(50000, USDT.decimals))
                })
                it("mint shares", async () => {
                    await assertVaultMint(staker1, daiToken, daiMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))
                    await assertVaultMint(staker1, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))
                    await assertVaultMint(staker1, usdtToken, usdtMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))
                })
                it("settles to underlying vaults", async () => {
                    const totalAssets = await periodicAllocationPerfFeeMetaVault.totalAssets()

                    // Settle evenly to underlying assets
                    const musdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(4) }
                    const fraxSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(4) }
                    const lusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(4) }
                    const busdSettlement = { vaultIndex: BN.from(3), assets: totalAssets.div(4) }
                    const settlements = { musd: musdSettlement, frax: fraxSettlement, lusd: lusdSettlement, busd: busdSettlement }

                    await assertVaultSettle(
                        vaultManager,
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        settlements,
                        staker1,
                    )
                })
            })
            describe("liquidation", async () => {
                it("collect rewards", async () => {
                    await assertLiquidatorCollectRewards([
                        convex3CrvLiquidatorVaults.musd.address,
                        convex3CrvLiquidatorVaults.frax.address,
                        convex3CrvLiquidatorVaults.busd.address,
                        convex3CrvLiquidatorVaults.lusd.address, // 3
                    ])
                })
                it("swap rewards for tokens to donate", async () => {
                    // Given that all underlying vaults are setup to donate DAI
                    // Swap CRV, CVX for DAI and evaluate balances on liquidator
                    await assertLiquidatorSwap()
                })
                it("donate purchased tokens", async () => {
                    // When tokens are donated
                    await assertLiquidatorDonateTokens(
                        [daiToken, daiToken, daiToken, daiToken],
                        [musdConvexVault.address, fraxConvexVault.address, busdConvexVault.address, lusdConvexVault.address],
                    )
                })
            })
            describe("after settlement", () => {
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
                it("total redeem", async () => {
                    await assertVaultRedeem(staker1, daiToken, daiMetaVault, dataEmitter)
                    await assertVaultRedeem(staker1, usdcToken, usdcMetaVault, dataEmitter)
                    await assertVaultRedeem(staker1, usdtToken, usdtMetaVault, dataEmitter)

                    const vaultsDataAfter = await snapshotVaults(
                        convex3CrvLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curve3CrvBasicMetaVaults,
                        staker1,
                    )

                    // 4626
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.dai.accountBalance, "dai vault user balance").to.be.eq(0)
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.dai.totalSupply, "dai vault total supply").to.be.eq(0)
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.dai.totalAssets, "dai vault total assets").to.be.eq(0)

                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdc.accountBalance, "usdc vault user balance").to.be.eq(0)
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdc.totalSupply, "usdc vault total supply").to.be.eq(0)
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdc.totalAssets, "usdc vault total assets").to.be.eq(0)

                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdt.accountBalance, "usdt vault user balance").to.be.eq(0)
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdt.totalSupply, "usdt vault total supply").to.be.eq(0)
                    expect(vaultsDataAfter.curve3CrvBasicMetaVaults.usdt.totalAssets, "usdt vault total assets").to.be.eq(0)

                    // metavault
                    expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault total supply").to.be.eq(0)
                    // FIXME - this scenario is still failing
                    assertBNClose(
                        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                        BN.from(0),
                        simpleToExactAmount(40),
                        "meta vault total assets",
                    )
                })
            })
        })
    })
})
