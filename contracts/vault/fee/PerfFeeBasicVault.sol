// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { FeeAdminAbstractVault } from "./FeeAdminAbstractVault.sol";
import { PerfFeeAbstractVault } from "./PerfFeeAbstractVault.sol";
import { AbstractVault, IERC20 } from "../AbstractVault.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../tokens/InitializableToken.sol";

/**
 * @notice  A simple implementation of the abstract performance fees vault.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-30
 */
contract PerfFeeBasicVault is Initializable, PerfFeeAbstractVault {
    using SafeERC20 for IERC20;

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
        uint24 _performanceFee
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, decimals);

        VaultManagerRole._initialize(_vaultManager);
        FeeAdminAbstractVault._initialize(feeReceiver);
        PerfFeeAbstractVault._initialize(_performanceFee);
    }

    /****************************************
                    Overrides
    ****************************************/

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = _asset.balanceOf(address(this));
    }
}
