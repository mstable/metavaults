// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IERC4626Vault } from "../interfaces/IERC4626Vault.sol";
import { VaultManagerRole } from "../shared/VaultManagerRole.sol";
import { InitializableToken } from "../tokens/InitializableToken.sol";

/**
 * @title   A minimal abstract implementation of a ERC-4626 vault.
 * @author  mStable
 * @notice  Only implements the asset and max functions.
 * See the following for the full EIP-4626 specification https://eips.ethereum.org/EIPS/eip-4626.
 * Connects to the mStable Nexus to get modules like the Governor and Keeper.
 * Creates the VaultManager role.
 * Is a ERC-20 token with token details (name, symbol and decimals).
 *
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-16
 *
 * The constructor of implementing contracts need to call the following:
 * - VaultManagerRole(_nexus)
 * - LightAbstractVault(_assetArg)
 *
 * The `initialize` function of implementing contracts need to call the following:
 * - InitializableToken._initialize(_name, _symbol, decimals)
 * - VaultManagerRole._initialize(_vaultManager)
 */
abstract contract LightAbstractVault is IERC4626Vault, InitializableToken, VaultManagerRole {
    /// @notice Address of the vault's underlying asset token.
    IERC20 internal immutable _asset;

    /**
     * @param _assetArg         Address of the vault's underlying asset.
     */
    constructor(address _assetArg) {
        require(_assetArg != address(0), "Asset is zero");
        _asset = IERC20(_assetArg);
    }

    /// @return assetTokenAddress The address of the underlying token used for the Vault uses for accounting, depositing, and withdrawing
    function asset() external view virtual override returns (address assetTokenAddress) {
        assetTokenAddress = address(_asset);
    }

    /**
     * @notice The maximum number of underlying assets that caller can deposit.
     * @param caller Account that the assets will be transferred from.
     * @return maxAssets The maximum amount of underlying assets the caller can deposit.
     */
    function maxDeposit(address caller) external view override returns (uint256 maxAssets) {
        if (paused()) {
            return 0;
        }

        maxAssets = type(uint256).max;
    }

    /**
     * @notice The maximum number of vault shares that caller can mint.
     * @param caller Account that the underlying assets will be transferred from.
     * @return maxShares The maximum amount of vault shares the caller can mint.
     */
    function maxMint(address caller) external view override returns (uint256 maxShares) {
        if (paused()) {
            return 0;
        }

        maxShares = type(uint256).max;
    }

    /**
     * @notice The maximum number of shares an owner can redeem for underlying assets.
     * @param owner Account that owns the vault shares.
     * @return maxShares The maximum amount of shares the owner can redeem.
     */
    function maxRedeem(address owner) external view override returns (uint256 maxShares) {
        if (paused()) {
            return 0;
        }

        maxShares = balanceOf(owner);
    }
}
