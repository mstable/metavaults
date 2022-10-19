// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// External
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

// Libs
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { ICowSettlement } from "../../peripheral/Cowswap/ICowSettlement.sol";
import { CowSwapSeller } from "../../peripheral/Cowswap/CowSwapSeller.sol";
import { DexSwapData, IDexAsyncSwap } from "../../interfaces/IDexSwap.sol";

/**
 * @title   CowSwapDex allows to swap tokens between via CowSwap.
 * @author  mStable
 * @notice
 * @dev     VERSION: 1.0
 *          DATE:    2022-06-17
 */
contract CowSwapDex is CowSwapSeller, ImmutableModule, IDexAsyncSwap {
    using SafeERC20 for IERC20;

    /**
     * @param _nexus  Address of the Nexus contract that resolves protocol modules and roles.
     * @param _relayer  Address of the GPv2VaultRelayer contract to set allowance to perform swaps
     * @param _settlement  Address of the GPv2Settlement contract that pre-signs orders.
     */
    constructor(
        address _nexus,
        address _relayer,
        address _settlement
    ) CowSwapSeller(_relayer, _settlement) ImmutableModule(_nexus) {
    }

    /**
     * @dev Modifier to allow function calls only from the Liquidator or the Keeper EOA.
     */
    modifier onlyKeeperOrLiquidator() {
        _keeperOrLiquidator();
        _;
    }

    function _keeperOrLiquidator() internal view {
        require(
            msg.sender == _keeper() || msg.sender == _liquidatorV2(),
            "Only keeper or liquidator"
        );
    }

    /***************************************
                    Core
    ****************************************/

    /**
     * @notice Initialises a cow swap order.
     * @dev This function is used in order to be compliant with IDexSwap interface.
     * @param swapData The data of the swap {fromAsset, toAsset, fromAssetAmount, fromAssetFeeAmount, data}.
     */
    function _initiateSwap(DexSwapData memory swapData) internal {
        // unpack the CowSwap specific params from the generic swap.data field
        (bytes memory orderUid, uint256 fromAssetFeeAmount, address receiver, bool onlySign) = abi
            .decode(swapData.data, (bytes, uint256, address, bool));

        if (!onlySign) {
            uint256 fromAssetTotalAmount = swapData.fromAssetAmount + fromAssetFeeAmount;
            // transfer in the fromAsset
            require(
                IERC20(swapData.fromAsset).balanceOf(msg.sender) >= fromAssetTotalAmount,
                "not enough from assets"
            );
            // Transfer rewards from the liquidator
            IERC20(swapData.fromAsset).safeTransferFrom(
                msg.sender,
                address(this),
                fromAssetTotalAmount
            );
        }

        CowSwapData memory orderData = CowSwapData({
            fromAsset: swapData.fromAsset,
            toAsset: swapData.toAsset,
            receiver: receiver,
            fromAssetAmount: swapData.fromAssetAmount,
            fromAssetFeeAmount: fromAssetFeeAmount
        });

        _initiateCowswapOrder(orderUid, orderData);
    }

    /**
     * @notice Initialises a cow swap order.
     * @dev Orders must be created off-chain.
     * In case that an order fails, a new order uid is created there is no need to transfer "fromAsset".
     * @param swapData The data of the swap {fromAsset, toAsset, fromAssetAmount, fromAssetFeeAmount, data}.
     */
    function initiateSwap(DexSwapData calldata swapData) external override onlyKeeperOrLiquidator {
        _initiateSwap(swapData);
    }

    /**
     * @notice Initiate cow swap orders in bulk.
     * @dev Orders must be created off-chain.
     * @param swapsData Array of swap data {fromAsset, toAsset, fromAssetAmount, fromAssetFeeAmount, data}.
     */
    function initiateSwap(DexSwapData[] calldata swapsData) external onlyKeeperOrLiquidator {
        uint256 len = swapsData.length;
        for (uint256 i = 0; i < len; ) {
            _initiateSwap(swapsData[i]);
            // Increment index with low gas consumption, no need to check for overflow.
            unchecked {
                i += 1;
            }
        }
    }

    /**
     * @notice It reverts as cowswap allows to provide a "receiver" while creating an order. Therefore
     * @dev  The method is kept to have compatibility with IDexAsyncSwap.
     */
    function settleSwap(DexSwapData memory) external pure {
        revert("!not supported");
    }

    /**
     * @notice Allows to cancel a cowswap order perhaps if it took too long or was with invalid parameters
     * @dev  This function performs no checks, there's a high change it will revert if you send it with fluff parameters
     * Emits the `SwapCancelled` event with the `orderUid`.
     * @param orderUid The order uid of the swap.
     */
    function cancelSwap(bytes calldata orderUid) external override onlyKeeperOrLiquidator {
        _cancelCowSwapOrder(orderUid);
    }

    /**
     * @notice Cancels cow swap orders in bulk.
     * @dev  It invokes the `cancelSwap` function for each order in the array.
     * For each order uid it emits the `SwapCancelled` event with the `orderUid`.
     * @param orderUids Array of swaps order uids
     */
    function cancelSwap(bytes[] calldata orderUids) external onlyKeeperOrLiquidator {
        _cancelCowSwapOrder(orderUids);
    }

    /**
     * @notice Rescues tokens from the contract in case of a cancellation or failure and sends it to governor.
     * @dev only governor can invoke.
     * Even if a swap fails, the order can be created again and keep trying, rescueToken must be the last resource,
     * ie, cowswap is not availabler for N hours.
     */
    function rescueToken(address _erc20, uint256 amount) external onlyGovernor {
        IERC20(_erc20).safeTransfer(_governor(), amount);
    }
}
