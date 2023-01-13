// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// Libs
import { AbstractSlippage } from "../AbstractSlippage.sol";
import { AbstractVault, IERC20 } from "../../AbstractVault.sol";
import { IConvexBooster } from "../../../peripheral/Convex/IConvexBooster.sol";
import { IConvexRewardsPool } from "../../../peripheral/Convex/IConvexRewardsPool.sol";
import { ICurveMetapool } from "../../../peripheral/Curve/ICurveMetapool.sol";
import { ICurve3Pool } from "../../../peripheral/Curve/ICurve3Pool.sol";
import { Curve3CrvMetapoolCalculatorLibrary } from "../../../peripheral/Curve/Curve3CrvMetapoolCalculatorLibrary.sol";

/**
 * @title   Abstract ERC-4626 vault with a Curve.fi 3pool (3Crv) asset invested in a Curve metapool,
 * deposited in a Convex pool and then staked.
 * @notice Curve.fi's 3pool DAI/USDC/USDT (3Crv) liquidity provider token is deposited in
 * a Curve.fi metapool to get a Curve.fi metapool LP token, eg musd3CRV,
 * which is deposited into a Convex Curve LP pool, eg cvxmusd3CRV, and finally the
 * Convex LP token is staked for rewards.
 *
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-06-06
 *
 * The constructor of implementing contracts need to call the following:
 * - VaultManagerRole(_nexus)
 * - AbstractSlippage(_slippageData)
 * - AbstractVault(_assetArg)
 * - Convex3CrvAbstractVault(_curveMetapool, _booster, _poolId)
 *
 * The `initialize` function of implementing contracts need to call the following:
 * - InitializableToken._initialize(_name, _symbol, decimals)
 * - VaultManagerRole._initialize(_vaultManager)
 * - AbstractVault._initialize(_assetToBurn)
 * - Convex3CrvAbstractVault._initialize()
 */
abstract contract Convex3CrvAbstractVault is AbstractSlippage, AbstractVault {
    using SafeERC20 for IERC20;

    // Initial arguments to pass to constructor in a struct to avaoid stackTooDeep compilation error
    /// @param metapool           Curve.fi's metapool the asset, eg 3Crv, is deposited into. eg musd3CRV, MIM-3LP3CRV-f or usdp3CRV
    /// @param booster            Convex's Booster contract that contains the Curve.fi LP pools.
    /// @param convexPoolId       Convex's pool identifier. eg 14 for the musd3CRV pool.
    struct ConstructorData {
        address metapool;
        address booster;
        uint256 convexPoolId;
    }

    /// @notice 3CRV token scale
    uint256 public constant ASSET_SCALE = 1e18;
    uint256 public constant VIRTUAL_PRICE_SCALE = 1e18;

    /// @notice Curve.fi pool the 3Crv asset is deposited into. eg musd3CRV, MIM-3LP3CRV-f or usdp3CRV.
    address public immutable metapool;
    /// @notice Curve.fi Metapool liquidity provider token. eg Curve.fi MUSD/3Crv (musd3CRV)
    address public immutable metapoolToken;
    /// @notice Scale of the metapool liquidity provider token. eg 1e18 if 18 decimal places.
    uint256 public immutable metapoolTokenScale;
    /// @notice Curve's 3Pool used as a base pool by the Curve metapools.
    address public immutable basePool;

    /// @notice Convex's Booster contract that contains the Curve.fi LP pools.
    IConvexBooster public immutable booster;
    /// @notice Convex's pool identifier. eg 14 for the musd3CRV pool.
    uint256 public immutable convexPoolId;
    /// @notice Convex's base rewards contract for staking Convex's LP token. eg staking cvxmusd3CRV
    IConvexRewardsPool public immutable baseRewardPool;

    /// @param _data Contract immutable config of type `ConstructorData`.
    constructor(ConstructorData memory _data) {
        // Convex contracts
        booster = IConvexBooster(_data.booster);
        convexPoolId = _data.convexPoolId;
        (address metapoolTokenAddress, , , address baseRewardPoolAddress, , ) = IConvexBooster(
            _data.booster
        ).poolInfo(_data.convexPoolId);
        metapoolToken = metapoolTokenAddress;
        metapoolTokenScale = 10 ** IERC20Metadata(metapoolTokenAddress).decimals();
        baseRewardPool = IConvexRewardsPool(baseRewardPoolAddress);

        metapool = _data.metapool;
        basePool = Curve3CrvMetapoolCalculatorLibrary.BASE_POOL;
    }

    /// @dev Set Allowances for threeCrvToken and _asset
    function _initialize() internal virtual {
        _resetAllowances();

        // Check the base token in the Curve.fi metapool matches the vault asset.
        // Need to check here as the _asset is set in the AbstractVault constructor hence not
        // available in this abstract contract's constructor.
        require(ICurveMetapool(metapool).coins(1) == address(_asset), "Asset != Curve base coin");
    }

    /***************************************
                    Valuations
    ****************************************/

    /**
     * @notice Uses the Curve 3Pool and Metapool virtual prices to calculate the value of
     * the vault's assets (3Crv) from the staked Metapool LP tokens, eg musd3Crv, in the Convex pool.
     * This does not include slippage or fees.
     * @return totalManagedAssets Value of all the assets (3Crv) in the vault.
     */
    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        uint256 totalMetapoolTokens = baseRewardPool.balanceOf(address(this));
        totalManagedAssets = Curve3CrvMetapoolCalculatorLibrary.convertToBaseLp(
            metapool,
            metapoolToken,
            totalMetapoolTokens
        );
    }

    /*///////////////////////////////////////////////////////////////
                        DEPOSIT/MINT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Overloaded standard ERC-4626 `deposit` method with custom slippage.
     * @param assets The amount of underlying assets to be transferred to the vault.
     * @param receiver The account that the vault shares will be minted to.
     * @param customDepositSlippage Deposit slippage in basis points i.e. 1% = 100.
     * @return shares The amount of vault shares that were minted.
     */
    function deposit(
        uint256 assets,
        address receiver,
        uint256 customDepositSlippage
    ) external virtual whenNotPaused returns (uint256 shares) {
        shares = _depositInternal(assets, receiver, customDepositSlippage);
    }

    /// @dev Override `AbstractVault._deposit`.
    function _deposit(uint256 assets, address receiver)
        internal
        virtual
        override
        returns (uint256 shares)
    {
        shares = _depositInternal(assets, receiver, depositSlippage);
    }

    /**
     * @dev Vault assets (3Crv) -> Metapool LP tokens, eg musd3Crv -> vault shares
     * If the vault has any 3Crv balance, it is added to the mint/deposit 3Crv that is added to the Metapool
     * and LP deposited to the Convex pool. The resulting shares are proportionally split between the reciever
     * and the vault via _afterSharesMintedHook fn.
     *
     * @param _assets The amount of underlying assets to be transferred to the vault.
     * @param _receiver The account that the vault shares will be minted to.
     * @param _slippage Deposit slippage in basis points i.e. 1% = 100.
     * @return shares The amount of vault shares that were minted.
     */
    function _depositInternal(
        uint256 _assets,
        address _receiver,
        uint256 _slippage
    ) internal virtual returns (uint256 shares) {
        uint256 assetsToDeposit = _asset.balanceOf(address(this)) + _assets;
        // Transfer vault's asssets (3Crv) from the caller.
        _asset.safeTransferFrom(msg.sender, address(this), _assets);

        // Get this vault's balance of Metapool LP tokens, eg musd3Crv.
        // Used to calculate the proportion of shares that should be minted.
        uint256 totalMetapoolTokensBefore = baseRewardPool.balanceOf(address(this));

        // Calculate fair amount of metapool LP tokens, eg musd3Crv, using virtual prices for vault assets (3Crv)
        uint256 minMetapoolTokens = _getMetapoolTokensForAssets(assetsToDeposit);
        // Calculate min amount of metapool LP tokens with max slippage
        // This is used for sandwich attack protection
        minMetapoolTokens = (minMetapoolTokens * (BASIS_SCALE - _slippage)) / BASIS_SCALE;

        // Deposit 3Crv into metapool and the stake into Convex vault
        uint256 metapoolTokensReceived = _depositAndStake(assetsToDeposit, minMetapoolTokens);

        // Calculate the proportion of shares to mint based on the amount of Metapool LP tokens.
        uint256 sharesToMint = _getSharesFromMetapoolTokens(
            metapoolTokensReceived,
            totalMetapoolTokensBefore,
            totalSupply(),
            false
        );
        // Calculate the proportion of shares to mint to the receiver.
        shares = (sharesToMint * _assets) / assetsToDeposit;

        _mint(_receiver, shares);

        emit Deposit(msg.sender, _receiver, _assets, shares);
        // Account any new shares, assets.
        _afterSharesMintedHook(sharesToMint - shares, assetsToDeposit - _assets);
    }

    /// @dev Converts vault assets to shares in two steps
    /// Vault assets (3Crv) -> Metapool LP tokens, eg musd3Crv -> vault shares
    /// Override `AbstractVault._previewDeposit`.
    /// changes - It takes into account any asset balance to be included in the deposit.
    function _previewDeposit(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        if (assets > 0) {
            // Take into account any asset balance.
            uint256 assetsToDeposit = _asset.balanceOf(address(this)) + assets;
            // Calculate Metapool LP tokens, eg musd3Crv, for vault assets (3Crv)
            (uint256 metapoolTokens, , , ) = Curve3CrvMetapoolCalculatorLibrary.calcDeposit(
                metapool,
                metapoolToken,
                assetsToDeposit,
                1
            );

            // Calculate the proportion of shares to mint based on the amount of metapool LP tokens, eg musd3Crv.
            uint256 sharesToMint = _getSharesFromMetapoolTokens(
                metapoolTokens,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                false
            );
            // Calculate the callers portion of shares
            shares = (sharesToMint * assets) / assetsToDeposit;
        }
    }

    /// @dev Override `AbstractVault._mint`.
    /// Vault shares -> Metapool LP tokens, eg musd3Crv -> vault assets (3Crv)
    function _mint(uint256 shares, address receiver)
        internal
        virtual
        override
        returns (uint256 assets)
    {
        uint256 donatedAssets = _asset.balanceOf(address(this));
        uint256 donatedMetapoolTokens = 0;
        if (donatedAssets > 0) {
            (donatedMetapoolTokens, , , ) = Curve3CrvMetapoolCalculatorLibrary.calcDeposit(
                metapool,
                metapoolToken,
                donatedAssets,
                1
            );
        }
        // Calculate Curve Metapool LP tokens, eg musd3CRV, needed to mint the required amount of shares
        uint256 metapoolTokens = _getMetapoolTokensFromShares(
            shares,
            baseRewardPool.balanceOf(address(this)),
            totalSupply(),
            false
        );
        uint256 requiredMetapoolTokens = metapoolTokens + donatedMetapoolTokens;

        // Calculate assets needed to deposit into the metapool for the required metapool lp tokens.
        uint256 assetsToDeposit;
        uint256 invariant;
        uint256 metapoolTotalSupply;
        uint256 baseVirtualPrice;
        (
            assetsToDeposit,
            invariant,
            metapoolTotalSupply,
            baseVirtualPrice
        ) = Curve3CrvMetapoolCalculatorLibrary.calcMint(
            metapool,
            metapoolToken,
            requiredMetapoolTokens,
            1
        );
        assets = (assetsToDeposit * requiredMetapoolTokens) / metapoolTokens;

        // Protect against sandwich and flash loan attacks where the balance of the metapool is manipulated.
        uint256 maxAssets = (requiredMetapoolTokens * invariant * VIRTUAL_PRICE_SCALE) /
            (metapoolTotalSupply * baseVirtualPrice);
        maxAssets = (maxAssets * (BASIS_SCALE + mintSlippage)) / BASIS_SCALE;

        require(assetsToDeposit <= maxAssets, "too much slippage");

        // Transfer vault's asssets (3Crv) from the caller.
        _asset.safeTransferFrom(msg.sender, address(this), assets);

        // Deposit 3Crv into metapool and the stake into Convex vault
        _depositAndStake(assetsToDeposit, requiredMetapoolTokens);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
        // Account any new shares, assets.
        uint256 donatedShares = donatedAssets == 0
            ? 0
            : (shares * requiredMetapoolTokens) / donatedMetapoolTokens;
        _afterSharesMintedHook(donatedShares, donatedAssets);
    }

    /// @dev Converts vault shares to assets in two steps
    /// Vault shares -> Metapool LP tokens, eg musd3Crv -> vault assets (3Crv)
    /// Override `AbstractVault._previewMint`.
    /// changes - It takes into account any asset balance to be included in the next mint.
    function _previewMint(uint256 shares) internal view virtual override returns (uint256 assets) {
        if (shares > 0) {
            uint256 donatedAssets = _asset.balanceOf(address(this));
            uint256 donatedMetapoolTokens = 0;
            if (donatedAssets > 0) {
                (donatedMetapoolTokens, , , ) = Curve3CrvMetapoolCalculatorLibrary.calcDeposit(
                    metapool,
                    metapoolToken,
                    donatedAssets,
                    1
                );
            }
            uint256 metapoolTokens = _getMetapoolTokensFromShares(
                shares,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                false
            );
            (uint256 assetsToDeposit, , , ) = Curve3CrvMetapoolCalculatorLibrary.calcMint(
                metapool,
                metapoolToken,
                metapoolTokens + donatedMetapoolTokens,
                1
            );
            // Calculate receivers portion of assets.
            assets = (assetsToDeposit * (metapoolTokens + donatedMetapoolTokens)) / metapoolTokens;
        }
    }

    /*///////////////////////////////////////////////////////////////
                        WITHDRAW/REDEEM
    //////////////////////////////////////////////////////////////*/

    /// @dev Override `AbstractVault._withdraw`.
    /// Vault assets (3Crv) -> Metapool LP tokens, eg musd3Crv -> vault shares
    function _withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) internal virtual override returns (uint256 shares) {
        if (assets > 0) {
            (
                uint256 metapoolTokensRequired,
                uint256 invariant,
                uint256 metapoolTotalSupply,
                uint256 baseVirtualPrice
            ) = Curve3CrvMetapoolCalculatorLibrary.calcWithdraw(metapool, metapoolToken, assets, 1);

            // Calculate max metapool tokens using virtual prices
            // This protects against sandwich and flash loan attacks against the the Curve metapool.
            uint256 maxMetapoolTokens = (assets * baseVirtualPrice * metapoolTotalSupply) /
                (invariant * VIRTUAL_PRICE_SCALE);
            maxMetapoolTokens =
                (maxMetapoolTokens * (BASIS_SCALE + withdrawSlippage)) /
                BASIS_SCALE;
            require(metapoolTokensRequired <= maxMetapoolTokens, "too much slippage");

            shares = _getSharesFromMetapoolTokens(
                metapoolTokensRequired,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                true
            );

            // If caller is not the owner of the shares
            uint256 allowed = allowance(owner, msg.sender);
            if (msg.sender != owner && allowed != type(uint256).max) {
                require(shares <= allowed, "Amount exceeds allowance");
                _approve(owner, msg.sender, allowed - shares);
            }

            // Withdraw metapool lp tokens from Convex pool
            // don't claim rewards.
            baseRewardPool.withdrawAndUnwrap(metapoolTokensRequired, false);

            // Remove assets (3Crv) from the Curve metapool by burning the LP tokens, eg musd3Crv
            ICurveMetapool(metapool).remove_liquidity_imbalance(
                [0, assets],
                metapoolTokensRequired
            );

            _burn(owner, shares);

            _asset.safeTransfer(receiver, assets);

            emit Withdraw(msg.sender, receiver, owner, assets, shares);
        }
    }

    /// @dev Override `AbstractVault._previewWithdraw`.
    function _previewWithdraw(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        if (assets > 0) {
            (uint256 metapoolTokens, , , ) = Curve3CrvMetapoolCalculatorLibrary.calcWithdraw(
                metapool,
                metapoolToken,
                assets,
                1
            );

            shares = _getSharesFromMetapoolTokens(
                metapoolTokens,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                true
            );
        }
    }

    /**
     * @notice Overloaded standard ERC-4626 `redeem` method with custom slippage.
     * @param shares The amount of vault shares to be burnt.
     * @param receiver The account the underlying assets will be transferred to.
     * @param owner The account that owns the vault shares to be burnt.
     * @param customRedeemSlippage Redeem slippage in basis points i.e. 1% = 100.
     * @return assets The amount of underlying assets that were transferred to the receiver.
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        uint256 customRedeemSlippage
    ) external virtual whenNotPaused returns (uint256 assets) {
        assets = _redeemInternal(shares, receiver, owner, customRedeemSlippage);
    }

    /// @dev Override `AbstractVault._redeem`.
    function _redeem(
        uint256 shares,
        address receiver,
        address owner
    ) internal virtual override returns (uint256 assets) {
        assets = _redeemInternal(shares, receiver, owner, redeemSlippage);
    }

    /// @dev Vault shares -> Metapool LP tokens, eg musd3Crv -> vault assets (3Crv)
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

            // Calculate Curve Metapool LP tokens, eg musd3CRV, needed to mint the required amount of shares
            uint256 totalMetapoolTokens = baseRewardPool.balanceOf(address(this));
            uint256 requiredMetapoolTokens = _getMetapoolTokensFromShares(
                _shares,
                totalMetapoolTokens,
                totalSupply(),
                false
            );

            // Calculate fair amount of assets (3Crv) using virtual prices for metapool LP tokens, eg musd3Crv
            uint256 minAssets = _getAssetsForMetapoolTokens(requiredMetapoolTokens);
            // Calculate min amount of assets (3Crv) with max slippage.
            // This is used for sandwich attack protection.
            minAssets = (minAssets * (BASIS_SCALE - _slippage)) / BASIS_SCALE;

            // Withdraw metapool lp tokens from Convex pool
            // don't claim rewards.
            baseRewardPool.withdrawAndUnwrap(requiredMetapoolTokens, false);

            // Remove assets (3Crv) from the Curve metapool by burning the LP tokens, eg musd3Crv
            assets = ICurveMetapool(metapool).remove_liquidity_one_coin(
                requiredMetapoolTokens,
                1,
                minAssets
            );

            _burn(_owner, _shares);

            _asset.safeTransfer(_receiver, assets);

            emit Withdraw(msg.sender, _receiver, _owner, assets, _shares);
        }
    }

    /// @dev Override `AbstractVault._previewRedeem`.
    /// Vault shares -> Metapool LP tokens, eg musd3Crv -> vault assets (3Crv)
    function _previewRedeem(uint256 shares)
        internal
        view
        virtual
        override
        returns (uint256 assets)
    {
        if (shares > 0) {
            uint256 metapoolTokens = _getMetapoolTokensFromShares(
                shares,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                false
            );
            (assets, , ) = Curve3CrvMetapoolCalculatorLibrary.calcRedeem(
                metapool,
                metapoolToken,
                metapoolTokens,
                1
            );
        }
    }

    /*///////////////////////////////////////////////////////////////
                            CONVERTIONS
    //////////////////////////////////////////////////////////////*/

    /// @dev Override `AbstractVault._convertToAssets`.
    function _convertToAssets(uint256 shares, bool isRoundUp)
        internal
        view
        virtual
        override
        returns (uint256 assets)
    {
        if (shares > 0) {
            uint256 metapoolTokens = _getMetapoolTokensFromShares(
                shares,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                isRoundUp
            );
            assets = Curve3CrvMetapoolCalculatorLibrary.convertToBaseLp(
                metapool,
                metapoolToken,
                metapoolTokens
            );
        }
    }

    /// @dev Override `AbstractVault._convertToShares`.
    function _convertToShares(uint256 assets, bool isRoundUp)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        if (assets > 0) {
            uint256 metapoolTokens = Curve3CrvMetapoolCalculatorLibrary.convertToMetaLp(
                metapool,
                metapoolToken,
                assets
            );
            shares = _getSharesFromMetapoolTokens(
                metapoolTokens,
                baseRewardPool.balanceOf(address(this)),
                totalSupply(),
                isRoundUp
            );
        }
    }

    /***************************************
                    Utility
    ****************************************/

    /// @dev Add assets (3Crv) to the Curve metapool and
    /// deposit the received metapool lp tokens, eg musd3Crv, into a Convex pool.
    function _depositAndStake(uint256 _assets, uint256 _minMetapoolTokens)
        internal
        returns (uint256 metapoolTokens_)
    {
        // Deposit assets, eg 3Crv, into the Curve.fi Metapool pool.
        metapoolTokens_ = ICurveMetapool(metapool).add_liquidity([0, _assets], _minMetapoolTokens);

        // Deposit Curve.fi Metapool LP token, eg musd3CRV, in Convex pool, eg cvxmusd3CRV, and stake.
        booster.deposit(convexPoolId, metapoolTokens_, true);
    }

    /// @dev Utility function to convert Curve Metapool LP tokens, eg musd3Crv, to expected 3Pool LP tokens (3Crv).
    /// @param _metapoolTokens Amount of Curve Metapool LP tokens. eg musd3Crv
    /// @return expectedAssets Expected amount of 3Pool (3Crv) LP tokens.
    function _getAssetsForMetapoolTokens(uint256 _metapoolTokens)
        internal
        view
        returns (uint256 expectedAssets)
    {
        // 3Crv virtual price in USD. Non-manipulable
        uint256 threePoolVirtualPrice = ICurve3Pool(basePool).get_virtual_price();
        // Metapool virtual price in USD. eg musd3Crv/USD
        uint256 metapoolVirtualPrice = ICurveMetapool(metapool).get_virtual_price();

        // Amount of "asset" (3Crv) tokens corresponding to Curve Metapool LP tokens
        // = musd3Crv/USD price * musd3Crv amount * 3Crv scale / (3Crv/USD price * musd3Crv scale)
        expectedAssets =
            (metapoolVirtualPrice * _metapoolTokens * ASSET_SCALE) /
            (threePoolVirtualPrice * metapoolTokenScale);
    }

    /// @dev Utility function to convert 3Pool (3Crv) LP tokens to expected Curve Metapool LP tokens (musd3Crv).
    /// @param _assetsAmount Amount of 3Pool (3Crv) LP tokens.
    /// @return expectedMetapoolTokens Amount of Curve Metapool tokens (musd3Crv) expected from curve.
    function _getMetapoolTokensForAssets(uint256 _assetsAmount)
        internal
        view
        returns (uint256 expectedMetapoolTokens)
    {
        // 3Crv virtual price in USD. Non-manipulable
        uint256 threePoolVirtualPrice = ICurve3Pool(basePool).get_virtual_price();
        // Metapool virtual price in USD
        uint256 metapoolVirtualPrice = ICurveMetapool(metapool).get_virtual_price();

        // Amount of Curve Metapool LP tokens corresponding to assets (3Crv)
        expectedMetapoolTokens =
            (threePoolVirtualPrice * _assetsAmount * metapoolTokenScale) /
            (metapoolVirtualPrice * ASSET_SCALE);
    }

    function _getSharesFromMetapoolTokens(
        uint256 _metapoolTokens,
        uint256 _totalMetapoolTokens,
        uint256 _totalShares,
        bool isRoundUp
    ) internal view returns (uint256 shares) {
        if (_totalMetapoolTokens == 0) {
            shares = (_metapoolTokens * ASSET_SCALE) / metapoolTokenScale;
        } else {
            shares = (_metapoolTokens * _totalShares) / _totalMetapoolTokens;
            if (isRoundUp && mulmod(_metapoolTokens, _totalShares, _totalMetapoolTokens) > 0) {
                shares += 1;
            }
        }
    }

    function _getMetapoolTokensFromShares(
        uint256 _shares,
        uint256 _totalMetapoolTokens,
        uint256 _totalShares,
        bool isRoundUp
    ) internal view returns (uint256 metapoolTokens) {
        if (_totalShares == 0) {
            metapoolTokens = (_shares * metapoolTokenScale) / ASSET_SCALE;
        } else {
            metapoolTokens = (_shares * _totalMetapoolTokens) / _totalShares;
            if (isRoundUp && mulmod(_shares, _totalMetapoolTokens, _totalShares) > 0) {
                metapoolTokens += 1;
            }
        }
    }

    /**
     * Called be the `deposit` and `mint` functions after the assets have been transferred into the vault
     * but before shares are minted.
     * Typically, the hook implementation deposits the assets into the underlying vaults or platforms.
     *
     * @dev the shares returned from `totalSupply` and `balanceOf` have not yet been updated with the minted shares.
     * The assets returned from `totalAssets` and `assetsOf` are typically updated as part of the `_afterDepositHook` hook but it depends on the implementation.
     *
     * If an vault is implementing multiple vault capabilities, the `_afterDepositHook` function that updates the assets amounts should be executed last.
     *
     * @param newShares the amount of underlying assets to be transferred to the vault.
     * @param newAssets the amount of vault shares to be minted.
     */
    function _afterSharesMintedHook(uint256 newShares, uint256 newAssets) internal virtual;

    /***************************************
                    Emergency Functions
    ****************************************/

    /**
     * @notice Governor liquidates all the vault's assets and send to the governor.
     * Only to be used in an emergency. eg whitehat protection against a hack.
     * The governor is the Protocol DAO's multisig wallet so can not be executed by one person.
     * @param minAssets Minimum amount of asset tokens (3Crv) to receive from removing liquidity from the Curve Metapool.
     * This provides sandwich attack protection.
     */
    function liquidateVault(uint256 minAssets) external onlyGovernor {
        uint256 totalMetapoolTokens = baseRewardPool.balanceOf(address(this));

        baseRewardPool.withdrawAndUnwrap(totalMetapoolTokens, false);
        ICurveMetapool(metapool).remove_liquidity_one_coin(totalMetapoolTokens, 1, minAssets);

        _asset.safeTransfer(_governor(), _asset.balanceOf(address(this)));
    }

    /***************************************
                    Set Vault Parameters
    ****************************************/

    /// @notice Function to reset allowances in the case they get exhausted
    function resetAllowances() external onlyGovernor {
        _resetAllowances();
    }

    function _resetAllowances() internal {
        // Approve the Curve.fi metapool, eg musd3CRV, to transfer the asset 3Crv.
        _asset.safeApprove(address(metapool), 0);
        _asset.safeApprove(address(metapool), type(uint256).max);
        // Approve the Convex booster contract to transfer the Curve.fi metapool LP token. eg musd3CRV
        IERC20(metapoolToken).safeApprove(address(booster), 0);
        IERC20(metapoolToken).safeApprove(address(booster), type(uint256).max);
    }
}
