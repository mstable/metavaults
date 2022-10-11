// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { AbstractSlippage } from "../AbstractSlippage.sol";
import { LightAbstractVault } from "../../LightAbstractVault.sol";
import { Curve3CrvAbstractMetaVault } from "./Curve3CrvAbstractMetaVault.sol";
import { VaultManagerRole } from "../../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../../tokens/InitializableToken.sol";

/**
 * @title   Basic 3Pool ERC-4626 vault that takes in one underlying asset to deposit in 3Pool and put the 3Crv in underlying metaVault.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-11
 */
contract Curve3CrvBasicMetaVault is Curve3CrvAbstractMetaVault, Initializable {
    /// @param _nexus         Address of the Nexus contract that resolves protocol modules and roles..
    /// @param _asset         Address of the vault's asset which is one of the 3Pool tokens DAI, USDC or USDT.
    /// @param _metaVault     Address of the vault's underlying meta vault that implements ERC-4626.
    constructor(
        address _nexus,
        address _asset,
        address _metaVault
    )
        LightAbstractVault(_asset)
        Curve3CrvAbstractMetaVault(_asset, _metaVault)
        VaultManagerRole(_nexus)
    {}

    /// @param _name          Name of vault.
    /// @param _symbol        Symbol of vault.
    /// @param _vaultManager  Trusted account that can perform vault operations. eg rebalance.
    /// @param _slippageData  Initial slippage limits.
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _vaultManager,
        SlippageData memory _slippageData
    ) external initializer {
        // Set the vault's decimals to the same as the Metapool LP token (3Crv).
        InitializableToken._initialize(_name, _symbol, 18);

        VaultManagerRole._initialize(_vaultManager);
        AbstractSlippage._initialize(_slippageData);
        Curve3CrvAbstractMetaVault._initialize();
    }
}
