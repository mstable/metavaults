// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { InitializableToken } from "../tokens/InitializableToken.sol";
import { VaultManagerRole } from "../shared/VaultManagerRole.sol";
import { LightAbstractVault } from "./LightAbstractVault.sol";

/**
 * @title   A minimal implementation of a ERC-4626 vault.
 * @author  mStable
 * @notice  Basic Implementation predominantly for testing purpose
 *
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-29
 */
contract LightBasicVault is LightAbstractVault, Initializable {
    using SafeERC20 for IERC20;

    /**
     * @param _nexus    Address of the Nexus contract that resolves protocol modules and roles.
     * @param _asset    Address of the vault's asset.
     */
    constructor(address _nexus, address _asset)
        LightAbstractVault(_asset)
        VaultManagerRole(_nexus)
    {}

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
        _burnOnCreate(_assetToBurn);
    }

    /**
     * @param _assetToBurn amount of assets that will be deposited and corresponding shares locked permanently
     * @dev This is to prevent against loss of precision and frontrunning the user deposits by sandwitch attack. Should be a non-trivial amount.
     */
    function _burnOnCreate(uint256 _assetToBurn) internal virtual override {
        if (_assetToBurn > 0) {
            // deposit the assets and transfer shares to the vault to lock permanently
            _deposit(_assetToBurn, address(this));
        }
    }

    /*///////////////////////////////////////////////////////////////
                        DEPOSIT/MINT
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 assets, address receiver)
        external
        virtual
        override
        whenNotPaused
        returns (uint256 shares)
    {
        shares = _deposit(assets, receiver);
    }

    function _deposit(uint256 assets, address receiver) internal virtual returns (uint256 shares) {
        shares = _previewDeposit(assets);

        _transferAndMint(assets, shares, receiver);
    }

    function previewDeposit(uint256 assets) external view override returns (uint256 shares) {
        shares = _previewDeposit(assets);
    }

    function _previewDeposit(uint256 assets) internal view virtual returns (uint256 shares) {
        shares = _convertToShares(assets, false);
    }

    function mint(uint256 shares, address receiver)
        external
        virtual
        override
        whenNotPaused
        returns (uint256 assets)
    {
        assets = _mint(shares, receiver);
    }

    function _mint(uint256 shares, address receiver) internal virtual returns (uint256 assets) {
        assets = _previewMint(shares);

        _transferAndMint(assets, shares, receiver);
    }

    function previewMint(uint256 shares) external view override returns (uint256 assets) {
        assets = _previewMint(shares);
    }

    function _previewMint(uint256 shares) internal view virtual returns (uint256 assets) {
        assets = _convertToAssets(shares, true);
    }

    /*///////////////////////////////////////////////////////////////
                        INTERNAL DEPSOIT/MINT
    //////////////////////////////////////////////////////////////*/

    function _transferAndMint(
        uint256 assets,
        uint256 shares,
        address receiver
    ) internal virtual {
        _asset.safeTransferFrom(msg.sender, address(this), assets);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /*///////////////////////////////////////////////////////////////
                        WITHDRAW/REDEEM
    //////////////////////////////////////////////////////////////*/

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external virtual override whenNotPaused returns (uint256 shares) {
        shares = _withdraw(assets, receiver, owner);
    }

    function _withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) internal virtual returns (uint256 shares) {
        shares = _previewWithdraw(assets);

        _burnTransfer(assets, shares, receiver, owner);
    }

    function previewWithdraw(uint256 assets) external view override returns (uint256 shares) {
        shares = _previewWithdraw(assets);
    }

    function _previewWithdraw(uint256 assets) internal view virtual returns (uint256 shares) {
        shares = _convertToShares(assets, true);
    }

    function maxWithdraw(address owner) external view override returns (uint256 maxAssets) {
        maxAssets = _maxWithdraw(owner);
    }

    function _maxWithdraw(address owner) internal view virtual returns (uint256 maxAssets) {
        if (paused()) {
            return 0;
        }
        
        maxAssets = _previewRedeem(balanceOf(owner));
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external virtual override whenNotPaused returns (uint256 assets) {
        assets = _redeem(shares, receiver, owner);
    }

    function _redeem(
        uint256 shares,
        address receiver,
        address owner
    ) internal virtual returns (uint256 assets) {
        assets = _previewRedeem(shares);

        _burnTransfer(assets, shares, receiver, owner);
    }

    function previewRedeem(uint256 shares) external view override returns (uint256 assets) {
        assets = _previewRedeem(shares);
    }

    function _previewRedeem(uint256 shares) internal view virtual returns (uint256 assets) {
        assets = _convertToAssets(shares, false);
    }

    /*///////////////////////////////////////////////////////////////
                        INTERNAL WITHDRAW/REDEEM
    //////////////////////////////////////////////////////////////*/

    function _burnTransfer(
        uint256 assets,
        uint256 shares,
        address receiver,
        address owner
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
                            EXTENRAL ASSETS
    //////////////////////////////////////////////////////////////*/

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = _asset.balanceOf(address(this));
    }

    /*///////////////////////////////////////////////////////////////
                            CONVERTIONS
    //////////////////////////////////////////////////////////////*/

    function convertToAssets(uint256 shares)
        external
        view
        virtual
        override
        returns (uint256 assets)
    {
        assets = _convertToAssets(shares, false);
    }

    function _convertToAssets(uint256 shares, bool isRoundUp) internal view virtual returns (uint256 assets) {
        uint256 totalShares = totalSupply();

        if (totalShares == 0) {
            assets = shares; // 1:1 value of shares and assets
        } else {
            uint256 totalAssetsMem = totalAssets();
            assets = (shares * totalAssetsMem) / totalShares;
            if (isRoundUp && mulmod(shares, totalAssetsMem, totalShares) > 0) {
                assets += 1;
            }
        }
    }

    function convertToShares(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = _convertToShares(assets, false);
    }

    function _convertToShares(uint256 assets, bool isRoundUp) internal view virtual returns (uint256 shares) {
        uint256 totalShares = totalSupply();

        if (totalShares == 0) {
            shares = assets; // 1:1 value of shares and assets
        } else {
            uint256 totalAssetsMem = totalAssets();
            shares = (assets * totalShares) / totalAssetsMem;
            if (isRoundUp && mulmod(assets, totalShares, totalAssetsMem) > 0) {
                shares += 1;
            }
        }
    }
}
