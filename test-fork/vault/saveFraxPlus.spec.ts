import { deployFraxBpMetaVaults } from "@tasks/deployment/convexFraxBpVaults"
import { config } from "@tasks/deployment/convexFraxBpVaults-config"
import { logger } from "@tasks/utils/logger"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { shouldBehaveLikeBaseVault, testAmounts } from "@test/shared/BaseVault.behaviour"
import { shouldBehaveLikeSameAssetUnderlyingsAbstractVault } from "@test/shared/SameAssetUnderlyingsAbstractVault.behaviour"
import { assertBNClose, assertBNClosePercent, findContractEvent } from "@utils/assertions"
import { DEAD_ADDRESS, ONE_HOUR, ONE_WEEK } from "@utils/constants"
import { impersonateAccount, loadOrExecFixture } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import * as hre from "hardhat"
import { ethers } from "hardhat"
import {
    BasicDexSwap__factory,
    ConvexFraxBpLiquidatorVault__factory,
    CowSwapDex__factory,
    CurveFraxBpBasicMetaVault__factory,
    DataEmitter__factory,
    IERC20__factory,
    IERC20Metadata__factory,
    InstantProxyAdmin__factory,
    Liquidator__factory,
    MockGPv2Settlement__factory,
    MockGPv2VaultRelayer__factory,
    Nexus__factory,
    PeriodicAllocationPerfFeeMetaVault__factory,
    BasicVault__factory
} from "types/generated"

import { buildDonateTokensInput, BUSD, CRV, crvFRAX, CVX, FRAX, logTxDetails, USDC, usdFormatter } from "../../tasks/utils"

import type { BaseVaultBehaviourContext } from "@test/shared/BaseVault.behaviour"
import type { SameAssetUnderlyingsAbstractVaultBehaviourContext } from "@test/shared/SameAssetUnderlyingsAbstractVault.behaviour"
import type { BigNumber, ContractTransaction, Signer } from "ethers"
import type {
    ConvexFraxBpLiquidatorVault,
    ConvexFraxBpPool,
    CowSwapDex,
    CurveFraxBpBasicMetaVault,
    CurveFraxBpPool,
    DataEmitter,
    Liquidator,
    Nexus,
} from "types"
import type { Account, AnyFraxVault } from "types/common"
import type {
    AbstractVault,
    IERC20Metadata,
    InstantProxyAdmin,
    PeriodicAllocationPerfFeeMetaVault,
    SameAssetUnderlyingsAbstractVault,
    BasicVault
} from "types/generated"

const log = logger("test:saveFraxPlus")

const governorAddress = resolveAddress("Governor")
const feeReceiver = resolveAddress("mStableDAO")
const curveFraxBpAddress = resolveAddress("FraxBP")
const convexBoosterAddress = resolveAddress("ConvexBooster")
const fraxWhaleAddress = "0xB1748C79709f4Ba2Dd82834B8c82D4a505003f27" // Frax Comptroller
const usdcWhaleAddress = "0x0A59649758aa4d66E25f08Dd01271e891fe52199" // Maker PSM
const crvFraxWhale1Address = "0xCFc25170633581Bf896CB6CDeE170e3E3Aa59503" // Curve crvFRAX Gauge
const crvFraxWhale2Address = "0xE57180685E3348589E9521aa53Af0BCD497E884d" // Curve DOLA-FRAX Metapool
const busdWhaleAddress = "0xf977814e90da44bfa03b6295a0616a897441acec" // Binance
// CRV and CVX rewards
const rewardsWhaleAddress = "0x28c6c06298d514db089934071355e5743bf21d60" // Binance Exchange

type Settlement = { vaultIndex: BN; assets: BN }
interface ConvexFraxBpLiquidatorVaults {
    busd?: ConvexFraxBpLiquidatorVault
    susd?: ConvexFraxBpLiquidatorVault
    alusd?: ConvexFraxBpLiquidatorVault
}
interface CurveFraxBpBasicMetaVaults {
    frax: CurveFraxBpBasicMetaVault
    usdc: CurveFraxBpBasicMetaVault
}
interface Settlements {
    busd?: Settlement
    susd?: Settlement
    alusd?: Settlement
}

async function deployMockSyncSwapper(deployer: Signer, nexus: Nexus) {
    const exchanges = [
        { from: CRV.address, to: USDC.address, rate: simpleToExactAmount(61, 4) },
        { from: CVX.address, to: USDC.address, rate: simpleToExactAmount(56, 4) },
        { from: CRV.address, to: FRAX.address, rate: simpleToExactAmount(63, 16) },
        { from: CVX.address, to: FRAX.address, rate: simpleToExactAmount(58, 16) },
    ]
    const swapper = await new BasicDexSwap__factory(deployer).deploy(nexus.address)
    await swapper.initialize(exchanges)
    return swapper
}
async function deployMockAsyncSwapper(deployer: Signer, nexus: Nexus) {
    const gpv2Settlement = await new MockGPv2Settlement__factory(deployer).deploy()
    const relayer = await new MockGPv2VaultRelayer__factory(deployer).deploy(DEAD_ADDRESS)
    await relayer.initialize([
        { from: CRV.address, to: USDC.address, rate: simpleToExactAmount(61, 4) },
        { from: CVX.address, to: USDC.address, rate: simpleToExactAmount(56, 4) },
        { from: CRV.address, to: FRAX.address, rate: simpleToExactAmount(63, 16) },
        { from: CVX.address, to: FRAX.address, rate: simpleToExactAmount(58, 16) },
    ])
    const swapper = await new CowSwapDex__factory(deployer).deploy(nexus.address, relayer.address, gpv2Settlement.address)
    return { relayer, swapper }
}

async function proposeAcceptNexusModule(nexus: Nexus, governor: Account, moduleName: string, moduleAddress: string) {
    const moduleKey = keccak256(toUtf8Bytes(moduleName))

    await nexus.connect(governor.signer).proposeModule(moduleKey, moduleAddress)
    // Adding another minute to the week as Anvil doesn't always increased by the correct number of seconds.
    await increaseTime(ONE_WEEK)
    await nexus.connect(governor.signer).acceptProposedModule(moduleKey)
}

const assertVaultDeposit = async (staker: Account, asset: IERC20Metadata, vault: AnyFraxVault, depositAmount: BigNumber) => {
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
    vault: AnyFraxVault,
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
const assertVaultWithdraw = async (staker: Account, asset: IERC20Metadata, vault: AnyFraxVault, _withdrawAmount?: BigNumber) => {
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
    vault: AnyFraxVault,
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

const snapConvexFraxBpLiquidatorVaults = async (vaults: ConvexFraxBpLiquidatorVaults, account: Account, metaVaultAddress: string) => {
    // reward tokens
    const crvToken = IERC20__factory.connect(CRV.address, account.signer)
    const cvxToken = IERC20__factory.connect(CVX.address, account.signer)

    const snapVault = async (vault: ConvexFraxBpLiquidatorVault) => ({
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
        busd: await snapVault(vaults.busd),
        susd: await snapVault(vaults.susd),
        alusd: await snapVault(vaults.alusd),
    }
    log(`
    busd: { totalAssets: ${vaultsData.busd.totalAssets.toString()}, totalSupply: ${vaultsData.busd.totalSupply.toString()} , metaVaultBalance: ${vaultsData.busd.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.busd.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.busd.crvBalance.toString()} , cvxBalance: ${vaultsData.busd.cvxBalance.toString()} , 
            STREAM_DURATION: ${vaultsData.busd.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.busd.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.busd.shareStream.toString()} , feeReceiver: ${vaultsData.busd.feeReceiver.toString()} 
        }
    susd: { totalAssets: ${vaultsData.susd.totalAssets.toString()}, totalSupply: ${vaultsData.susd.totalSupply.toString()} , metaVaultBalance: ${vaultsData.susd.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.susd.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.susd.crvBalance.toString()} , cvxBalance: ${vaultsData.susd.cvxBalance.toString()} 
            STREAM_DURATION: ${vaultsData.susd.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.susd.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.susd.shareStream.toString()} , feeReceiver: ${vaultsData.susd.feeReceiver.toString()}             
        }
    alusd: { totalAssets: ${vaultsData.alusd.totalAssets.toString()}, totalSupply: ${vaultsData.alusd.totalSupply.toString()} , metaVaultBalance: ${vaultsData.alusd.metaVaultBalance.toString()} , 
            feeReceiverBalance: ${vaultsData.alusd.feeReceiverBalance.toString()} , crvBalance: ${vaultsData.alusd.crvBalance.toString()} , cvxBalance: ${vaultsData.alusd.cvxBalance.toString()} 
            STREAM_DURATION: ${vaultsData.alusd.STREAM_DURATION.toString()} , STREAM_PER_SECOND_SCALE: ${vaultsData.alusd.STREAM_PER_SECOND_SCALE.toString()} 
            shareStream: ${vaultsData.alusd.shareStream.toString()} , feeReceiver: ${vaultsData.alusd.feeReceiver.toString()}             
        }
    `)
    return vaultsData
}
const snapPeriodicAllocationPerfFeeMetaVault = async (
    vault: PeriodicAllocationPerfFeeMetaVault,
    account: Account,
    curveFraxBpBasicMetaVaults: CurveFraxBpBasicMetaVaults,
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
    let curveFraxBpBasicMetaVaultsData = undefined
    if (curveFraxBpBasicMetaVaults) {
        curveFraxBpBasicMetaVaultsData = {
            fraxVaultBalance: await vault.balanceOf(curveFraxBpBasicMetaVaults.frax.address),
            usdcVaultBalance: await vault.balanceOf(curveFraxBpBasicMetaVaults.usdc.address),
        }
    }
    // users: {user1Balance: ${usersData.user1Balance.toString()}, user2Balance:${usersData.user2Balance.toString()}}
    log(`
    vault: { totalAssets: ${vaultData.totalAssets.toString()}, totalSupply: ${vaultData.totalSupply.toString()} , assetsPerShare: ${vaultData.assetsPerShare.toString()},  internalBalance: ${vaultData.internalBalance.toString()}}
    users: { user1Balance: ${usersData.user1Balance.toString()} }
    `)
    if (curveFraxBpBasicMetaVaultsData) {
        log(`curveFraxBpBasicMetaVaults: { fraxVaultBalance: ${curveFraxBpBasicMetaVaultsData.fraxVaultBalance.toString()}, usdcVaultBalance: ${curveFraxBpBasicMetaVaultsData.usdcVaultBalance.toString()} }
        `)
    }
    return {
        vault: vaultData,
        users: usersData,
        curveFraxBpBasicMetaVaults: curveFraxBpBasicMetaVaultsData,
    }
}
const snapCurveFraxBpBasicMetaVaults = async (vaults: CurveFraxBpBasicMetaVaults, accountAddress: string) => {
    const snapVault = async (vault: CurveFraxBpBasicMetaVault) => ({
        totalAssets: await vault.totalAssets(),
        totalSupply: await vault.totalSupply(),
        accountBalance: await vault.balanceOf(accountAddress),
    })
    const vaultsData = {
        frax: await snapVault(vaults.frax),
        usdc: await snapVault(vaults.usdc),
    }
    log(`
    frax: {totalAssets: ${vaultsData.frax.totalAssets.toString()}, totalSupply: ${vaultsData.frax.totalSupply.toString()} , accountBalance: ${vaultsData.frax.accountBalance.toString()} }
    usdc: {totalAssets: ${vaultsData.usdc.totalAssets.toString()}, totalSupply: ${vaultsData.usdc.totalSupply.toString()} , accountBalance: ${vaultsData.usdc.accountBalance.toString()} }
    `)
    return vaultsData
}

const snapshotVaults = async (
    convexFraxBpLiquidatorVaults: ConvexFraxBpLiquidatorVaults,
    periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault,
    curveFraxBpBasicMetaVaults: CurveFraxBpBasicMetaVaults,
    account: Account,
) => {
    const accountAddress = account.address
    return {
        convexFraxBpLiquidatorVaults: await snapConvexFraxBpLiquidatorVaults(
            convexFraxBpLiquidatorVaults,
            account,
            periodicAllocationPerfFeeMetaVault.address,
        ),
        periodicAllocationPerfFeeMetaVault: await snapPeriodicAllocationPerfFeeMetaVault(
            periodicAllocationPerfFeeMetaVault,
            account,
            curveFraxBpBasicMetaVaults,
        ),
        curveFraxBpBasicMetaVaults: await snapCurveFraxBpBasicMetaVaults(curveFraxBpBasicMetaVaults, accountAddress),
    }
}
const assertVaultSettle = async (
    vaultManager: Account,
    convexFraxBpLiquidatorVaults: ConvexFraxBpLiquidatorVaults,
    periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault,
    curveFraxBpBasicMetaVaults: CurveFraxBpBasicMetaVaults,
    settlements: Settlements,
    account: Account,
) => {
    const vaultsDataBefore = await snapshotVaults(
        convexFraxBpLiquidatorVaults,
        periodicAllocationPerfFeeMetaVault,
        curveFraxBpBasicMetaVaults,
        account,
    )
    const totalAssetsSettle = settlements.busd.assets.add(settlements.susd.assets.add(settlements.alusd.assets))
    log(`Total assets to settle ${usdFormatter(totalAssetsSettle, 18, 14, 18)}`)

    const tx = await periodicAllocationPerfFeeMetaVault
        .connect(vaultManager.signer)
        .settle([settlements.busd, settlements.susd, settlements.alusd])
    await logTxDetails(tx, "settle to 3 underlying vaults")

    const vaultsDataAfter = await snapshotVaults(
        convexFraxBpLiquidatorVaults,
        periodicAllocationPerfFeeMetaVault,
        curveFraxBpBasicMetaVaults,
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
    function expectConvexFraxBpLiquidatorVaultSettlement(vaultName: string) {
        expect(vaultsDataBefore.convexFraxBpLiquidatorVaults[vaultName].totalSupply, `${vaultName} vault total supply increases`).to.lt(
            vaultsDataAfter.convexFraxBpLiquidatorVaults[vaultName].totalSupply,
        )
        expect(vaultsDataBefore.convexFraxBpLiquidatorVaults[vaultName].totalAssets, `${vaultName} vault total assets increases`).to.lt(
            vaultsDataAfter.convexFraxBpLiquidatorVaults[vaultName].totalAssets,
        )
        expect(
            vaultsDataBefore.convexFraxBpLiquidatorVaults[vaultName].metaVaultBalance,
            `metavault balance increases on ${vaultName} vault`,
        ).to.lt(vaultsDataAfter.convexFraxBpLiquidatorVaults[vaultName].metaVaultBalance)
        assertBNClosePercent(
            vaultsDataBefore.convexFraxBpLiquidatorVaults[vaultName].totalAssets.add(settlements.busd.assets),
            vaultsDataAfter.convexFraxBpLiquidatorVaults[vaultName].totalAssets,
            "0.5",
            `${vaultName} totalSupply after settlement`,
        )
    }
    expectConvexFraxBpLiquidatorVaultSettlement("busd")
    expectConvexFraxBpLiquidatorVaultSettlement("susd")
    expectConvexFraxBpLiquidatorVaultSettlement("alusd")
}

describe("SaveFrax+ Basic and Meta Vaults", async () => {
    let sa: StandardAccounts
    let deployer: Signer
    let governor: Account
    let rewardsWhale: Account
    let vaultManager: Account
    let keeper: Account
    let fraxWhale: Account
    let usdcWhale: Account
    let crvFraxWhale1: Account
    let crvFraxWhale2: Account
    let busdWhale: Account
    // core smart contracts
    let nexus: Nexus
    let proxyAdmin: InstantProxyAdmin
    // common smart contracts
    let swapper: CowSwapDex
    let liquidator: Liquidator
    // external smart contracts
    let crvFraxToken: IERC20Metadata
    let cvxToken: IERC20Metadata
    let crvToken: IERC20Metadata
    let fraxToken: IERC20Metadata
    let usdcToken: IERC20Metadata
    let busdToken: IERC20Metadata
    // mstable underlying vaults  <= => convex
    let busdConvexVault: ConvexFraxBpLiquidatorVault
    let susdConvexVault: ConvexFraxBpLiquidatorVault
    let alusdConvexVault: ConvexFraxBpLiquidatorVault
    // meta vault  <= => mstable underlying vaults
    let periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault
    // 4626 vaults  <= => meta vault
    let fraxMetaVault: CurveFraxBpBasicMetaVault
    let usdcMetaVault: CurveFraxBpBasicMetaVault

    // custom types to ease unit testing
    let curveFraxBpBasicMetaVaults: CurveFraxBpBasicMetaVaults
    let convexFraxBpLiquidatorVaults: ConvexFraxBpLiquidatorVaults

    let dataEmitter: DataEmitter
    const { network } = hre

    const resetNetwork = async (blockNumber?: number) => {
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
    const setup = async () => {
        await resetNetwork(15966213)
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        governor = await impersonateAccount(resolveAddress("Governor"))
        sa.governor = governor

        crvFraxWhale1 = await impersonateAccount(crvFraxWhale1Address)
        crvFraxWhale2 = await impersonateAccount(crvFraxWhale2Address)
        sa.alice = crvFraxWhale1
        sa.bob = crvFraxWhale2

        rewardsWhale = await impersonateAccount(rewardsWhaleAddress)
        vaultManager = await impersonateAccount(resolveAddress("VaultManager"))
        sa.vaultManager = vaultManager
        keeper = await impersonateAccount(resolveAddress("OperationsSigner"))
        sa.keeper = keeper
        deployer = keeper.signer

        usdcWhale = await impersonateAccount(usdcWhaleAddress)
        fraxWhale = await impersonateAccount(fraxWhaleAddress)
        busdWhale = await impersonateAccount(busdWhaleAddress)

        const nexusAddress = resolveAddress("Nexus")
        nexus = Nexus__factory.connect(nexusAddress, governor.signer)
        const proxyAdminAddress = resolveAddress("InstantProxyAdmin")
        proxyAdmin = InstantProxyAdmin__factory.connect(proxyAdminAddress, governor.signer)

        // Deploy mocked contracts
        ;({ swapper } = await deployMockAsyncSwapper(deployer, nexus))
        await swapper.connect(governor.signer).approveToken(CRV.address)
        await swapper.connect(governor.signer).approveToken(CVX.address)
        // swapper = CowSwapDex__factory.connect(resolveAddress("CowSwapDex"), deployer)
        const syncSwapper = await deployMockSyncSwapper(deployer, nexus)

        // Deploy common /  utilities  contracts
        // ;({ liquidator } = await deployCommon(hre, deployer, nexus, proxyAdmin, syncSwapper.address, swapper.address))
        liquidator = Liquidator__factory.connect(resolveAddress("LiquidatorV2"), keeper.signer)
        liquidator.connect(governor.signer).setSyncSwapper(syncSwapper.address)

        //await proposeAcceptNexusModule(nexus, governor, "LiquidatorV2", liquidator.address)

        //  1 - deployConvexFraxBpLiquidatorVault,  2 - deployPeriodicAllocationPerfFeeMetaVaults,  3 - deployCurveFraxBpMetaVault
        const {
            convexFraxBpVaults,
            periodicAllocationPerfFeeMetaVault: periodicAllocationPerfFeeVault,
            curveFraxBpMetaVaults,
        } = await deployFraxBpMetaVaults(hre, deployer, nexus, proxyAdmin, vaultManager.address)

        //  1.- underlying meta vaults capable of liquidate rewards
        busdConvexVault = ConvexFraxBpLiquidatorVault__factory.connect(convexFraxBpVaults.busd.proxy.address, deployer)
        susdConvexVault = ConvexFraxBpLiquidatorVault__factory.connect(convexFraxBpVaults.susd.proxy.address, deployer)
        alusdConvexVault = ConvexFraxBpLiquidatorVault__factory.connect(convexFraxBpVaults.alusd.proxy.address, deployer)

        // 2.- save plus meta vault
        periodicAllocationPerfFeeMetaVault = PeriodicAllocationPerfFeeMetaVault__factory.connect(
            periodicAllocationPerfFeeVault.proxy.address,
            deployer,
        )

        //  3.- 4626 Wrappers of the save plus meta vault
        fraxMetaVault = CurveFraxBpBasicMetaVault__factory.connect(curveFraxBpMetaVaults.frax.proxy.address, deployer)
        usdcMetaVault = CurveFraxBpBasicMetaVault__factory.connect(curveFraxBpMetaVaults.usdc.proxy.address, deployer)

        // Deploy mocked contracts
        dataEmitter = await new DataEmitter__factory(deployer).deploy()

        crvFraxToken = IERC20Metadata__factory.connect(crvFRAX.address, crvFraxWhale1.signer)
        cvxToken = IERC20Metadata__factory.connect(CVX.address, rewardsWhale.signer)
        crvToken = IERC20Metadata__factory.connect(CRV.address, rewardsWhale.signer)
        fraxToken = IERC20Metadata__factory.connect(FRAX.address, fraxWhale.signer)
        usdcToken = IERC20Metadata__factory.connect(USDC.address, usdcWhale.signer)
        busdToken = IERC20Metadata__factory.connect(BUSD.address, busdWhale.signer)

        // Mock balances on swappers to simulate swaps
        await cvxToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        await crvToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        await fraxToken.transfer(syncSwapper.address, simpleToExactAmount(10000))
        await usdcToken.transfer(syncSwapper.address, simpleToExactAmount(1000000, USDC.decimals))

        await cvxToken.transfer(swapper.address, simpleToExactAmount(10000))
        await crvToken.transfer(swapper.address, simpleToExactAmount(10000))
        await fraxToken.transfer(swapper.address, simpleToExactAmount(10000))
        await usdcToken.transfer(swapper.address, simpleToExactAmount(1000000, USDC.decimals))

        // Stakers approve vaults to take their tokens
        await crvFraxToken.connect(crvFraxWhale1.signer).approve(periodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)
        await crvFraxToken.connect(crvFraxWhale2.signer).approve(periodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)

        await fraxToken.connect(fraxWhale.signer).approve(fraxMetaVault.address, ethers.constants.MaxUint256)
        await fraxToken.connect(crvFraxWhale2.signer).approve(fraxMetaVault.address, ethers.constants.MaxUint256)

        await usdcToken.connect(usdcWhale.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)
        await usdcToken.connect(crvFraxWhale2.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)

        // Mock Balances on our lovely users
        // Because setBalancesToAccountForFraxBp not working transfer some tokens
        await usdcToken.connect(usdcWhale.signer).transfer(crvFraxWhale1.address, simpleToExactAmount(10000000, USDC.decimals))
        await usdcToken.connect(usdcWhale.signer).transfer(crvFraxWhale2.address, simpleToExactAmount(10000000, USDC.decimals))

        await fraxToken.connect(fraxWhale.signer).transfer(crvFraxWhale1.address, simpleToExactAmount(10000000, FRAX.decimals))
        await fraxToken.connect(fraxWhale.signer).transfer(crvFraxWhale2.address, simpleToExactAmount(10000000, FRAX.decimals))

        await busdToken.connect(busdWhale.signer).transfer(crvFraxWhale1.address, simpleToExactAmount(100000000, BUSD.decimals))
        await busdToken.connect(busdWhale.signer).transfer(crvFraxWhale2.address, simpleToExactAmount(100000000, BUSD.decimals))

        // custom types to ease  unit testing
        convexFraxBpLiquidatorVaults = {
            busd: busdConvexVault,
            susd: susdConvexVault,
            alusd: alusdConvexVault,
        }
        curveFraxBpBasicMetaVaults = {
            frax: fraxMetaVault,
            usdc: usdcMetaVault,
        }
    }

    const assertConvexFraxBpVaultConfiguration = async (
        convexFraxBpVault: ConvexFraxBpLiquidatorVault,
        convexFraxBpPool: ConvexFraxBpPool,
    ) => {
        const rewardTokens = await convexFraxBpVault.rewardTokens()
        expect(await convexFraxBpVault.nexus(), "nexus").eq(nexus.address)
        expect((await convexFraxBpVault.metapool()).toLowerCase(), "curve Metapool").to.equal(convexFraxBpPool.curveMetapool.toLowerCase())
        expect((await convexFraxBpVault.metapoolToken()).toLowerCase(), "metapool token").to.equal(
            convexFraxBpPool.curveMetapoolToken.toLowerCase(),
        )
        expect(await convexFraxBpVault.basePool(), "FraxBp pool").to.equal(curveFraxBpAddress)
        expect(await convexFraxBpVault.booster(), "booster").to.equal(convexBoosterAddress)
        expect(await convexFraxBpVault.convexPoolId(), "convex Pool Id").to.equal(convexFraxBpPool.convexPoolId)
        expect(await convexFraxBpVault.baseRewardPool(), "base reward pool").to.equal(convexFraxBpPool.convexRewardPool)
        expect(rewardTokens[0], "reward tokens").to.equal(convexFraxBpPool.rewardTokens[0])
        expect(rewardTokens[1], "reward tokens").to.equal(convexFraxBpPool.rewardTokens[1])
    }
    const assertCurveFraxBpVaultConfiguration = async (curveFraxBpVault: CurveFraxBpBasicMetaVault, curveFraxBpPool: CurveFraxBpPool) => {
        // check a minimum set of configurations
        expect(await curveFraxBpVault.nexus(), "nexus").eq(nexus.address)
        expect(await curveFraxBpVault.metaVault(), "underlying metaVault").to.equal(periodicAllocationPerfFeeMetaVault.address)
        expect(await curveFraxBpVault.asset(), "asset").to.equal(curveFraxBpPool.asset)
        expect(await curveFraxBpVault.name(), "name").to.equal(curveFraxBpPool.name)
        expect(await curveFraxBpVault.symbol(), "symbol").to.equal(curveFraxBpPool.symbol)
        expect(await curveFraxBpVault.decimals(), "decimals").to.equal(18)
    }
    const simulateConvexRewardsDonation = async () => {
        await crvToken.connect(rewardsWhale.signer).transfer(busdConvexVault.address, simpleToExactAmount(100))
        await crvToken.connect(rewardsWhale.signer).transfer(susdConvexVault.address, simpleToExactAmount(100))
        await crvToken.connect(rewardsWhale.signer).transfer(alusdConvexVault.address, simpleToExactAmount(100))
        await cvxToken.connect(rewardsWhale.signer).transfer(busdConvexVault.address, simpleToExactAmount(150))
        await cvxToken.connect(rewardsWhale.signer).transfer(susdConvexVault.address, simpleToExactAmount(150))
        await cvxToken.connect(rewardsWhale.signer).transfer(alusdConvexVault.address, simpleToExactAmount(150))
    }
    const snapLiquidator = async () => {
        const crvBalance = await crvToken.balanceOf(liquidator.address)
        const cvxBalance = await cvxToken.balanceOf(liquidator.address)
        const purchaseTokenBalance = await usdcToken.balanceOf(liquidator.address)
        const pendingCrv = await liquidator.pendingRewards(CRV.address, USDC.address)
        const pendingCvx = await liquidator.pendingRewards(CVX.address, USDC.address)

        return { crvBalance, cvxBalance, purchaseTokenBalance, pendingCrv, pendingCvx }
    }
    const assertLiquidatorCollectRewards = async (vaults: Array<string>) => {
        // simulate convex sends rewards to convexFraxBpLiquidatorVaults when calling collectRewards()
        await simulateConvexRewardsDonation()
        await increaseTime(ONE_WEEK)
        const liqDataBefore = await snapLiquidator()

        const rewardsAddress = [CRV.address.toLowerCase(), CVX.address.toLowerCase()]
        // When collects rewards from all vaults
        const tx = await liquidator.collectRewards(vaults)
        await logTxDetails(tx, "collectRewards")

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

        log(`CollectedRewards rewards {
                        busd: { rewards[0]: ${collectedRewardsEvent.args.rewards[0][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[0][1].toString()} }
                        susd: { rewards[0]: ${collectedRewardsEvent.args.rewards[1][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[1][1].toString()} }
                        alusd: { rewards[0]: ${collectedRewardsEvent.args.rewards[2][0].toString()}, rewards[1]: ${collectedRewardsEvent.args.rewards[2][1].toString()} }
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
        expect(liqDataBefore.purchaseTokenBalance, "liquidator usdc balance").to.be.eq(0)

        // When Swap CRV for USDC
        let tx = await liquidator.connect(governor.signer).swap(CRV.address, USDC.address, 0, "0x")
        await logTxDetails(tx, "swap CRV for USDC")
        await expect(tx).to.emit(liquidator, "Swapped")

        // When Swap CVX for USDC
        tx = await liquidator.connect(governor.signer).swap(CVX.address, USDC.address, 0, "0x")
        await logTxDetails(tx, "swap CVX for USDC")
        await expect(tx).to.emit(liquidator, "Swapped")

        // Then
        const liqDataAfter = await snapLiquidator()
        expect(liqDataAfter.pendingCrv.rewards, "liquidator crv pending").to.be.eq(0)
        expect(liqDataAfter.pendingCvx.rewards, "liquidator cvx pending").to.be.eq(0)
        expect(liqDataAfter.purchaseTokenBalance, "liquidator usdc balance").to.be.gt(0)
    }
    const assertLiquidatorDonateTokens = async (assets: IERC20Metadata[], vaultsAddress: string[]): Promise<ContractTransaction> => {
        const { rewardTokens, purchaseTokens, vaults } = await buildDonateTokensInput(deployer, vaultsAddress)
        const tx = await liquidator.connect(governor.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
        await logTxDetails(tx, "donateTokens")

        for (let i = 0; i < vaultsAddress.length; i++) {
            await expect(tx, `asset ${i}`).to.emit(assets[i], "Transfer")
        }
        await expect(tx).to.emit(liquidator, "DonatedAssets")
        return tx
    }
    before("reset block number", async () => {
        await loadOrExecFixture(setup)
    })
    context("deployment check", async () => {
        describe("proxy instant admin", async () => {
            it("owner is the multisig governor", async () => {
                expect(await proxyAdmin.owner(), "owner must be governor").to.be.eq(governorAddress)
            })
            it("is the admin of all vaults proxies", async () => {
                expect(await proxyAdmin.getProxyAdmin(busdConvexVault.address), "busd vault proxy admin").to.be.eq(proxyAdmin.address)
                expect(await proxyAdmin.getProxyAdmin(susdConvexVault.address), "susd vault proxy admin").to.be.eq(proxyAdmin.address)
                expect(await proxyAdmin.getProxyAdmin(alusdConvexVault.address), "alusd vault proxy admin").to.be.eq(proxyAdmin.address)
            })
        })
        describe("Convex FraxBp Liquidator Vaults", async () => {
            it("busd should properly store valid arguments", async () => {
                await assertConvexFraxBpVaultConfiguration(busdConvexVault, config.convexFraxBpPools.busd)
            })
            it("susd should properly store valid arguments", async () => {
                await assertConvexFraxBpVaultConfiguration(susdConvexVault, config.convexFraxBpPools.susd)
            })
            it("alusd should properly store valid arguments", async () => {
                await assertConvexFraxBpVaultConfiguration(alusdConvexVault, config.convexFraxBpPools.alusd)
            })
        })
        describe("Curve Convex FraxBp Meta Vault", async () => {
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

                expect(await periodicAllocationPerfFeeMetaVault.resolveVaultIndex(0), "underlying vault 0").to.equal(
                    busdConvexVault.address,
                )
                expect(await periodicAllocationPerfFeeMetaVault.resolveVaultIndex(1), "underlying vault 1").to.equal(
                    susdConvexVault.address,
                )
                expect(await periodicAllocationPerfFeeMetaVault.resolveVaultIndex(2), "underlying vault 2").to.equal(
                    alusdConvexVault.address,
                )
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
        describe("Curve FraxBp Meta Vaults", async () => {
            // 4626 Wrappers that facilitate deposit / withdraw USDC | FRAX
            it("frax should properly store valid arguments", async () => {
                await assertCurveFraxBpVaultConfiguration(fraxMetaVault, config.curveFraxBpMetaVault.frax)
            })
            it("usdc should properly store valid arguments", async () => {
                await assertCurveFraxBpVaultConfiguration(usdcMetaVault, config.curveFraxBpMetaVault.usdc)
            })
        })
    })
    context("behaviors", async () => {
        context("should behave like AbstractVault", async () => {
            describe("periodicAllocationPerfFeeMetaVault", async () => {
                const ctx: Partial<BaseVaultBehaviourContext> = {}
                before(async () => {
                    // Anonymous functions cannot be used as fixtures so can't use arrow function
                    ctx.fixture = async function fixture() {
                        await loadOrExecFixture(setup)

                        ctx.vault = periodicAllocationPerfFeeMetaVault as unknown as AbstractVault
                        ctx.asset = crvFraxToken
                        ctx.sa = sa
                        ctx.amounts = testAmounts(1000, crvFRAX.decimals)
                        ctx.dataEmitter = dataEmitter
                    }
                })
                shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
            })
            describe("convexFraxBpLiquidatorVault - busd", async () => {
                const ctx: Partial<BaseVaultBehaviourContext> = {}
                // 'RewardPool : Cannot stake 0'
                before(async () => {
                    // Anonymous functions cannot be used as fixtures so can't use arrow function
                    ctx.fixture = async function fixture() {
                        await loadOrExecFixture(setup)
                        ctx.vault = busdConvexVault as unknown as AbstractVault
                        ctx.asset = crvFraxToken
                        ctx.sa = sa
                        ctx.variances = {
                            convertToAssets: 0.08,
                            convertToShares: 0.08,
                            maxWithdraw: 0.25,
                        }
                        ctx.amounts = testAmounts(1000, crvFRAX.decimals)
                        ctx.dataEmitter = dataEmitter
                    }
                })

                shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
            })
            describe("convexFraxBpLiquidatorVault - susd", async () => {
                const ctx: Partial<BaseVaultBehaviourContext> = {}
                // 'RewardPool : Cannot stake 0'
                before(async () => {
                    // Anonymous functions cannot be used as fixtures so can't use arrow function
                    ctx.fixture = async function fixture() {
                        await loadOrExecFixture(setup)
                        ctx.vault = susdConvexVault as unknown as AbstractVault
                        ctx.asset = crvFraxToken
                        ctx.sa = sa
                        ctx.variances = {
                            convertToAssets: 0.2,
                            convertToShares: 0.2,
                            maxWithdraw: 0.8,
                        }
                        ctx.amounts = testAmounts(1000, crvFRAX.decimals)
                        ctx.dataEmitter = dataEmitter
                    }
                })

                shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
            })
            describe("convexFraxBpLiquidatorVault - alusd", async () => {
                const ctx: Partial<BaseVaultBehaviourContext> = {}
                // 'RewardPool : Cannot stake 0'
                before(async () => {
                    // Anonymous functions cannot be used as fixtures so can't use arrow function
                    ctx.fixture = async function fixture() {
                        await loadOrExecFixture(setup)
                        ctx.vault = alusdConvexVault as unknown as AbstractVault
                        ctx.asset = crvFraxToken
                        ctx.sa = sa
                        ctx.variances = {
                            convertToAssets: 0.5,
                            convertToShares: 0.5,
                            maxWithdraw: 3,
                        }
                        ctx.amounts = testAmounts(1000, crvFRAX.decimals)
                        ctx.dataEmitter = dataEmitter
                    }
                })

                shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
            })
            describe("curveFraxBpBasicMetaVault - USDC", async () => {
                const ctx: Partial<BaseVaultBehaviourContext> = {}
                before(async () => {
                    // Anonymous functions cannot be used as fixtures so can't use arrow function
                    ctx.fixture = async function fixture() {
                        await loadOrExecFixture(setup)
                        ctx.vault = usdcMetaVault as unknown as AbstractVault
                        ctx.asset = usdcToken
                        ctx.sa = sa
                        ctx.sa.alice = usdcWhale
                        ctx.variances = {
                            convertToAssets: 0.12,
                            convertToShares: 0.12,
                            maxWithdraw: 0.08,
                        }
                        ctx.amounts = testAmounts(1000, USDC.decimals)
                        ctx.dataEmitter = dataEmitter
                    }
                })
                shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
            })
            describe("curveFraxBpBasicMetaVault - FRAX", async () => {
                const ctx: Partial<BaseVaultBehaviourContext> = {}
                before(async () => {
                    // Anonymous functions cannot be used as fixtures so can't use arrow function
                    ctx.fixture = async function fixture() {
                        await loadOrExecFixture(setup)
                        ctx.vault = fraxMetaVault as unknown as AbstractVault
                        ctx.asset = fraxToken
                        ctx.sa = sa
                        ctx.sa.alice = fraxWhale
                        ctx.variances = {
                            convertToAssets: 0.08,
                            convertToShares: 0.08,
                            maxWithdraw: 0.02,
                        }
                        ctx.amounts = testAmounts(1000, FRAX.decimals)
                        ctx.dataEmitter = dataEmitter
                    }
                })
                shouldBehaveLikeBaseVault(() => ctx as BaseVaultBehaviourContext)
            })
        })
        context("should behave like SameAssetUnderlyingsAbstractVault", async () => {
            describe("periodicAllocationPerfFeeMetaVault", async () => {
                const ctxSa: Partial<SameAssetUnderlyingsAbstractVaultBehaviourContext> = {}
                before(async () => {
                    ctxSa.fixture = async function fixture() {
                        await loadOrExecFixture(setup)

                        //add a dummy vault and make it singleSourceVaultIndex so that the behavior can freely remove vaults
                        let dummyVault = await new BasicVault__factory(sa.default.signer).deploy(nexus.address, crvFraxToken.address)
                        await dummyVault.initialize(`bv1${await crvFraxToken.name()}`, `bv1${await crvFraxToken.symbol()}`, sa.vaultManager.address)
                        await periodicAllocationPerfFeeMetaVault.connect(sa.governor.signer).addVault(dummyVault.address)
                        await periodicAllocationPerfFeeMetaVault.connect(sa.governor.signer).setSingleSourceVaultIndex(3)

                        ctxSa.vault = periodicAllocationPerfFeeMetaVault as unknown as SameAssetUnderlyingsAbstractVault
                        ctxSa.asset = crvFraxToken
                        ctxSa.sa = sa
                        ctxSa.sa.alice = crvFraxWhale1
                        ctxSa.amounts = { initialDeposit: simpleToExactAmount(100, crvFRAX.decimals) }
                        ctxSa.variances = {
                            totalAssets: simpleToExactAmount(21, 18),
                            totalSupply: simpleToExactAmount(1, 1),
                            bVault0: simpleToExactAmount(2, 20),
                            bVault1: simpleToExactAmount(46, 19),
                        }
                        // underlying vaults are empty even after an initial deposit with this implementation.
                        // periodicAllocationPerfFeeMetaVault.settle needs to be invoked
                        await assertVaultDeposit(
                            crvFraxWhale1,
                            crvFraxToken,
                            periodicAllocationPerfFeeMetaVault,
                            simpleToExactAmount(50000, crvFRAX.decimals),
                        )
                        const totalAssets = await periodicAllocationPerfFeeMetaVault.totalAssets()
                        const settleAssets = totalAssets.div(3)
                        const remainingAssets = totalAssets.sub(settleAssets.mul(2))
                        // Settle evenly to underlying assets
                        const busdSettlement = { vaultIndex: BN.from(0), assets: settleAssets }
                        const susdSettlement = { vaultIndex: BN.from(1), assets: settleAssets }
                        const alusdSettlement = { vaultIndex: BN.from(2), assets: remainingAssets }
                        const settlements = { busd: busdSettlement, susd: susdSettlement, alusd: alusdSettlement }
                        await assertVaultSettle(
                            vaultManager,
                            convexFraxBpLiquidatorVaults,
                            periodicAllocationPerfFeeMetaVault,
                            curveFraxBpBasicMetaVaults,
                            settlements,
                            crvFraxWhale1,
                        )
                    }
                })
                shouldBehaveLikeSameAssetUnderlyingsAbstractVault(() => ctxSa as SameAssetUnderlyingsAbstractVaultBehaviourContext)
            })
        })
    })
    context("PeriodicAllocationPerfFeeMetaVault", async () => {
        let vaultsDataBefore
        before("reset block number", async () => {
            await loadOrExecFixture(setup)
        })
        beforeEach("snap data", async () => {
            vaultsDataBefore = await snapshotVaults(
                convexFraxBpLiquidatorVaults,
                periodicAllocationPerfFeeMetaVault,
                curveFraxBpBasicMetaVaults,
                crvFraxWhale1,
            )
        })
        describe("basic flow", () => {
            it("deposit crvFrax", async () => {
                await assertVaultDeposit(
                    crvFraxWhale1,
                    crvFraxToken,
                    periodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(50000, crvFRAX.decimals),
                )
            })
            it("mint shares", async () => {
                await assertVaultMint(
                    crvFraxWhale1,
                    crvFraxToken,
                    periodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(70000, crvFRAX.decimals),
                )
            })
            it("partial withdraw", async () => {
                await assertVaultWithdraw(
                    crvFraxWhale1,
                    crvFraxToken,
                    periodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(60000, crvFRAX.decimals),
                )
            })
            it("partial redeem", async () => {
                await assertVaultRedeem(
                    crvFraxWhale1,
                    crvFraxToken,
                    periodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(7000, crvFRAX.decimals),
                )
            })
            it("total redeem", async () => {
                await assertVaultRedeem(crvFraxWhale1, crvFraxToken, periodicAllocationPerfFeeMetaVault, dataEmitter)
                const vaultsDataAfter = await snapshotVaults(
                    convexFraxBpLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curveFraxBpBasicMetaVaults,
                    crvFraxWhale1,
                )
                // Expect all liquidity to be removed
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.users.user1Balance, "user balance").to.be.eq(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault total supply").to.be.eq(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault total assets").to.be.eq(0)
            })
        })
        describe("full flow with settlement", () => {
            describe("before settlement", () => {
                it("deposit crvFrax", async () => {
                    await assertVaultDeposit(
                        crvFraxWhale1,
                        crvFraxToken,
                        periodicAllocationPerfFeeMetaVault,
                        simpleToExactAmount(50000, crvFRAX.decimals),
                    )

                    // Expect underlying vaults with 0 balance until settlement
                    const vaultsDataAfter = await snapshotVaults(
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        crvFraxWhale1,
                    )
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.busd.totalSupply, "musd vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.susd.totalSupply, "frax vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.alusd.totalSupply, "busd vault totalSupply").to.be.eq(0)
                })
                it("mint shares", async () => {
                    await assertVaultMint(
                        crvFraxWhale1,
                        crvFraxToken,
                        periodicAllocationPerfFeeMetaVault,
                        dataEmitter,
                        simpleToExactAmount(70000, crvFRAX.decimals),
                    )
                    // Expect underlying vaults with 0 balance until settlement
                    const vaultsDataAfter = await snapshotVaults(
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        crvFraxWhale1,
                    )
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.busd.totalSupply, "musd vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.susd.totalSupply, "frax vault totalSupply").to.be.eq(0)
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.alusd.totalSupply, "busd vault totalSupply").to.be.eq(0)
                })
                it("settles to underlying vaults", async () => {
                    const totalAssets = await periodicAllocationPerfFeeMetaVault.totalAssets()
                    // Settle evenly to underlying assets
                    log(`Total assets in Meta Vault ${usdFormatter(totalAssets, 18, 14, 18)}`)
                    log(`${usdFormatter(totalAssets.div(4), 18, 14, 18)} assets to each underlying vault`)
                    const busdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(3) }
                    const susdSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(3) }
                    const alusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(3) }
                    const settlements = { busd: busdSettlement, susd: susdSettlement, alusd: alusdSettlement }
                    await assertVaultSettle(
                        vaultManager,
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        settlements,
                        crvFraxWhale1,
                    )
                })
            })
            describe("liquidation", async () => {
                it("collect rewards", async () => {
                    await assertLiquidatorCollectRewards([
                        convexFraxBpLiquidatorVaults.busd.address,
                        convexFraxBpLiquidatorVaults.susd.address,
                        convexFraxBpLiquidatorVaults.alusd.address,
                    ])
                })
                it("swap rewards for tokens to donate", async () => {
                    // Given that all underlying vaults are setup to donate USDC
                    // Swap CRV, CVX for USDC and evaluate balances on liquidator
                    await assertLiquidatorSwap()
                })
                it("donate purchased tokens", async () => {
                    // Given the liquidator has purchased tokens
                    const liqDataBefore = await snapLiquidator()
                    expect(liqDataBefore.purchaseTokenBalance, "liquidator usdc balance").to.be.gt(0)
                    // The fee receiver has 0 shares up to now as no donations have been triggered yet
                    expect(vaultsDataBefore.convexFraxBpLiquidatorVaults.busd.feeReceiverBalance, "busd vault feeReceiverBalance").to.be.eq(
                        0,
                    )
                    expect(vaultsDataBefore.convexFraxBpLiquidatorVaults.susd.feeReceiverBalance, "susd vault feeReceiverBalance").to.be.eq(
                        0,
                    )
                    expect(
                        vaultsDataBefore.convexFraxBpLiquidatorVaults.alusd.feeReceiverBalance,
                        "alusd vault feeReceiverBalance",
                    ).to.be.eq(0)
                    // When tokens are donated
                    await assertLiquidatorDonateTokens(
                        [usdcToken, usdcToken, usdcToken],
                        [busdConvexVault.address, susdConvexVault.address, alusdConvexVault.address],
                    )
                    const liqDataAfter = await snapLiquidator()
                    const vaultsDataAfter = await snapshotVaults(
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        crvFraxWhale1,
                    )
                    //  Then fee receiver must not change
                    expect(liqDataAfter.purchaseTokenBalance, "liquidator usdc balance decreased").to.be.lt(
                        liqDataBefore.purchaseTokenBalance,
                    )
                    // The fee receiver shares does not change yet.
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.busd.feeReceiverBalance, "busd vault feeReceiverBalance").to.be.eq(
                        vaultsDataBefore.convexFraxBpLiquidatorVaults.busd.feeReceiverBalance,
                    )
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.susd.feeReceiverBalance, "susd vault feeReceiverBalance").to.be.eq(
                        vaultsDataBefore.convexFraxBpLiquidatorVaults.susd.feeReceiverBalance,
                    )
                    expect(
                        vaultsDataAfter.convexFraxBpLiquidatorVaults.alusd.feeReceiverBalance,
                        "alusd vault feeReceiverBalance",
                    ).to.be.eq(vaultsDataBefore.convexFraxBpLiquidatorVaults.alusd.feeReceiverBalance)
                })
                it("settles to underlying vaults deposits + donations", async () => {
                    // When settlement it also deposits and stakes all underlying vaults balances.
                    await assertVaultDeposit(
                        crvFraxWhale1,
                        crvFraxToken,
                        periodicAllocationPerfFeeMetaVault,
                        simpleToExactAmount(50000, crvFRAX.decimals),
                    )
                    const totalAssets = await crvFraxToken.balanceOf(periodicAllocationPerfFeeMetaVault.address)
                    const settleAssets = totalAssets.div(3)
                    const remainingAssets = totalAssets.sub(settleAssets.mul(2))
                    // Settle evenly to underlying assets
                    log(`Total assets in Meta Vault ${usdFormatter(totalAssets, 18, 14, 18)}`)
                    log(`${usdFormatter(totalAssets.div(3), 18, 14, 18)} assets to each underlying vault`)

                    const busdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(3) }
                    const susdSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(3) }
                    const alusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(3) }
                    const settlements = { busd: busdSettlement, susd: susdSettlement, alusd: alusdSettlement }

                    await assertVaultSettle(
                        vaultManager,
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        settlements,
                        crvFraxWhale1,
                    )
                    const vaultsDataAfter = await snapshotVaults(
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        crvFraxWhale1,
                    )
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.busd.feeReceiverBalance, "busd vault feeReceiverBalance").to.be.gt(
                        0,
                    )
                    expect(vaultsDataAfter.convexFraxBpLiquidatorVaults.susd.feeReceiverBalance, "susd vault feeReceiverBalance").to.be.gt(
                        0,
                    )
                    expect(
                        vaultsDataAfter.convexFraxBpLiquidatorVaults.alusd.feeReceiverBalance,
                        "alusd vault feeReceiverBalance",
                    ).to.be.gt(0)
                })
                it("update assets per shares", async () => {
                    const assetsPerShareBefore = await periodicAllocationPerfFeeMetaVault.assetsPerShare()
                    const tx = await periodicAllocationPerfFeeMetaVault.connect(vaultManager.signer).updateAssetPerShare()
                    await expect(tx).to.emit(periodicAllocationPerfFeeMetaVault, "AssetsPerShareUpdated")

                    const assetsPerShareAfter = await periodicAllocationPerfFeeMetaVault.assetsPerShare()
                    expect(assetsPerShareAfter).to.gt(assetsPerShareBefore)
                })
                it("charge performance fee", async () => {
                    const perfAssetsPerShareBefore = await periodicAllocationPerfFeeMetaVault.perfFeesAssetPerShare()

                    const tx = await periodicAllocationPerfFeeMetaVault.connect(vaultManager.signer).chargePerformanceFee()

                    await expect(tx).not.to.emit(periodicAllocationPerfFeeMetaVault, "PerformanceFee")
                    const perfAssetsPerShareAfter = await periodicAllocationPerfFeeMetaVault.perfFeesAssetPerShare()
                    expect(perfAssetsPerShareAfter).to.lt(perfAssetsPerShareBefore)
                })
            })
            describe("after settlement and burning vault shares", () => {
                it("partial withdraw", async () => {
                    await assertVaultWithdraw(
                        crvFraxWhale1,
                        crvFraxToken,
                        periodicAllocationPerfFeeMetaVault,
                        simpleToExactAmount(60000, crvFRAX.decimals),
                    )
                })
                it("partial redeem", async () => {
                    await assertVaultRedeem(
                        crvFraxWhale1,
                        crvFraxToken,
                        periodicAllocationPerfFeeMetaVault,
                        dataEmitter,
                        simpleToExactAmount(7000, crvFRAX.decimals),
                    )
                })
                it("total redeem", async () => {
                    await assertVaultRedeem(crvFraxWhale1, crvFraxToken, periodicAllocationPerfFeeMetaVault, dataEmitter)
                    const vaultsDataAfter = await snapshotVaults(
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        crvFraxWhale1,
                    )

                    expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.users.user1Balance, "user balance").to.be.eq(0)
                    expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault total supply").to.be.eq(0)
                    assertBNClose(
                        vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                        BN.from(0),
                        simpleToExactAmount(12),
                        "meta vault total assets",
                    )
                })
            })
        })
        describe("mint and withdraw should round up", () => {
            it("minting shares should round up", async () => {
                await loadOrExecFixture(setup)
                let owner = crvFraxWhale1
                let vault = periodicAllocationPerfFeeMetaVault
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer).deposit(10, owner.address)
                await crvFraxToken.transfer(vault.address, 1)

                await vault.connect(sa.vaultManager.signer).updateAssetPerShare()
            
                const userAssetsBefore = await crvFraxToken.balanceOf(owner.address)
                console.log("userAssetsBefore: ", userAssetsBefore.toString())
                // asset/share ratio is 11:10. Thus, when minting 3 shares, it would result in 3.33 assets transferred from user
                // According to erc4626 it should round up, thus it should transfer 4 assets
                await vault.connect(owner.signer).mint(3, owner.address)
                const userAssetsAfter = await crvFraxToken.balanceOf(owner.address)
                console.log("userAssetsAfter: ", userAssetsAfter.toString())
                expect(userAssetsAfter).to.be.eq(userAssetsBefore.sub(4))
            })
            it("withdrawing assets should round up", async () => {
                await loadOrExecFixture(setup)
                let owner = crvFraxWhale1
                let vault = periodicAllocationPerfFeeMetaVault
                // vault asset/share ratio is 11:10 after the following 2 transactions
                await vault.connect(owner.signer)["deposit(uint256,address)"](10, owner.address)
                await crvFraxToken.connect(owner.signer).transfer(vault.address, 1)

                await vault.connect(sa.vaultManager.signer).updateAssetPerShare()

                const userSharesBefore = await vault.balanceOf(owner.address)
                // asset/share ratio is 11:10. Thus, when withdrawing 3 assets, it would result in 2.73 shares burned from user
                // According to erc4626 it should round up, thus burning 3 shares
                await vault.connect(owner.signer).withdraw(3, owner.address, owner.address)
                const userSharesAfter = await vault.balanceOf(owner.address)
                expect(userSharesAfter).to.be.eq(userSharesBefore.sub(3))
            })
        })
    })
    context("CurveFraxBpBasicMetaVault", async () => {
        let vaultsDataBefore

        before("reset block number", async () => {
            await loadOrExecFixture(setup)
        })
        beforeEach("snap data", async () => {
            vaultsDataBefore = await snapshotVaults(
                convexFraxBpLiquidatorVaults,
                periodicAllocationPerfFeeMetaVault,
                curveFraxBpBasicMetaVaults,
                crvFraxWhale1,
            )
        })
        describe("basic flow", () => {
            it("deposit erc20Token", async () => {
                // Given the periodicAllocationPerfFeeMetaVault total supply is 0
                expect(vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "metavault supply").to.be.eq(0)

                // When deposit via 4626MetaVault
                await assertVaultDeposit(usdcWhale, usdcToken, usdcMetaVault, simpleToExactAmount(50000, USDC.decimals))
                await assertVaultDeposit(fraxWhale, fraxToken, fraxMetaVault, simpleToExactAmount(50000, FRAX.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convexFraxBpLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curveFraxBpBasicMetaVaults,
                    crvFraxWhale1,
                )
                // Then periodicAllocationPerfFeeMetaVault supply increases
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault totalAssets").to.be.gt(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault totalSupply").to.be.gt(0)
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.internalBalance, "meta vault internalBalance").to.be.gt(0)

                // The 4626MetaVault's shares on the meta vault increases
                const { curveFraxBpBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.fraxVaultBalance, "meta vault frax vault balance").to.be.gt(0)
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.gt(0)
                // no change on underlying vaults
            })
            it("mint shares", async () => {
                // When mint via 4626MetaVault
                await assertVaultMint(usdcWhale, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(70000, USDC.decimals))
                await assertVaultMint(fraxWhale, fraxToken, fraxMetaVault, dataEmitter, simpleToExactAmount(70000, FRAX.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convexFraxBpLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curveFraxBpBasicMetaVaults,
                    crvFraxWhale1,
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
                const { curveFraxBpBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.fraxVaultBalance, "meta vault frax vault balance").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curveFraxBpBasicMetaVaults.fraxVaultBalance,
                )
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.gt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curveFraxBpBasicMetaVaults.usdcVaultBalance,
                )
                // no change on underlying vaults
            })
            it("partial withdraw", async () => {
                await assertVaultWithdraw(usdcWhale, usdcToken, usdcMetaVault, simpleToExactAmount(60000, USDC.decimals))
                await assertVaultWithdraw(fraxWhale, fraxToken, fraxMetaVault, simpleToExactAmount(60000, FRAX.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convexFraxBpLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curveFraxBpBasicMetaVaults,
                    crvFraxWhale1,
                )
                // The 4626MetaVault's shares on the meta vault decreases
                const { curveFraxBpBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.fraxVaultBalance, "meta vault frax vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curveFraxBpBasicMetaVaults.fraxVaultBalance,
                )
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curveFraxBpBasicMetaVaults.usdcVaultBalance,
                )
                // no change on underlying vaults
            })
            it("partial redeem", async () => {
                await assertVaultRedeem(usdcWhale, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(7000, USDC.decimals))
                await assertVaultRedeem(fraxWhale, fraxToken, fraxMetaVault, dataEmitter, simpleToExactAmount(7000, FRAX.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convexFraxBpLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curveFraxBpBasicMetaVaults,
                    crvFraxWhale1,
                )
                // The 4626MetaVault's shares on the meta vault decreases
                const { curveFraxBpBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.fraxVaultBalance, "meta vault frax vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curveFraxBpBasicMetaVaults.fraxVaultBalance,
                )
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.lt(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curveFraxBpBasicMetaVaults.usdcVaultBalance,
                )
                // no change on underlying vaults
            })
            it("total redeem", async () => {
                await assertVaultRedeem(usdcWhale, usdcToken, usdcMetaVault, dataEmitter)
                await assertVaultRedeem(fraxWhale, fraxToken, fraxMetaVault, dataEmitter)

                // 4626
                expect(await fraxMetaVault.balanceOf(fraxWhale.address), "frax vault user balance").to.be.eq(0)
                expect(await fraxMetaVault.totalSupply(), "frax vault total supply").to.be.eq(0)
                expect(await fraxMetaVault.totalAssets(), "frax vault total assets").to.be.eq(0)

                expect(await usdcMetaVault.balanceOf(usdcWhale.address), "usdc vault user balance").to.be.eq(0)
                expect(await usdcMetaVault.totalSupply(), "usdc vault total supply").to.be.eq(0)
                expect(await usdcMetaVault.totalAssets(), "usdc vault total assets").to.be.eq(0)

                // metavault
                expect(await periodicAllocationPerfFeeMetaVault.totalSupply(), "meta vault total supply").to.be.eq(0)
                assertBNClose(
                    await periodicAllocationPerfFeeMetaVault.totalAssets(),
                    BN.from(0),
                    simpleToExactAmount(12),
                    "meta vault total assets",
                )
            })
        })
        describe("full flow with settlement", () => {
            describe("before settlement", () => {
                it("deposit erc20Token", async () => {
                    await assertVaultDeposit(usdcWhale, usdcToken, usdcMetaVault, simpleToExactAmount(50000, USDC.decimals))
                    await assertVaultDeposit(fraxWhale, fraxToken, fraxMetaVault, simpleToExactAmount(50000, FRAX.decimals))
                })
                it("mint shares", async () => {
                    await assertVaultMint(usdcWhale, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(70000, USDC.decimals))
                    await assertVaultMint(fraxWhale, fraxToken, fraxMetaVault, dataEmitter, simpleToExactAmount(70000, FRAX.decimals))
                })
                it("settles to underlying vaults", async () => {
                    const totalAssets = await periodicAllocationPerfFeeMetaVault.totalAssets()

                    // Settle evenly to underlying assets
                    const busdSettlement = { vaultIndex: BN.from(0), assets: totalAssets.div(3) }
                    const susdSettlement = { vaultIndex: BN.from(1), assets: totalAssets.div(3) }
                    const alusdSettlement = { vaultIndex: BN.from(2), assets: totalAssets.div(3) }
                    const settlements = { busd: busdSettlement, susd: susdSettlement, alusd: alusdSettlement }

                    await assertVaultSettle(
                        vaultManager,
                        convexFraxBpLiquidatorVaults,
                        periodicAllocationPerfFeeMetaVault,
                        curveFraxBpBasicMetaVaults,
                        settlements,
                        crvFraxWhale1,
                    )
                })
            })
            describe("after settlement", () => {
                it("partial withdraw", async () => {
                    await assertVaultWithdraw(usdcWhale, usdcToken, usdcMetaVault, simpleToExactAmount(60000, USDC.decimals))
                    await assertVaultWithdraw(fraxWhale, fraxToken, fraxMetaVault, simpleToExactAmount(60000, FRAX.decimals))
                })
                it("partial redeem", async () => {
                    await assertVaultRedeem(usdcWhale, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(7000, USDC.decimals))
                    await assertVaultRedeem(fraxWhale, fraxToken, fraxMetaVault, dataEmitter, simpleToExactAmount(7000, FRAX.decimals))
                })
                it("total redeem", async () => {
                    await assertVaultRedeem(usdcWhale, usdcToken, usdcMetaVault, dataEmitter)
                    await periodicAllocationPerfFeeMetaVault.connect(vaultManager.signer).updateAssetPerShare()
                    await assertVaultRedeem(fraxWhale, fraxToken, fraxMetaVault, dataEmitter)

                    // 4626
                    expect(await fraxMetaVault.balanceOf(fraxWhale.address), "frax vault user balance").to.be.eq(0)
                    expect(await fraxMetaVault.totalSupply(), "frax vault total supply").to.be.eq(0)
                    expect(await fraxMetaVault.totalAssets(), "frax vault total assets").to.be.eq(0)

                    expect(await usdcMetaVault.balanceOf(usdcWhale.address), "usdc vault user balance").to.be.eq(0)
                    expect(await usdcMetaVault.totalSupply(), "usdc vault total supply").to.be.eq(0)
                    expect(await usdcMetaVault.totalAssets(), "usdc vault total assets").to.be.eq(0)

                    // metavault
                    expect(await periodicAllocationPerfFeeMetaVault.totalSupply(), "meta vault total supply").to.be.eq(0)
                    assertBNClose(
                        await periodicAllocationPerfFeeMetaVault.totalAssets(),
                        BN.from(0),
                        simpleToExactAmount(40),
                        "meta vault total assets",
                    )
                })
            })
        })
    })
    context("ConvexFraxBpLiquidatorVault", async () => {
        before("reset block number", async () => {
            await loadOrExecFixture(setup)
        })
        describe("liquidate assets", () => {
            before(async () => {
                await crvFraxToken.connect(crvFraxWhale1.signer).approve(alusdConvexVault.address, ethers.constants.MaxUint256)
                await alusdConvexVault.connect(crvFraxWhale1.signer).mint(simpleToExactAmount(10000), crvFraxWhale1.address)
            })
            it("whale should fail to liquidate vault if not governor", async () => {
                const tx = alusdConvexVault.connect(crvFraxWhale1.signer).liquidateVault(0)
                await expect(tx).to.be.revertedWith("Only governor can execute")
            })
            it("vault manager should fail to liquidate vault if not governor", async () => {
                const tx = alusdConvexVault.connect(vaultManager.signer).liquidateVault(0)
                await expect(tx).to.be.revertedWith("Only governor can execute")
            })
            it("governor should liquidate vault", async () => {
                const governorAssetsBefore = await crvFraxToken.balanceOf(governor.address)
                const totalSharesBefore = await alusdConvexVault.totalSupply()
                await alusdConvexVault.connect(governor.signer).liquidateVault(0)

                expect(await crvFraxToken.balanceOf(governor.address), "governor FraxBp bal").to.gt(governorAssetsBefore)
                expect(await alusdConvexVault.totalAssets(), "total assets").to.eq(0)
                expect(await alusdConvexVault.totalSupply(), "total shares").to.eq(totalSharesBefore)
            })
        })
        it("reset allowances", async () => {
            await alusdConvexVault.connect(governor.signer).resetAllowances()
        })
    })
})
