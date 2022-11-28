// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ICurveFraxBP } from "./ICurveFraxBP.sol";
import { ICurveMetapool } from "./ICurveMetapool.sol";

/**
 * @title   Calculates Curve token amounts including fees for FraxBP based Curve.fi metapools.
 * @notice  This has been configured to work for metapools with only two coins, 18 decimal places
 * and FRAX/USDC (crvFRAX) as the base pool. That is, crvFRAX is the second coin in index position 1 of the metapool.
 *
 * WARNING this library can not be used with the GUSD+FRAX metapool as GUSD only has 2 decimal places.
 *
 * This is an alternative to Curve's `calc_token_amount` which does not take into account fees.
 * This library takes into account pool fees.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-19
 * @dev     See Atul Agarwal's post "Understanding the Curve AMM, Part -1: StableSwap Invariant"
 *          for an explaination of the maths behind StableSwap. This includes an explation of the
 *          variables S, D, Ann used in getD and getY.
 *          https://atulagarwal.dev/posts/curveamm/stableswap/
 */
library CurveFraxBpMetapoolCalculatorLibrary {
    /// @notice Curve's FRAX/USDC pool used as a base pool by the Curve metapools.
    address public constant BASE_POOL = 0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2;

    /// @notice Number of coins in the pool.
    uint256 public constant N_COINS = 2;
    uint256 public constant VIRTUAL_PRICE_SCALE = 1e18;
    /// @notice Scale of the Curve.fi metapool fee. 100% = 1e10, 0.04% = 4e6.
    uint256 public constant CURVE_FEE_SCALE = 1e10;
    /// @notice Scales up the mint tokens by 0.002 basis points.
    uint256 public constant MINT_ADJUST = 10000002;
    uint256 public constant MINT_ADJUST_SCALE = 10000000;

    /**
     * @notice Calculates the amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f,
     * to mint for depositing a fixed amount of tokens, eg BUSD or crvFRAX, to the metapool.
     * @param _metapool Curve metapool to deposit tokens. eg BUSD+FRAX
     * @param _metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f
     * @param _tokenAmount The amount of coins, eg BUSD or crvFRAX, to deposit to the metapool.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return mintAmount_ The amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, to mint.
     * @return invariant_ The metapool invariant before the deposit. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the deposit.
     * @return baseVirtualPrice_ Virtual price of the base pool in USD and `VIRTUAL_PRICE_SCALE` decimals.
     */
    function calcDeposit(
        address _metapool,
        address _metapoolToken,
        uint256 _tokenAmount,
        uint256 _coinIndex
    )
        external
        view
        returns (
            uint256 mintAmount_,
            uint256 invariant_,
            uint256 totalSupply_,
            uint256 baseVirtualPrice_
        )
    {
        totalSupply_ = IERC20(_metapoolToken).totalSupply();
        // To save gas, only deal with a non empty pool.
        require(totalSupply_ > 0, "empty pool");

        baseVirtualPrice_ = ICurveFraxBP(BASE_POOL).get_virtual_price();

        // Using separate vairables rather than an array to save gas
        uint256 oldBalancesScaled0 = ICurveMetapool(_metapool).balances(0);
        uint256 oldBalancesScaled1 = ICurveMetapool(_metapool).balances(1);

        // The metapool's amplitude coefficient (A) multiplied by the number of coins in the pool.
        uint256 Ann = ICurveMetapool(_metapool).A() * N_COINS;

        // Calculate invariant before deposit
        invariant_ = _getD(
            [oldBalancesScaled0, (oldBalancesScaled1 * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE],
            Ann
        );

        // Using separate vairables rather than an array to save gas
        uint256 newBalancesScaled0 = _coinIndex == 0
            ? oldBalancesScaled0 + _tokenAmount
            : oldBalancesScaled0;
        uint256 newBalancesScaled1 = _coinIndex == 1
            ? oldBalancesScaled1 + _tokenAmount
            : oldBalancesScaled1;

        // Recalculate invariant after deposit
        uint256 invariantAfterDeposit = _getD(
            [newBalancesScaled0, (newBalancesScaled1 * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE],
            Ann
        );

        // We need to recalculate the invariant accounting for fees to calculate fair user's share
        // fee: uint256 = CurveBase(_base_pool).fee() * BASE_N_COINS / (4 * (BASE_N_COINS - 1))
        uint256 fee = ICurveMetapool(_metapool).fee() / 2;
        uint256 differenceScaled;

        // Get the difference between the actual balance after deposit and the ideal balance if a propotional deposit.
        differenceScaled = _coinIndex == 0
            ? newBalancesScaled0 - ((oldBalancesScaled0 * invariantAfterDeposit) / invariant_)
            : ((oldBalancesScaled0 * invariantAfterDeposit) / invariant_) - oldBalancesScaled0;
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled0 -= (fee * differenceScaled) / CURVE_FEE_SCALE;

        // Get the difference between the actual balance after deposit and the ideal balance if a propotional deposit.
        differenceScaled = _coinIndex == 1
            ? newBalancesScaled1 - ((oldBalancesScaled1 * invariantAfterDeposit) / invariant_)
            : ((oldBalancesScaled1 * invariantAfterDeposit) / invariant_) - oldBalancesScaled1;
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled1 -= (fee * differenceScaled) / CURVE_FEE_SCALE;

        // Recalculate invariant after fees have been taken out
        uint256 invariantAfterFees = _getD(
            [newBalancesScaled0, (newBalancesScaled1 * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE],
            Ann
        );

        // Calculate how much metapool tokens to mint
        mintAmount_ = (totalSupply_ * (invariantAfterFees - invariant_)) / invariant_;
    }

    /**
     * @notice Calculates the amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f,
     * to burn for withdrawing a fixed amount of tokens, eg BUSD or crvFRAX, from the metapool.
     * @param _metapool Curve metapool to withdraw tokens. eg BUSD+FRAX
     * @param _metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f
     * @param _tokenAmount The amount of coins, eg BUSD or crvFRAX, to withdraw from the metapool.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return burnAmount_ The amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, to burn.
     * @return invariant_ The metapool invariant before the withdraw. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the withdraw.
     */
    function calcWithdraw(
        address _metapool,
        address _metapoolToken,
        uint256 _tokenAmount,
        uint256 _coinIndex
    )
        external
        view
        returns (
            uint256 burnAmount_,
            uint256 invariant_,
            uint256 totalSupply_,
            uint256 baseVirtualPrice_
        )
    {
        totalSupply_ = IERC20(_metapoolToken).totalSupply();
        // To save gas, only deal with a non empty pool.
        require(totalSupply_ > 0, "empty pool");

        baseVirtualPrice_ = ICurveFraxBP(BASE_POOL).get_virtual_price();

        // Using separate vairables rather than an array to save gas
        uint256 oldBalancesScaled0 = ICurveMetapool(_metapool).balances(0);
        uint256 oldBalancesScaled1 = ICurveMetapool(_metapool).balances(1);

        // The metapool's amplitude coefficient (A) multiplied by the number of coins in the pool.
        uint256 Ann = ICurveMetapool(_metapool).A() * N_COINS;

        // Calculate invariant before deposit
        invariant_ = _getD(
            [oldBalancesScaled0, (oldBalancesScaled1 * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE],
            Ann
        );

        // Using separate vairables rather than an array to save gas
        uint256 newBalancesScaled0 = _coinIndex == 0
            ? oldBalancesScaled0 - _tokenAmount
            : oldBalancesScaled0;
        uint256 newBalancesScaled1 = _coinIndex == 1
            ? oldBalancesScaled1 - _tokenAmount
            : oldBalancesScaled1;

        // Recalculate invariant after deposit
        uint256 invariantAfterWithdraw = _getD(
            [newBalancesScaled0, (newBalancesScaled1 * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE],
            Ann
        );

        // We need to recalculate the invariant accounting for fees to calculate fair user's share
        // fee: uint256 = CurveBase(_base_pool).fee() * BASE_N_COINS / (4 * (BASE_N_COINS - 1))
        uint256 fee = ICurveMetapool(_metapool).fee() / 2;
        uint256 differenceScaled;

        // Get the difference between the actual balance after deposit and the ideal balance if a propotional deposit.
        differenceScaled = _coinIndex == 0
            ? ((oldBalancesScaled0 * invariantAfterWithdraw) / invariant_) - newBalancesScaled0
            : oldBalancesScaled0 - ((oldBalancesScaled0 * invariantAfterWithdraw) / invariant_);
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled0 -= (fee * differenceScaled) / CURVE_FEE_SCALE;

        // Get the difference between the actual balance after deposit and the ideal balance if a propotional deposit.
        differenceScaled = _coinIndex == 1
            ? ((oldBalancesScaled1 * invariantAfterWithdraw) / invariant_) - newBalancesScaled1
            : oldBalancesScaled1 - ((oldBalancesScaled1 * invariantAfterWithdraw) / invariant_);
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled1 -= (fee * differenceScaled) / CURVE_FEE_SCALE;

        // Recalculate invariant after fees have been taken out
        uint256 invariantAfterFees = _getD(
            [newBalancesScaled0, (newBalancesScaled1 * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE],
            Ann
        );

        // Calculate how much metapool tokens to burn
        burnAmount_ = ((totalSupply_ * (invariant_ - invariantAfterFees)) / invariant_) + 1;
    }

    /**
     * @notice Calculates the amount of metapool coins, eg BUSD or crvFRAX, to deposit into the metapool
     * to mint a fixed amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f.
     * @param _metapool Curve metapool to mint tokens. eg BUSD+FRAX
     * @param _metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f
     * @param _mintAmount The amount of metapool liquidity provider token, eg BUSDFRAXBP3CRV-f, to mint.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return tokenAmount_ The amount of coins, eg BUSD or crvFRAX, to deposit.
     * @return invariant_ The invariant before the mint. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the mint.
     */
    function calcMint(
        address _metapool,
        address _metapoolToken,
        uint256 _mintAmount,
        uint256 _coinIndex
    )
        external
        view
        returns (
            uint256 tokenAmount_,
            uint256 invariant_,
            uint256 totalSupply_,
            uint256 baseVirtualPrice_
        )
    {
        totalSupply_ = IERC20(_metapoolToken).totalSupply();
        // To save gas, only deal with a non empty pool.
        require(totalSupply_ > 0, "empty pool");

        baseVirtualPrice_ = ICurveFraxBP(BASE_POOL).get_virtual_price();

        // Using separate vairables rather than an array to save gas
        uint256 oldBalancesScaled0 = ICurveMetapool(_metapool).balances(0);
        uint256 oldBalancesScaled1 = (ICurveMetapool(_metapool).balances(1) * baseVirtualPrice_) /
            VIRTUAL_PRICE_SCALE;

        // The metapool's amplitude coefficient (A) multiplied by the number of coins in the pool.
        uint256 Ann = ICurveMetapool(_metapool).A() * N_COINS;

        // Calculate invariant before deposit
        invariant_ = _getD([oldBalancesScaled0, oldBalancesScaled1], Ann);

        // Desired invariant after mint
        uint256 invariantAfterMint = invariant_ + ((_mintAmount * invariant_) / totalSupply_);

        // Required coin balance to get to the new invariant after mint
        uint256 requiredBalanceScaled = _getY(
            [oldBalancesScaled0, oldBalancesScaled1],
            Ann,
            _coinIndex,
            invariantAfterMint
        );

        // Adjust balances for fees
        // fee: uint256 = CurveBase(_base_pool).fee() * BASE_N_COINS / (4 * (BASE_N_COINS - 1))
        uint256 fee = ICurveMetapool(_metapool).fee() / 2;
        // Get the difference between the actual balance after deposit and the ideal balance if a propotional deposit.
        // The first assignment is the balance delta but can't use a diff variable due to stack too deep
        uint256 newBalancesScaled0 = _coinIndex == 0
            ? requiredBalanceScaled - ((oldBalancesScaled0 * invariantAfterMint) / invariant_)
            : ((oldBalancesScaled0 * invariantAfterMint) / invariant_) - oldBalancesScaled0;
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled0 = oldBalancesScaled0 - ((newBalancesScaled0 * fee) / CURVE_FEE_SCALE);

        // Get the difference between the actual balance after deposit and the ideal balance if a propotional deposit.
        // The first assignment is the balance delta but can't use a diff variable due to stack too deep
        uint256 newBalancesScaled1 = _coinIndex == 1
            ? requiredBalanceScaled - ((oldBalancesScaled1 * invariantAfterMint) / invariant_)
            : ((oldBalancesScaled1 * invariantAfterMint) / invariant_) - oldBalancesScaled1;
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled1 = oldBalancesScaled1 - ((newBalancesScaled1 * fee) / CURVE_FEE_SCALE);

        // Calculate new coin balance to preserve the invariant
        requiredBalanceScaled = _getY(
            [newBalancesScaled0, newBalancesScaled1],
            Ann,
            _coinIndex,
            invariantAfterMint
        );

        // tokens required to deposit = new coin balance - current coin balance
        // Deposit more to account for rounding errors.
        // If the base pool lp token, eg crvFRAX, then need to convert from USD back to crvFRAX
        // using the base pool virtual price.
        tokenAmount_ = _coinIndex == 0
            ? requiredBalanceScaled - newBalancesScaled0
            : ((requiredBalanceScaled - newBalancesScaled1) * VIRTUAL_PRICE_SCALE) /
                baseVirtualPrice_;

        tokenAmount_ = (tokenAmount_ * MINT_ADJUST) / MINT_ADJUST_SCALE;
    }

    /**
     * @notice Calculates the amount of metapool coins, eg BUSD or crvFRAX, that will be received from the metapool
     * from burning a fixed amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f.
     * @param _metapool Curve metapool to redeem tokens. eg BUSD+FRAX
     * @param _metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f
     * @param _burnAmount The amount of metapool liquidity provider token, eg BUSDFRAXBP3CRV-f, to burn.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return tokenAmount_ The amount of coins, eg BUSD or crvFRAX, to deposit.
     * @return invariant_ The invariant before the redeem. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the redeem.
     */
    function calcRedeem(
        address _metapool,
        address _metapoolToken,
        uint256 _burnAmount,
        uint256 _coinIndex
    )
        external
        view
        returns (
            uint256 tokenAmount_,
            uint256 invariant_,
            uint256 totalSupply_
        )
    {
        totalSupply_ = IERC20(_metapoolToken).totalSupply();
        // To save gas, only deal with a non empty pool.
        require(totalSupply_ > 0, "empty pool");

        uint256 baseVirtualPrice = ICurveFraxBP(BASE_POOL).get_virtual_price();

        // Using separate vairables rather than an array to save gas
        uint256 oldBalancesScaled0 = ICurveMetapool(_metapool).balances(0);
        uint256 oldBalancesScaled1 = (ICurveMetapool(_metapool).balances(1) * baseVirtualPrice) /
            VIRTUAL_PRICE_SCALE;

        // The metapool's amplitude coefficient (A) multiplied by the number of coins in the pool.
        uint256 Ann = ICurveMetapool(_metapool).A() * N_COINS;

        // Calculate invariant before deposit
        invariant_ = _getD([oldBalancesScaled0, oldBalancesScaled1], Ann);

        // Desired invariant after redeem
        uint256 invariantAfterRedeem = invariant_ - ((_burnAmount * invariant_) / totalSupply_);

        // Required coin balance to get to the new invariant after redeem
        uint256 requiredBalanceScaled = _getY(
            [oldBalancesScaled0, oldBalancesScaled1],
            Ann,
            _coinIndex,
            invariantAfterRedeem
        );

        // Adjust balances for fees
        // fee: uint256 = CurveBase(_base_pool).fee() * BASE_N_COINS / (4 * (BASE_N_COINS - 1))
        uint256 fee = ICurveMetapool(_metapool).fee() / 2;
        // Get the difference between the actual balance after deposit and the ideal balance if a propotional redeem.
        // The first assignment is the balance delta but can't use a diff variable due to stack too deep
        uint256 newBalancesScaled0 = _coinIndex == 0
            ? ((oldBalancesScaled0 * invariantAfterRedeem) / invariant_) - requiredBalanceScaled
            : oldBalancesScaled0 - ((oldBalancesScaled0 * invariantAfterRedeem) / invariant_);
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled0 = oldBalancesScaled0 - ((newBalancesScaled0 * fee) / CURVE_FEE_SCALE);

        // Get the difference between the actual balance after deposit and the ideal balance if a propotional redeem.
        // The first assignment is the balance delta but can't use a diff variable due to stack too deep
        uint256 newBalancesScaled1 = _coinIndex == 1
            ? ((oldBalancesScaled1 * invariantAfterRedeem) / invariant_) - requiredBalanceScaled
            : oldBalancesScaled1 - ((oldBalancesScaled1 * invariantAfterRedeem) / invariant_);
        // new balance = old balance - (diff from ideal balance * fee)
        newBalancesScaled1 = oldBalancesScaled1 - ((newBalancesScaled1 * fee) / CURVE_FEE_SCALE);

        // Calculate new coin balance to preserve the invariant
        requiredBalanceScaled = _getY(
            [newBalancesScaled0, newBalancesScaled1],
            Ann,
            _coinIndex,
            invariantAfterRedeem
        );

        // tokens required to deposit = new coin balance - current coin balance
        // Deposit more to account for rounding errors.
        // If the base pool lp token, eg crvFRAX, then need to convert from USD back to crvFRAX
        // using the base pool virtual price.
        tokenAmount_ = _coinIndex == 0
            ? newBalancesScaled0 - requiredBalanceScaled - 1
            : ((newBalancesScaled1 - requiredBalanceScaled - 1) * VIRTUAL_PRICE_SCALE) /
                baseVirtualPrice;
    }

    /**
     * @notice Gets the USD price of one base pool liquidity provider token scaled to `VIRTUAL_PRICE_SCALE`. eg crvFRAX/USD.
     * Note the base pool virtual price is different to the metapool virtual price.
     * The base pool's virtual price is used to price FraxBP's crvFRAX back to USD.
     */
    function getBaseVirtualPrice() external view returns (uint256 baseVirtualPrice_) {
        baseVirtualPrice_ = ICurveFraxBP(BASE_POOL).get_virtual_price();
    }

    /**
     * @notice Gets the metapool and basepool virtual prices. These prices do not change with the balance of the coins in the pools.
     * This means the virtual prices can not be manipulated with flash loans or sandwich attacks.
     * @param metapool Curve metapool to get the virtual price from.
     * @param metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f/USD
     * false will get the base pool's virtual price directly from the base pool.
     * @return metaVirtualPrice_ Metapool's liquidity provider token price in USD scaled to `VIRTUAL_PRICE_SCALE`. eg BUSDFRAXBP3CRV-f/USD
     * @return baseVirtualPrice_ Basepool's liquidity provider token price in USD scaled to `VIRTUAL_PRICE_SCALE`. eg crvFRAX/USD
     */
    function getVirtualPrices(address metapool, address metapoolToken)
        external
        view
        returns (uint256 metaVirtualPrice_, uint256 baseVirtualPrice_)
    {
        baseVirtualPrice_ = ICurveFraxBP(BASE_POOL).get_virtual_price();

        // Calculate invariant before deposit
        uint256 invariant = _getD(
            [
                ICurveMetapool(metapool).balances(0),
                (ICurveMetapool(metapool).balances(1) * baseVirtualPrice_) / VIRTUAL_PRICE_SCALE
            ],
            ICurveMetapool(metapool).A() * N_COINS
        );

        // This will fail if the metapool is empty
        metaVirtualPrice_ = (invariant * VIRTUAL_PRICE_SCALE) / IERC20(metapoolToken).totalSupply();
    }

    /**
     * @notice Values USD amount as base pool LP tokens.
     * Base pool LP = USD amount * virtual price scale / base pool virutal price
     * @param usdAmount Amount of USD scaled to 18 decimal places to value.
     * @return baseLp_ Value in base pool liquidity provider tokens. eg crvFRAX
     */
    function convertUsdToBaseLp(uint256 usdAmount) external view returns (uint256 baseLp_) {
        if (usdAmount > 0) {
            baseLp_ = (usdAmount * VIRTUAL_PRICE_SCALE) /
            ICurveFraxBP(BASE_POOL).get_virtual_price();
        }
    }

    /**
     * @notice Values USD amount as metapool LP tokens.
     * Metapool LP = USD amount * virtual price scale / metapool virutal price
     * @param metapool Curve metapool to get the virtual price from.
     * @param usdAmount Amount of USD scaled to 18 decimal places to value.
     * @return metaLp_ Value in metapool liquidity provider tokens. eg BUSDFRAXBP3CRV-f
     */
    function convertUsdToMetaLp(address metapool, uint256 usdAmount)
        external
        view
        returns (uint256 metaLp_)
    {
        if (usdAmount > 0) {
            metaLp_ =
                (usdAmount * VIRTUAL_PRICE_SCALE) /
                ICurveMetapool(metapool).get_virtual_price();
        }
    }

    /**
     * @notice Values metapool liquidity provider (LP) tokens as base pool LP tokens.
     * Base pool LP = metapool LP tokens * metapool USD value * base pool virtual price scale /
     * (total metapool LP supply * base pool virutal price)
     * @param metapool Curve metapool to get the virtual price from.
     * @param metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f/USD
     * @param metaLp Amount of metapool liquidity provider tokens to value.
     * @return baseLp_ Value in base pool liquidity provider tokens.
     */
    function convertToBaseLp(
        address metapool,
        address metapoolToken,
        uint256 metaLp
    ) external view returns (uint256 baseLp_) {
        if (metaLp > 0) {
            // Get value of one base pool lp token in USD scaled to VIRTUAL_PRICE_SCALE. eg crvFRAX/USD.
            uint256 baseVirtualPrice = ICurveFraxBP(BASE_POOL).get_virtual_price();

            // Calculate metapool invariant which is value of the metapool in USD
            uint256 invariant = _getD(
                [
                    ICurveMetapool(metapool).balances(0),
                    (ICurveMetapool(metapool).balances(1) * baseVirtualPrice) / VIRTUAL_PRICE_SCALE
                ],
                ICurveMetapool(metapool).A() * N_COINS
            );

            uint256 metaVirtualPrice = (invariant * VIRTUAL_PRICE_SCALE) /
                IERC20(metapoolToken).totalSupply();

            // This will fail if the metapool is empty
            baseLp_ = (metaLp * metaVirtualPrice) / baseVirtualPrice;
        }
    }

    /**
     * @notice Values base pool liquidity provider (LP) tokens as metapool LP tokens.
     * Metapool LP = base pool LP tokens * base pool virutal price * total metapool LP supply /
     * (metapool USD value * base pool virtual price scale)
     * @param metapool Curve metapool to get the virtual price from.
     * @param metapoolToken Curve metapool liquidity provider token. eg BUSDFRAXBP3CRV-f/USD
     * @param baseLp Amount of base pool liquidity provider tokens to value.
     * @return metaLp_ Value in metapool liquidity provider tokens.
     */
    function convertToMetaLp(
        address metapool,
        address metapoolToken,
        uint256 baseLp
    ) external view returns (uint256 metaLp_) {
        if (baseLp > 0) {
            uint256 baseVirtualPrice = ICurveFraxBP(BASE_POOL).get_virtual_price();

            // Calculate invariant which is value of metapool in USD
            uint256 invariant = _getD(
                [
                    ICurveMetapool(metapool).balances(0),
                    (ICurveMetapool(metapool).balances(1) * baseVirtualPrice) / VIRTUAL_PRICE_SCALE
                ],
                ICurveMetapool(metapool).A() * N_COINS
            );

            uint256 metaVirtualPrice = (invariant * VIRTUAL_PRICE_SCALE) /
                IERC20(metapoolToken).totalSupply();

            metaLp_ = (baseLp * baseVirtualPrice) / metaVirtualPrice;
        }
    }

    /**
     * @notice Uses Newton’s Method to iteratively solve the StableSwap invariant (D).
     * @dev This is a port of Curve's Vyper implementation with some gas optimizations.
     * Curve's implementation is `get_D` in https://etherscan.io/address/0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6#code
     *
     * @param xp  The scaled balances of the coins in the pool.
     * @param Ann The amplitude coefficient multiplied by the number of coins in the pool (A * N_COINS).
     * @return D  The StableSwap invariant
     */
    function _getD(uint256[N_COINS] memory xp, uint256 Ann) internal pure returns (uint256 D) {
        uint256 S = xp[0] + xp[1];

        // Do these multiplications here rather than in each loop
        uint256 xp0 = xp[0] * N_COINS;
        uint256 xp1 = xp[1] * N_COINS;

        uint256 Dprev = 0;
        D = S;
        uint256 D_P;
        for (uint256 i = 0; i < 255; ) {
            // D_P: uint256 = D
            // for _x in xp:
            //     D_P = D_P * D / (_x * N_COINS)  # If division by 0, this will be borked: only withdrawal will work. And that is good
            D_P = ((((D * D) / xp0) * D) / xp1);

            Dprev = D;
            D = ((Ann * S + D_P * N_COINS) * D) / ((Ann - 1) * D + (N_COINS + 1) * D_P);
            // Equality with the precision of 1
            if (D > Dprev) {
                if (D - Dprev <= 1) break;
            } else {
                if (Dprev - D <= 1) break;
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Uses Newton’s Method to iteratively solve the required balance of a coin to maintain StableSwap invariant (D).
     * @dev This is a port of Curve's Vyper implementation with some gas optimizations.
     * Curve's implementation is `get_y_D` in https://etherscan.io/address/0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6#code
     *
     * @param xp  The scaled balances of the coins in the pool.
     * @param Ann The amplitude coefficient multiplied by the number of coins in the pool (A * N_COINS).
     * @param coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @param D  The StableSwap invariant
     * @return y The required balance of coin at `coinIndex`.
     */
    function _getY(
        uint256[N_COINS] memory xp,
        uint256 Ann,
        uint256 coinIndex,
        uint256 D
    ) internal pure returns (uint256 y) {
        uint256 c = D;
        uint256 S_ = 0;
        if (coinIndex != 0) {
            S_ += xp[0];
            c = (c * D) / (xp[0] * N_COINS);
        }
        if (coinIndex != 1) {
            S_ += xp[1];
            c = (c * D) / (xp[1] * N_COINS);
        }

        c = (c * D) / (Ann * N_COINS);
        uint256 b = S_ + D / Ann;
        uint256 yPrev = 0;
        y = D;
        uint256 i = 0;
        for (; i < 255; ) {
            yPrev = y;
            y = (y * y + c) / (2 * y + b - D);

            // Equality with the precision of 1
            if (y > yPrev) {
                if (y - yPrev <= 1) break;
            } else {
                if (yPrev - y <= 1) break;
            }

            unchecked {
                ++i;
            }
        }
    }
}
