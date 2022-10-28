import { defaultAbiCoder } from "ethers/lib/utils"

/**
 * Encode the data for a Cowswap initiate swap call
 *
 * @param {string} orderUid  the order id of the swap
 * @param {boolean} transfer  transfer sell tokens from the liquidator
 * @return {string}  The encoded data for the call
 */
export const encodeInitiateSwap = (orderUid: string, transfer = true): string =>
    defaultAbiCoder.encode(["bytes", "bool"], [orderUid, transfer])
/**
 * Encode the data for a Cowswap initiate swap call
 *
 * @param {string} orderUid  the order id of the swap
 * @param {string} owner  the address of the owner of the swap
 * @param {string} receiver  the address of the receiver of the swap
 * @return {string}  The encoded data for the call
 */
export const encodeSettleSwap = (orderUid: string, owner: string, receiver: string): string =>
    defaultAbiCoder.encode(["bytes", "address", "address"], [orderUid, owner, receiver])
