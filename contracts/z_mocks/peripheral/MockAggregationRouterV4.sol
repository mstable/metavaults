// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Libs
import { IAggregationExecutor, IAggregationRouterV4, SwapDescription } from "../../peripheral/OneInch/IAggregationRouterV4.sol";

contract MockAggregationRouterV4 is IAggregationRouterV4, Initializable {
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
        address sender,
        IERC20 srcToken,
        IERC20 dstToken,
        address dstReceiver,
        uint256 spentAmount,
        uint256 returnAmount
    );

    constructor() {}

    function initialize(Exchange[] memory exchanges) external initializer {
        uint256 len = exchanges.length;
        for (uint256 i = 0; i < len; ) {
            _setRate(exchanges[i]);
            unchecked {
                ++i;
            }
        }
    }

    function swap(
        IAggregationExecutor,
        SwapDescription calldata desc,
        bytes calldata
    ) external returns (uint256 returnAmount, uint256) {
        // transfer in the from asset
        require(
            IERC20(desc.srcToken).balanceOf(msg.sender) >= desc.amount,
            "not enough from assets"
        );

        IERC20(desc.srcToken).safeTransferFrom(msg.sender, address(this), desc.amount);

        // calculate to asset amount
        returnAmount =
            (desc.amount * rates[address(desc.srcToken)][address(desc.dstToken)]) /
            RATE_SCALE;

        require(returnAmount >= desc.minReturnAmount, "to asset < min");

        // transfer out the to asset
        require(
            IERC20(desc.dstToken).balanceOf(address(this)) >= returnAmount,
            "not enough to assets"
        );
        IERC20(desc.dstToken).safeTransfer(desc.dstReceiver, returnAmount);

        emit Swapped(
            msg.sender,
            desc.srcToken,
            desc.dstToken,
            msg.sender,
            desc.amount,
            returnAmount
        );
    }

    function setRate(Exchange memory exchange) external {
        _setRate(exchange);
    }

    function _setRate(Exchange memory exchange) internal {
        rates[exchange.from][exchange.to] = exchange.rate;
        rates[exchange.to][exchange.from] = RATE_SCALE / exchange.rate;
    }
}
