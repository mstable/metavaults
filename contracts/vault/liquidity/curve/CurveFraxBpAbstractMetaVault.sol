// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// Libs
import { AbstractSlippage } from "../AbstractSlippage.sol";
import { ICurveAddressProvider } from "../../../peripheral/Curve/ICurveAddressProvider.sol";
import { ICurveRegistryContract } from "../../../peripheral/Curve/ICurveRegistryContract.sol";
import { ICurveFraxBP } from "../../../peripheral/Curve/ICurveFraxBP.sol";
import { LightAbstractVault, IERC20 } from "../../LightAbstractVault.sol";
import { IERC4626Vault } from "../../../interfaces/IERC4626Vault.sol";
import { CurveFraxBpCalculatorLibrary } from "../../../peripheral/Curve/CurveFraxBpCalculatorLibrary.sol";

/**
 * @title  Abstract ERC-4626 vault with one of USDC/FRAX asset invested in FraxBp, and then deposited in Meta Vault.
 * @notice One of USDC/FRAX token is deposited in FraxBp to get a FraxBp LP token,
 *  which is deposited into the underlying metavault
 *
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-06-02
 *
 * The constructor of implementing contracts need to call the following:
 * - VaultManagerRole(_nexus)
 * - AbstractSlippage(_slippageData)
 * - AbstractVault(_assetArg)
 * - CurveFraxBpAbstractMetaVault(_asset, _metaVault)
 *
 * The `initialize` function of implementing contracts need to call the following:
 * - InitializableToken._initialize(_name, _symbol, decimals)
 * - VaultManagerRole._initialize(_vaultManager)
 * - CurveFraxBpAbstractMetaVault._initialize()
 */
abstract contract CurveFraxBpAbstractMetaVault is AbstractSlippage, LightAbstractVault {
    using SafeERC20 for IERC20;

    /// @notice Scale of one asset. eg 1e18 if asset has 18 decimal places.
    uint256 public immutable assetScale;
    /// @notice Converts USD value with 18 decimals back down to asset/vault scale.
    /// For example, convert 18 decimal USD value back down to USDC which only has 6 decimal places.
    /// Will 1e12 for USDC, and 1 for FRAX
    uint256 public immutable assetFromUsdScale;

    /// @notice Scale of the Curve.fi CrvFrax token. 1e18 = 18 decimal places
    uint256 public constant crvFraxTokenScale = 1e18;
    /// @notice Address of the underlying Meta Vault that implements ERC-4626.
    IERC4626Vault public immutable metaVault;

    /// @notice The index of underlying asset USDC or FRAX in FraxBp. FRAX = 0 and USDC = 1
    uint256 public immutable assetPoolIndex;

    /// @param _asset     Address of the vault's asset which is one of the FraxBp tokens FRAX or USDC
    /// @param _metaVault Address of the vault's underlying meta vault that implements ERC-4626.
    constructor(address _asset, address _metaVault) {
        require(_metaVault != address(0), "Invalid Vault");
        metaVault = IERC4626Vault(_metaVault);

        // Set underlying asset scales
        uint256 _decimals = IERC20Metadata(_asset).decimals();
        assetScale = 10**_decimals;
        assetFromUsdScale = (10**(18 - _decimals));

        uint256 _assetPoolIndex = 3;
        if (ICurveFraxBP(CurveFraxBpCalculatorLibrary.FRAXBP_POOL).coins(0) == address(_asset))
            _assetPoolIndex = 0;
        else if (ICurveFraxBP(CurveFraxBpCalculatorLibrary.FRAXBP_POOL).coins(1) == address(_asset))
            _assetPoolIndex = 1;
        require(_assetPoolIndex < 2, "Underlying asset not in FraxBp");
        assetPoolIndex = _assetPoolIndex;
    }

    /// @dev approve FraxBp and the Meta Vault to transfer assets and CrvFrax from this vault.
    function _initialize() internal virtual {
        _resetAllowances();
    }

    /***************************************
                    Valuations
    ****************************************/

    /**
     * @notice Calculates the vault's total assets by extrapolating the asset tokens (FRAX, USDC) received
     * from redeeming one Curve FraxBp LP token (crvFrax) by the amount of crvFrax in the underlying Meta Vault.
     * This takes into account Curve FraxBp token balances but does not take into account any slippage.
     * Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (FRAX, USDC)
     * @return totalManagedAssets Amount of assets managed by the vault.
     */
    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        // Get the amount of underying meta vault shares held by this vault.
        uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
        if (totalMetaVaultShares > 0) {
            // Convert underlying meta vault shares to crvFrax
            // This uses the Metapool and FraxBp virtual prices
            uint256 crvFraxTokens = metaVault.convertToAssets(totalMetaVaultShares);

            // Convert crvFrax to vault assets (FRAX, USDC)
            totalManagedAssets = _getAssetsForCrvFraxTokens(crvFraxTokens);
        }
    }

    /***************************************
                Deposit functions
    ****************************************/

    /**
     * @notice Overrides the standard ERC-4626 deposit with an allowed slippage in basis points.
     * Adds vault asset (FRAX, USDC) into Curve FraxBp and
     * deposits the liquidity provider token (crvFrax) into the underlying crvFrax based meta vault.
     * @dev Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
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
     * Adds vault asset (FRAX, USDC) into Curve FraxBp and deposits the liquidity provider token (crvFrax)
     * into the underlying crvFrax based meta vault.
     * @dev Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
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
    /// Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
    function _depositInternal(
        uint256 _assets,
        address _receiver,
        uint256 _slippage
    ) internal virtual returns (uint256 shares) {
        // Transfer this vault's asssets (FRAX, USDC) from the caller
        _asset.safeTransferFrom(msg.sender, address(this), _assets);

        // Get this vault's balance of underlying Meta Vault shares before deposit.
        uint256 metaVaultSharesBefore = metaVault.balanceOf(address(this));

        // Calculate fair amount of FraxBp LP tokens (crvFrax) using virtual prices for vault assets, eg USDC
        uint256 minCrvFraxTokens = _getCrvFraxTokensForAssets(_assets);
        // Calculate min amount of metapool LP tokens with max slippage
        // This is used for sandwich attack protection
        minCrvFraxTokens = (minCrvFraxTokens * (BASIS_SCALE - _slippage)) / BASIS_SCALE;

        // Deposit asset (FRAX, USDC) into FraxBp and then deposit into underlying meta vault.
        uint256 metaVaultSharesReceived = _addAndDeposit(_assets, minCrvFraxTokens);

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
     * @dev Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
     */
    function previewDeposit(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        if (assets > 0) {
            // Calculate Meta Vault assets (crvFrax) for this vault's asset (FRAX, USDC)
            (uint256 crvFraxTokens, , ) = CurveFraxBpCalculatorLibrary.calcDeposit(
                assets,
                assetPoolIndex
            );

            // Calculate underlying meta vault shares received for Meta Vault assets (crvFrax)
            uint256 metaVaultShares = metaVault.previewDeposit(crvFraxTokens);

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
     * Adds vault asset (FRAX, USDC) into Curve FraxBp and deposits the liquidity provider token (crvFrax)
     * into the underlying crvFrax based meta vault.
     * @param shares The amount of vault shares to be minted.
     * @param receiver The account the vault shares will be minted to.
     * @return assets The amount of underlying assets that were transferred from the caller.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (eg USDC)
     */
    function mint(uint256 shares, address receiver)
        external
        virtual
        override
        whenNotPaused
        returns (uint256 assets)
    {
        // Get the total underlying Meta Vault shares held by this vault.
        uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
        // Convert this vault's required shares to required underlying meta vault shares.
        uint256 requiredMetaVaultShares = _getMetaVaultSharesFromShares(
            shares,
            totalMetaVaultShares,
            totalSupply()
        );

        // Calculate crvFrax needed to mint the required Meta Vault shares
        // There is no sandwich protection on underlying Meta Vault deposits as
        // the crvFrax is not converted to Curve Metapool LP tokens until a later settle process.
        uint256 requiredCrvFraxTokens = metaVault.previewMint(requiredMetaVaultShares);

        // Calculate assets (FRAX, USDC) needed to mint the required amount of shares
        uint256 invariant;
        uint256 totalcrvFraxSupply;
        (assets, invariant, totalcrvFraxSupply) = CurveFraxBpCalculatorLibrary.calcMint(
            requiredCrvFraxTokens,
            assetPoolIndex
        );

        // Protect against sandwich and flash loan attacks where the balance of the FraxBp can be manipulated.
        // Calculate fair USD amount to mint required crvFrax.
        // Unscaled FraxBp virtual price (crvFrax/USD) = pool invariant (USD value) / total supply of LP token (crvFrax).
        // USD amount = crvFrax amount * pool invariant (USD value) / total supply of LP token (crvFrax)
        uint256 maxAssets = (requiredCrvFraxTokens * invariant) / totalcrvFraxSupply;
        // Max USD = USD amount + (1 + mint slippage). So for 1% slippage, USD amount * 1.01
        // We will assume 1 USDC is close to 1 USD so max USD = max assets (FRAX, USDC).
        maxAssets = (maxAssets * (BASIS_SCALE + mintSlippage)) / BASIS_SCALE;
        require(assets <= maxAssets, "too much slippage");

        // Transfer this vault's asssets (FRAX, USDC) from the caller.
        _asset.safeTransferFrom(msg.sender, address(this), assets);

        // Deposit asset (FRAX, USDC) into FraxBp and then deposit into underlying meta vault.
        _addAndDeposit(assets, requiredCrvFraxTokens);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their mint at the current transaction, given current on-chain conditions.
     * @param shares The amount of vault shares to be minted.
     * @return assets The amount of each underlying assest tokens that will be transferred from the caller.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (eg USDC)
     */
    function previewMint(uint256 shares) external view virtual override returns (uint256 assets) {
        if (shares > 0) {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));
            // Convert this vault's required shares to required underlying meta vault shares.
            uint256 requiredMetaVaultShares = _getMetaVaultSharesFromShares(
                shares,
                totalMetaVaultShares,
                totalSupply()
            );

            // Calculate crvFrax needed to mint the required Meta Vault shares
            uint256 requiredCrvFraxTokens = metaVault.previewMint(requiredMetaVaultShares);

            // Calculate assets (FRAX, USDC) needed to mint the required amount of shares
            (assets, , ) = CurveFraxBpCalculatorLibrary.calcMint(
                requiredCrvFraxTokens,
                assetPoolIndex
            );
        }
    }

    /***************************************
                Withdraw functions
    ****************************************/

    /**
     * @notice Burns enough vault shares from owner and transfers the exact amount of each underlying asset tokens to the receiver.
     * Withdraws crvFrax from underlying meta vault and then removes stablecoin (FRAX, USDC) from the Curve FraxBp.
     * @param assets The amount of each underlying asset tokens to be withdrawn from the vault.
     * @param receiver The account that each underlying asset will be transferred to.
     * @param owner Account that owns the vault shares to be burnt.
     * @return shares The amount of vault shares that were burnt.
     * @dev Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external virtual override whenNotPaused returns (uint256 shares) {
        if (assets > 0) {
            // Get the total underlying Meta Vault shares held by this vault.
            uint256 totalMetaVaultSharesBefore = metaVault.balanceOf(address(this));

            // Calculate FraxBp LP tokens (crvFrax) required for this vault's asset (FRAX, USDC).
            (
                uint256 requiredCrvFraxTokens,
                uint256 invariant,
                uint256 totalcrvFraxSupply
            ) = CurveFraxBpCalculatorLibrary.calcWithdraw(assets, assetPoolIndex);

            // Withdraw crvFrax from underlying meta vault.
            uint256 metaVaultShares = metaVault.withdraw(
                requiredCrvFraxTokens,
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
                // Protect against sandwich and flash loan attacks where the balance of the FraxBp can be manipulated.
                // Calculate fair USD amount to withdraw required crvFrax.
                // Unscaled FraxBp virtual price (crvFrax/USD) = pool invariant (USD value) / total supply of LP token (crvFrax).
                // USD amount = crvFrax amount * pool invariant (USD value) / total supply of LP token (crvFrax)
                uint256 minAssets = (requiredCrvFraxTokens * invariant) / totalcrvFraxSupply;
                // Max USD = USD amount + (1 - withdraw slippage). So for 1% slippage, USD amount * 0.99
                // We will assume 1 USDC is close to 1 USD so min USD = min assets (FRAX, USDC).
                minAssets = (minAssets * (BASIS_SCALE - withdrawSlippage)) / BASIS_SCALE;
                // USD value is scaled to 18 decimals, it needs to be scaled to asset decimals.
                minAssets = minAssets / assetFromUsdScale;
                require(assets >= minAssets, "too much slippage");

                uint256[2] memory assetsArray;
                assetsArray[assetPoolIndex] = assets;
                // Burn FraxBp LP tokens (crvFrax) and receive this vault's asset (FRAX, USDC).
                ICurveFraxBP(CurveFraxBpCalculatorLibrary.FRAXBP_POOL).remove_liquidity_imbalance(
                    assetsArray,
                    requiredCrvFraxTokens
                );
            }

            // Burn the owner's vault shares
            _burn(owner, shares);

            // Transfer this vault's asssets (FRAX, USDC) to the receiver.
            _asset.safeTransfer(receiver, assets);

            emit Withdraw(msg.sender, receiver, owner, assets, shares);
        }
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current transaction, given current on-chain conditions.
     * @param assets The amount of each underlying asset tokens to be withdrawn.
     * @return shares The amount of vault shares that will be burnt.
     * @dev Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
     */
    function previewWithdraw(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        if (assets > 0) {
            // Calculate FraxBp LP tokens (crvFrax) for this vault's asset (FRAX, USDC).
            (uint256 crvFraxTokens, , ) = CurveFraxBpCalculatorLibrary.calcWithdraw(
                assets,
                assetPoolIndex
            );

            // Calculate underlying meta vault shares received for FraxBp LP tokens (crvFrax)
            uint256 metaVaultShares = metaVault.previewWithdraw(crvFraxTokens);

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
     * Redeems crvFrax from underlying meta vault and then removes stablecoin from the Curve FraxBp.
     * @param shares The amount of vault shares to be burnt.
     * @param receiver The account the underlying assets will be transferred to.
     * @param owner The account that owns the vault shares to be burnt.
     * @return assets The amount of underlying assets that were transferred to the receiver.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (eg USDC)
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
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (eg USDC)
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        uint256 customRedeemSlippage
    ) external virtual whenNotPaused returns (uint256 assets) {
        assets = _redeemInternal(shares, receiver, owner, customRedeemSlippage);
    }

    /// @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (eg USDC)
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

            // Burn underlying meta vault shares and receive FraxBp LP tokens (crvFrax).
            uint256 crvFraxTokens = metaVault.redeem(
                metaVaultShares,
                address(this),
                address(this)
            );

            // Protect against sandwich and flash loan attacks where the balance of the FraxBp can be manipulated.
            // Get virtual price of Curve FraxBp LP tokens (crvFrax) in USD.
            uint256 virtualPrice = CurveFraxBpCalculatorLibrary.getVirtualPrice();

            // Calculate fair USD amount for burning crvFrax.
            // FraxBp virtual price (crvFrax/USD) = pool invariant (USD value) * virtual price scale / total supply of LP token (crvFrax).
            // crvFrax amount = USD amount * FraxBp virtual price / virtial price scale
            // USD amount = crvFrax amount * virtial price scale / FraxBp virtual price
            uint256 minAssets = (crvFraxTokens * CurveFraxBpCalculatorLibrary.VIRTUAL_PRICE_SCALE) /
                virtualPrice;
            // Min USD = USD amount + (1 - mint slippage). So for 1% slippage, USD amount * 0.99
            // We will assume 1 USDC is close to 1 USD so min USD = min assets (FRAX, USDC).
            minAssets = (minAssets * (BASIS_SCALE - _slippage)) / BASIS_SCALE;
            // USD value is scaled to 18 decimals, it needs to be scaled to asset decimals.
            minAssets = minAssets / assetFromUsdScale;

            // Burn FraxBp LP tokens (crvFrax) and receive this vault's asset (FRAX, USDC).
            ICurveFraxBP(CurveFraxBpCalculatorLibrary.FRAXBP_POOL).remove_liquidity_one_coin(
                crvFraxTokens,
                int128(uint128(assetPoolIndex)),
                minAssets
            );

            _burn(_owner, _shares);

            // Need to get how many assets was withdrawn from the FraxBp as it will be more than
            // the assets amount passed into this function for redeem()
            assets = _asset.balanceOf(address(this));

            // Transfer this vault's asssets (FRAX, USDC) to the receiver.
            _asset.safeTransfer(_receiver, assets);

            emit Withdraw(msg.sender, _receiver, _owner, assets, _shares);
        }
    }

    /**
     * @notice Allows an on-chain or off-chain user to simulate the effects of their redeemption at the current transaction, given current on-chain conditions.
     * @param shares The amount of vault shares to be burnt.
     * @return assets The amount of each underlying assest tokens that will transferred to the receiver.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (eg USDC)
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

            // Convert underlying meta vault shares to FraxBp LP tokens (crvFrax).
            uint256 crvFraxTokens = metaVault.previewRedeem(metaVaultShares);

            // Convert FraxBp LP tokens (crvFrax) to assets (FRAX, USDC).
            (assets, , ) = CurveFraxBpCalculatorLibrary.calcRedeem(crvFraxTokens, assetPoolIndex);
        }
    }

    /*///////////////////////////////////////////////////////////////
                            CONVERTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice The amount of assets that the Vault would exchange for the amount of shares provided, in an ideal scenario where all the conditions are met.
     * @param shares The amount of vault shares to be converted to the underlying assets.
     * @return assets The amount of underlying assets converted from the vault shares.
     * @dev Vault shares -> Meta Vault shares -> Meta Vault assets (crvFrax) -> vault assets (FRAX, USDC)
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

        // Convert underlying meta vault shares to crvFrax
        // This uses the Metapool and FraxBp virtual prices
        uint256 crvFraxTokens = metaVault.convertToAssets(metaVaultShares);
        // Convert crvFrax to assets (FRAX, USDC) by extrapolating redeeming 1 crvFrax.
        assets = _getAssetsForCrvFraxTokens(crvFraxTokens);
    }

    /**
     * @notice The amount of shares that the Vault would exchange for the amount of assets provided, in an ideal scenario where all the conditions are met.
     * @param assets The amount of underlying assets to be convert to vault shares.
     * @return shares The amount of vault shares converted from the underlying assets.
     * @dev Vault assets (FRAX, USDC) -> Meta Vault assets (crvFrax) -> Meta Vault shares -> this vault's shares
     */
    function convertToShares(uint256 assets)
        external
        view
        virtual
        override
        returns (uint256 shares)
    {
        // Calculate fair amount of FraxBp LP tokens (crvFrax) using virtual prices for vault assets, eg USDC
        uint256 crvFraxTokens = _getCrvFraxTokensForAssets(assets);

        // Convert crvFrax to underlying meta vault shares.
        // This uses the Metapool and FraxBp virtual prices.
        uint256 metaVaultShares = metaVault.convertToShares(crvFraxTokens);

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

    /// @dev Deposit asset (FRAX, USDC) into FraxBp and then deposit crvFrax into underlying meta vault.
    function _addAndDeposit(uint256 _assets, uint256 _minCrvFraxTokens)
        internal
        returns (uint256 metaVaultShares_)
    {
        // Get asset array of underlying to be deposited in the pool
        uint256[2] memory assetsArray;
        assetsArray[assetPoolIndex] = _assets;

        // Add assets, eg USDC, to the FraxBp and receive FraxBp LP tokens (crvFrax)
        ICurveFraxBP(CurveFraxBpCalculatorLibrary.FRAXBP_POOL).add_liquidity(
            assetsArray,
            _minCrvFraxTokens
        );

        // Deposit crvFrax into the underlying meta vault and receive meta vault shares.
        // This assumes there is no crvFrax sitting in this vault. If there is, the caller will get extra vault shares.
        // Meta Vault deposits do not need sandwich attack protection.
        metaVaultShares_ = metaVault.deposit(
            IERC20(CurveFraxBpCalculatorLibrary.LP_TOKEN).balanceOf(address(this)),
            address(this)
        );
    }

    /// @dev Utility function to convert crvFrax tokens to expected asset tokens (FRAX, USDC) from Curve's FraxBp.
    /// Extrapolates assets received for redeeming on FraxBp LP token (crvFrax).
    /// @param _crvFraxTokens Amount of crvFrax tokens to burn.
    /// @return expectedAssets Amount of asset tokens expected from Curve FraxBp.
    function _getAssetsForCrvFraxTokens(uint256 _crvFraxTokens)
        internal
        view
        returns (uint256 expectedAssets)
    {
        if (_crvFraxTokens > 0) {
            // convert 1 crvFrax to the vault assets (FRAX, USDC) per crvFrax
            (uint256 assetsPercrvFrax, , ) = CurveFraxBpCalculatorLibrary.calcRedeem(
                crvFraxTokenScale,
                assetPoolIndex
            );
            // Convert crvFrax amount to assets (FRAX, USDC)
            expectedAssets = (_crvFraxTokens * assetsPercrvFrax) / crvFraxTokenScale;
        }
    }

    /// @dev Utility function to convert asset (FRAX, USDC) amount to fair crvFrax token amount.
    /// @param _assetsAmount Amount of assets (FRAX, USDC) to burn.
    /// @return expectedcrvFraxTokens Fair amount of crvFrax tokens expected from Curve FraxBp.
    function _getCrvFraxTokensForAssets(uint256 _assetsAmount)
        internal
        view
        returns (uint256 expectedcrvFraxTokens)
    {
        // Curve FraxBp lp token virtual price which is the price of one scaled crvFrax (USD/crvFrax). Non-manipulable
        uint256 lpVirtualPrice = CurveFraxBpCalculatorLibrary.getVirtualPrice();

        // Amount of FraxBp lp tokens (crvFrax) corresponding to asset tokens (FRAX, USDC)
        // Assume 1 USDC == 1 USD
        // crvFrax amount = USDC amount / crvFrax/USD virtual price
        expectedcrvFraxTokens =
            (CurveFraxBpCalculatorLibrary.VIRTUAL_PRICE_SCALE * _assetsAmount * crvFraxTokenScale) /
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

    /**
     * @notice Governor liquidates all the vault's assets and send to the governor.
     * Only to be used in an emergency. eg whitehat protection against a hack.
     * @param minAssets Minimum amount of asset tokens to receive from removing liquidity from the Curve FraxBp.
     * This provides sandwich attack protection.
     */
    function liquidateVault(uint256 minAssets) external onlyGovernor {
        uint256 totalMetaVaultShares = metaVault.balanceOf(address(this));

        metaVault.redeem(totalMetaVaultShares, address(this), address(this));

        ICurveFraxBP(CurveFraxBpCalculatorLibrary.FRAXBP_POOL).remove_liquidity_one_coin(
            IERC20(CurveFraxBpCalculatorLibrary.LP_TOKEN).balanceOf(address(this)),
            int128(uint128(assetPoolIndex)),
            minAssets
        );

        _asset.safeTransfer(_governor(), _asset.balanceOf(address(this)));
    }

    /***************************************
                    Set Vault Parameters
    ****************************************/

    /// @notice Approves Curve's FraxBp contract to transfer assets (FRAX, USDC) from this vault.
    /// Also approves the underlying Meta Vault to transfer crvFrax from this vault.
    function resetAllowances() external onlyGovernor {
        _resetAllowances();
    }

    /// @dev Approves Curve's FraxBp contract to transfer assets (FRAX, USDC) from this vault.
    /// Also approves the underlying Meta Vault to transfer crvFrax from this vault.
    function _resetAllowances() internal {
        _asset.safeApprove(address(CurveFraxBpCalculatorLibrary.FRAXBP_POOL), type(uint256).max);
        IERC20(CurveFraxBpCalculatorLibrary.LP_TOKEN).safeApprove(
            address(metaVault),
            type(uint256).max
        );
    }
}
