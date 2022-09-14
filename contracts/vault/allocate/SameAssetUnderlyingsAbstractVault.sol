// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Libs
import { AbstractVault } from "../AbstractVault.sol";
import { IERC4626Vault } from "../../interfaces/IERC4626Vault.sol";

/**
 * @title   Abstract ERC-4626 vault that invests in underlying ERC-4626 vaults of the same asset.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-03-28
 * The constructor of implementing contracts need to call the following:
 * - VaultManagerRole(_nexus)
 * - LightAbstractVault(_assetArg)
 *
 * The `initialize` function of implementing contracts need to call the following:
 * - InitializableToken._initialize(_name, _symbol, decimals)
 * - VaultManagerRole._initialize(_vaultManager)
 * - SameAssetUnderlyingsAbstractVault._initialize(_underlyingVaults)
 */
abstract contract SameAssetUnderlyingsAbstractVault is AbstractVault {
    using SafeERC20 for IERC20;

    struct Swap {
        uint256 fromVaultIndex;
        uint256 toVaultIndex;
        uint256 shares;
        uint256 assets;
    }

    /// @notice The underlying vaults this vault invests into.
    IERC4626Vault[] public underlyingVaults;

    event AddedVault(uint256 indexed vaultIndex, address indexed vault);
    event RemovedVault(uint256 indexed vaultIndex, address indexed vault);

    /**
     * @param _underlyingVaults  The underlying vaults address to invest into.
     */
    function _initialize(address[] memory _underlyingVaults) internal virtual {
        uint256 vaultsLen = _underlyingVaults.length;
        require(vaultsLen > 0, "No underlying vaults");

        // For each underlying vault
        for (uint256 i = 0; i < vaultsLen; ) {
            _addVault(_underlyingVaults[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Includes all the assets in this vault plus all the underlying vaults.
     * The amount of assets in each underlying vault is calculated using the vault's share of the
     * underlying vault's total assets. `totalAssets()` does not account for fees or slippage so
     * the actual asset value is likely to be less.
     *
     * @return  totalManagedAssets The total assets managed by this vault.
     */
    function totalAssets() public view virtual override returns (uint256 totalManagedAssets) {
        totalManagedAssets = _asset.balanceOf(address(this)) + _totalUnderlyingAssets();
    }

    /**
     * @notice Includes the assets in all underlying vaults. It does not include the assets in this vault.
     * @return  totalUnderlyingAssets The total assets held in underlying vaults
     */
    function _totalUnderlyingAssets() internal view returns (uint256 totalUnderlyingAssets) {
        // Get the assets held by this vault in each of in the underlying vaults
        uint256 len = underlyingVaults.length;

        for (uint256 i = 0; i < len; ) {
            totalUnderlyingAssets += underlyingVaults[i].maxWithdraw(address(this));
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Returns the total number of underlying vaults.
     *
     * @return  vaultsLen The total number of underlying vaults
     */
    function underlyingVaultsLength() external view virtual returns (uint256 vaultsLen) {
        vaultsLen = underlyingVaults.length;
    }

    /**
     * @notice `VaultManager` rebalances the assets in the underlying vaults.
     * This can be moving assets between underlying vaults, moving assets in underlying
     * vaults back to this vault, or moving assets in this vault to underlying vaults.
     */
    function rebalance(Swap[] calldata swaps) external virtual onlyVaultManager {
        // For each swap
        Swap memory swap;
        uint256 underlyingVaultsLength = underlyingVaults.length;
        for (uint256 i = 0; i < swaps.length; ) {
            swap = swaps[i];
            require(swap.fromVaultIndex < underlyingVaultsLength, "Invalid from vault index");
            require(swap.toVaultIndex < underlyingVaultsLength, "Invalid to vault index");

            if (swap.assets > 0) {
                // Withdraw assets from underlying vault
                underlyingVaults[swap.fromVaultIndex].withdraw(
                    swap.assets,
                    address(this),
                    address(this)
                );

                // Deposits withdrawn assets in underlying vault
                underlyingVaults[swap.toVaultIndex].deposit(swap.assets, address(this));
            }
            if (swap.shares > 0) {
                // Redeem shares from underlying vault
                uint256 redeemedAssets = underlyingVaults[swap.fromVaultIndex].redeem(
                    swap.shares,
                    address(this),
                    address(this)
                );

                // Deposits withdrawn assets in underlying vault
                underlyingVaults[swap.toVaultIndex].deposit(redeemedAssets, address(this));
            }

            unchecked {
                ++i;
            }
        }
    }

    /***************************************
                Vault Management
    ****************************************/

    /**
     * @notice  Adds a new underlying ERC-4626 compliant vault.
     * This Meta Vault approves the new underlying vault to transfer max assets.
     * @param _underlyingVault Address of a ERC-4626 compliant vault.
     */
    function addVault(address _underlyingVault) external onlyVaultManager {
        _addVault(_underlyingVault);
    }

    function _addVault(address _underlyingVault) internal virtual {
        require(IERC4626Vault(_underlyingVault).asset() == address(_asset), "Invalid vault asset");
        // TODO - should avoid adding same vault more than once

        // Get the index of the vault that is about to be added.
        uint256 vaultIndex = underlyingVaults.length;

        // Store new underlying vault in the contract.
        underlyingVaults.push(IERC4626Vault(_underlyingVault));

        // Approve the underlying vaults to transfer assets from this Meta Vault.
        _asset.safeApprove(_underlyingVault, type(uint256).max);

        emit AddedVault(vaultIndex, _underlyingVault);
    }

    /**
     * @notice  Removes an underlying ERC-4626 compliant vault.
     * All underlying shares are redeemed with the assets transferred to this vault.
     *
     * WARNING any underlying vaults after the removed vault will have their index reduced by one.
     * Off-chain processes that use underlying vault indexes will need to be updated.
     *
     * @param vaultIndex Index position of the underlying vault starting at position 0.
     */
    function removeVault(uint256 vaultIndex) external onlyGovernor {
        uint256 underlyingVaultsLen = underlyingVaults.length;
        require(vaultIndex < underlyingVaultsLen, "Invalid from vault index");

        // Withdraw all assets from the underlying vault being removed.
        uint256 underlyingShares = underlyingVaults[vaultIndex].maxRedeem(address(this));
        if (underlyingShares > 0) {
            underlyingVaults[vaultIndex].redeem(underlyingShares, address(this), address(this));
        }

        address underlyingVault = address(underlyingVaults[vaultIndex]);

        // move all vaults to the left after the vault being removed
        for (uint256 i = vaultIndex; i < underlyingVaultsLen - 1; ) {
            underlyingVaults[i] = underlyingVaults[i + 1];
            unchecked {
                ++i;
            }
        }
        underlyingVaults.pop(); // delete the last item

        emit RemovedVault(vaultIndex, underlyingVault);
    }
}
