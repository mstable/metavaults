// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// libs
import { AbstractSlippage } from "../AbstractSlippage.sol";
import { AbstractVault, IERC20 } from "../../AbstractVault.sol";
import { ConvexFraxBpAbstractVault } from "./ConvexFraxBpAbstractVault.sol";
import { LiquidatorAbstractVault } from "../../liquidator/LiquidatorAbstractVault.sol";
import { LiquidatorStreamAbstractVault } from "../../liquidator/LiquidatorStreamAbstractVault.sol";
import { LiquidatorStreamFeeAbstractVault } from "../../liquidator/LiquidatorStreamFeeAbstractVault.sol";
import { VaultManagerRole } from "../../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../../tokens/InitializableToken.sol";
import { ICurveFraxBP } from "../../../peripheral/Curve/ICurveFraxBP.sol";
import { ICurveMetapool } from "../../../peripheral/Curve/ICurveMetapool.sol";
import { CurveFraxBpMetapoolCalculatorLibrary } from "../../../peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol";

/**
 * @title   Convex Vault for FRAX based Curve Metapools that liquidates CRV and CVS rewards.
 * @notice  ERC-4626 vault that deposits Curve FRAX/USDC LP tokens (crvFRAX) in a FraxBP base Curve Metapool;
 * deposits the Metapool LP token in Convex; and stakes the Convex LP token,
 * in Convex for CRV and CVX rewards. The Convex rewards are swapped for a FRAX or USDC tokens
 * using the Liquidator module and donated back to the vault.
 * On donation back to the vault, the FRAX or USDC is deposited into the underlying Curve Metapool;
 * the Curve Metapool LP token is deposited into the corresponding Convex pool and the Convex LP token staked.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-19
 */
contract ConvexFraxBpLiquidatorVault is
    ConvexFraxBpAbstractVault,
    LiquidatorStreamFeeAbstractVault,
    Initializable
{
    using SafeERC20 for IERC20;

    address public constant FRAX = 0x853d955aCEf822Db058eb8505911ED77F175b99e;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    /// @notice Token that the liquidator sells CRV and CVX rewards for. This must be a FRAX or USDC.
    address internal donateToken_;

    event DonateTokenUpdated(address token);

    /**
     * @param _nexus               Address of the Nexus contract that resolves protocol modules and roles..
     * @param _asset               Address of the vault's asset which is Curve's FRAX/USDC LP token (crvFRAX).
     * @param _data                Initial data for ConvexFraxBpAbstractVault constructor.
     * @param _streamDuration      Number of seconds the increased asssets per share will be streamed after liquidated rewards are donated back.
     */
    constructor(
        address _nexus,
        address _asset,
        ConstructorData memory _data,
        uint256 _streamDuration
    )
        VaultManagerRole(_nexus)
        AbstractVault(_asset)
        ConvexFraxBpAbstractVault(_data)
        LiquidatorStreamAbstractVault(_streamDuration)
    {}

    /**
     *
     * @param _name            Name of vault.
     * @param _symbol          Symbol of vault.
     * @param _vaultManager    Trusted account that can perform vault operations. eg rebalance.
     * @param _slippageData        Initial slippage limits.
     * @param _rewardTokens    Address of the reward tokens.
     * @param __donateToken    FRAX or USDC token that CVX and CRV rewards are swapped to by the Liquidator.
     * @param _feeReceiver     Account that receives the performance fee as shares.
     * @param _donationFee     Donation fee scaled to `FEE_SCALE`.
     */
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _vaultManager,
        SlippageData memory _slippageData,
        address[] memory _rewardTokens,
        address __donateToken,
        address _feeReceiver,
        uint256 _donationFee
    ) external initializer {
        // Vault initialization
        VaultManagerRole._initialize(_vaultManager);
        AbstractSlippage._initialize(_slippageData);
        LiquidatorAbstractVault._initialize(_rewardTokens);
        ConvexFraxBpAbstractVault._initialize();
        LiquidatorStreamFeeAbstractVault._initialize(_feeReceiver, _donationFee);

        // Set the vault's decimals to the same as the metapool's LP token, eg BUSDFRAXBP3CRV-f
        uint8 decimals_ = InitializableToken(address(metapoolToken)).decimals();
        InitializableToken._initialize(_name, _symbol, decimals_);

        _setDonateToken(__donateToken);

        // Approve the Curve.fi FRAX/USDC base pool to transfer the FRAX and USDC tokens.
        IERC20(FRAX).safeApprove(address(basePool), type(uint256).max);
        IERC20(USDC).safeApprove(address(basePool), type(uint256).max);
    }

    function totalSupply()
        public
        view
        virtual
        override(ERC20, IERC20, LiquidatorStreamAbstractVault)
        returns (uint256)
    {
        return LiquidatorStreamAbstractVault.totalSupply();
    }

    /***************************************
                Liquidator Hooks
    ****************************************/

    /**
     * @return token Token that the liquidator needs to swap reward tokens to which must be either FRAX or USDC.
     */
    function _donateToken(address) internal view override returns (address token) {
        token = donateToken_;
    }

    function _beforeCollectRewards() internal virtual override {
        // claim CRV and CVX from Convex
        // also claim any additional rewards if any.
        baseRewardPool.getReward(address(this), true);
    }

    /**
     * @dev Converts donated tokens (FRAX, USDC) to vault assets (crvFRAX) and shares.
     * Transfers token from donor to vault.
     * Adds the token to the frazBP to receive the vault asset (crvFRAX) in exchange.
     * The resulting asset (crvFRAX) stays in the vault to be deposit in the next deposit / mint tx
     */
    function _convertTokens(address token, uint256 amount)
        internal
        virtual
        override
        returns (uint256 shares_, uint256 assets_)
    {
        // validate token is in FRAX/USDC pool and scale all amounts up to 18 decimals
        uint256[2] memory basePoolAmounts;
        uint256 scaledUsdAmount;
        if (token == FRAX) {
            scaledUsdAmount = amount;
            basePoolAmounts[0] = amount;
        } else if (token == USDC) {
            scaledUsdAmount = amount * 1e12;
            basePoolAmounts[1] = amount;
        } else {
            revert("token not in FraxBP");
        }

        // Transfer FRAX or USDC from donor
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Deposit FRAX or USDC and receive Curve.fi FRAX/USDC LP tokens (crvFRAX).
        ICurveFraxBP(basePool).add_liquidity(
            basePoolAmounts,
            0 // slippage protection will be done on the second deposit into the Metapool
        );

        // Slippage and flash loan protection
        // Convert FRAX or USDC to Metapool LP tokens, eg BUSDFRAXBP3CRV-f.
        uint256 minMetapoolTokens = CurveFraxBpMetapoolCalculatorLibrary.convertUsdToMetaLp(
            metapool,
            scaledUsdAmount
        );
        // Then reduce the metapol LP tokens amount by the slippage. eg 10 basis points = 0.1%
        minMetapoolTokens = (minMetapoolTokens * (BASIS_SCALE - depositSlippage)) / BASIS_SCALE;

        assets_ = _asset.balanceOf(address(this));
        shares_ = 0;
    }

    /***************************************
     Vault overrides with streamRewards modifier
    ****************************************/

    // As two vaults (ConvexFraxBpAbstractVault and LiquidatorStreamFeeAbstractVault) are being inheriterd, Solidity needs to know which functions to override.

    function deposit(uint256 assets, address receiver)
        external
        virtual
        override(AbstractVault, LiquidatorStreamAbstractVault)
        whenNotPaused
        streamRewards
        returns (uint256 shares)
    {
        shares = _deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        external
        virtual
        override(AbstractVault, LiquidatorStreamAbstractVault)
        whenNotPaused
        streamRewards
        returns (uint256 assets)
    {
        assets = _mint(shares, receiver);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    )
        external
        virtual
        override(AbstractVault, LiquidatorStreamAbstractVault)
        whenNotPaused
        streamRewards
        returns (uint256 assets)
    {
        assets = _redeem(shares, receiver, owner);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    )
        external
        virtual
        override(AbstractVault, LiquidatorStreamAbstractVault)
        whenNotPaused
        streamRewards
        returns (uint256 shares)
    {
        shares = _withdraw(assets, receiver, owner);
    }

    /***************************************
            Vault overrides Hooks
    ****************************************/

    function _previewDeposit(uint256 assets)
        internal
        view
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        returns (uint256 shares)
    {
        shares = ConvexFraxBpAbstractVault._previewDeposit(assets);
    }

    function _previewMint(uint256 shares)
        internal
        view
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        returns (uint256 assets)
    {
        assets = ConvexFraxBpAbstractVault._previewMint(shares);
    }

    function _previewRedeem(uint256 shares)
        internal
        view
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        returns (uint256 assets)
    {
        assets = ConvexFraxBpAbstractVault._previewRedeem(shares);
    }

    function _previewWithdraw(uint256 assets)
        internal
        view
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        returns (uint256 shares)
    {
        shares = ConvexFraxBpAbstractVault._previewWithdraw(assets);
    }

    function _deposit(uint256 assets, address receiver)
        internal
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        streamRewards
        returns (uint256 shares)
    {
        shares = ConvexFraxBpAbstractVault._deposit(assets, receiver);
    }

    function _mint(uint256 shares, address receiver)
        internal
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        streamRewards
        returns (uint256 assets)
    {
        assets = ConvexFraxBpAbstractVault._mint(shares, receiver);
    }

    function _redeem(
        uint256 shares,
        address receiver,
        address owner
    ) internal virtual override(AbstractVault, ConvexFraxBpAbstractVault) returns (uint256 assets) {
        assets = ConvexFraxBpAbstractVault._redeem(shares, receiver, owner);
    }

    function _withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) internal virtual override(AbstractVault, ConvexFraxBpAbstractVault) returns (uint256 shares) {
        shares = ConvexFraxBpAbstractVault._withdraw(assets, receiver, owner);
    }

    /// @dev use LiquidatorStreamAbstractVault._streamNewShares implementation.
    function _afterDepositHook(
        uint256 newShares,
        uint256 newAssets
    ) internal virtual override(ConvexFraxBpAbstractVault) {
        LiquidatorStreamAbstractVault._streamNewShares(newShares, newAssets);
    }

    function _convertToAssets(uint256 shares)
        internal
        view
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        returns (uint256 assets)
    {
        assets = ConvexFraxBpAbstractVault._convertToAssets(shares);
    }

    function _convertToShares(uint256 assets)
        internal
        view
        virtual
        override(AbstractVault, ConvexFraxBpAbstractVault)
        returns (uint256 shares)
    {
        shares = ConvexFraxBpAbstractVault._convertToShares(assets);
    }

     /***************************************
                    Vault Admin
    ****************************************/

    /// @dev Sets the token the rewards are swapped for and donated back to the vault.
    function _setDonateToken(address __donateToken) internal {
        require(
            __donateToken == FRAX || __donateToken == USDC,
            "donate token not in FraxBP"
        );
        donateToken_ = __donateToken;

        emit DonateTokenUpdated(__donateToken);
    }

    /**
     * @notice  Vault manager or governor sets the token the rewards are swapped for and donated back to the vault.
     * @param __donateToken a token in the FraxBP (FRAX, USDC).
     */
    function setDonateToken(address __donateToken) external onlyKeeperOrGovernor {
        _setDonateToken(__donateToken);
    }
}
