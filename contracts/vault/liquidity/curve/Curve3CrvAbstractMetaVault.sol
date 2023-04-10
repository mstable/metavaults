// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// Libs
import { AbstractSlippage } from "../AbstractSlippage.sol";
import { ICurveAddressProvider } from "../../../peripheral/Curve/ICurveAddressProvider.sol";
import { ICurveRegistryContract } from "../../../peripheral/Curve/ICurveRegistryContract.sol";
import { ICurve3Pool } from "../../../peripheral/Curve/ICurve3Pool.sol";
import { LightAbstractVault, IERC20 } from "../../LightAbstractVault.sol";
import { IERC4626Vault } from "../../../interfaces/IERC4626Vault.sol";
import { Curve3PoolCalculatorLibrary } from "../../../peripheral/Curve/Curve3PoolCalculatorLibrary.sol";

/**
 * @title  Abstract ERC-4626 vault with one of DAI/USDC/USDT asset invested in 3Pool, and then deposited in Meta Vault.
 * @notice One of DAI/USDC/USDT token is deposited in 3Pool to get a 3Pool LP token,
 *  which is deposited into a 3Pool Gauge for rewards.
 *
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-06-02
 *
 * The constructor of implementing contracts need to call the following:
 * - VaultManagerRole(_nexus)
 * - AbstractSlippage(_slippageData)
 * - AbstractVault(_assetArg)
 * - Curve3CrvAbstractMetaVault(_asset, _metaVault)
 *
 * The `initialize` function of implementing contracts need to call the following:
 * - InitializableToken._initialize(_name, _symbol, decimals)
 * - VaultManagerRole._initialize(_vaultManager)
 * - Curve3CrvAbstractMetaVault._initialize()
 */
abstract contract Curve3CrvAbstractMetaVault is AbstractSlippage, LightAbstractVault {
    using SafeERC20 for IERC20;

    /// @notice Scale of one asset. eg 1e18 if asset has 18 decimal places.
    uint256 public immutable assetScale;
    /// @notice Converts USD value with 18 decimals back down to asset/vault scale.
    /// For example, convert 18 decimal USD value back down to USDC which only has 6 decimal places.
    /// Will be 1 for DAI, 1e12 for USDC and USDT.
    uint256 public immutable assetFromUsdScale;

    /// @notice Scale of the Curve.fi 3Crv token. 1e18 = 18 decimal places
    uint256 public constant threeCrvTokenScale = 1e18;
    /// @notice Address of the underlying Meta Vault that implements ERC-4626.
    IERC4626Vault public immutable metaVault;

    /// @notice The index of underlying asset DAI, USDC or USDT in 3Pool. DAI = 0, USDC = 1 and USDT = 2
    uint256 public immutable assetPoolIndex;

    /// @param _asset     Address of the vault's asset which is one of the 3Pool tokens DAI, USDC or USDT.
    /// @param _metaVault Address of the vault's underlying meta vault that implements ERC-4626.
    constructor(address _asset, address _metaVault) {
        require(_metaVault != address(0), "Invalid Vault");
        metaVault = IERC4626Vault(_metaVault);

        // Set underlying asset scales
        uint256 _decimals = IERC20Metadata(_asset).decimals();
        assetScale = 10**_decimals;
        assetFromUsdScale = (10**(18 - _decimals));

        uint256 _assetPoolIndex = 4;
        if (ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).coins(0) == address(_asset))
            _assetPoolIndex = 0;
        else if (ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).coins(1) == address(_asset))
            _assetPoolIndex = 1;
        else if (ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).coins(2) == address(_asset))
            _assetPoolIndex = 2;
        require(_assetPoolIndex < 3, "Underlying asset not in 3Pool");
        assetPoolIndex = _assetPoolIndex;
    }

    /// @dev approve 3Pool and the Meta Vault to transfer assets and 3Crv from this vault.
    function _initialize() internal virtual {
        _resetAllowances();
    }

    /***************************************
                    Valuations
    ****************************************/

    /**
     * @notice Calculates the vault's total assets by extrapolating the asset tokens (DAI, USDC or USDT) received
     * from redeeming one Curve 3Pool LP token (3Crv) by the amount of 3Crv in the underlying Meta Vault.
     * This takes into account Curve 3Pool token balances but does not take into account any slippage.
     * Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (DAI, USDC or USDT)
     * @return totalManagedAssets Amount of assets managed by the vault.
     */
    function totalAssets() public view virtual override returns (uint256 totalManagedAssets) {
        // Get the amount of underying meta vault shares held by this vault.
        uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
        if (totalMetaVaultShares > 0) {
            // Convert underlying meta vault shares to 3Crv
            // This uses the Metapool and 3Pool virtual prices
            uint256 threeCrvTokens = metaVault.convertToAssets(totalMetaVaultShares);

            // Convert 3Crv to vault assets (DAI, USDC or USDT)
            totalManagedAssets = _getAssetsForThreeCrvTokens(threeCrvTokens);
        }
    }

    /***************************************
                Deposit functions
    ****************************************/

    /**
     * @notice Overrides the standard ERC-4626 deposit with an allowed slippage in basis points.
     * Adds vault asset (DAI, USDC or USDT) into Curve 3Pool and
     * deposits the liquidity provider token (3Crv) into the underlying 3Crv based meta vault.
     * @dev Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
     * @param assets The amount of underlying assets to be transferred to the vault.
     * @param receiver The account that the vault shares will be minted to.
     * @param slippage Deposit slippage in basis points i.e. 1% = 100.
     * @return shares The amount of vault shares that were minted.
     */
    function deposit(
        uint256 assets,
        address receiver,
        uint256 slippage
    ) external virtual whenNotPaused returns (uint256 shares) {
        shares = _depositInternal(assets, receiver, slippage);
    }

    /**
     * @notice  Mint vault shares to receiver by transferring exact amount of underlying asset tokens from the caller.
     * Adds vault asset (DAI, USDC or USDT) into Curve 3Pool and deposits the liquidity provider token (3Crv)
     * into the underlying 3Crv based meta vault.
     * @dev Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
     * @param assets The amount of underlying assets to be transferred to the vault.
     * @param receiver The account that the vault shares will be minted to.
     * @return shares The amount of vault shares that were minted.
     */
    function deposit(uint256 assets, address receiver)
        external
        virtual
        override
        whenNotPaused
        returns (uint256 shares)
    {
        shares = _depositInternal(assets, receiver, depositSlippage);
    }

    /// @dev Converts vault assets to shares in three steps:
    /// Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
    function _depositInternal(
        uint256 _assets,
        address _receiver,
        uint256 _slippage
    ) internal virtual returns (uint256 shares) {
        // Transfer this vault's asssets (DAI, USDC or USDT) from the caller
        _asset.safeTransferFrom(msg.sender, address(this), _assets);

        // Get this vault's balance of underlying Meta Vault shares before deposit.
        uint256 metaVaultSharesBefore = metaVault.balanceOf(address(this));

        // Calculate fair amount of 3Pool LP tokens (3Crv) using virtual prices for vault assets, eg DAI
        uint256 minThreeCrvTokens = _getThreeCrvTokensForAssets(_assets);
        // Calculate min amount of metapool LP tokens with max slippage
        // This is used for sandwich attack protection
        minThreeCrvTokens = (minThreeCrvTokens * (BASIS_SCALE - _slippage)) / BASIS_SCALE;

        // Deposit asset (DAI, USDC or USDT) into 3Pool and then deposit into underlying meta vault.
        uint256 metaVaultSharesReceived = _addAndDeposit(_assets, minThreeCrvTokens);

        // Calculate the proportion of shares to mint based on the amount of underlying meta vault shares.
        shares = _getSharesFromMetaVaultShares(
            metaVaultSharesReceived,
            metaVaultSharesBefore,
            totalSupply()
        );

        _mint(_receiver, shares);

        emit Deposit(msg.sender, _receiver, _assets, shares);
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their deposit at the current transaction, given current on-chain conditions.
     * @param assets The amount of underlying assets to be transferred.
     * @return shares The amount of vault shares that will be minted.
     * @dev Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
     */
    function previewDeposit(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = _previewDeposit(assets);
    }

    function _previewDeposit(uint256 assets) internal view virtual returns (uint256 shares) {
        if (assets > 0) {
            // Calculate Meta Vault assets (3Crv) for this vault's asset (DAI, USDC, USDT)
            (uint256 threeCrvTokens, , ) = Curve3PoolCalculatorLibrary.calcDeposit(
                assets,
                assetPoolIndex
            );

            // Calculate underlying meta vault shares received for Meta Vault assets (3Crv)
            uint256 metaVaultShares = metaVault.previewDeposit(threeCrvTokens);

            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            // Calculate the proportion of shares to mint based on the amount of underlying meta vault shares.
            shares = _getSharesFromMetaVaultShares(
                metaVaultShares,
                totalMetaVaultShares,
                totalSupply()
            );
        }
    }

    /***************************************
                Mint functions
    ****************************************/

    /**
     * @notice Mint exact amount of vault shares to the receiver by transferring enough underlying asset tokens from the caller.
     * Adds vault asset (DAI, USDC or USDT) into Curve 3Pool and deposits the liquidity provider token (3Crv)
     * into the underlying 3Crv based meta vault.
     * @param shares The amount of vault shares to be minted.
     * @param receiver The account the vault shares will be minted to.
     * @return assets The amount of underlying assets that were transferred from the caller.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (eg DAI)
     */
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
        // Get the total underlying Meta Vault shares held by this vault.
        uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
        // Convert this vault's required shares to required underlying meta vault shares.
        uint256 requiredMetaVaultShares = _getMetaVaultSharesFromShares(
            shares,
            totalMetaVaultShares,
            totalSupply()
        );

        // Calculate 3Crv needed to mint the required Meta Vault shares
        // There is no sandwich protection on underlying Meta Vault deposits as
        // the 3Crv is not converted to Curve Metapool LP tokens until a later settle process.
        uint256 requiredThreeCrvTokens = metaVault.previewMint(requiredMetaVaultShares);

        // Calculate assets (DAI, USDC or USDT) needed to mint the required amount of shares
        uint256 invariant;
        uint256 total3CrvSupply;
        (assets, invariant, total3CrvSupply) = Curve3PoolCalculatorLibrary.calcMint(
            requiredThreeCrvTokens,
            assetPoolIndex
        );

        // Protect against sandwich and flash loan attacks where the balance of the 3Pool can be manipulated.
        // Calculate fair USD amount to mint required 3Crv.
        // Unscaled 3Pool virtual price (3Crv/USD) = pool invariant (USD value) / total supply of LP token (3Crv).
        // USD amount = 3Crv amount * pool invariant (USD value) / total supply of LP token (3Crv)
        uint256 maxAssets = (requiredThreeCrvTokens * invariant) / total3CrvSupply;
        // Max USD = USD amount + (1 + mint slippage). So for 1% slippage, USD amount * 1.01
        // We will assume 1 DAI is close to 1 USD so max USD = max assets (DAI, USDC or USDT).
        maxAssets = (maxAssets * (BASIS_SCALE + mintSlippage)) / BASIS_SCALE;
        require(assets <= maxAssets, "too much slippage");

        // Transfer this vault's asssets (DAI, USDC or USDT) from the caller.
        _asset.safeTransferFrom(msg.sender, address(this), assets);

        // Deposit asset (DAI, USDC or USDT) into 3Pool and then deposit into underlying meta vault.
        _addAndDeposit(assets, requiredThreeCrvTokens);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their mint at the current transaction, given current on-chain conditions.
     * @param shares The amount of vault shares to be minted.
     * @return assets The amount of each underlying assest tokens that will be transferred from the caller.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (eg DAI)
     */
    function previewMint(uint256 shares) external view virtual override returns (uint256 assets) {
        assets = _previewMint(shares);
    }

    function _previewMint(uint256 shares) internal view virtual returns (uint256 assets) {
        if (shares > 0) {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            // Convert this vault's required shares to required underlying meta vault shares.
            uint256 requiredMetaVaultShares = _getMetaVaultSharesFromShares(
                shares,
                totalMetaVaultShares,
                totalSupply()
            );

            // Calculate 3Crv needed to mint the required Meta Vault shares
            uint256 requiredThreeCrvTokens = metaVault.previewMint(requiredMetaVaultShares);

            // Calculate assets (DAI, USDC or USDT) needed to mint the required amount of shares
            (assets, , ) = Curve3PoolCalculatorLibrary.calcMint(
                requiredThreeCrvTokens,
                assetPoolIndex
            );
        }
    }

    /***************************************
                Withdraw functions
    ****************************************/

    /**
     * @notice Burns enough vault shares from owner and transfers the exact amount of each underlying asset tokens to the receiver.
     * Withdraws 3Crv from underlying meta vault and then removes stablecoin (DAI, USDC or USDT) from the Curve 3Pool.
     * @param assets The amount of each underlying asset tokens to be withdrawn from the vault.
     * @param receiver The account that each underlying asset will be transferred to.
     * @param owner Account that owns the vault shares to be burnt.
     * @return shares The amount of vault shares that were burnt.
     * @dev Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
     */
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
        if (assets > 0) {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultSharesBefore = metaVault.balanceOf(address(this));

            // Calculate 3Pool LP tokens (3Crv) required for this vault's asset (DAI, USDC or USDT).
            (
                uint256 requiredThreeCrvTokens,
                uint256 invariant,
                uint256 total3CrvSupply
            ) = Curve3PoolCalculatorLibrary.calcWithdraw(assets, assetPoolIndex);

            // Withdraw 3Crv from underlying meta vault.
            uint256 metaVaultShares = metaVault.withdraw(
                requiredThreeCrvTokens,
                address(this),
                address(this)
            );

            // Calculate the proportion of shares to burn based on the amount of underlying meta vault shares.
            shares = _getSharesFromMetaVaultShares(
                metaVaultShares,
                totalMetaVaultSharesBefore,
                totalSupply()
            );

            // If caller is not the owner of the shares
            uint256 allowed = allowance(owner, msg.sender);
            if (msg.sender != owner && allowed != type(uint256).max) {
                require(shares <= allowed, "Amount exceeds allowance");
                _approve(owner, msg.sender, allowed - shares);
            }

            // Block scoping to workaround stack too deep
            {
                // Protect against sandwich and flash loan attacks where the balance of the 3Pool can be manipulated.
                // Calculate fair USD amount to withdraw required 3Crv.
                // Unscaled 3Pool virtual price (3Crv/USD) = pool invariant (USD value) / total supply of LP token (3Crv).
                // USD amount = 3Crv amount * pool invariant (USD value) / total supply of LP token (3Crv)
                uint256 minAssets = (requiredThreeCrvTokens * invariant) / total3CrvSupply;
                // Max USD = USD amount + (1 - withdraw slippage). So for 1% slippage, USD amount * 0.99
                // We will assume 1 DAI is close to 1 USD so min USD = min assets (DAI, USDC or USDT).
                minAssets = (minAssets * (BASIS_SCALE - withdrawSlippage)) / BASIS_SCALE;
                // USD value is scaled to 18 decimals, it needs to be scaled to asset decimals.
                minAssets = minAssets / assetFromUsdScale;
                require(assets >= minAssets, "too much slippage");

                uint256[3] memory assetsArray;
                assetsArray[assetPoolIndex] = assets;
                // Burn 3Pool LP tokens (3Crv) and receive this vault's asset (DAI, USDC or USDT).
                ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).remove_liquidity_imbalance(
                    assetsArray,
                    requiredThreeCrvTokens
                );
            }

            // Burn the owner's vault shares
            _burn(owner, shares);

            // Transfer this vault's asssets (DAI, USDC or USDT) to the receiver.
            _asset.safeTransfer(receiver, assets);

            emit Withdraw(msg.sender, receiver, owner, assets, shares);
        }
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current transaction, given current on-chain conditions.
     * @param assets The amount of each underlying asset tokens to be withdrawn.
     * @return shares The amount of vault shares that will be burnt.
     * @dev Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
     */
    function previewWithdraw(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        shares = _previewWithdraw(assets);
    }

    function _previewWithdraw(uint256 assets) internal view virtual returns (uint256 shares) {
        if (assets > 0) {
            // Calculate 3Pool LP tokens (3Crv) for this vault's asset (DAI, USDC or USDT).
            (uint256 threeCrvTokens, , ) = Curve3PoolCalculatorLibrary.calcWithdraw(
                assets,
                assetPoolIndex
            );

            // Calculate underlying meta vault shares received for 3Pool LP tokens (3Crv)
            uint256 metaVaultShares = metaVault.previewWithdraw(threeCrvTokens);

            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            // Calculate the proportion of shares to burn based on the amount of underlying meta vault shares.
            shares = _getSharesFromMetaVaultShares(
                metaVaultShares,
                totalMetaVaultShares,
                totalSupply()
            );
        }
    }

    /**
     * @notice The maximum number of underlying assets that owner can withdraw.
     * @param owner Account that owns the vault shares.
     * @return maxAssets The maximum amount of underlying assets the owner can withdraw.
     */
    function maxWithdraw(address owner) external view virtual override returns (uint256 maxAssets) {
        if (paused()) {
            return 0;
        }

        maxAssets = _previewRedeem(balanceOf(owner));
    }

    /***************************************
                Redeem functions
    ****************************************/

    /**
     * @notice Standard EIP-4626 redeem.
     * Redeems 3Crv from underlying meta vault and then removes stablecoin from the Curve 3Pool.
     * @param shares The amount of vault shares to be burnt.
     * @param receiver The account the underlying assets will be transferred to.
     * @param owner The account that owns the vault shares to be burnt.
     * @return assets The amount of underlying assets that were transferred to the receiver.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (eg DAI)
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external virtual override whenNotPaused returns (uint256 assets) {
        assets = _redeemInternal(shares, receiver, owner, redeemSlippage);
    }

    /**
     * @notice Overloaded standard ERC-4626 `redeem` method with custom slippage.
     * This can be used in the event of the asset depegging from 1 USD.
     * @param shares The amount of vault shares to be burnt.
     * @param receiver The account the underlying assets will be transferred to.
     * @param owner The account that owns the vault shares to be burnt.
     * @param customRedeemSlippage Redeem slippage in basis points i.e. 1% = 100.
     * @return assets The amount of underlying assets that were transferred to the receiver.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (eg DAI)
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        uint256 customRedeemSlippage
    ) external virtual whenNotPaused returns (uint256 assets) {
        assets = _redeemInternal(shares, receiver, owner, customRedeemSlippage);
    }

    /// @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (eg DAI)
    function _redeemInternal(
        uint256 _shares,
        address _receiver,
        address _owner,
        uint256 _slippage
    ) internal virtual returns (uint256 assets) {
        if (_shares > 0) {
            uint256 allowed = allowance(_owner, msg.sender);
            if (msg.sender != _owner && allowed != type(uint256).max) {
                require(_shares <= allowed, "Amount exceeds allowance");
                _approve(_owner, msg.sender, allowed - _shares);
            }

            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            // Convert this vault's shares to underlying meta vault shares.
            uint256 metaVaultShares = _getMetaVaultSharesFromShares(
                _shares,
                totalMetaVaultShares,
                totalSupply()
            );

            // Burn underlying meta vault shares and receive 3Pool LP tokens (3Crv).
            uint256 threeCrvTokens = metaVault.redeem(
                metaVaultShares,
                address(this),
                address(this)
            );

            // Protect against sandwich and flash loan attacks where the balance of the 3Pool can be manipulated.
            // Get virtual price of Curve 3Pool LP tokens (3Crv) in USD.
            uint256 virtualPrice = Curve3PoolCalculatorLibrary.getVirtualPrice();

            // Calculate fair USD amount for burning 3Crv.
            // 3Pool virtual price (3Crv/USD) = pool invariant (USD value) * virtual price scale / total supply of LP token (3Crv).
            // 3Crv amount = USD amount * 3Pool virtual price / virtial price scale
            // USD amount = 3Crv amount * virtial price scale / 3Pool virtual price
            uint256 minAssets = (threeCrvTokens * Curve3PoolCalculatorLibrary.VIRTUAL_PRICE_SCALE) /
                virtualPrice;
            // Min USD = USD amount + (1 - mint slippage). So for 1% slippage, USD amount * 0.99
            // We will assume 1 DAI is close to 1 USD so min USD = min assets (DAI, USDC or USDT).
            minAssets = (minAssets * (BASIS_SCALE - _slippage)) / BASIS_SCALE;
            // USD value is scaled to 18 decimals, it needs to be scaled to asset decimals.
            minAssets = minAssets / assetFromUsdScale;

            // Burn 3Pool LP tokens (3Crv) and receive this vault's asset (DAI, USDC or USDT).
            ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).remove_liquidity_one_coin(
                threeCrvTokens,
                int128(uint128(assetPoolIndex)),
                minAssets
            );

            _burn(_owner, _shares);

            // Need to get how many assets was withdrawn from the 3Pool as it will be more than
            // the assets amount passed into this function for redeem()
            assets = _asset.balanceOf(address(this));

            // Transfer this vault's asssets (DAI, USDC or USDT) to the receiver.
            _asset.safeTransfer(_receiver, assets);

            emit Withdraw(msg.sender, _receiver, _owner, assets, _shares);
        }
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their redeemption at the current transaction, given current on-chain conditions.
     * @param shares The amount of vault shares to be burnt.
     * @return assets The amount of each underlying assest tokens that will transferred to the receiver.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (eg DAI)
     */
    function previewRedeem(uint256 shares) external view virtual override returns (uint256 assets) {
        assets = _previewRedeem(shares);
    }

    function _previewRedeem(uint256 shares) internal view virtual returns (uint256 assets) {
        if (shares > 0) {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));

            // Convert this vault's shares to underlying meta vault shares.
            uint256 metaVaultShares = _getMetaVaultSharesFromShares(
                shares,
                totalMetaVaultShares,
                totalSupply()
            );

            // Convert underlying meta vault shares to 3Pool LP tokens (3Crv).
            uint256 threeCrvTokens = metaVault.previewRedeem(metaVaultShares);

            // Convert 3Pool LP tokens (3Crv) to assets (DAI, USDC or USDT).
            (assets, , ) = Curve3PoolCalculatorLibrary.calcRedeem(threeCrvTokens, assetPoolIndex);
        }
    }

    /*///////////////////////////////////////////////////////////////
                            CONVERTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice The amount of assets that the Vault would exchange for the amount of shares provided, in an ideal scenario where all the conditions are met.
     * @param shares The amount of vault shares to be converted to the underlying assets.
     * @return assets The amount of underlying assets converted from the vault shares.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (3Crv) -> vault assets (DAI, USDC or USDT)
     */
    function convertToAssets(uint256 shares)
        external
        view
        virtual
        override
        returns (uint256 assets)
    {
        uint256 metaVaultShares;
        uint256 totalShares = totalSupply();
        if (totalShares == 0) {
            // start with 1:1 value of shares to underlying meta vault shares
            metaVaultShares = shares;
        } else {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            // Convert this vault's shares to underlying meta vault shares.
            metaVaultShares = _getMetaVaultSharesFromShares(
                shares,
                totalMetaVaultShares,
                totalShares
            );
        }

        // Convert underlying meta vault shares to 3Crv
        // This uses the Metapool and 3Pool virtual prices
        uint256 threeCrvTokens = metaVault.convertToAssets(metaVaultShares);
        // Convert 3Crv to assets (DAI, USDC or USDT) by extrapolating redeeming 1 3Crv.
        assets = _getAssetsForThreeCrvTokens(threeCrvTokens);
    }

    /**
     * @notice The amount of shares that the Vault would exchange for the amount of assets provided, in an ideal scenario where all the conditions are met.
     * @param assets The amount of underlying assets to be convert to vault shares.
     * @return shares The amount of vault shares converted from the underlying assets.
     * @dev Vault assets (DAI, USDC or USDT) -> Meta Vault assets (3Crv) -> Meta Vault shares -> this vault's shares
     */
    function convertToShares(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        // Calculate fair amount of 3Pool LP tokens (3Crv) using virtual prices for vault assets, eg DAI
        uint256 threeCrvTokens = _getThreeCrvTokensForAssets(assets);

        // Convert 3Crv to underlying meta vault shares.
        // This uses the Metapool and 3Pool virtual prices.
        uint256 metaVaultShares = metaVault.convertToShares(threeCrvTokens);

        uint256 totalShares = totalSupply();
        if (totalShares == 0) {
            // start with 1:1 value of shares to underlying meta vault shares
            shares = metaVaultShares;
        } else {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            shares = _getSharesFromMetaVaultShares(
                metaVaultShares,
                totalMetaVaultShares,
                totalShares
            );
        }
    }

    /***************************************
                    Utility
    ****************************************/

    /// @dev Deposit asset (DAI, USDC or USDT) into 3Pool and then deposit 3Crv into underlying meta vault.
    function _addAndDeposit(uint256 _assets, uint256 _minThreeCrvTokens)
        internal
        returns (uint256 metaVaultShares_)
    {
        // Get asset array of underlying to be deposited in the pool
        uint256[3] memory assetsArray;
        assetsArray[assetPoolIndex] = _assets;

        // Add assets, eg DAI, to the 3Pool and receive 3Pool LP tokens (3Crv)
        ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).add_liquidity(
            assetsArray,
            _minThreeCrvTokens
        );

        // Deposit 3Crv into the underlying meta vault and receive meta vault shares.
        // This assumes there is no 3Crv sitting in this vault. If there is, the caller will get extra vault shares.
        // Meta Vault deposits do not need sandwich attack protection.
        metaVaultShares_ = metaVault.deposit(
            IERC20(Curve3PoolCalculatorLibrary.LP_TOKEN).balanceOf(address(this)),
            address(this)
        );
    }

    /// @dev Utility function to convert 3Crv tokens to expected asset tokens (DAI, USDC or USDT) from Curve's 3Pool.
    /// Extrapolates assets received for redeeming on 3Pool LP token (3Crv).
    /// @param _threeCrvTokens Amount of 3Crv tokens to burn.
    /// @return expectedAssets Amount of asset tokens expected from Curve 3Pool.
    function _getAssetsForThreeCrvTokens(uint256 _threeCrvTokens)
        internal
        view
        returns (uint256 expectedAssets)
    {
        if (_threeCrvTokens > 0) {
            // convert 1 3Crv to the vault assets (DAI, USDC or USDT) per 3Crv
            (uint256 assetsPer3Crv, , ) = Curve3PoolCalculatorLibrary.calcRedeem(
                threeCrvTokenScale,
                assetPoolIndex
            );
            // Convert 3Crv amount to assets (DAI, USDC or USDT)
            expectedAssets = (_threeCrvTokens * assetsPer3Crv) / threeCrvTokenScale;
        }
    }

    /// @dev Utility function to convert asset (DAI, USDC or USDT) amount to fair 3Crv token amount.
    /// @param _assetsAmount Amount of assets (DAI, USDC or USDT) to burn.
    /// @return expectedthreeCrvTokens Fair amount of 3Crv tokens expected from Curve 3Pool.
    function _getThreeCrvTokensForAssets(uint256 _assetsAmount)
        internal
        view
        returns (uint256 expectedthreeCrvTokens)
    {
        // Curve 3Pool lp token virtual price which is the price of one scaled 3Crv (USD/3Crv). Non-manipulable
        uint256 lpVirtualPrice = Curve3PoolCalculatorLibrary.getVirtualPrice();

        // Amount of 3Pool lp tokens (3Crv) corresponding to asset tokens (DAI, USDC or USDT)
        // Assume 1 DAI == 1 USD
        // 3Crv amount = DAI amount / 3Crv/USD virtual price
        expectedthreeCrvTokens =
            (Curve3PoolCalculatorLibrary.VIRTUAL_PRICE_SCALE * _assetsAmount * threeCrvTokenScale) /
            (lpVirtualPrice * assetScale);
    }

    /// @param _metaVaultShares Underlying vault shares from deposit or withdraw.
    /// @param _totalMetaVaultShares Total number of Underlying vault shares owned by this vault.
    /// @param _totalShares Total shares of this vault before deposit or withdraw.
    /// @return shares Vault shares for deposit or withdraw.
    function _getSharesFromMetaVaultShares(
        uint256 _metaVaultShares,
        uint256 _totalMetaVaultShares,
        uint256 _totalShares
    ) internal pure returns (uint256 shares) {
        if (_totalMetaVaultShares == 0) {
            shares = _metaVaultShares;
        } else {
            shares = (_metaVaultShares * _totalShares) / _totalMetaVaultShares;
        }
    }

    function _getMetaVaultSharesFromShares(
        uint256 _shares,
        uint256 _totalMetaVaultShares,
        uint256 _totalShares
    ) internal pure returns (uint256 metaVaultShares) {
        if (_totalShares == 0) {
            metaVaultShares = _shares;
        } else {
            metaVaultShares = (_shares * _totalMetaVaultShares) / _totalShares;
        }
    }

    /***************************************
                    Emergency Functions
    ****************************************/
    function _liquidateVault(uint256 minAssets, bool transferToGovernor) internal {
        uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));

        metaVault.redeem(totalMetaVaultShares, address(this), address(this));

        ICurve3Pool(Curve3PoolCalculatorLibrary.THREE_POOL).remove_liquidity_one_coin(
            IERC20(Curve3PoolCalculatorLibrary.LP_TOKEN).balanceOf(address(this)),
            int128(uint128(assetPoolIndex)),
            minAssets
        );
        if (transferToGovernor) {
            _asset.safeTransfer(_governor(), _asset.balanceOf(address(this)));
        }
    }

    /**
     * @notice Governor liquidates all the vault's assets and send to the governor.
     * Only to be used in an emergency. eg whitehat protection against a hack.
     * @param minAssets Minimum amount of asset tokens to receive from removing liquidity from the Curve 3Pool.
     * This provides sandwich attack protection.
     */
    function liquidateVault(uint256 minAssets) external virtual onlyGovernor {
        _liquidateVault(minAssets, true);
    }

    /***************************************
                    Set Vault Parameters
    ****************************************/

    /// @notice Approves Curve's 3Pool contract to transfer assets (DAI, USDC or USDT) from this vault.
    /// Also approves the underlying Meta Vault to transfer 3Crv from this vault.
    function resetAllowances() external virtual onlyGovernor {
        _resetAllowances();
    }

    /// @dev Approves Curve's 3Pool contract to transfer assets (DAI, USDC or USDT) from this vault.
    /// Also approves the underlying Meta Vault to transfer 3Crv from this vault.
    function _resetAllowances() internal {
        _asset.safeApprove(address(Curve3PoolCalculatorLibrary.THREE_POOL), 0);
        IERC20(Curve3PoolCalculatorLibrary.LP_TOKEN).safeApprove(address(metaVault), 0);

        _asset.safeApprove(address(Curve3PoolCalculatorLibrary.THREE_POOL), type(uint256).max);
        IERC20(Curve3PoolCalculatorLibrary.LP_TOKEN).safeApprove(
            address(metaVault),
            type(uint256).max
        );
    }
}
