// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { FeeAdminAbstractVault } from "./FeeAdminAbstractVault.sol";
import { ManFeeAbstractVault } from "./ManFeeAbstractVault.sol";
import { AbstractVault } from "../AbstractVault.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../tokens/InitializableToken.sol";

/**
 * @notice  A simple implementation of the abstract management fee vault.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-31
 */
contract ManFeeBasicVault is Initializable, ManFeeAbstractVault {
    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     * @param _assetArg Address of the vault's underlying asset.
     */
    constructor(address _nexus, address _assetArg)
        VaultManagerRole(_nexus)
        AbstractVault(_assetArg)
    {}

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _vaultManager,
        address feeReceiver,
        uint32 _managementFee
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, decimals);

        VaultManagerRole._initialize(_vaultManager);
        FeeAdminAbstractVault._initialize(feeReceiver);
        ManFeeAbstractVault._initialize(_managementFee);
    }

    /***************************************
                    Overrides
    ****************************************/

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        // Return the asset balance of this vault and the token holder
        totalManagedAssets = _asset.balanceOf(address(this));
    }
}
