// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { AbstractSlippage } from "../AbstractSlippage.sol";
import { LightAbstractVault } from "../../LightAbstractVault.sol";
import { Curve3CrvAbstractMetaVault } from "./Curve3CrvAbstractMetaVault.sol";
import { VaultManagerRole } from "../../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../../tokens/InitializableToken.sol";

/**
 * @title   Basic 3Pool ERC-4626 vault that takes in one underlying asset to deposit in 3Pool and put the 3Crv in underlying metaVault.
 * @notice  Disables permanently mints and deposits, allows to liquidate underlying vaults.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-11
 */
contract Curve3CrvBasicMetaVault is Curve3CrvAbstractMetaVault, Initializable {
    using SafeERC20 for IERC20;

    /// @param _nexus         Address of the Nexus contract that resolves protocol modules and roles..
    /// @param _asset         Address of the vault's asset which is one of the 3Pool tokens DAI, USDC or USDT.
    /// @param _metaVault     Address of the vault's underlying meta vault that implements ERC-4626.
    constructor(
        address _nexus,
        address _asset,
        address _metaVault
    )
        LightAbstractVault(_asset)
        Curve3CrvAbstractMetaVault(_asset, _metaVault)
        VaultManagerRole(_nexus)
    {}

    /// @param _name          Name of vault.
    /// @param _symbol        Symbol of vault.
    /// @param _vaultManager  Trusted account that can perform vault operations. eg rebalance.
    /// @param _slippageData  Initial slippage limits.
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _vaultManager,
        SlippageData memory _slippageData
    ) external initializer {
        // Set the vault's decimals to the same as the Metapool LP token (3Crv).
        InitializableToken._initialize(_name, _symbol, 18);

        VaultManagerRole._initialize(_vaultManager);
        AbstractSlippage._initialize(_slippageData);
        Curve3CrvAbstractMetaVault._initialize();
    }

    /// @dev Overrides Curve3CrvAbstractMetaVault.totalAssets()
    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets =
            Curve3CrvAbstractMetaVault.totalAssets() +
            _asset.balanceOf(address(this));
    }

    /*///////////////////////////////////////////////////////////////
                        DEPOSIT/MINT
    //////////////////////////////////////////////////////////////*/
    /// @dev disables Curve3CrvAbstractMetaVault implementation.
    function _depositInternal(
        uint256, /** assets */
        address, /** receiver */
        uint256 /** _slippage */
    )
        internal
        virtual
        override(Curve3CrvAbstractMetaVault)
        returns (
            uint256 /** shares */
        )
    {
        revert("Vault shutdown");
    }

    function _previewDeposit(
        uint256 /** assets*/
    ) internal view virtual override returns (uint256 shares) {
        // return 0
    }

    function _maxDeposit(
        address /** caller */
    ) internal view virtual override returns (uint256 maxAssets) {
        // return 0
    }

    /// @dev disables Curve3CrvAbstractMetaVault implementation.
    function _mint(
        uint256, /** shares */
        address /** receiver */
    )
        internal
        virtual
        override(Curve3CrvAbstractMetaVault)
        returns (
            uint256 /** assets */
        )
    {
        revert("Vault shutdown");
    }

    function _previewMint(uint256 shares) internal view virtual override returns (uint256 assets) {
        // return 0
    }

    function _maxMint(
        address /** caller */
    ) internal view virtual override returns (uint256 maxShares) {
        // return 0
    }

    /*///////////////////////////////////////////////////////////////
                        WITHDRAW/REDEEM
    //////////////////////////////////////////////////////////////*/
    /// @dev Overrides Curve3CrvAbstractMetaVault._withdraw()
    function _withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) internal virtual override returns (uint256 shares) {
        shares = _previewWithdraw(assets);

        _burnTransfer(assets, shares, receiver, owner, false);
    }

    function _previewWithdraw(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = _convertToShares(assets);
    }

    /// @dev Overrides Curve3CrvAbstractMetaVault._redeemInternal()
    function _redeemInternal(
        uint256 shares,
        address receiver,
        address owner,
        uint256 /** _slippage **/
    ) internal virtual override returns (uint256 assets) {
        assets = _previewRedeem(shares);
        _burnTransfer(assets, shares, receiver, owner, true);
    }

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
                        INTERNAL WITHDRAW/REDEEM
    //////////////////////////////////////////////////////////////*/

    function _burnTransfer(
        uint256 assets,
        uint256 shares,
        address receiver,
        address owner,
        bool /** fromRedeem */
    ) internal virtual {
        // If caller is not the owner of the shares
        uint256 allowed = allowance(owner, msg.sender);
        if (msg.sender != owner && allowed != type(uint256).max) {
            require(shares <= allowed, "Amount exceeds allowance");
            _approve(owner, msg.sender, allowed - shares);
        }

        _burn(owner, shares);

        _asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /*///////////////////////////////////////////////////////////////
                            CONVERTIONS
    //////////////////////////////////////////////////////////////*/
    function _convertToShares(uint256 assets) internal view virtual returns (uint256 shares) {
        uint256 totalShares = totalSupply();

        if (totalShares == 0) {
            shares = assets; // 1:1 value of shares and assets
        } else {
            shares = (assets * totalShares) / totalAssets();
        }
    }

    function _convertToAssets(uint256 shares) internal view virtual returns (uint256 assets) {
        uint256 totalShares = totalSupply();

        if (totalShares == 0) {
            assets = shares; // 1:1 value of shares and assets
        } else {
            assets = (shares * totalAssets()) / totalShares;
        }
    }

    /**
     * @notice disables Curve3CrvAbstractMetaVault.liquidateVault(), it does nothing.
     */
    function liquidateVault(
        uint256 /**  minAssets */
    ) external view override onlyGovernor {
        revert("Vault shutdown");
    }

    /**
     * @notice Governor liquidates all underlying vaults assets.
     * @param minAssets Minimum amount of asset tokens to receive from removing liquidity from the Curve 3Pool.
     * This provides sandwich attack protection.
     */
    function liquidateUnderlyingVault(uint256 minAssets) external onlyGovernor {
        _liquidateVault(minAssets, false);
    }
}
