import { usdFormatter } from "@tasks/utils"
import { logger } from "@tasks/utils/logger"
import { ThreeCRV } from "@tasks/utils/tokens"
import { ONE_DAY, SAFE_INFINITY, ZERO, ZERO_ADDRESS } from "@utils/constants"
import { basisPointDiff, BN, simpleToExactAmount, roundUp } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Wallet } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { ethers } from "hardhat"

import type { BigNumber, ContractTransaction } from "ethers"
import type { Account } from "types/common"
import type {
    Convex3CrvBasicVault,
    Convex3CrvLiquidatorVault,
    Curve3CrvFactoryMetapoolCalculatorLibrary,
    Curve3CrvMetapoolCalculatorLibrary,
    DataEmitter,
    IConvexRewardsPool,
    ICurve3Pool,
    ICurveMetapool,
    IERC20,
} from "types/generated"
import { assertBNClose } from "@utils/assertions"
import { vault } from "types/generated/contracts"

const log = logger("test:Convex3CrvVault")

export type Convex3CrvVault = Convex3CrvBasicVault | Convex3CrvLiquidatorVault
export type Convex3CrvCalculatorLibrary = Curve3CrvMetapoolCalculatorLibrary | Curve3CrvFactoryMetapoolCalculatorLibrary
const isConvex3CrvLiquidatorVault = (vault: Convex3CrvVault): boolean => "donate" in vault

export interface VaultData {
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
    convertToAssets: BN
    convertToShares: BN
    symbol: string
    totalAssets: BN
    totalSupply: BN
    redeemSlippage: BN
    depositSlippage: BN
    withdrawSlippage: BN
    mintSlippage: BN
}
export interface SnapVaultData {
    vault: VaultData
    underlying: { balanceOfVault: BN; balanceOfOwner: BN }
    convex: {
        curveMetapool: string
        booster: string
        convexPoolId: BN
        metapoolToken: string
        baseRewardPool: string
    }
}

export const snapVault = async (
    vault: Convex3CrvVault,
    underlying: IERC20,
    owner: string,
    assets: BN,
    shares: BN,
): Promise<SnapVaultData> => {
    const snapShot = {
        vault: {
            address: vault.address,
            asset: await vault.asset(),
            balanceOf: await vault.balanceOf(owner),
            decimals: await vault.decimals(),
            maxDeposit: await vault.maxDeposit(owner),
            maxMint: await vault.maxMint(owner),
            maxRedeem: await vault.maxRedeem(owner),
            maxWithdraw: await vault.maxWithdraw(owner),
            name: await vault.name(),
            nexus: await vault.nexus(),
            previewDeposit: await vault.previewDeposit(assets),
            previewMint: await vault.previewMint(shares),
            previewRedeem: await vault.previewRedeem(shares),
            previewWithdraw: await vault.previewWithdraw(assets),
            convertToAssets: await vault.convertToAssets(shares),
            convertToShares: await vault.convertToShares(assets),
            symbol: await vault.symbol(),
            totalAssets: await vault.totalAssets(),
            totalSupply: await vault.totalSupply(),
            redeemSlippage: await vault.redeemSlippage(),
            depositSlippage: await vault.depositSlippage(),
            withdrawSlippage: await vault.withdrawSlippage(),
            mintSlippage: await vault.mintSlippage(),
        },
        underlying: {
            balanceOfVault: await underlying.balanceOf(vault.address),
            balanceOfOwner: await underlying.balanceOf(owner),
        },
        convex: {
            curveMetapool: await vault.metapool(),
            booster: await vault.booster(),
            convexPoolId: await vault.convexPoolId(),
            metapoolToken: await vault.metapoolToken(),
            baseRewardPool: await vault.baseRewardPool(),
        },
    }
    return snapShot
}
export interface Convex3CrvContext {
    vault: Convex3CrvVault
    owner: Account
    threePool: ICurve3Pool
    threeCrvToken: IERC20
    metapool: ICurveMetapool
    baseRewardsPool: IConvexRewardsPool
    dataEmitter: DataEmitter
    convex3CrvCalculatorLibrary: Convex3CrvCalculatorLibrary
    amounts: {
        initialDeposit: BigNumber
        deposit: BigNumber
        mint: BigNumber
        withdraw: BigNumber
        redeem: BigNumber
    }
}

export const behaveLikeConvex3CrvVault = (ctx: () => Convex3CrvContext): void => {
    const getAssetsFromTokens = async (tokens: BN): Promise<BN> => {
        const { threePool, metapool } = ctx()
        const threePoolVP = await threePool.get_virtual_price()
        const metapoolVP = await metapool.get_virtual_price()
        return metapoolVP.mul(tokens).div(threePoolVP)
    }
    const getTokensFromAssets = async (assets: BN): Promise<BN> => {
        const { threePool, metapool } = ctx()
        const threePoolVP = await threePool.get_virtual_price()
        const metapoolVP = await metapool.get_virtual_price()
        return threePoolVP.mul(assets).div(metapoolVP)
    }
    const getSharesFromTokens = async (tokens: BN, isRoundUp: boolean): Promise<BN> => {
        const { baseRewardsPool, vault } = ctx()
        const totalTokens = await baseRewardsPool.balanceOf(vault.address)
        const totalShares = await vault.totalSupply()
        if (totalTokens.eq(0)) {
            return tokens
        } else {
            return isRoundUp ? roundUp(tokens.mul(totalShares), totalTokens) : tokens.mul(totalShares).div(totalTokens)
        }
    }
    const getTokensFromShares = async (shares: BN, isRoundUp: boolean): Promise<BN> => {
        const { baseRewardsPool, vault } = ctx()
        const totalTokens = await baseRewardsPool.balanceOf(vault.address)
        const totalShares = await vault.totalSupply()
        if (totalShares.eq(0)) {
            return shares
        } else {
            return isRoundUp ? roundUp(shares.mul(totalTokens), totalShares) : shares.mul(totalTokens).div(totalShares)
        }
    }
    const sendStaticTxs = async (
        previewFuncFragment: "previewDeposit" | "previewRedeem" | "previewMint" | "previewWithdraw",
        previewAmount: BN,
    ): Promise<{ txTotalSupply: ContractTransaction; txPreview: ContractTransaction }> => {
        const { vault, dataEmitter } = ctx()

        // Encode the data field of the function call
        const totalSupplyTxData = vault.interface.encodeFunctionData("totalSupply")
        // just picking one of the four preview functions as TypeScript can't detect which override.
        // The correct one will be used at runtime
        const txPreviewData = vault.interface.encodeFunctionData(previewFuncFragment as "previewDeposit", [previewAmount])

        // Call the DataEmitter contract which will then statically call a the totalSupply and preview functions on the vault
        return {
            // totalSupply
            txTotalSupply: await dataEmitter.emitStaticCall(vault.address, totalSupplyTxData),
            // preview
            txPreview: await dataEmitter.emitStaticCall(vault.address, txPreviewData),
        }
    }
    const decodeStaticTxs = async (
        txTotalSupply: ContractTransaction,
        txPreview: ContractTransaction,
    ): Promise<{ totalSupply: BN; previewResult: BN }> => {
        const { vault } = ctx()

        // Get the tx receipts for each transactions so we can get DataEmitter's Data event
        const receiptTotalSupply = await txTotalSupply.wait()
        const receiptPreviewShares = await txPreview.wait()

        const totalSupplyResult = receiptTotalSupply.events[0].args[0]
        const previewResult = receiptPreviewShares.events[0].args[0]

        return {
            // decode totalSupply from the DataEmitter's Data event
            totalSupply: vault.interface.decodeFunctionResult("totalSupply", totalSupplyResult)[0],
            // decode result of preview call
            // It doesn't matter which preview function is decoded as they all return a BigNumber
            previewResult: vault.interface.decodeFunctionResult("previewDeposit", previewResult)[0],
        }
    }
    const standardAssetsAmount = simpleToExactAmount(100000, 18)
    const standardSharesAmount = simpleToExactAmount(100000, 18)

    describe("EIP-4626 view functions", () => {
        it("asset()", async () => {
            const { owner, vault } = ctx()
            expect(await vault.asset(), "asset").eq(ThreeCRV.address)

            await owner.signer.sendTransaction(await vault.populateTransaction.asset())
        })
        it("totalAssets()", async () => {
            const { baseRewardsPool, owner, vault } = ctx()
            const expectedAssets = await getAssetsFromTokens(await baseRewardsPool.balanceOf(vault.address))
            expect(await vault.totalAssets(), "totalAssets").gte(expectedAssets)

            await owner.signer.sendTransaction(await vault.populateTransaction.totalAssets())
        })
        it("convertToAssets()", async () => {
            const { owner, vault } = ctx()

            const expectedAssets = await getAssetsFromTokens(await getTokensFromShares(standardSharesAmount, false))
            expect(await vault.convertToAssets(standardSharesAmount), "convertToAssets").gte(expectedAssets)

            await owner.signer.sendTransaction(await vault.populateTransaction.convertToAssets(standardSharesAmount))
        })
        it("convertToShares()", async () => {
            const { owner, vault } = ctx()

            const expectedShares = await getSharesFromTokens(await getTokensFromAssets(standardAssetsAmount), false)
            expect(await vault.convertToShares(standardAssetsAmount), "convertToShares").lte(expectedShares)

            await owner.signer.sendTransaction(await vault.populateTransaction.convertToShares(standardAssetsAmount))
        })
        it("maxDeposit()", async () => {
            const { owner, vault } = ctx()
            expect(await vault.maxDeposit(owner.address), "maxDeposit").eq(SAFE_INFINITY)

            await owner.signer.sendTransaction(await vault.populateTransaction.maxDeposit(owner.address))
        })
        it("maxRedeem()", async () => {
            const { owner, vault } = ctx()
            const actualMaxShares = await vault.maxRedeem(owner.address)
            expect(actualMaxShares, "maxRedeem").eq(await vault.balanceOf(owner.address))

            await owner.signer.sendTransaction(await vault.populateTransaction.maxRedeem(owner.address))
        })
        it("maxWithdraw()", async () => {
            const { owner, vault } = ctx()

            const ownerShares = await vault.balanceOf(owner.address)
            const expectedAssets = await vault.callStatic["redeem(uint256,address,address)"](ownerShares, owner.address, owner.address)
            expect(await vault.maxWithdraw(owner.address), "maxWithdraw").eq(expectedAssets)

            await owner.signer.sendTransaction(await vault.populateTransaction.maxWithdraw(owner.address))
        })
        it("maxMint()", async () => {
            const { owner, vault } = ctx()

            expect(await vault.maxMint(owner.address), "maxMint").eq(SAFE_INFINITY)

            await owner.signer.sendTransaction(await vault.populateTransaction.maxMint(owner.address))
        })
    })
    describe("EIP-4626 preview", () => {
        it("deposit", async () => {
            const { amounts, owner, vault } = ctx()

            // Test previewDeposit is the same as deposit at the end of the old block using static calls
            const staticPreviewShares = await vault.previewDeposit(amounts.initialDeposit)
            const staticDepositShares = await vault.callStatic["deposit(uint256,address)"](amounts.initialDeposit, owner.address)
            expect(staticDepositShares, "previewDeposit == static deposit shares").to.eq(staticPreviewShares)

            // Is only used to get gas usage using gasReporter
            await owner.signer.sendTransaction(await vault.populateTransaction.previewDeposit(amounts.initialDeposit))
        })
        it("mint", async () => {
            const { amounts, owner, vault } = ctx()

            // Test previewMint is the same as mint at the end of the old block using static calls
            const staticPreviewAssets = await vault.previewMint(amounts.mint)
            const staticMintAssets = await vault.callStatic.mint(amounts.mint, owner.address)
            expect(staticMintAssets, "previewMint == static mint assets").to.eq(staticPreviewAssets)

            // Is only used to get gas usage using gasReporter
            await owner.signer.sendTransaction(await vault.populateTransaction.previewMint(amounts.mint))
        })
        it("redeem", async () => {
            const { amounts, owner, vault } = ctx()

            // Test previewRedeem is the same as redeem at the end of the old block using static calls
            const previewAssets = await vault.previewRedeem(amounts.redeem)
            const staticRedeemAssets = await vault.callStatic["redeem(uint256,address,address)"](
                amounts.redeem,
                owner.address,
                owner.address,
            )
            expect(staticRedeemAssets, "previewRedeem == static redeem assets").to.eq(previewAssets)

            const previewShares = await vault.previewWithdraw(previewAssets)
            const sharesDiff = amounts.redeem.sub(previewShares)
            const sharesDiffBp = sharesDiff.mul(10000000000).div(amounts.redeem)
            log(`Shares diff ${formatUnits(sharesDiff, 18)} ${formatUnits(sharesDiffBp, 6)} bps on ${usdFormatter(amounts.redeem)}`)

            // Is only used to get gas usage using gasReporter
            await owner.signer.sendTransaction(await vault.populateTransaction.previewRedeem(amounts.redeem))
        })
        it("withdraw", async () => {
            const { amounts, owner, vault } = ctx()

            // Test previewWithdraw is the same as withdraw at the end of the old block using static calls
            const previewShares = await vault.previewWithdraw(amounts.withdraw)
            const staticWithdrawShares = await vault.callStatic.withdraw(amounts.withdraw, owner.address, owner.address)
            expect(staticWithdrawShares, "previewWithdraw == static withdraw shares").to.eq(previewShares)

            const previewAssets = await vault.previewRedeem(previewShares)
            const assetsDiff = amounts.withdraw.sub(previewAssets)
            const assetsDiffBp = assetsDiff.mul(10000000000).div(amounts.withdraw)
            log(`Assets diff ${formatUnits(assetsDiff, 18)} ${formatUnits(assetsDiffBp, 6)} bps on ${usdFormatter(amounts.withdraw)}`)

            // Is only used to get gas usage using gasReporter
            await owner.signer.sendTransaction(await vault.populateTransaction.previewWithdraw(amounts.withdraw))
        })
    })
    describe("EIP-4626 operations", () => {
        let baseVirtualPriceBefore = BN.from(0)
        before(async () => {
            // Stop automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [false])
        })
        after(async () => {
            // Restore automine a new block with every transaction
            await ethers.provider.send("evm_setAutomine", [true])
        })
        beforeEach(async () => {
            baseVirtualPriceBefore = await ctx().convex3CrvCalculatorLibrary["getBaseVirtualPrice()"]()
        })
        afterEach(async () => {
            const baseVirtualPriceAfter = await ctx().convex3CrvCalculatorLibrary["getBaseVirtualPrice()"]()
            expect(baseVirtualPriceBefore, "virtual price should not change").to.be.eq(baseVirtualPriceAfter)
        })
        it("user deposits 3Crv assets to vault", async () => {
            const { amounts, threeCrvToken, owner, vault } = ctx()

            let feeReceiver = ZERO_ADDRESS
            let streamedSharesBefore = ZERO
            if (isConvex3CrvLiquidatorVault(vault)) {
                const vaultL = vault as Convex3CrvLiquidatorVault
                feeReceiver = await vaultL.feeReceiver()
                streamedSharesBefore = await vaultL.streamedShares()
            }

            const receiver = Wallet.createRandom().address
            const ownerAssetsBefore = await threeCrvToken.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()
            const receiverSharesBefore = await vault.balanceOf(receiver)
            const feeReceiverSharesBefore = await vault.balanceOf(feeReceiver)
            const donatedAssetsBefore = await threeCrvToken.balanceOf(vault.address)

            // Enough assets for deposit
            log(`owner's 3Crv balance ${usdFormatter(ownerAssetsBefore)}`)
            expect(ownerAssetsBefore, "3Crv bal >= deposit amount").to.gte(amounts.initialDeposit)

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewDeposit", amounts.initialDeposit)
            // Deposit
            const txDeposit = await vault["deposit(uint256,address)"](amounts.initialDeposit, receiver)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewShares } = await decodeStaticTxs(txTotalSupply, txPreview)

            // Deposit event
            await expect(txDeposit).to.emit(vault, "Deposit").withArgs(owner.address, receiver, amounts.initialDeposit, previewShares)

            // Assets
            expect(await threeCrvToken.balanceOf(owner.address), "owner assets").eq(ownerAssetsBefore.sub(amounts.initialDeposit))
            // Shares
            const totalSharesAfter = await vault.totalSupply({ blockTag: txDeposit.blockNumber })
            const receiverSharesAfter = await vault.balanceOf(receiver)
            const receiverSharesMinted = receiverSharesAfter.sub(receiverSharesBefore)
            expect(receiverSharesMinted, "minted shares == preview shares").eq(previewShares)

            // Total assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsAfter.sub(totalAssetsBefore).sub(donatedAssetsBefore)
            const donatedAssetsAfter = await threeCrvToken.balanceOf(vault.address)
            const assetsSlippage = basisPointDiff(amounts.initialDeposit, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to deposit amount").lte(50).gte(-50)

            // Add checks for donations
            if (isConvex3CrvLiquidatorVault(vault)) {
                const vaultL = vault as Convex3CrvLiquidatorVault

                const feeReceiverSharesAfter = await vaultL.balanceOf(feeReceiver)
                const streamedSharesAfter = await vaultL.streamedShares()

                const feeReceiverSharesMinted = feeReceiverSharesAfter.sub(feeReceiverSharesBefore)
                const streamedSharesMinted = streamedSharesAfter.sub(streamedSharesBefore)
                const sharesMinted = totalSharesAfter.sub(totalSharesBefore)
                const donatedSharesMinted = sharesMinted.sub(receiverSharesMinted)

                const donationFee = await vaultL.donationFee()
                const feeScale = await vaultL.FEE_SCALE()
                const feeReceiverSharesExpected = donatedSharesMinted.mul(donationFee).div(feeScale)
                const streamedSharesExpected = donatedSharesMinted.sub(feeReceiverSharesExpected)

                assertBNClose(
                    sharesMinted,
                    receiverSharesMinted.add(feeReceiverSharesMinted).add(streamedSharesMinted),
                    BN.from(10),
                    "total shares minted",
                )
                assertBNClose(feeReceiverSharesMinted, feeReceiverSharesExpected, BN.from(10), "fee receiver shares minted")
                assertBNClose(streamedSharesMinted, streamedSharesExpected, BN.from(10), "shares to streamed minted")
                expect(donatedAssetsAfter, "donated assets after").eq(ZERO)
            }
        })
        it("user redeems some shares from vault", async () => {
            const { amounts, threeCrvToken, owner, vault } = ctx()

            await increaseTime(ONE_DAY)
            const receiver = Wallet.createRandom().address
            const ownerSharesBefore = await vault.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()

            const previewAssetsPreviousBlock = await vault.previewRedeem(amounts.redeem)
            expect(await vault.balanceOf(owner.address), "shares bal >= redeem amount").to.gte(previewAssetsPreviousBlock)

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewRedeem", amounts.redeem)
            const tx = await vault["redeem(uint256,address,address)"](amounts.redeem, receiver, owner.address)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewAssets } = await decodeStaticTxs(txTotalSupply, txPreview)

            await expect(tx).to.emit(vault, "Withdraw").withArgs(owner.address, receiver, owner.address, previewAssets, amounts.redeem)

            // Assets
            const assetsWithdrawn = await threeCrvToken.balanceOf(receiver)
            expect(assetsWithdrawn, "withdrawn assets == preview assets").eq(previewAssets)
            expect(await threeCrvToken.balanceOf(receiver), "receiver assets").eq(assetsWithdrawn)
            // Shares
            expect(await vault.balanceOf(owner.address), "owner shares").eq(ownerSharesBefore.sub(amounts.redeem))
            const expectedTotalSupply = totalSharesBefore.sub(amounts.redeem)
            expect(await vault.totalSupply(), "total shares")
                .gte(expectedTotalSupply)
                .lte(expectedTotalSupply.add(1))
            // Total Assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsBefore.sub(totalAssetsAfter)
            const assetsSlippage = basisPointDiff(assetsWithdrawn, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to assets withdrawn").lte(50).gte(-50)
        })
        it("user withdraws some 3Crv assets from vault", async () => {
            const { amounts, threeCrvToken, owner, vault } = ctx()

            await increaseTime(ONE_DAY)
            const receiver = Wallet.createRandom().address
            const ownerSharesBefore = await vault.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewWithdraw", amounts.withdraw)
            const tx = await vault.withdraw(amounts.withdraw, receiver, owner.address)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewShares } = await decodeStaticTxs(txTotalSupply, txPreview)

            await expect(tx).to.emit(vault, "Withdraw").withArgs(owner.address, receiver, owner.address, amounts.withdraw, previewShares)

            // Assets
            expect(await threeCrvToken.balanceOf(receiver), "withdrawn assets == actual assets").eq(amounts.withdraw)
            // Shares
            const ownerSharesAfter = await vault.balanceOf(owner.address)
            const sharesRedeemed = ownerSharesBefore.sub(ownerSharesAfter)
            expect(sharesRedeemed, "redeemed shares == preview shares").eq(previewShares)
            const expectedTotalSupply = totalSharesBefore.sub(sharesRedeemed)
            expect(await vault.totalSupply(), "total shares")
                .gte(expectedTotalSupply)
                .lte(expectedTotalSupply.add(1))
            // Total assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsBefore.sub(totalAssetsAfter)
            const assetsSlippage = basisPointDiff(amounts.withdraw, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to withdraw amount").lte(50).gte(-50)
        })
        it("user mints shares from vault", async () => {
            const { amounts, threeCrvToken, owner, vault } = ctx()

            await increaseTime(ONE_DAY)
            const receiver = Wallet.createRandom().address
            const ownerAssetsBefore = await threeCrvToken.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewMint", amounts.mint)
            const tx = await vault.mint(amounts.mint, receiver)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewAssets } = await decodeStaticTxs(txTotalSupply, txPreview)

            const receipt = await tx.wait()
            const event = receipt.events.find((e) => e.event === "Deposit")
            const assetsDeposited = BN.from(event.args.assets)
            await expect(tx).to.emit(vault, "Deposit").withArgs(owner.address, receiver, assetsDeposited, amounts.mint)

            // Assets
            const ownerAssetsAfter = await threeCrvToken.balanceOf(owner.address)
            expect(ownerAssetsBefore.sub(ownerAssetsAfter), "owner assets diff == deposit assets").eq(assetsDeposited)
            expect(assetsDeposited, "deposited assets <= preview assets").lte(previewAssets)
            // Shares
            const totalSharesAfter = await vault.totalSupply()
            expect(await vault.balanceOf(receiver), "receiver shares").eq(amounts.mint)
            expect(totalSharesAfter.sub(totalSharesBefore), "minted shares == preview shares").gte(amounts.mint).lte(amounts.mint.add(1))
            // Total assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsAfter.sub(totalAssetsBefore)
            const assetsSlippage = basisPointDiff(assetsDeposited, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to deposit amount").lte(50).gte(-50)
        })
        it("user deposits 3Crv assets to vault with custom slippage", async () => {
            const { amounts, threeCrvToken, owner, vault } = ctx()

            const receiver = Wallet.createRandom().address
            const ownerAssetsBefore = await threeCrvToken.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()

            expect(await threeCrvToken.balanceOf(owner.address), "3Crv bal >= deposit amount").to.gte(amounts.initialDeposit)

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewDeposit", amounts.initialDeposit)
            const tx = await vault["deposit(uint256,address,uint256)"](amounts.initialDeposit, receiver, 200)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewShares } = await decodeStaticTxs(txTotalSupply, txPreview)

            await expect(tx).to.emit(vault, "Deposit").withArgs(owner.address, receiver, amounts.initialDeposit, previewShares)

            // Assets
            expect(await threeCrvToken.balanceOf(owner.address), "owner assets").eq(ownerAssetsBefore.sub(amounts.initialDeposit))
            // Shares
            const totalSharesAfter = await vault.totalSupply()
            const sharesMinted = totalSharesAfter.sub(totalSharesBefore)
            expect(sharesMinted, "minted shares == preview shares").eq(previewShares)
            expect(await vault.balanceOf(receiver), "receiver shares").eq(sharesMinted)
            // Total assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsAfter.sub(totalAssetsBefore)
            const assetsSlippage = basisPointDiff(amounts.initialDeposit, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to deposit amount").lte(50).gte(-50)
        })
        it("user redeems some shares from vault with custom slippage", async () => {
            const { amounts, threeCrvToken, owner, vault } = ctx()

            await increaseTime(ONE_DAY)
            const receiver = Wallet.createRandom().address
            const ownerSharesBefore = await vault.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()

            expect(await vault.balanceOf(owner.address), "shares bal >= redeem amount").to.gte(amounts.redeem)

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewRedeem", amounts.redeem)
            const tx = await vault["redeem(uint256,address,address,uint256)"](amounts.redeem, receiver, owner.address, 200)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewAssets } = await decodeStaticTxs(txTotalSupply, txPreview)

            await expect(tx).to.emit(vault, "Withdraw").withArgs(owner.address, receiver, owner.address, previewAssets, amounts.redeem)

            // Assets
            const assetsWithdrawn = await threeCrvToken.balanceOf(receiver)
            expect(assetsWithdrawn, "withdrawn assets == preview assets").eq(previewAssets)
            expect(await threeCrvToken.balanceOf(receiver), "receiver assets").eq(assetsWithdrawn)
            // Shares
            expect(await vault.balanceOf(owner.address), "owner shares").eq(ownerSharesBefore.sub(amounts.redeem))
            expect(await vault.totalSupply(), "total shares").eq(totalSharesBefore.sub(amounts.redeem))
            // Total Assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsBefore.sub(totalAssetsAfter)
            const assetsSlippage = basisPointDiff(assetsWithdrawn, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to assets withdrawn").lte(50).gte(-50)
        })
        it("user redeems all shares", async () => {
            const { threeCrvToken, owner, vault } = ctx()

            await increaseTime(ONE_DAY)
            const receiver = Wallet.createRandom().address
            const ownerSharesBefore = await vault.balanceOf(owner.address)
            const totalAssetsBefore = await vault.totalAssets()

            expect(await vault.balanceOf(owner.address), "shares bal >= redeem amount").to.gte(ownerSharesBefore)

            // The following three transactions will be in a new block
            // The totalSupply will change from the previous block
            const { txTotalSupply, txPreview } = await sendStaticTxs("previewRedeem", ownerSharesBefore)
            const tx = await vault["redeem(uint256,address,address)"](ownerSharesBefore, receiver, owner.address)

            // Mine the three transactions in the same block
            await ethers.provider.send("evm_mine", [])

            // Decode the extract the totalSupply and preview result data from the Data events
            const { totalSupply: totalSharesBefore, previewResult: previewAssets } = await decodeStaticTxs(txTotalSupply, txPreview)

            await expect(tx).to.emit(vault, "Withdraw").withArgs(owner.address, receiver, owner.address, previewAssets, ownerSharesBefore)
            // Assets
            const assetsWithdrawn = await threeCrvToken.balanceOf(receiver)
            expect(assetsWithdrawn, "withdrawn assets == preview assets").eq(previewAssets)
            expect(await threeCrvToken.balanceOf(receiver), "receiver assets").eq(assetsWithdrawn)
            // Shares
            expect(await vault.balanceOf(owner.address), "owner shares").eq(0)
            expect(await vault.totalSupply(), "total shares").eq(totalSharesBefore.sub(ownerSharesBefore))
            // Total Assets
            const totalAssetsAfter = await vault.totalAssets()
            const totalAssetsDiff = totalAssetsBefore.sub(totalAssetsAfter)
            const assetsSlippage = basisPointDiff(assetsWithdrawn, totalAssetsDiff)
            expect(assetsSlippage, "total assets diff to assets withdrawn").lte(50).gte(-50)
        })
    })
}
