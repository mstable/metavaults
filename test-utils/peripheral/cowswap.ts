import { ethers } from "hardhat"

import type { BigNumber as BN } from "ethers"
/**
 * Encode the data for a Cowswap initiate swap call
 *
 * @param {string} orderUid  the order id of the swap
 * @param {BN} fromAssetFeeAmount  the fee amount of the from asset
 * @param {string} receiver  the address receiver of the swap
 * @param {boolean} onlySign  if it should only sign the tx, rather than transferIn assets and sign
 * @return {string}  The encoded data for the call
 */
export const encodeInitiateSwap = (orderUid: string, fromAssetFeeAmount: BN, receiver: string, onlySign = false): string =>
    ethers.utils.defaultAbiCoder.encode(["bytes", "uint256", "address", "bool"], [orderUid, fromAssetFeeAmount, receiver, onlySign])
/**
 * Encode the data for a Cowswap initiate swap call
 *
 * @param {string} orderUid  the order id of the swap
 * @param {string} owner  the address of the owner of the swap
 * @param {string} receiver  the address of the receiver of the swap
 * @return {string}  The encoded data for the call
 */
export const encodeSettleSwap = (orderUid: string, owner: string, receiver: string): string =>
    ethers.utils.defaultAbiCoder.encode(["bytes", "address", "address"], [orderUid, owner, receiver])
