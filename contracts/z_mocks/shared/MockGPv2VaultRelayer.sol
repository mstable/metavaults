// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { BasicDexSwap } from "../../vault/swap/BasicDexSwap.sol";

/// @title Mock Gnosis Protocol v2 Vault Relayer Contract
contract MockGPv2VaultRelayer is BasicDexSwap {
    using SafeERC20 for IERC20;

    /**
     * @param _nexus  Address of the Nexus contract that resolves protocol modules and roles.
     */
    constructor(address _nexus) BasicDexSwap(_nexus) {}

    /**
     * @notice Send tokens to the settlement contracts
     */
    function rescueToken(
        address _erc20,
        address to,
        uint256 amount
    ) external {
        IERC20 token = IERC20(_erc20);
        token.safeTransfer(to, amount);
    }
}
