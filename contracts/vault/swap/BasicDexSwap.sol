// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

// External
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Libs
import { IDexSwap, DexSwapData } from "../../interfaces/IDexSwap.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

/**
 * @notice  Implementation of IDexSwap for testing purposes.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-17
 */
contract BasicDexSwap is IDexSwap, ImmutableModule, Initializable {
    using SafeERC20 for IERC20;

    struct Exchange {
        address from;
        address to;
        uint256 rate;
    }

    uint256 public constant RATE_SCALE = 1e18;

    // FromToken => ToToken => Rate
    mapping(address => mapping(address => uint256)) public rates;

    event Swapped(
        address indexed from,
        address indexed to,
        uint256 fromAssetAmount,
        uint256 toAssetAmount
    );
    event RateSet(address from, address to, uint256 rate);

    /**
     * @param _nexus  Address of the Nexus contract that resolves protocol modules and roles.
     */
    constructor(address _nexus) ImmutableModule(_nexus) {}

    function initialize(Exchange[] memory exchanges) external initializer {
        uint256 len = exchanges.length;
        for (uint256 i = 0; i < len; ) {
            _setRate(exchanges[i]);
            unchecked {
                ++i;
            }
        }
    }

    function swap(DexSwapData memory _swap) external override returns (uint256 toAssetAmount) {
        // transfer in the from asset
        require(
            IERC20(_swap.fromAsset).balanceOf(msg.sender) >= _swap.fromAssetAmount,
            "not enough from assets"
        );
        IERC20(_swap.fromAsset).safeTransferFrom(msg.sender, address(this), _swap.fromAssetAmount);

        // calculate to asset amount
        toAssetAmount =
            (_swap.fromAssetAmount * rates[_swap.fromAsset][_swap.toAsset]) /
            RATE_SCALE;

        require(toAssetAmount >= _swap.minToAssetAmount, "to asset < min");

        // transfer out the to asset
        require(
            IERC20(_swap.toAsset).balanceOf(address(this)) >= toAssetAmount,
            "not enough to assets"
        );
        IERC20(_swap.toAsset).safeTransfer(msg.sender, toAssetAmount);

        emit Swapped(_swap.fromAsset, _swap.toAsset, _swap.fromAssetAmount, toAssetAmount);
    }

    function setRate(Exchange memory exchange) external onlyKeeperOrGovernor {
        _setRate(exchange);
    }

    function _setRate(Exchange memory exchange) internal {
        rates[exchange.from][exchange.to] = exchange.rate;
        rates[exchange.to][exchange.from] = RATE_SCALE / exchange.rate;

        emit RateSet(exchange.from, exchange.to, exchange.rate);
    }
}
