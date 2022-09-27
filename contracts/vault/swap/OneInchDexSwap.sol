// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

import { IAggregationExecutor, IAggregationRouterV4, SwapDescription } from "../../peripheral/OneInch/IAggregationRouterV4.sol";
import { IDexSwap, DexSwapData } from "../../interfaces/IDexSwap.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice  Implementation of IDexSwap that uses 1inch API Aggregation Protocol v4.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-02-27
 */
contract OneInchDexSwap is IDexSwap {
    using SafeERC20 for IERC20;

    /// @notice Contract IAggregationRouterV4 to give allowance to perform swaps
    IAggregationRouterV4 public immutable router;

    /// @dev Emitted when a swap is performed.
    event Swapped(
        address indexed fromAsset,
        address indexed toAsset,
        uint256 fromAssetAmount,
        uint256 toAssetAmount
    );

    /**
     * @dev Initializes the contract
     * @param _router OneInch aggretation router
     */
    constructor(address _router) {
        router = IAggregationRouterV4(_router);
    }

    function swap(DexSwapData memory _swap) external override returns (uint256 toAssetAmount) {
        // unpack the 1Inch specific params from the generic swap.data field
        (address callerAddress, address payable srcReceiver, bytes memory data) = abi.decode(
            _swap.data,
            (address, address, bytes)
        );

        IERC20(_swap.fromAsset).safeTransferFrom(msg.sender, address(this), _swap.fromAssetAmount);
        IERC20(_swap.fromAsset).safeIncreaseAllowance(address(router), _swap.fromAssetAmount);

        IAggregationExecutor caller = IAggregationExecutor(callerAddress);

        SwapDescription memory desc = SwapDescription({
            srcToken: IERC20(_swap.fromAsset),
            dstToken: IERC20(_swap.toAsset),
            srcReceiver: srcReceiver,
            dstReceiver: payable(msg.sender),
            amount: _swap.fromAssetAmount,
            minReturnAmount: _swap.minToAssetAmount,
            flags: 0, // no special swaps needed
            permit: "0x" // we are not approving tx via signatures so it is not necessary
        });
        (toAssetAmount, ) = router.swap(caller, desc, data);

        emit Swapped(_swap.fromAsset, _swap.toAsset, _swap.fromAssetAmount, toAssetAmount);
    }
}
