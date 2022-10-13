// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { PeriodicAllocationAbstractVault } from "./PeriodicAllocationAbstractVault.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../tokens/InitializableToken.sol";
import { AbstractVault } from "../AbstractVault.sol";

/**
 * @title   Abstract ERC-4626 vault that invests in underlying ERC-4626 vaults of the same asset.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-03
 */
contract PeriodicAllocationBasicVault is Initializable, PeriodicAllocationAbstractVault {
    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     * @param _assetArg Address of the vault's underlying asset.
     */
    constructor(address _nexus, address _assetArg)
        VaultManagerRole(_nexus)
        AbstractVault(_assetArg)
    {}

    /**
     * @param _nameArg  Name of Vault token
     * @param _symbolArg Symbol of vault token
     * @param _vaultManager Trusted account that can perform vault operations. eg rebalance.
     * @param _underlyingVaults  The underlying vaults address to invest into.
     * @param _sourceParams Params related to sourcing of assets
     * @param _assetPerShareUpdateThreshold threshold amount of transfers to/from for assetPerShareUpdate
     */
    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _vaultManager,
        address[] memory _underlyingVaults,
        AssetSourcingParams memory _sourceParams,
        uint256 _assetPerShareUpdateThreshold
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 _decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, _decimals);

        VaultManagerRole._initialize(_vaultManager);
        PeriodicAllocationAbstractVault._initialize(
            _underlyingVaults,
            _sourceParams,
            _assetPerShareUpdateThreshold
        );
    }
}
