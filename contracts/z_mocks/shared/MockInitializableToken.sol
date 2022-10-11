// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { InitializableToken } from "../../tokens/InitializableToken.sol";

/**
 * @title  MockInitializableToken
 * @author mStable
 * @notice Basic token with name, symbol and decimals that are initializable.
 * A fixed supply of tokens is minted on initializeation to a nominated account.
 */
contract MockInitializableToken is InitializableToken {
    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) external {
        InitializableToken._initialize(_nameArg, _symbolArg, _decimals);

        _mint(_initialRecipient, _initialMint * (10**uint256(_decimals)));
    }
}
