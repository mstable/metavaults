import { logger } from "@tasks/utils/logger"
import { StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { MockERC20__factory, MockNexus__factory, TxFeeBasicVault__factory } from "types/generated"

import type { BN } from "@utils/math"
import type { Account } from "types"
import type { IERC20, MockERC20, MockNexus, TxFeeBasicVault } from "types/generated"

const log = logger("test:TxFeeVault")

interface VaultData {
    address: string
    asset: string
    balanceOf: BN
    decimals: number
    maxDeposit: BN
    maxMint: BN
    maxRedeem: BN
    maxWithdraw: BN
    name: string
    nexus: string
    previewDeposit: BN
    previewMint: BN
    previewRedeem: BN
    previewWithdraw: BN
    symbol: string
    totalAssets: BN
    totalSupply: BN
}

interface SnapshotData {
    vault: VaultData
    underlying: { balanceOfVault: BN; balanceOfDepositor: BN; balanceOfFeeReceiver: BN }
}

describe("Transaction Fees", async () => {
    // dummy1 = fee receiver
    let sa: StandardAccounts
    let feeReceiver: Account
    let nexus: MockNexus
    let underlying: MockERC20
    let feeVault: TxFeeBasicVault

    const zeroFees = {
        depositFee: 0,
        mintFee: 0,
        withdrawFee: 0,
        redeemFee: 0,
        swapFee: 0,
    }

    const deployFeeVaultDependencies = async () => {
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)
        underlying = await new MockERC20__factory(sa.default.signer).deploy(
            "USD underlying",
            "RWD",
            18,
            sa.default.address,
            simpleToExactAmount(100000000),
        )
    }

    const deployFeeVault = async (): Promise<TxFeeBasicVault> => {
        await deployFeeVaultDependencies()
        feeVault = await new TxFeeBasicVault__factory(sa.default.signer).deploy(nexus.address, underlying.address)

        await feeVault["initialize(string,string,address,address,(uint16,uint16,uint16,uint16,uint16))"](
            "feeVault",
            "fv",
            sa.vaultManager.address,
            feeReceiver.address,
            zeroFees,
        )

        // Approve vault to transfer assets from default signer
        await underlying.approve(feeVault.address, ethers.constants.MaxUint256)

        return feeVault
    }

    const getSnapShot = async (
        vault: TxFeeBasicVault,
        underlyingArg: IERC20,
        depositor: string,
        assets: BN,
        shares: BN,
    ): Promise<SnapshotData> => {
        return {
            vault: {
                address: vault.address,
                asset: await vault.asset(),
                balanceOf: await vault.balanceOf(depositor),
                decimals: await vault.decimals(),
                maxDeposit: await vault.maxDeposit(depositor),
                maxMint: await vault.maxMint(depositor),
                maxRedeem: await vault.maxRedeem(depositor),
                maxWithdraw: await vault.maxWithdraw(depositor),
                name: await vault.name(),
                nexus: await vault.nexus(),
                previewDeposit: await vault.previewDeposit(assets),
                previewMint: await vault.previewMint(shares),
                previewRedeem: await vault.previewRedeem(shares),
                previewWithdraw: await vault.previewWithdraw(assets),
                // rewardToken: await vault.rewardToken(),
                symbol: await vault.symbol(),
                totalAssets: await vault.totalAssets(),
                totalSupply: await vault.totalSupply(),
            },
            underlying: {
                balanceOfVault: await underlying.balanceOf(vault.address),
                balanceOfDepositor: await underlying.balanceOf(depositor),
                balanceOfFeeReceiver: await underlying.balanceOf(feeReceiver.address),
            },
        }
    }
    const logSnapshot = (snapshot: SnapshotData) => {
        const { vault, underlying: underlyingArg } = snapshot

        log(`
        address:    ${vault.address}
        asset:      ${vault.asset}
        balanceOf:      ${vault.balanceOf.toString()}
        decimals:       ${vault.decimals.toString()}
        maxDeposit:     ${vault.maxDeposit.toString()}
        maxMint:        ${vault.maxMint.toString()}
        maxRedeem:      ${vault.maxRedeem.toString()}
        maxWithdraw:    ${vault.maxWithdraw.toString()}
        name:           ${vault.name}
        nexus:          ${vault.nexus}
        previewDeposit: ${vault.previewDeposit.toString()}
        previewMint:    ${vault.previewMint.toString()}
        previewRedeem:  ${vault.previewRedeem.toString()}
        previewWithdraw:${vault.previewWithdraw.toString()}
        symbol:         ${vault.symbol}
        totalAssets:    ${vault.totalAssets.toString()}
        totalSupply:    ${vault.totalSupply.toString()}

        underlying.balanceOfDepositor:  ${underlyingArg.balanceOfDepositor.toString()}
        underlying.balanceOfVault:      ${underlyingArg.balanceOfVault.toString()}
        underlying.balanceOfFeeReceiver:${underlyingArg.balanceOfFeeReceiver.toString()}
        
        `)
    }
    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        feeReceiver = sa.feeReceiver
    })
    beforeEach(async () => {
        /* before each context */
        feeVault = await deployFeeVault()
    })
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await feeVault.asset(), "underlying asset").to.eq(underlying.address)
            expect(await feeVault.feeReceiver(), "fee receiver").to.eq(feeReceiver.address)
            expect(await feeVault.isVaultManager(sa.vaultManager.address), "is vault manager").to.eq(true)
        })
        it("should default initializable values ", async () => {
            const { depositFee, mintFee, withdrawFee, redeemFee, swapFee } = await feeVault.feeData()
            expect(depositFee, "deposit fee").to.eq(0)
            expect(mintFee, "deposit fee").to.eq(0)
            expect(withdrawFee, "deposit fee").to.eq(0)
            expect(redeemFee, "deposit fee").to.eq(0)
            expect(swapFee, "deposit fee").to.eq(0)
            // expect(await feeVault.symbol(), "symbol").to.eq("")
            // expect(await feeVault.name(), "name").to.eq("")
        })
    })
    describe("calling initialize", async () => {
        it("should properly store valid arguments", async () => {
            // await feeVault.initialize("feeVault", "fv")
            expect(await feeVault.symbol(), "symbol").to.eq("fv")
            expect(await feeVault.name(), "name").to.eq("feeVault")
            expect(await feeVault.decimals(), "symbol").to.eq(await underlying.decimals())
        })

        it("fails if initialize is called more than once", async () => {
            await expect(
                feeVault["initialize(string,string,address,address,(uint16,uint16,uint16,uint16,uint16))"](
                    "feeVault",
                    "fv",
                    sa.vaultManager.address,
                    feeReceiver.address,
                    zeroFees,
                ),
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
    describe("deposit with fees", async () => {
        // 2%
        const genericFee = 200
        before("sets fee values", async () => {
            await feeVault.connect(sa.governor.signer).setFeeData({
                depositFee: genericFee,
                mintFee: genericFee,
                withdrawFee: genericFee,
                redeemFee: genericFee,
                swapFee: genericFee,
            })
            const { depositFee, mintFee, withdrawFee, redeemFee, swapFee } = await feeVault.feeData()
            expect(depositFee, "deposit fee").to.eq(genericFee)
            expect(mintFee, "mint fee").to.eq(genericFee)
            expect(withdrawFee, "withdraw fee").to.eq(genericFee)
            expect(redeemFee, "redeem fee").to.eq(genericFee)
            expect(swapFee, "swap fee").to.eq(genericFee)
        })
        it("default user deposit assets into vault", async () => {
            const assets = simpleToExactAmount(100)
            const shares = await feeVault.previewDeposit(assets)
            log(`ts:deposit assets: ${assets.toString()} , shares: ${shares.toString()}, fee: ${genericFee.toString()} `)
            const dataBefore = await getSnapShot(feeVault, underlying, sa.default.address, assets, shares)
            logSnapshot(dataBefore)

            const tx = await feeVault.connect(sa.default.signer).deposit(assets, sa.default.address)
            await expect(tx).to.emit(feeVault, "Deposit").withArgs(sa.default.address, sa.default.address, assets, shares)

            // check balances
            const dataAfter = await getSnapShot(feeVault, underlying, sa.default.address, assets, shares)
            logSnapshot(dataAfter)
        })
        it("fails if passed incorrect data", async () => {})
    })
    describe("mint", async () => {
        it("default user mints shares into vault", async () => {
            const shares = simpleToExactAmount(100)
            const assets = await feeVault.previewMint(shares)
            log(`ts:mint assets: ${assets.toString()} , shares: ${shares.toString()} `)
            const dataBefore = await getSnapShot(feeVault, underlying, sa.default.address, assets, shares)
            logSnapshot(dataBefore)

            await feeVault.connect(sa.default.signer).mint(assets, sa.default.address)
            // const tx =
            // await expect(tx).to.emit(feeVault, "Deposit").withArgs(sa.default.address, sa.default.address, assets, shares )

            // check balances

            const dataAfter = await getSnapShot(feeVault, underlying, sa.default.address, assets, shares)
            logSnapshot(dataAfter)
        })
        it("fails if mint more than balance", async () => {})
    })
    describe("transfer", async () => {
        const shares = simpleToExactAmount(100)
        beforeEach(async () => {
            await feeVault.connect(sa.default.signer).mint(shares, sa.default.address)
        })
        it("should transfer assets from vault", async () => {
            await feeVault.connect(sa.default.signer).transfer(sa.dummy1.address, shares)
        })
        it("fails if transfer more than balance", async () => {
            const tx = feeVault.connect(sa.default.signer).transfer(sa.dummy1.address, shares.add(1))
            await expect(tx).revertedWith("ERC20: transfer amount exceeds balance")
        })
    })
    describe("withdraw", async () => {
        it("should withdraw assets from vault", async () => {})
        it("fails if withdraws more than balance", async () => {})
    })
    describe("redeem", async () => {
        it("should redeem shares from vault", async () => {})
        it("fails if redeem more than balance", async () => {})
    })
})
