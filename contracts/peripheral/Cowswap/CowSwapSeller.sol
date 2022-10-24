// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// External
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Libs
import { ICowSettlement } from "./ICowSettlement.sol";

/**
 * @title   CowSwapSeller sets ERC20 Tokens allowance and presign CowSwap orders.
 * @author  mStable
 * @notice  Simplified version of  https://github.com/GalloDaSballo/fair-selling
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-11
 */
abstract contract CowSwapSeller {
    using SafeERC20 for IERC20;

    /// @notice Contract GPv2VaultRelayer to give allowance to perform swaps
    address public immutable RELAYER;

    /// @notice GPv2Settlement contract
    ICowSettlement public immutable SETTLEMENT;

    /// @notice Event emitted when a order is cancelled.
    event SwapCancelled(bytes indexed orderUid);

    /**
     * @param _relayer  Address of the GPv2VaultRelayer contract to set allowance to perform swaps
     * @param _settlement  Address of the GPv2Settlement contract that pre-signs orders.
     */
    constructor(address _relayer, address _settlement) {
        RELAYER = _relayer;
        SETTLEMENT = ICowSettlement(_settlement);
    }

    /**
     * @notice Initializes a cow swap order by setting the allowance of the token and presigning the order.
     * @dev This is the function to perform a swap on Cowswap via this smart contract.
     * @param orderUid CowSwap's unique identifier of the swap order.
     * @param fromAsset address of the token to sell.
     * @param fromAssetAmount amount of tokens to sell including fees.
     * @param transfer flag if tokens have not already been allowed to be transferred by the cow swap relay.
     */
    function _initiateCowswapOrder(bytes memory orderUid, address fromAsset, uint256 fromAssetAmount, bool transfer) internal {
        if (transfer) {
            // allow the cow swap router to transfer sell tokens from this contract
            IERC20(fromAsset).safeIncreaseAllowance(
                RELAYER,
                fromAssetAmount
            );
        }

        // sign the order on-chain so the order will happen
        SETTLEMENT.setPreSignature(orderUid, true);
    }

    /**
     * @notice Allows to cancel a cow swap order perhaps if it took too long or was with invalid parameters
     * @dev  This function performs no checks, there's a high change it will revert if you send it with fluff parameters
     * Emits the `SwapCancelled` event with the `orderUid`.
     * @param orderUid The order uid of the swap.
     */
    function _cancelCowSwapOrder(bytes memory orderUid) internal {
        // IERC20(fromAsset).safeDecreaseAllowance(
        //     RELAYER,
        //     fromAssetAmount
        // );

        SETTLEMENT.setPreSignature(orderUid, false);

        emit SwapCancelled(orderUid);
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
}
