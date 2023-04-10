import { deployPeriodicAllocationPerfFeeMetaVault } from "@tasks/convex3CrvMetaVault"
import { deployConvex3CrvLiquidatorVaultCopy } from "@tasks/convex3CrvVault"
import { deployCurve3CrvMetaVault } from "@tasks/curve3CrvVault"
import { config } from "@tasks/deployment/convex3CrvVaults-config"
import { logger } from "@tasks/utils/logger"
import { resolveAddress } from "@tasks/utils/networkAddressFactory"
import { assertBNClose, assertBNClosePercent } from "@utils/assertions"
import { ONE_HOUR, ZERO } from "@utils/constants"
import { impersonateAccount, loadOrExecFixture, setBalancesToAccount } from "@utils/fork"
import { StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import * as hre from "hardhat"
import { ethers } from "hardhat"
import {
    Convex3CrvLiquidatorVault__factory,
    Curve3CrvBasicMetaVault__factory,
    DataEmitter__factory,
    IERC20__factory,
    IERC20Metadata__factory,
    InstantProxyAdmin__factory,
    Nexus__factory,
    PeriodicAllocationPerfFeeMetaVault__factory,
} from "types/generated"

import { CRV, CVX, DAI, logTxDetails, ThreeCRV, USDC, usdFormatter, USDT } from "../../tasks/utils"

import type { BigNumber, Signer } from "ethers"
import type { Convex3CrvLiquidatorVault, Convex3CrvPool, Curve3CrvBasicMetaVault, Curve3CrvPool, DataEmitter, Nexus } from "types"
import type { Account, AnyVault } from "types/common"
import type { ERC20, IERC20Metadata, InstantProxyAdmin, PeriodicAllocationPerfFeeMetaVault } from "types/generated"

const log = logger("test:savePlus")

const governorAddress = resolveAddress("Governor")
const feeReceiver = resolveAddress("mStableDAO")
const curveThreePoolAddress = resolveAddress("CurveThreePool")
const convexBoosterAddress = resolveAddress("ConvexBooster")
const usdtWhaleAddress = "0xD6216fC19DB775Df9774a6E33526131dA7D19a2c" // KuCoin 6
const daiWhaleAddress = "0xD6216fC19DB775Df9774a6E33526131dA7D19a2c" // KuCoin 6
const usdcWhaleAddress = "0x3dd46846eed8D147841AE162C8425c08BD8E1b41" // mStableDAO
const threeCrvWhale1Address = "0x064c60c99C392c96d5733AE48d83fE7Ea3C75CAf"
const threeCrvWhale2Address = "0xEcd5e75AFb02eFa118AF914515D6521aaBd189F1"
// CRV and CVX rewards
const rewardsWhaleAddress = "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2" // FTX Exchange

interface Convex3CrvLiquidatorVaults {
    musd: Convex3CrvLiquidatorVault
    frax: Convex3CrvLiquidatorVault
    busd: Convex3CrvLiquidatorVault
}
interface Curve3CrvBasicMetaVaults {
    usdc: Curve3CrvBasicMetaVault
}
const assertVaultDepositRevert = async (staker: Account, asset: IERC20Metadata, vault: AnyVault, depositAmount: BigNumber) => {
    await increaseTime(ONE_HOUR)
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const totalAssetsBefore = await vault.totalAssets()

    const sharesPreviewed = await vault.connect(staker.signer).previewDeposit(depositAmount)

    await expect(vault.connect(staker.signer)["deposit(uint256,address)"](depositAmount, staker.address), "deposit").to.be.revertedWith(
        "Vault shutdown",
    )
    const sharesAfter = await vault.balanceOf(staker.address)
    const assetsAfter = await asset.balanceOf(staker.address)
    const sharesMinted = sharesAfter.sub(sharesBefore)

    expect(sharesMinted, "sharesMinted").to.be.eq(ZERO)
    expect(sharesPreviewed, "previewDeposit").to.be.eq(ZERO)
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).eq(assetsBefore)
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).eq(sharesBefore)
    expect(await vault.totalAssets(), "totalAssets").to.be.eq(totalAssetsBefore)
}
const assertVaultMintRevert = async (
    staker: Account,
    asset: IERC20Metadata,
    vault: AnyVault,
    dataEmitter: DataEmitter,
    mintAmount: BigNumber,
) => {
    await increaseTime(ONE_HOUR)
    const assetsBefore = await asset.balanceOf(staker.address)
    const sharesBefore = await vault.balanceOf(staker.address)
    const totalSharesBefore = await vault.totalSupply()
    const assetsPreviewed = await vault.connect(staker.signer).previewMint(mintAmount)
    log(`Assets deposited from mint of 70,000 shares ${usdFormatter(assetsPreviewed)}`)

    await expect(vault.connect(staker.signer).mint(mintAmount, staker.address), "mint").to.be.revertedWith("Vault shutdown")

    const assetsAfter = await asset.balanceOf(staker.address)
    const assetsUsedForMint = assetsBefore.sub(assetsAfter)

    expect(assetsUsedForMint, "assetsUsedForMint").to.be.eq(ZERO)
    expect(assetsPreviewed, "assetsPreviewed").to.be.eq(ZERO)
    expect(assetsAfter, `staker ${await asset.symbol()} assets after`).eq(assetsBefore)
    expect(await vault.balanceOf(staker.address), `staker ${await vault.symbol()} shares after`).eq(sharesBefore)
    expect(await vault.totalSupply(), "vault supply after").eq(totalSharesBefore)
}
const assertVaultWithdraw = async (staker: Account, asset: IERC20Metadata, vault: AnyVault, _withdrawAmount?: BigNumber) => {
    const variance = simpleToExactAmount(3, 15)
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
    const variance = simpleToExactAmount(4, 15)

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
    assertBNClose(await vault.totalSupply(), totalSharesBefore.sub(redeemAmount), simpleToExactAmount(5, 16), "vault supply after")
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
    }
    let curve3CrvBasicMetaVaultsData = undefined
    if (curve3CrvBasicMetaVaults) {
        curve3CrvBasicMetaVaultsData = {
            usdcVaultBalance: await vault.balanceOf(curve3CrvBasicMetaVaults.usdc.address),
        }
    }
    // users: {user1Balance: ${usersData.user1Balance.toString()}, user2Balance:${usersData.user2Balance.toString()}}
    log(`
    vault: { totalAssets: ${vaultData.totalAssets.toString()}, totalSupply: ${vaultData.totalSupply.toString()} , assetsPerShare: ${vaultData.assetsPerShare.toString()},  internalBalance: ${vaultData.internalBalance.toString()}}
    users: { user1Balance: ${usersData.user1Balance.toString()} }
    `)
    if (curve3CrvBasicMetaVaultsData) {
        log(`curve3CrvBasicMetaVaults: { usdcVaultBalance: ${curve3CrvBasicMetaVaultsData.usdcVaultBalance.toString()} }
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
        usdc: await snapVault(vaults.usdc),
    }
    log(`
    usdc: {totalAssets: ${vaultsData.usdc.totalAssets.toString()}, totalSupply: ${vaultsData.usdc.totalSupply.toString()} , accountBalance: ${vaultsData.usdc.accountBalance.toString()} }
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

describe("Save+ Basic and Meta Vaults - Shutdown", async () => {
    let sa: StandardAccounts
    let deployer: Signer
    let governor: Account
    let vaultManager: Account
    let keeper: Account
    let usdtWhale: Account
    let usdcWhale: Account
    let daiWhale: Account
    let threeCrvWhale1: Account
    let threeCrvWhale2: Account
    // core smart contracts
    let nexus: Nexus
    let proxyAdmin: InstantProxyAdmin
    // common smart contracts
    let threeCrvToken: IERC20Metadata
    let usdcToken: IERC20Metadata
    let usdtToken: IERC20Metadata
    // mstable underlying vaults  <= => convex
    let musdConvexVault: Convex3CrvLiquidatorVault
    let fraxConvexVault: Convex3CrvLiquidatorVault
    let busdConvexVault: Convex3CrvLiquidatorVault
    // meta vault  <= => mstable underlying vaults
    let periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVault
    // 4626 vaults  <= => meta vault
    let usdcMetaVault: Curve3CrvBasicMetaVault

    // custom types to ease unit testing
    let curve3CrvBasicMetaVaults: Curve3CrvBasicMetaVaults
    let convex3CrvLiquidatorVaults: Convex3CrvLiquidatorVaults

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
        await resetNetwork(16989760)
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        governor = await impersonateAccount(resolveAddress("Governor"))
        sa.governor = governor

        threeCrvWhale1 = await impersonateAccount(threeCrvWhale1Address)
        threeCrvWhale2 = await impersonateAccount(threeCrvWhale2Address)
        sa.alice = threeCrvWhale1
        sa.bob = threeCrvWhale2

        vaultManager = await impersonateAccount(resolveAddress("VaultManager"))
        sa.vaultManager = vaultManager
        keeper = await impersonateAccount(resolveAddress("OperationsSigner"))
        sa.keeper = keeper
        deployer = keeper.signer

        daiWhale = await impersonateAccount(daiWhaleAddress)
        usdcWhale = await impersonateAccount(usdcWhaleAddress)
        usdtWhale = await impersonateAccount(usdtWhaleAddress)

        const nexusAddress = resolveAddress("Nexus")
        nexus = Nexus__factory.connect(nexusAddress, governor.signer)
        const proxyAdminAddress = resolveAddress("InstantProxyAdmin")

        proxyAdmin = InstantProxyAdmin__factory.connect(proxyAdminAddress, governor.signer)

        const convex3CrvVaults = {
            musd: { address: resolveAddress("vcx3CRV-mUSD") },
            frax: { address: resolveAddress("vcx3CRV-FRAX") },
            busd: { address: resolveAddress("vcx3CRV-BUSD") },
        }
        const curve3CrvMetaVaults = {
            usdc: { address: resolveAddress("mvUSDC-3PCV") },
        }

        const savePlusConfig = {
            periodicAllocationPerfFeeMetaVault: { address: resolveAddress("mv3CRV-CVX") },
            convex3CrvVaults,
            curve3CrvMetaVaults,
        }

        //  1.- underlying meta vaults capable of liquidate rewards
        musdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.musd.address, deployer)
        fraxConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.frax.address, deployer)
        busdConvexVault = Convex3CrvLiquidatorVault__factory.connect(convex3CrvVaults.busd.address, deployer)

        // 2.- save plus meta vault
        periodicAllocationPerfFeeMetaVault = PeriodicAllocationPerfFeeMetaVault__factory.connect(
            savePlusConfig.periodicAllocationPerfFeeMetaVault.address,
            deployer,
        )
        //  3.- 4626 Wrappers of the save plus meta vault
        usdcMetaVault = Curve3CrvBasicMetaVault__factory.connect(curve3CrvMetaVaults.usdc.address, deployer)

        // Deploy mocked contracts
        dataEmitter = await new DataEmitter__factory(deployer).deploy()

        threeCrvToken = IERC20Metadata__factory.connect(ThreeCRV.address, threeCrvWhale1.signer)
        usdcToken = IERC20Metadata__factory.connect(USDC.address, usdcWhale.signer)
        usdtToken = IERC20Metadata__factory.connect(USDT.address, usdtWhale.signer)

        // Mock Balances on our lovely users
        const musdTokenAddress = resolveAddress("mUSD")
        const daiTokenAddress = DAI.address
        const usdcTokenAddress = USDC.address
        const usdtTokenAddress = USDT.address
        const tokensToMockBalance = { musdTokenAddress, usdcTokenAddress, daiTokenAddress, usdtTokenAddress }

        await setBalancesToAccount(threeCrvWhale1, [] as ERC20[], tokensToMockBalance, 10000000000)
        await setBalancesToAccount(threeCrvWhale2, [] as ERC20[], tokensToMockBalance, 10000000000)

        // Stakers approve vaults to take their tokens
        await threeCrvToken.connect(threeCrvWhale1.signer).approve(periodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)
        await threeCrvToken.connect(threeCrvWhale2.signer).approve(periodicAllocationPerfFeeMetaVault.address, ethers.constants.MaxUint256)

        await usdcToken.connect(usdcWhale.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)
        await usdcToken.connect(threeCrvWhale2.signer).approve(usdcMetaVault.address, ethers.constants.MaxUint256)

        await usdtToken.connect(usdtWhale.signer).transfer(threeCrvWhale1.address, simpleToExactAmount(10000000, USDT.decimals))
        await usdtToken.connect(usdtWhale.signer).transfer(threeCrvWhale2.address, simpleToExactAmount(10000000, USDT.decimals))

        // custom types to ease  unit testing
        convex3CrvLiquidatorVaults = {
            musd: musdConvexVault,
            frax: fraxConvexVault,
            busd: busdConvexVault,
        }
        curve3CrvBasicMetaVaults = {
            usdc: usdcMetaVault,
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
    before("reset block number", async () => {
        await loadOrExecFixture(setup)
    })
    context("deployment check", async () => {
        describe("proxy instant admin", async () => {
            it("owner is the multisig governor", async () => {
                expect(await proxyAdmin.owner(), "owner must be governor").to.be.eq(governorAddress)
            })
            it("is the admin of all vaults proxies", async () => {
                expect(await proxyAdmin.getProxyAdmin(musdConvexVault.address), "musd vault proxy admin").to.be.eq(proxyAdmin.address)
                expect(await proxyAdmin.getProxyAdmin(fraxConvexVault.address), "frax vault proxy admin").to.be.eq(proxyAdmin.address)
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
        })
        describe("Curve 3CRV Convex Meta Vault", async () => {
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
                    fraxConvexVault.address,
                )
                expect(await periodicAllocationPerfFeeMetaVault.resolveVaultIndex(1), "underlying vault 1").to.equal(
                    musdConvexVault.address,
                )
                expect(await periodicAllocationPerfFeeMetaVault.resolveVaultIndex(2), "underlying vault 2").to.equal(
                    busdConvexVault.address,
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
        describe("Curve 3Crv Meta Vaults", async () => {
            // 4626 Wrappers that facilitate deposit / withdraw USDC | DAI| USDT
            it("usdc should properly store valid arguments", async () => {
                await assertCurve3CrvVaultConfiguration(usdcMetaVault, config.curve3CrvMetaVault.usdc)
            })
        })
    })
    context.skip("upgrade vaults", async () => {
        // mstable underlying vaults  <= => convex
        let musdConvexVaultImpl: Convex3CrvLiquidatorVault
        let fraxConvexVaultImpl: Convex3CrvLiquidatorVault
        let busdConvexVaultImpl: Convex3CrvLiquidatorVault
        // meta vault  <= => mstable underlying vaults
        let periodicAllocationPerfFeeMetaVaultImpl: PeriodicAllocationPerfFeeMetaVault
        // 4626 vaults  <= => meta vault
        let usdcMetaVaultImpl: Curve3CrvBasicMetaVault

        describe("propose / accepts upgrades", async () => {
            it("deploys new vaults", async () => {
                //  1.- underlying meta vaults capable of liquidate rewards
                // yarn task convex-3crv-vault-deploy-copy --vault vcx3CRV-FRAX  --calculator-library Curve3CrvFactoryMetapoolCalculatorLibrary --network mainnet
                fraxConvexVaultImpl = (
                    await deployConvex3CrvLiquidatorVaultCopy(
                        hre,
                        deployer,
                        fraxConvexVault,
                        resolveAddress("Curve3CrvFactoryMetapoolCalculatorLibrary"),
                    )
                ).impl
                // yarn task convex-3crv-vault-deploy-copy --vault vcx3CRV-mUSD  --calculator-library Curve3CrvMetapoolCalculatorLibrary --network mainnet
                musdConvexVaultImpl = (
                    await deployConvex3CrvLiquidatorVaultCopy(
                        hre,
                        deployer,
                        musdConvexVault,
                        resolveAddress("Curve3CrvMetapoolCalculatorLibrary"),
                    )
                ).impl

                // yarn task convex-3crv-vault-deploy-copy --vault vcx3CRV-BUSD  --calculator-library Curve3CrvFactoryMetapoolCalculatorLibrary --network mainnet
                busdConvexVaultImpl = (
                    await deployConvex3CrvLiquidatorVaultCopy(
                        hre,
                        deployer,
                        busdConvexVault,
                        resolveAddress("Curve3CrvFactoryMetapoolCalculatorLibrary"),
                    )
                ).impl

                // 2.- save plus meta vault
                //  yarn task convex-3crv-mv-deploy  --asset  3Crv --proxy false --network mainnet
                periodicAllocationPerfFeeMetaVaultImpl = (
                    await deployPeriodicAllocationPerfFeeMetaVault(hre, deployer, {
                        nexus: nexus.address,
                        asset: await periodicAllocationPerfFeeMetaVault.asset(),
                        proxy: false,
                    })
                ).impl

                //  3.- 4626 Wrappers of the save plus meta vault
                // yarn task curve-3crv-meta-vault-deploy --asset USDC  --calculator-library  Curve3CrvCalculatorLibrary --proxy false --network mainnet
                usdcMetaVaultImpl = (
                    await deployCurve3CrvMetaVault(hre, deployer, {
                        calculatorLibrary: resolveAddress("Curve3CrvCalculatorLibrary"),
                        nexus: nexus.address,
                        asset: usdcToken.address,
                        metaVault: periodicAllocationPerfFeeMetaVault.address,
                        proxy: false,
                    })
                ).impl
            })
            it("pause all vaults", async () => {
                await musdConvexVault.connect(governor.signer).pause()
                await fraxConvexVault.connect(governor.signer).pause()
                await busdConvexVault.connect(governor.signer).pause()

                expect(await musdConvexVault.paused(), " musd convex vault paused").to.be.eq(true)
                expect(await fraxConvexVault.paused(), " frax convex vault paused").to.be.eq(true)
                expect(await busdConvexVault.paused(), " busd convex vault paused").to.be.eq(true)

                await periodicAllocationPerfFeeMetaVault.connect(governor.signer).pause()
                expect(await periodicAllocationPerfFeeMetaVault.paused(), " periodic allocation vault paused").to.be.eq(true)

                await usdcMetaVault.connect(governor.signer).pause()
                expect(await usdcMetaVault.paused(), " usdc curve vault paused").to.be.eq(true)
            })
            it("upgrade contracts", async () => {
                await proxyAdmin.upgrade(musdConvexVault.address, musdConvexVaultImpl.address)
                await proxyAdmin.upgrade(fraxConvexVault.address, fraxConvexVaultImpl.address)
                await proxyAdmin.upgrade(busdConvexVault.address, busdConvexVaultImpl.address)

                expect(await proxyAdmin.getProxyImplementation(musdConvexVault.address), "musd proxy convex vault updated").to.be.eq(
                    musdConvexVaultImpl.address,
                )
                expect(await proxyAdmin.getProxyImplementation(fraxConvexVault.address), "frax proxy convex vault updated").to.be.eq(
                    fraxConvexVaultImpl.address,
                )
                expect(await proxyAdmin.getProxyImplementation(busdConvexVault.address), "busd proxy convex vault updated").to.be.eq(
                    busdConvexVaultImpl.address,
                )

                await proxyAdmin.upgrade(periodicAllocationPerfFeeMetaVault.address, periodicAllocationPerfFeeMetaVaultImpl.address)
                expect(
                    await proxyAdmin.getProxyImplementation(periodicAllocationPerfFeeMetaVault.address),
                    "periodic allocation proxy convex vault updated",
                ).to.be.eq(periodicAllocationPerfFeeMetaVaultImpl.address)

                await proxyAdmin.upgrade(usdcMetaVault.address, usdcMetaVaultImpl.address)
                expect(await proxyAdmin.getProxyImplementation(usdcMetaVault.address), "usdc proxy convex vault updated").to.be.eq(
                    usdcMetaVaultImpl.address,
                )
            })
            it("unpause all vaults", async () => {
                await musdConvexVault.connect(governor.signer).unpause()
                await fraxConvexVault.connect(governor.signer).unpause()
                await busdConvexVault.connect(governor.signer).unpause()

                expect(await musdConvexVault.paused(), " musd convex vault paused").to.be.eq(false)
                expect(await fraxConvexVault.paused(), " frax convex vault paused").to.be.eq(false)
                expect(await busdConvexVault.paused(), " busd convex vault paused").to.be.eq(false)

                await periodicAllocationPerfFeeMetaVault.connect(governor.signer).unpause()
                expect(await periodicAllocationPerfFeeMetaVault.paused(), " periodic allocation vault paused").to.be.eq(false)

                await usdcMetaVault.connect(governor.signer).unpause()
                expect(await usdcMetaVault.paused(), " usdc curve vault paused").to.be.eq(false)
            })
        })
    })
    context.skip("remove liquidity from yield sources", async () => {
        it("PeriodicAllocationPerfFeeMetaVault remove underlying vaults", async () => {
            const totalSupplyBefore = await periodicAllocationPerfFeeMetaVault.totalSupply()
            const totalAssetsBefore = await periodicAllocationPerfFeeMetaVault.totalAssets()

            await periodicAllocationPerfFeeMetaVault.connect(governor.signer).removeVault(2) //busd
            await periodicAllocationPerfFeeMetaVault.connect(governor.signer).removeVault(1) //musd
            await periodicAllocationPerfFeeMetaVault.connect(governor.signer).removeVault(0) //Frax

            const totalAssetsAfter = await periodicAllocationPerfFeeMetaVault.totalAssets()
            const totalSupplyAfter = await periodicAllocationPerfFeeMetaVault.totalSupply()

            log(`PAPFV Total Supply: Before ${usdFormatter(totalSupplyBefore)} - After ${usdFormatter(totalSupplyAfter)}`)
            log(`PAPFV Total Assets: Before ${usdFormatter(totalAssetsBefore)} - After ${usdFormatter(totalAssetsAfter)}`)
            assertBNClosePercent(totalAssetsBefore, totalAssetsAfter)
            expect(totalSupplyBefore, "total supply").to.be.eq(totalSupplyAfter)
        })
        it("Curve3CrvBasicMetaVault withdraw from convex", async () => {
            const totalAssetsBefore = await usdcMetaVault.totalAssets()
            const totalSupplyBefore = await usdcMetaVault.totalSupply()

            await usdcMetaVault.connect(governor.signer).liquidateUnderlyingVault(ZERO)

            const totalAssetsAfter = await usdcMetaVault.totalAssets()
            const totalSupplyAfter = await usdcMetaVault.totalSupply()
            log(`C3CRV Total Supply: Before ${usdFormatter(totalSupplyBefore)} - After ${usdFormatter(totalSupplyAfter)}`)
            log(`C3CRV Total Assets: Before ${usdFormatter(totalAssetsBefore)} - After ${usdFormatter(totalAssetsAfter)}`)

            expect(totalSupplyBefore, "total supply").to.be.eq(totalSupplyAfter)
            assertBNClose(totalAssetsBefore, totalAssetsAfter, simpleToExactAmount(5, 5), "total assets")

            const usdcMetavaultBalance = await periodicAllocationPerfFeeMetaVault.balanceOf(usdcMetaVault.address)
            expect(usdcMetavaultBalance, "usdc metavault balance on underlying vault").to.be.eq(0)
        })
    })
    // ------------------------------------------------------------------//
    // ------------------------ VERIFY BEHAVIORS ------------------------//
    // ------------------------------------------------------------------//
    ;["vcx3CRV-mUSD", "vcx3CRV-FRAX", "vcx3CRV-BUSD"].forEach((vaultSymbol) => {
        context(`Convex3CrvLiquidatorVault ${vaultSymbol}`, async () => {
            let holder: Account
            let convex3CrvLiquidatorVault: Convex3CrvLiquidatorVault

            before(async () => {
                holder = await impersonateAccount(resolveAddress("OperationsSigner"))
                convex3CrvLiquidatorVault = Convex3CrvLiquidatorVault__factory.connect(resolveAddress(vaultSymbol), deployer)
            })
            describe("liquidate assets", () => {
                it("whale should fail to liquidate vault", async () => {
                    const tx = convex3CrvLiquidatorVault.connect(holder.signer).liquidateVault(0)
                    await expect(tx).to.be.revertedWith("Only governor can execute")
                })
                it("vault manager should fail to liquidate vault", async () => {
                    const tx = convex3CrvLiquidatorVault.connect(vaultManager.signer).liquidateVault(0)
                    await expect(tx).to.be.revertedWith("Only governor can execute")
                })
            })
            it("reset allowances", async () => {
                await convex3CrvLiquidatorVault.connect(governor.signer).resetAllowances()
            })
            describe("basic flow", () => {
                it("deposit 3Crv reverted", async () => {
                    await assertVaultDepositRevert(
                        threeCrvWhale1,
                        threeCrvToken,
                        convex3CrvLiquidatorVault,
                        simpleToExactAmount(50000, ThreeCRV.decimals),
                    )
                })
                it("mint shares reverted", async () => {
                    await assertVaultMintRevert(
                        threeCrvWhale1,
                        threeCrvToken,
                        convex3CrvLiquidatorVault,
                        dataEmitter,
                        simpleToExactAmount(70000, ThreeCRV.decimals),
                    )
                })
                it("partial withdraw", async () => {
                    const maxWithdraw = await convex3CrvLiquidatorVault.maxWithdraw(holder.address)

                    await assertVaultWithdraw(holder, threeCrvToken, convex3CrvLiquidatorVault, maxWithdraw.div(2))
                })
                it("partial redeem", async () => {
                    const maxRedeem = await convex3CrvLiquidatorVault.maxRedeem(holder.address)
                    await assertVaultRedeem(holder, threeCrvToken, convex3CrvLiquidatorVault, dataEmitter, maxRedeem.div(2))
                })
                it("total redeem", async () => {
                    await assertVaultRedeem(holder, threeCrvToken, convex3CrvLiquidatorVault, dataEmitter)
                })
            })
        })
    })
    context("PeriodicAllocationPerfFeeMetaVault", async () => {
        let holder: Account
        before("", async () => {
            holder = await impersonateAccount(resolveAddress("OperationsSigner"))
        })
        describe("basic flow", () => {
            it("deposit 3Crv reverted", async () => {
                await assertVaultDepositRevert(
                    threeCrvWhale1,
                    threeCrvToken,
                    periodicAllocationPerfFeeMetaVault,
                    simpleToExactAmount(50000, ThreeCRV.decimals),
                )
            })
            it("mint shares reverted", async () => {
                await assertVaultMintRevert(
                    threeCrvWhale1,
                    threeCrvToken,
                    periodicAllocationPerfFeeMetaVault,
                    dataEmitter,
                    simpleToExactAmount(70000, ThreeCRV.decimals),
                )
            })
            it("partial withdraw", async () => {
                const maxWithdraw = await periodicAllocationPerfFeeMetaVault.maxWithdraw(holder.address)
                await assertVaultWithdraw(holder, threeCrvToken, periodicAllocationPerfFeeMetaVault, maxWithdraw.div(2))
            })
            it("partial redeem", async () => {
                const maxRedeem = await periodicAllocationPerfFeeMetaVault.maxRedeem(holder.address)
                await assertVaultRedeem(holder, threeCrvToken, periodicAllocationPerfFeeMetaVault, dataEmitter, maxRedeem.div(2))
            })
            it("total redeem", async () => {
                await assertVaultRedeem(holder, threeCrvToken, periodicAllocationPerfFeeMetaVault, dataEmitter)
                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    holder,
                )
                // Expect all liquidity to be removed
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.users.user1Balance, "user balance").to.be.eq(0)
            })
        })
    })
    context("Curve3CrvBasicMetaVault", async () => {
        let vaultsDataBefore
        beforeEach("snap data", async () => {
            vaultsDataBefore = await snapshotVaults(
                convex3CrvLiquidatorVaults,
                periodicAllocationPerfFeeMetaVault,
                curve3CrvBasicMetaVaults,
                threeCrvWhale1,
            )
        })
        describe("basic flow", () => {
            it("deposit erc20Token", async () => {
                // When deposit via 4626MetaVault
                await assertVaultDepositRevert(usdcWhale, usdcToken, usdcMetaVault, simpleToExactAmount(50000, USDC.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    threeCrvWhale1,
                )
                // Then periodicAllocationPerfFeeMetaVault supply eq
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault totalAssets").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                )
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault totalSupply").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalSupply,
                )
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.internalBalance, "meta vault internalBalance").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.internalBalance,
                )

                // The 4626MetaVault's shares on the meta vault eq
                const { curve3CrvBasicMetaVaults: dataBefore } = vaultsDataBefore.periodicAllocationPerfFeeMetaVault
                const { curve3CrvBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.eq(dataBefore.usdcVaultBalance)
                // no change on underlying vaults
            })
            it("mint shares", async () => {
                // When mint via 4626MetaVault
                await assertVaultMintRevert(usdcWhale, usdcToken, usdcMetaVault, dataEmitter, simpleToExactAmount(70000, ThreeCRV.decimals))

                const vaultsDataAfter = await snapshotVaults(
                    convex3CrvLiquidatorVaults,
                    periodicAllocationPerfFeeMetaVault,
                    curve3CrvBasicMetaVaults,
                    threeCrvWhale1,
                )
                // Then periodicAllocationPerfFeeMetaVault supply eq
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalAssets, "meta vault totalAssets").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalAssets,
                )
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.totalSupply, "meta vault totalSupply").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.totalSupply,
                )
                expect(vaultsDataAfter.periodicAllocationPerfFeeMetaVault.vault.internalBalance, "meta vault internalBalance").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.vault.internalBalance,
                )

                // The 4626MetaVault's shares on the meta vault eq
                const { curve3CrvBasicMetaVaults: dataAfter } = vaultsDataAfter.periodicAllocationPerfFeeMetaVault
                expect(dataAfter.usdcVaultBalance, "meta vault usdc vault balance").to.be.eq(
                    vaultsDataBefore.periodicAllocationPerfFeeMetaVault.curve3CrvBasicMetaVaults.usdcVaultBalance,
                )
                // no change on underlying vaults
            })
            it("partial withdraw", async () => {
                const maxWithdraw = await usdcMetaVault.maxWithdraw(usdcWhale.address)

                await assertVaultWithdraw(usdcWhale, usdcToken, usdcMetaVault, maxWithdraw.div(2))
                // no change on underlying vaults
            })
            it("partial redeem", async () => {
                const maxRedeem = await usdcMetaVault.maxRedeem(usdcWhale.address)

                await assertVaultRedeem(usdcWhale, usdcToken, usdcMetaVault, dataEmitter, maxRedeem.div(2))
                // no change on underlying vaults
            })
            it("total redeem", async () => {
                await assertVaultRedeem(usdcWhale, usdcToken, usdcMetaVault, dataEmitter)

                // 4626
                expect(await usdcMetaVault.balanceOf(daiWhale.address), "usdc vault user balance").to.be.eq(0)
            })
        })
    })
})
