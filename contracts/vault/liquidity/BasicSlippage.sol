// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

// External
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

// Libs
import { AbstractSlippage } from "./AbstractSlippage.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";

/**
 * @title   Basic implementation of `AbstractSlippage` for unit testing.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-18
 */
contract BasicSlippage is AbstractSlippage, Initializable {
    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     */
    constructor(address _nexus) VaultManagerRole(_nexus) {}

    /**
     * @param _vaultManager Trusted account that can perform vault operations. eg rebalance.
     * @param _slippageData  Initial slippage limits.
     */
    function initialize(address _vaultManager, SlippageData memory _slippageData)
        external
        initializer
    {
        VaultManagerRole._initialize(_vaultManager);
        AbstractSlippage._initialize(_slippageData);
    }
}
