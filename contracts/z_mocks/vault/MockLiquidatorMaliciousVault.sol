// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { InitializableToken } from "../../tokens/InitializableToken.sol";
import { VaultManagerRole } from "../../shared/VaultManagerRole.sol";
import { AbstractVault } from "../../vault/AbstractVault.sol";
import { LiquidatorAbstractVault } from "../../vault/liquidator/LiquidatorAbstractVault.sol";
import { ILiquidatorV2 } from "../../interfaces/ILiquidatorV2.sol";

/**
 * @notice  A simple implementation of the abstract liquidator vault for testing purposes.
 * Rewards are added to the vault by simply transferring them to the vault.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-11-30
 */
contract MockLiquidatorMaliciousVault is AbstractVault, LiquidatorAbstractVault, Initializable {
    using SafeERC20 for IERC20;

    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     * @param _asset    Address of the vault's asset.
     */
    constructor(address _nexus, address _asset) AbstractVault(_asset) VaultManagerRole(_nexus) {}

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _vaultManager,
        address[] memory _rewardTokens
    ) external initializer {
        // Set the vault's decimals to the same as the reference asset.
        uint8 _decimals = InitializableToken(address(_asset)).decimals();
        InitializableToken._initialize(_nameArg, _symbolArg, _decimals);

        VaultManagerRole._initialize(_vaultManager);
        LiquidatorAbstractVault._initialize(_rewardTokens);
    }

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = _asset.balanceOf(address(this));
    }

    /**
     * @notice Adds tokens to the vault.
     * The base implementation only receives vault assets without minting any shares.
     * This increases the vault's assets per share.
     * @param token The address of the token being donated.
     * @param amount The amount of tokens being donated.
     */
    function donate(address token, uint256 amount) external override {
        require(token == address(_asset), "Donated token not asset");
        _transferAndMint(amount, 0, address(this), true);
    }

    /**
     * @dev Base implementation returns the vault asset.
     * This can be overridden to swap rewards for other tokens.
     */
    function _donateToken(address) internal view override returns (address token) {
        token = address(_asset);
    }

    /**
     * @dev Calls liquidator again to collect rewards.
     */
    function _beforeCollectRewards() internal virtual override {
        address liquidator = _liquidatorV2();
        address[] memory vaults = new address[](1);
        vaults[0] = address(this);
        // Re-entry call
        ILiquidatorV2(liquidator).collectRewards(vaults);
    }
}
