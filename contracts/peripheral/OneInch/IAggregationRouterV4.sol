// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/** @dev Struct to store information one inch swaps*/
struct SwapDescription {
    IERC20 srcToken; // contract address of a token to sell
    IERC20 dstToken; // contract address of a token to buy
    address payable srcReceiver;
    address payable dstReceiver; // Receiver of destination currency. default: fromAddress
    uint256 amount;
    uint256 minReturnAmount;
    uint256 flags;
    bytes permit;
}

/// @title Interface for making arbitrary calls during swap
interface IAggregationExecutor {
    function callBytes(address msgSender, bytes calldata data) external payable;
}

interface IAggregationRouterV4 {
    function swap(
        IAggregationExecutor caller,
        SwapDescription calldata desc,
        bytes calldata data
    ) external returns (uint256 returnAmount, uint256 gasLeft);
}
