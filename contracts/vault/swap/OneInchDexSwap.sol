// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

import { IAggregationExecutor, IAggregationRouterV4, SwapDescription } from "../../peripheral/OneInch/AggregationRouterV4.sol";
import { IDexSwap, DexSwapData } from "../../interfaces/IDexSwap.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice  Implementation of IDexSwap that uses 1inch API Aggregation Protocol v4.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-02-27
 */
contract OneInchDexSwap is IDexSwap {
    IAggregationRouterV4 public immutable router;

    constructor(address _router) {
        router = IAggregationRouterV4(_router);
    }

    function swap(DexSwapData memory _swap) external override returns (uint256 toAssetAmount) {
        // unpack the 1Inch specific params from the generic swap.data field
        (
            address callerAddress,
            address payable srcReceiver,
            address payable dstReceiver,
            uint256 flags,
            bytes memory data
        ) = abi.decode(_swap.data, (address, address, address, uint256, bytes));

        IAggregationExecutor caller = IAggregationExecutor(callerAddress);

        SwapDescription memory desc = SwapDescription({
            srcToken: IERC20(_swap.fromAsset),
            dstToken: IERC20(_swap.toAsset),
            srcReceiver: srcReceiver,
            dstReceiver: dstReceiver,
            amount: _swap.fromAssetAmount,
            minReturnAmount: _swap.minToAssetAmount,
            flags: flags,
            permit: ""
        });

        (toAssetAmount, ) = router.swap(caller, desc, data);
    }
}
