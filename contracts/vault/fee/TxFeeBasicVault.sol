// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

// Libs
import { FeeAdminAbstractVault } from "./FeeAdminAbstractVault.sol";
import { TxFeeAbstractVault } from "./TxFeeAbstractVault.sol";
import { AbstractVault } from "../AbstractVault.sol";
import { InitializableToken } from "../../tokens/InitializableToken.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";

/**
 * @title   A simple implementation of the abstract transaction fees vault.
 * @author  mStable
 * @notice  Deposited assets just sit in the vault. They are not invested anywhere.
 * @dev     VERSION: 1.0
 *          DATE:    2022-04-07
 */
contract TxFeeBasicVault is TxFeeAbstractVault, Initializable {
    constructor(address _nexus, address _assetArg)
        AbstractVault(_assetArg)
        VaultManagerRole(_nexus)
    {}

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _vaultManager,
        address _feeReceiver,
        FeeData memory _feeData
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, decimals);

        VaultManagerRole._initialize(_vaultManager);
        FeeAdminAbstractVault._initialize(_feeReceiver);
        TxFeeAbstractVault._initialize(_feeData);
    }

    /***************************************
                    Overrides
    ****************************************/

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        // Return the asset balance of this vault
        totalManagedAssets = _asset.balanceOf(address(this));
    }

    /***************************************
                    Hooks
    ****************************************/

    function _afterDepositHook(
        uint256 assets,
        uint256,
        address,
        bool
    ) internal override {
        // Does not depost assets as just used for testing
    }

    function _beforeWithdrawHook(
        uint256 assets,
        uint256,
        address,
        bool
    ) internal override {
        // Does not withdraw assets as just used for testing
    }
}
