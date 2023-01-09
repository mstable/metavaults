// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { InitializableToken } from "../../tokens/InitializableToken.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";
import { AbstractVault } from "../AbstractVault.sol";
import { LiquidatorAbstractVault } from "./LiquidatorAbstractVault.sol";
import { LiquidatorStreamAbstractVault } from "./LiquidatorStreamAbstractVault.sol";

/**
 * @notice  A simple implementation of the abstract liquidator vault that streams donated assets for testing purposes.
 * Rewards are added to the vault by simply transferring them to the vault.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-30
 */
contract LiquidatorStreamBasicVault is LiquidatorStreamAbstractVault, Initializable {
    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     * @param _asset    Address of the vault's asset.
     * @param _streamDuration  Number of seconds the increased asssets per share will be streamed after tokens are donated.
     */
    constructor(
        address _nexus,
        address _asset,
        uint256 _streamDuration
    )
        AbstractVault(_asset)
        VaultManagerRole(_nexus)
        LiquidatorStreamAbstractVault(_streamDuration)
    {}

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _vaultManager,
        address[] memory _rewardTokens,
        uint256 _assetToBurn
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, decimals);

        VaultManagerRole._initialize(_vaultManager);
        LiquidatorAbstractVault._initialize(_rewardTokens);
        AbstractVault._initialize(_assetToBurn);
    }

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = _asset.balanceOf(address(this));
    }
}
