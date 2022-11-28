import { ZERO } from "@utils/constants"
import { BN } from "@utils/math"
import { expect } from "chai"
import { getAddress } from "ethers/lib/utils"
import { ethers } from "ethers"
import type { Account } from "types/common"
import type { Convex3CrvLiquidatorVault, ConvexFraxBpLiquidatorVault, IERC20 } from "types/generated"

import { assertBNClose } from "@utils/assertions"

export interface DepositAssertion {
    sender: Account
    receiver: Account
    asset: IERC20
    vault: Convex3CrvLiquidatorVault | ConvexFraxBpLiquidatorVault
    amount: BN
}
export interface DonationAssertion {
    sender: Account
    asset: IERC20
    donatedToken: IERC20
    vault: Convex3CrvLiquidatorVault | ConvexFraxBpLiquidatorVault
    amount: BN
}
export const snapConvexLiquidatorVault = async (
    receiver: Account,
    asset: IERC20,
    rewardsToken: IERC20,
    vault: Convex3CrvLiquidatorVault | ConvexFraxBpLiquidatorVault,
) => {
    const feeReceiver = await vault.feeReceiver()

    return {
        totalAssets: await vault.totalAssets(),
        totalSupply: await vault.totalSupply(),
        donatedAssets: await asset.balanceOf(vault.address),
        receiverShares: await vault.balanceOf(receiver.address),
        // rewards
        rewardsBalance: await rewardsToken.balanceOf(vault.address),
        // fees
        donationFee: await vault.donationFee(),
        feeReceiver,
        feeReceiverShares: await vault.balanceOf(feeReceiver),
        feeScale: await vault.FEE_SCALE(),
        STREAM_DURATION: await vault.STREAM_DURATION(),
        STREAM_PER_SECOND_SCALE: await vault.STREAM_PER_SECOND_SCALE(),
        shareStream: await vault.shareStream(),
        streamedShares: await vault.streamedShares(),
    }
}
export const assertDepositWithDonation = async (assertion: DepositAssertion) => {
    const { sender, receiver, asset, vault, amount } = assertion
    const donatedAssetsBefore = await asset.balanceOf(vault.address)

    expect(donatedAssetsBefore, "vault has donated assets").to.be.gt(ZERO)
    const feeReceiver = await vault.feeReceiver()
    const expectedShares = await vault.previewDeposit(amount)
    const totalSupplyBefore = await vault.totalSupply()
    const receiverSharesBefore = await vault.balanceOf(receiver.address)
    const feeReceiverSharesBefore = await vault.balanceOf(feeReceiver)
    const streamedSharesBefore = await vault.streamedShares()

    // --------- Test ----------

    await asset.connect(sender.signer).approve(vault.address, amount)
    const tx = await vault.connect(sender.signer)["deposit(uint256,address)"](amount, receiver.address)
    // -------- Test -----------

    const donatedAssetsAfter = await asset.balanceOf(vault.address)
    const totalSupplyAfter = await vault.totalSupply()
    const receiverSharesAfter = await vault.balanceOf(receiver.address)
    const feeReceiverSharesAfter = await vault.balanceOf(feeReceiver)
    const streamedSharesAfter = await vault.streamedShares()

    const receiverSharesMinted = receiverSharesAfter.sub(receiverSharesBefore)
    const feeReceiverSharesMinted = feeReceiverSharesAfter.sub(feeReceiverSharesBefore)
    const streamedSharesMinted = streamedSharesAfter.sub(streamedSharesBefore)
    const sharesMinted = totalSupplyAfter.sub(totalSupplyBefore)
    const donatedSharesMinted = sharesMinted.sub(receiverSharesMinted)

    const donationFee = await vault.donationFee()
    const feeScale = await vault.FEE_SCALE()
    const feeReceiverSharesExpected = donatedSharesMinted.mul(donationFee).div(feeScale)
    const feeReceiverAssetsExpected = donatedAssetsBefore.mul(donationFee).div(feeScale)
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

    console.log(
        "Deposit feeReceiver, assets, shares",
        ethers.utils.formatEther(feeReceiverAssetsExpected),
        ethers.utils.formatEther(feeReceiverSharesExpected),
    )
    console.log(
        "Deposit stream, assets, shares",
        ethers.utils.formatEther(donatedAssetsBefore.sub(feeReceiverAssetsExpected)),
        ethers.utils.formatEther(donatedSharesMinted.sub(feeReceiverSharesExpected)),
    )

    // Deposit event for the receiver
    await expect(tx).to.emit(vault, "Deposit").withArgs(sender.address, receiver.address, amount, expectedShares)

    // Deposit event for the fee
    await expect(tx)
        .to.emit(vault, "Deposit")
        .withArgs(getAddress(sender.address), feeReceiver, feeReceiverAssetsExpected, feeReceiverSharesExpected)

    // Deposit event for the streaming of shares
    await expect(tx)
        .to.emit(vault, "Deposit")
        .withArgs(
            getAddress(sender.address),
            vault.address,
            donatedAssetsBefore.sub(feeReceiverAssetsExpected),
            donatedSharesMinted.sub(feeReceiverSharesExpected),
        )
}

export const assertDonation = async (assertion: DonationAssertion) => {
    const { sender, asset, vault, amount, donatedToken } = assertion

    const dataBefore = await snapConvexLiquidatorVault(sender, asset, donatedToken, vault)

    // Test
    await donatedToken.connect(sender.signer).approve(vault.address, amount)
    const tx = await vault.connect(sender.signer).donate(donatedToken.address, amount)

    const dataAfter = await snapConvexLiquidatorVault(sender, asset, donatedToken, vault)

    // Deposit events
    await expect(tx).to.not.emit(vault, "Deposit")
    // expect(dataBefore.totalAssets, "totalAssets").to.be.eq(dataAfter.totalAssets);
    expect(dataBefore.totalSupply, "totalSupply").to.be.eq(dataAfter.totalSupply)
    expect(dataBefore.donatedAssets, "donatedAssets").to.be.lt(dataAfter.donatedAssets)
}
