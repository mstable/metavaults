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
import { ICurveFraxBP } from "../../../peripheral/Curve/ICurveFraxBP.sol";
import { CurveFraxBpMetapoolCalculatorLibrary } from "../../../peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol";

/**
 * @title   Abstract ERC-4626 vault with a Curve.fi FRAX/USDC (crvFRAX) asset invested in a Curve metapool,
 * deposited in a Convex pool and then staked.
 * @notice Curve.fi's FRAX/USDC (crvFRAX) liquidity provider token is deposited in
 * a Curve.fi metapool to get a Curve.fi metapool LP token, eg BUSDFRAXBP3CRV-f/USD,
 * which is deposited into a Convex Curve LP pool, eg cvxBUSDFRAXBP3CRV-f, and finally the
 * Convex LP token is staked for rewards.
 *
 * WARNING this vault can not be used with the GUSD+FRAX metapool as GUSD only has 2 decimal places.
 *
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-19
 *
 * The constructor of implementing contracts need to call the following:
 * - VaultManagerRole(_nexus)
 * - AbstractSlippage(_slippageData)
 * - AbstractVault(_assetArg)
 * - ConvexFraxBpAbstractVault(_curveMetapool, _booster, _poolId)
 *
 * The `initialize` function of implementing contracts need to call the following:
 * - InitializableToken._initialize(_name, _symbol, decimals)
 * - VaultManagerRole._initialize(_vaultManager)
 * - ConvexFraxBpAbstractVault._initialize()
 */
abstract contract ConvexFraxBpAbstractVault is AbstractSlippage, AbstractVault {
    using SafeERC20 for IERC20;

    // Initial arguments to pass to constructor in a struct to avaoid stackTooDeep compilation error
    /// @param metapool           Curve.fi's metapool the asset, eg crvFRAX, is deposited into. eg BUSD+FRAXBP
    /// @param booster            Convex's Booster contract that contains the Curve.fi LP pools.
    /// @param convexPoolId       Convex's pool identifier. eg 104 for the BUSD+FRAXBP pool.
    struct ConstructorData {
        address metapool;
        address booster;
        uint256 convexPoolId;
    }

    /// @notice crvFRAX token scale
    uint256 public constant ASSET_SCALE = 1e18;

    /// @notice Curve.fi pool the crvFRAX asset is deposited into. eg BUSD+FRAX or BUSD+FRAX.
    address public immutable metapool;
    /// @notice Curve.fi Metapool liquidity provider token. eg Curve.fi Factory USD Metapool: BUSDFRAXBP (BUSDFRAXBP3CRV-f)
    address public immutable metapoolToken;
    /// @notice Scale of the metapool liquidity provider token. eg 1e18 if 18 decimal places.
    uint256 public immutable metapoolTokenScale;
    /// @notice Curve's FRAX+USDC (crvFRAX) used as a base pool by the Curve metapools.
    address public immutable basePool;

    /// @notice Convex's Booster contract that contains the Curve.fi LP pools.
    IConvexBooster public immutable booster;
    /// @notice Convex's pool identifier. eg 104 for the BUSD+FRAX pool.
    uint256 public immutable convexPoolId;
    /// @notice Convex's base rewards contract for staking Convex's LP token. eg staking cvxBUSDFRAXBP3CRV-f
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
        basePool = CurveFraxBpMetapoolCalculatorLibrary.BASE_POOL;
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
     * @notice Uses the Curve FRAX/USDC and Metapool virtual prices to calculate the value of
     * the vault's assets (crvFRAX) from the staked Metapool LP tokens in the Convex pool.
     * This does not include slippage or fees.
     * @return totalManagedAssets Value of all the assets (crvFRAX) in the vault.
     */
    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        uint256 totalMetapoolTokens = baseRewardPool.balanceOf(address(this));
        totalManagedAssets = CurveFraxBpMetapoolCalculatorLibrary.convertToBaseLp(
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
     * @dev Vault assets (crvFRAX) -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault shares.
     * If the vault has any crvFRAX balance, it is added to the mint/deposit crvFRAX that is added to the Metapool
     * and LP deposited to the Convex pool. The resulting shares are proportionally split between the reciever
     * and the vault via _afterDepositHook fn.
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
        // Transfer vault's asssets (crvFRAX) from the caller.
        _asset.safeTransferFrom(msg.sender, address(this), _assets);

        // Get this vault's balance of Metapool LP tokens, eg BUSDFRAXBP3CRV-f.
        // Used to calculate the proportion of shares that should be minted.
        uint256 totalMetapoolTokensBefore = baseRewardPool.balanceOf(address(this));

        // Calculate fair amount of metapool LP tokens, eg BUSDFRAXBP3CRV-f, using virtual prices for vault assets (crvFRAX)
        uint256 minMetapoolTokens = _getMetapoolTokensForAssets(assetsToDeposit);
        // Calculate min amount of metapool LP tokens with max slippage
        // This is used for sandwich attack protection
        minMetapoolTokens = (minMetapoolTokens * (BASIS_SCALE - _slippage)) / BASIS_SCALE;

        // Deposit crvFRAX into metapool and the stake into Convex vault
        uint256 metapoolTokensReceived = _depositAndStake(assetsToDeposit, minMetapoolTokens);

        // Calculate the proportion of shares to mint based on the amount of Metapool LP tokens.
        uint256 sharesToMint = _getSharesFromMetapoolTokens(
            metapoolTokensReceived,
            totalMetapoolTokensBefore,
            totalSupply()
        );
        // Calculate the proportion of shares to mint to the receiver.
        shares = (sharesToMint * _assets) / assetsToDeposit;

        _mint(_receiver, shares);

        emit Deposit(msg.sender, _receiver, _assets, shares);
        // Account any new shares, assets.
        _afterDepositHook(sharesToMint - shares, assetsToDeposit - _assets);
    }

    /// @dev Converts vault assets to shares in two steps
    /// Vault assets (crvFRAX) -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault shares
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
            // Calculate Metapool LP tokens, eg BUSDFRAXBP3CRV-f, for vault assets (crvFRAX)
            (uint256 metapoolTokens, , , ) = CurveFraxBpMetapoolCalculatorLibrary.calcDeposit(
                metapool,
                metapoolToken,
                assetsToDeposit,
                1
            );

            // Calculate the proportion of shares to mint based on the amount of metapool LP tokens, eg BUSDFRAXBP3CRV-f.
            uint256 sharesToMint = _getSharesFromMetapoolTokens(
                metapoolTokens,
                baseRewardPool.balanceOf(address(this)),
                totalSupply()
            );
            // Calculate the callers portion of shares
            shares = (sharesToMint * assets) / assetsToDeposit;
        }
    }

    /// @dev Override `AbstractVault._mint`.
    /// Vault shares -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault assets (crvFRAX)
    function _mint(uint256 shares, address receiver)
        internal
        virtual
        override
        returns (uint256 assets)
    {
        uint256 donatedAssets = _asset.balanceOf(address(this));
        uint256 donatedMetapoolTokens = 0;
        if (donatedAssets > 0) {
            (donatedMetapoolTokens, , , ) = CurveFraxBpMetapoolCalculatorLibrary.calcDeposit(
                metapool,
                metapoolToken,
                donatedAssets,
                1
            );
        }
        // Calculate Curve Metapool LP tokens, eg BUSDFRAXBP3CRV-f, needed to mint the required amount of shares
        uint256 metapoolTokens = _getMetapoolTokensFromShares(
            shares,
            baseRewardPool.balanceOf(address(this)),
            totalSupply()
        );
        uint256 requiredMetapoolTokens = metapoolTokens + donatedMetapoolTokens;

        // Calculate assets needed to deposit into the metapool for the for required metapool lp tokens.
        uint256 assetsToDeposit;
        uint256 invariant;
        uint256 metapoolTotalSupply;
        uint256 baseVirtualPrice;
        (
            assetsToDeposit,
            invariant,
            metapoolTotalSupply,
            baseVirtualPrice
        ) = CurveFraxBpMetapoolCalculatorLibrary.calcMint(
            metapool,
            metapoolToken,
            requiredMetapoolTokens,
            1
        );
        assets = (assetsToDeposit * requiredMetapoolTokens) / metapoolTokens;
        // Protect against sandwich and flash loan attacks where the balance of the metapool is manipulated.
        uint256 maxAssets = (requiredMetapoolTokens *
            invariant *
            CurveFraxBpMetapoolCalculatorLibrary.VIRTUAL_PRICE_SCALE) /
            (metapoolTotalSupply * baseVirtualPrice);
        maxAssets = (maxAssets * (BASIS_SCALE + mintSlippage)) / BASIS_SCALE;

        require(assetsToDeposit <= maxAssets, "too much slippage");

        // Transfer vault's asssets (crvFRAX) from the caller.
        _asset.safeTransferFrom(msg.sender, address(this), assets);

        // Deposit crvFRAX into metapool and the stake into Convex vault
        _depositAndStake(assets, requiredMetapoolTokens);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
        // Account any new shares, assets.
        uint256 donatedShares = donatedAssets == 0
            ? 0
            : (shares * requiredMetapoolTokens) / donatedMetapoolTokens;
        _afterDepositHook(donatedShares, donatedAssets);
    }

    /// @dev Converts vault shares to assets in two steps
    /// Vault shares -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault assets (crvFRAX)
    /// Override `AbstractVault._previewMint`.
    /// changes - It takes into account any asset balance to be included in the next mint.
    function _previewMint(uint256 shares) internal view virtual override returns (uint256 assets) {
        if (shares > 0) {
            uint256 donatedAssets = _asset.balanceOf(address(this));
            uint256 donatedMetapoolTokens = 0;
            if (donatedAssets > 0) {
                (donatedMetapoolTokens, , , ) = CurveFraxBpMetapoolCalculatorLibrary.calcDeposit(
                    metapool,
                    metapoolToken,
                    donatedAssets,
                    1
                );
            }
            uint256 metapoolTokens = _getMetapoolTokensFromShares(
                shares,
                baseRewardPool.balanceOf(address(this)),
                totalSupply()
            );
            (uint256 assetsToDeposit, , , ) = CurveFraxBpMetapoolCalculatorLibrary.calcMint(
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
    /// Vault assets (crvFRAX) -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault shares
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
            ) = CurveFraxBpMetapoolCalculatorLibrary.calcWithdraw(
                    metapool,
                    metapoolToken,
                    assets,
                    1
                );

            // Calculate max metapool tokens using virtual prices
            // This protects against sandwich and flash loan attacks against the the Curve metapool.
            uint256 maxMetapoolTokens = (assets * baseVirtualPrice * metapoolTotalSupply) /
                (invariant * CurveFraxBpMetapoolCalculatorLibrary.VIRTUAL_PRICE_SCALE);
            maxMetapoolTokens =
                (maxMetapoolTokens * (BASIS_SCALE + withdrawSlippage)) /
                BASIS_SCALE;
            require(metapoolTokensRequired <= maxMetapoolTokens, "too much slippage");

            shares = _getSharesFromMetapoolTokens(
                metapoolTokensRequired,
                baseRewardPool.balanceOf(address(this)),
                totalSupply()
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

            // Remove assets (crvFRAX) from the Curve metapool by burning the LP tokens, eg BUSDFRAXBP3CRV-f
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
            (uint256 metapoolTokens, , , ) = CurveFraxBpMetapoolCalculatorLibrary.calcWithdraw(
                metapool,
                metapoolToken,
                assets,
                1
            );

            shares = _getSharesFromMetapoolTokens(
                metapoolTokens,
                baseRewardPool.balanceOf(address(this)),
                totalSupply()
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

    /// @dev Vault shares -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault assets (crvFRAX)
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

            // Calculate Curve Metapool LP tokens, eg BUSDFRAXBP3CRV-f, needed to mint the required amount of shares
            uint256 totalMetapoolTokens = baseRewardPool.balanceOf(address(this));
            uint256 requiredMetapoolTokens = _getMetapoolTokensFromShares(
                _shares,
                totalMetapoolTokens,
                totalSupply()
            );

            // Calculate fair amount of assets (crvFRAX) using virtual prices for metapool LP tokens, eg BUSDFRAXBP3CRV-f
            uint256 minAssets = _getAssetsForMetapoolTokens(requiredMetapoolTokens);
            // Calculate min amount of assets (crvFRAX) with max slippage.
            // This is used for sandwich attack protection.
            minAssets = (minAssets * (BASIS_SCALE - _slippage)) / BASIS_SCALE;

            // Withdraw metapool lp tokens from Convex pool
            // don't claim rewards.
            baseRewardPool.withdrawAndUnwrap(requiredMetapoolTokens, false);

            // Remove assets (crvFRAX) from the Curve metapool by burning the LP tokens, eg BUSDFRAXBP3CRV-f
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
    /// Vault shares -> Metapool LP tokens, eg BUSDFRAXBP3CRV-f -> vault assets (crvFRAX)
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
                totalSupply()
            );
            (assets, , ) = CurveFraxBpMetapoolCalculatorLibrary.calcRedeem(
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
    function _convertToAssets(uint256 shares)
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
                totalSupply()
            );
            assets = CurveFraxBpMetapoolCalculatorLibrary.convertToBaseLp(
                metapool,
                metapoolToken,
                metapoolTokens
            );
        }
    }

    /// @dev Override `AbstractVault._convertToShares`.
    function _convertToShares(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        if (assets > 0) {
            uint256 metapoolTokens = CurveFraxBpMetapoolCalculatorLibrary.convertToMetaLp(
                metapool,
                metapoolToken,
                assets
            );
            shares = _getSharesFromMetapoolTokens(
                metapoolTokens,
                baseRewardPool.balanceOf(address(this)),
                totalSupply()
            );
        }
    }

    /***************************************
                    Utility
    ****************************************/

    /// @dev Add assets (crvFRAX) to the Curve metapool and
    /// deposit the received metapool lp tokens, eg musd3Crv, into a Convex pool.
    function _depositAndStake(uint256 _assets, uint256 _minMetapoolTokens)
        internal
        returns (uint256 metapoolTokens_)
    {
        // Deposit assets (crvFRAX) into the Curve.fi Metapool pool.
        metapoolTokens_ = ICurveMetapool(metapool).add_liquidity([0, _assets], _minMetapoolTokens);

        // Deposit Curve.fi Metapool LP token, eg BUSDFRAXBP3CRV-f, in Convex pool, eg cvxBUSDFRAXBP3CRV-f, and stake.
        booster.deposit(convexPoolId, metapoolTokens_, true);
    }

    /// @dev Utility function to convert Curve Metapool LP tokens, eg BUSDFRAXBP3CRV-f, to expected FraxBP LP tokens (crvFRAX).
    /// @param _metapoolTokens Amount of Curve Metapool LP tokens. eg BUSDFRAXBP3CRV-f
    /// @return expectedAssets Expected amount of FRAX/USDC (crvFRAX) LP tokens.
    function _getAssetsForMetapoolTokens(uint256 _metapoolTokens)
        internal
        view
        returns (uint256 expectedAssets)
    {
        // crvFRAX virtual price in USD. Non-manipulable
        uint256 threePoolVirtualPrice = ICurveFraxBP(basePool).get_virtual_price();
        // Metapool virtual price in USD. eg BUSDFRAXBP3CRV-f/USD
        uint256 metapoolVirtualPrice = ICurveMetapool(metapool).get_virtual_price();

        // Amount of "asset" (crvFRAX) tokens corresponding to Curve Metapool LP tokens, eg BUSDFRAXBP3CRV-f
        // = BUSDFRAXBP3CRV-f/USD price * BUSDFRAXBP3CRV-f amount * crvFRAX scale / (crvFRAX/USD price * BUSDFRAXBP3CRV-f scale)
        expectedAssets =
            (metapoolVirtualPrice * _metapoolTokens * ASSET_SCALE) /
            (threePoolVirtualPrice * metapoolTokenScale);
    }

    /// @dev Utility function to convert FRAX/USDC LP tokens (crvFRAX) to expected Curve Metapool LP tokens (BUSDFRAXBP3CRV-f).
    /// @param _assetsAmount Amount of FraxBP (crvFRAX) LP tokens.
    /// @return expectedMetapoolTokens Amount of Curve Metapool tokens (BUSDFRAXBP3CRV-f) expected from curve.
    function _getMetapoolTokensForAssets(uint256 _assetsAmount)
        internal
        view
        returns (uint256 expectedMetapoolTokens)
    {
        // crvFRAX virtual price in USD. Non-manipulable
        uint256 threePoolVirtualPrice = ICurveFraxBP(basePool).get_virtual_price();
        // Metapool virtual price in USD
        uint256 metapoolVirtualPrice = ICurveMetapool(metapool).get_virtual_price();

        // Amount of Curve Metapool LP tokens corresponding to assets (crvFRAX)
        expectedMetapoolTokens =
            (threePoolVirtualPrice * _assetsAmount * metapoolTokenScale) /
            (metapoolVirtualPrice * ASSET_SCALE);
    }

    function _getSharesFromMetapoolTokens(
        uint256 _metapoolTokens,
        uint256 _totalMetapoolTokens,
        uint256 _totalShares
    ) internal pure returns (uint256 shares) {
        if (_totalMetapoolTokens == 0) {
            shares = _metapoolTokens;
        } else {
            shares = (_metapoolTokens * _totalShares) / _totalMetapoolTokens;
        }
    }

    function _getMetapoolTokensFromShares(
        uint256 _shares,
        uint256 _totalMetapoolTokens,
        uint256 _totalShares
    ) internal pure returns (uint256 metapoolTokens) {
        if (_totalShares == 0) {
            metapoolTokens = _shares;
        } else {
            metapoolTokens = (_shares * _totalMetapoolTokens) / _totalShares;
        }
    }

    /// @dev Function accrue rewards to be implemented, invoked after deposit or mint
    function _afterDepositHook(uint256 newShares, uint256 newAssets) internal virtual;

    /***************************************
                    Emergency Functions
    ****************************************/

    /**
     * @notice Governor liquidates all the vault's assets and send to the governor.
     * Only to be used in an emergency. eg whitehat protection against a hack.
     * The governor is the Protocol DAO's multisig wallet so can not be executed by one person.
     * @param minAssets Minimum amount of asset tokens (crvFRAX) to receive from removing liquidity from the Curve Metapool.
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
        // Approve the Curve.fi metapool, eg BUSDFRAXBP3CRV-f, to transfer the asset crvFRAX.
        _asset.safeApprove(address(metapool), 0);
        _asset.safeApprove(address(metapool), type(uint256).max);
        // Approve the Convex booster contract to transfer the Curve.fi metapool LP token. eg BUSDFRAXBP3CRV-f
        IERC20(metapoolToken).safeApprove(address(booster), 0);
        IERC20(metapoolToken).safeApprove(address(booster), type(uint256).max);
    }
}
