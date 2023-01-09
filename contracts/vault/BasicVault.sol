// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { InitializableToken } from "../tokens/InitializableToken.sol";
import { VaultManagerRole } from "../shared/VaultManagerRole.sol";
import { AbstractVault } from "./AbstractVault.sol";

contract BasicVault is AbstractVault, Initializable {
    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     * @param _asset    Address of the vault's asset.
     */
    constructor(address _nexus, address _asset) AbstractVault(_asset) VaultManagerRole(_nexus) {}

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _vaultManager,
        uint256 _assetToBurn
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 _decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, _decimals);
        VaultManagerRole._initialize(_vaultManager);
        AbstractVault._initialize(_assetToBurn);
    }

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = _asset.balanceOf(address(this));
    }
}
