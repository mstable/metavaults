// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import { AbstractVault } from "../AbstractVault.sol";

/**
 * @title   Abstract ERC-4626 vault that maintains an `assetPerShare` ratio for vault operations (deposit, mint, withdraw and redeem).
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-02-10
 *
 * The following functions have to be implemented
 * - totalAssets()
 * - the token functions on `AbstractToken`.
 *
 * The following functions have to be called by implementing contract.
 * - constructor
 *   - AbstractVault(_asset)
 *   - VaultManagerRole(_nexus)
 * - VaultManagerRole._initialize(_vaultManager)
 * - AssetPerShareAbstractVault._initialize()
 */
abstract contract AssetPerShareAbstractVault is AbstractVault {
    /// @notice Scale of the assets per share. 1e26 = 26 decimal places
    uint256 public constant ASSETS_PER_SHARE_SCALE = 1e26;

    /// @notice Assets per share scaled to 26 decimal places.
    uint256 public assetsPerShare;

    /// @dev initialize the starting assets per share.
    function _initialize() internal virtual {
        assetsPerShare = ASSETS_PER_SHARE_SCALE;
    }

    /**
     * @dev Calculate the amount of shares to mint to the receiver.
     * Use the assets per share value from the last settlement
     */
    function _previewDeposit(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = _convertToShares(assets);
    }

    /**
     * @dev Calculate the amount of assets to transfer from the caller.
     * Use the assets per share value from the last settlement
     */
    function _previewMint(uint256 shares) internal view virtual override returns (uint256 assets) {
        assets = _convertToAssets(shares);
    }

    /**
     * @dev Calculate the amount of shares to burn from the owner.
     * Use the assets per share value from the last settlement
     */
    function _previewWithdraw(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = _convertToShares(assets);
    }

    /**
     * @dev Calculate the amount of assets to transfer to the receiver.
     * Use the assets per share value from the last settlement
     */
    function _previewRedeem(uint256 shares)
        internal
        view
        virtual
        override
        returns (uint256 assets)
    {
        assets = _convertToAssets(shares);
    }

    /*///////////////////////////////////////////////////////////////
                            CONVERTIONS
    //////////////////////////////////////////////////////////////*/

    /// @dev uses the stored `assetsPerShare` to convert shares to assets.
    function _convertToAssets(uint256 shares)
        internal
        view
        virtual
        override
        returns (uint256 assets)
    {
        assets = (shares * assetsPerShare) / ASSETS_PER_SHARE_SCALE;
    }

    /// @dev uses the stored `assetsPerShare` to convert assets to shares.
    function _convertToShares(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = (assets * ASSETS_PER_SHARE_SCALE) / assetsPerShare;
    }
}
