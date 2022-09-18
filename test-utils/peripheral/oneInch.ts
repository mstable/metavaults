import { ethers } from "hardhat"

/**
 * Encode the data for a OneInch swap swap call
 *
 * @param {string} data  Encoded calls that caller should execute in between of swaps
 * @return {string}  The encoded data for the call
 */
export const encodeOneInchSwap = (caller: string, receiver: string, data: string): string =>
    ethers.utils.defaultAbiCoder.encode(["address", "address", "bytes"], [caller, receiver, data])
//  TODO - investigate how to calculate the caller swaps and encode them , reference https://docs.1inch.io/docs/aggregation-protocol/smart-contract/AggregationRouterV4
