// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// External
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

// Libs
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { ICowSettlement } from "./ICowSettlement.sol";

/**
 * @title   CowSwapSeller sets ERC20 Tokens allowance and presign CowSwap orders.
 * @author  mStable
 * @notice  Simplified version of  https://github.com/GalloDaSballo/fair-selling
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-11
 */
abstract contract CowSwapSeller is InitializableReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Contract GPv2VaultRelayer to give allowance to perform swaps
    address public immutable RELAYER;

    /// @notice GPv2Settlement contract
    ICowSettlement public immutable SETTLEMENT;

    struct CowSwapData {
        address fromAsset;
        address toAsset;
        address receiver;
        uint256 fromAssetAmount;
        uint256 fromAssetFeeAmount;
    }

    struct CowSwapTrade {
        address owner;
        address receiver;
        address toAsset;
        uint256 toAssetAmount;
    }

    /// @notice Event emitted when a order is initliased.
    event SwapInitiated(
        bytes indexed orderUid,
        address indexed fromAsset,
        uint256 fromAssetAmount,
        uint256 fromAssetFeeAmount
    );

    /// @notice Event emitted when a order is cancelled.
    event SwapCancelled(bytes indexed orderUid);

    /// @notice Event emitted when a order is initliased.
    event SwapSettled(bytes indexed orderUid, address indexed toAsset, uint256 toAssetAmount);

    /**
     * @param _relayer  Address of the GPv2VaultRelayer contract to set allowance to perform swaps
     * @param _settlement  Address of the GPv2Settlement contract that pre-signs orders.
     */
    constructor(address _relayer, address _settlement) {
        _initializeReentrancyGuard();
        RELAYER = _relayer;
        SETTLEMENT = ICowSettlement(_settlement);
    }

    /**
     * @notice Initializes a  cow swap order by setting the allowance of the token and presigning the order.
     * @dev This is the function to perform a swap on Cowswap via this smart contract.
     * Emits the `SwapInitiated` event with the `orderUid` details.
     * @param orderUid The order uid of the swap.
     * @param orderData The data of the cow swap order {fromAsset, toAsset, fromAssetAmount, fromAssetFeeAmount}.
     */
    function _initiateCowswapOrder(bytes memory orderUid, CowSwapData memory orderData) internal {
        // Because swap is looking good, check we have the amount, then give allowance to the Cowswap Router
        address fromAsset = orderData.fromAsset;
        IERC20(fromAsset).safeIncreaseAllowance(
            RELAYER,
            orderData.fromAssetAmount + orderData.fromAssetFeeAmount
        );

        // Once allowance is set, let's setPresignature and the order will happen
        SETTLEMENT.setPreSignature(orderUid, true);
        emit SwapInitiated(
            orderUid,
            fromAsset,
            orderData.fromAssetAmount,
            orderData.fromAssetFeeAmount
        );
    }

    /**
     * @notice Initializes cow swap orders in bulk.
     * @dev It invokes the `_initiateCowswapOrder` function for each order in the array.
     * Emits the `SwapInitiated` event with the `orderUid` details for each  order.
     * @param orderUids Array of order uids.
     * @param ordersData Array of cow swap order data [{fromAsset, toAsset, fromAssetAmount, fromAssetFeeAmount}].
     */
    function _initiateCowswapOrder(bytes[] memory orderUids, CowSwapData[] calldata ordersData)
        internal
    {
        require(ordersData.length == orderUids.length, "invalid input");
        uint256 len = orderUids.length;
        for (uint256 i = 0; i < len; ) {
            _initiateCowswapOrder(orderUids[i], ordersData[i]);
            // Increment index with low gas consumption, no need to check for overflow.
            unchecked {
                i += 1;
            }
        }
    }

    /**
     * @notice Allows to cancel a cowswap order perhaps if it took too long or was with invalid parameters
     * @dev  This function performs no checks, there's a high change it will revert if you send it with fluff parameters
     * Emits the `SwapCancelled` event with the `orderUid`.
     * @param orderUid The order uid of the swap.
     */
    function _cancelCowSwapOrder(bytes memory orderUid) internal {
        emit SwapCancelled(orderUid);
        SETTLEMENT.setPreSignature(orderUid, false);
    }

    /**
     * @notice Cancels cow swap orders in bulk.
     * @dev  It invokes the `_cancelCowSwapOrder` function for each order in the array.
     * For each order uid it emits the `SwapCancelled` event with the `orderUid`.
     * @param orderUids Array of swaps order uids
     */
    function _cancelCowSwapOrder(bytes[] memory orderUids) internal {
        uint256 len = orderUids.length;
        for (uint256 i = 0; i < len; ) {
            _cancelCowSwapOrder(orderUids[i]);
            // Increment index with low gas consumption, no need to check for overflow.
            unchecked {
                i += 1;
            }
        }
    }

    /**
     * @notice Settle a cowswap order by sending the tokens to the owner.
     * @dev  emits the `SwapSettled` event with the `orderUid` details.
     * @param orderUid The swap order uids
     * @param tradeData The cow swap order data {owner, fromAsset, fromAssetAmount, fromAssetFeeAmount,toAsset , toAssetAmount }.
     */
    function _settleCowSwapOrder(bytes memory orderUid, CowSwapTrade memory tradeData) internal {
        emit SwapSettled(orderUid, tradeData.toAsset, tradeData.toAssetAmount);
    }
}
