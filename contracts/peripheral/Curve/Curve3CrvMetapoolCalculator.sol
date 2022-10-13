// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Curve3CrvMetapoolCalculatorLibrary } from "./Curve3CrvMetapoolCalculatorLibrary.sol";

/**
 * @title   Curve3CrvMetapoolCalculatorLibrary wrapper for testing.
 * @notice  This has been configured to work for metapools with only two coins, 18 decimal places and 3Pool (3Crv) as the base pool.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-07-20
 */
contract Curve3CrvMetapoolCalculator {
    /// @notice Curve's 3Crv based metapool. eg the musd3Crv pool
    address public immutable metapool;
    /// @notice Curve's Liquidity Provider (LP) token for the metapool. eg musd3Crv.
    address public immutable metapoolToken;

    /**
     * @param _metapool Curve metapool. eg the musd3Crv pool. This is different to the metapool LP token.
     * @param _metapoolToken Curve liquidity provider token for the metapool. eg musd3Crv
     */
    constructor(
        address _metapool,
        address _metapoolToken
    ) {
        metapool = _metapool;
        metapoolToken = _metapoolToken;
    }

    /**
     * @notice Calculates the amount of metapool liquidity provider tokens, eg musd3Crv,
     * to mint for depositing a fixed amount of tokens, eg mUSD or 3Crv, to the metapool.
     * @param _tokenAmount The amount of coins, eg mUSD or 3Crv, to deposit to the metapool.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg musd, 1 = base coin, eg 3Crv.
     * @return mintAmount_ The amount of metapool liquidity provider tokens, eg musd3Crv, to mint.
     * @return invariant_ The metapool invariant before the deposit. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg musd3Crv, before the deposit.
     * @return baseVirtualPrice_ Virtual price of the base pool in USD and `VIRTUAL_PRICE_SCALE` decimals.
     */
    function calcDeposit(
        uint256 _tokenAmount,
        uint256 _coinIndex
    )
        public
        view
        returns (
            uint256 mintAmount_,
            uint256 invariant_,
            uint256 totalSupply_,
            uint256 baseVirtualPrice_
        )
    {
        return
            Curve3CrvMetapoolCalculatorLibrary.calcDeposit(
                metapool,
                metapoolToken,
                _tokenAmount,
                _coinIndex
            );
    }

    /**
     * @notice Calculates the amount of metapool liquidity provider tokens, eg musd3Crv,
     * to burn for withdrawing a fixed amount of tokens, eg mUSD or 3Crv, from the metapool.
     * @param _tokenAmount The amount of coins, eg mUSD or 3Crv, to withdraw from the metapool.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg musd, 1 = base coin, eg 3Crv.
     * @return burnAmount_ The amount of metapool liquidity provider tokens, eg musd3Crv, to burn.
     * @return invariant_ The metapool invariant before the withdraw. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg musd3Crv, before the withdraw.
     */
    function calcWithdraw(uint256 _tokenAmount, uint256 _coinIndex)
        public
        view
        returns (
            uint256 burnAmount_,
            uint256 invariant_,
            uint256 totalSupply_,
            uint256 baseVirtualPrice_
        )
    {
        return
            Curve3CrvMetapoolCalculatorLibrary.calcWithdraw(
                metapool,
                metapoolToken,
                _tokenAmount,
                _coinIndex
            );
    }

    /**
     * @notice Calculates the amount of metapool coins, eg mUSD or 3Crv, to deposit into the metapool
     * to mint a fixed amount of metapool liquidity provider tokens, eg musd3Crv.
     * @param _mintAmount The amount of metapool liquidity provider token, eg musd3Crv, to mint.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg musd, 1 = base coin, eg 3Crv.
     * @return tokenAmount_ The amount of coins, eg mUSD or 3Crv, to deposit.
     * @return invariant_ The invariant before the mint. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg musd3Crv, before the mint.
     */
    function calcMint(uint256 _mintAmount, uint256 _coinIndex)
        public
        view
        returns (
            uint256 tokenAmount_,
            uint256 invariant_,
            uint256 totalSupply_,
            uint256 baseVirtualPrice_
        )
    {
        return
            Curve3CrvMetapoolCalculatorLibrary.calcMint(
                metapool,
                metapoolToken,
                _mintAmount,
                _coinIndex
            );
    }

    /**
     * @notice Calculates the amount of metapool coins, eg mUSD or 3Crv, that will be received from the metapool
     * from burning a fixed amount of metapool liquidity provider tokens, eg musd3Crv.
     * @param _burnAmount The amount of metapool liquidity provider token, eg musd3Crv, to burn.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg musd, 1 = base coin, eg 3Crv.
     * @return tokenAmount_ The amount of coins, eg mUSD or 3Crv, to deposit.
     * @return invariant_ The invariant before the redeem. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg musd3Crv, before the redeem.
     */
    function calcRedeem(uint256 _burnAmount, uint256 _coinIndex)
        public
        view
        returns (
            uint256 tokenAmount_,
            uint256 invariant_,
            uint256 totalSupply_
        )
    {
        return
            Curve3CrvMetapoolCalculatorLibrary.calcRedeem(
                metapool,
                metapoolToken,
                _burnAmount,
                _coinIndex
            );
    }

    /**
     * @notice Gets the USD price of one base pool liquidity provider token scaled to `VIRTUAL_PRICE_SCALE`. eg 3Crv/USD.
     * This is either going to be from
     * 1. The 10 minute cache in the metapool.
     * 2. The latest directly from the base pool.
     * Note the base pool virtual price is different to the metapool virtual price.
     * The base pool's virtual price is used to price 3Pool's 3Crv back to USD.
     * @param cached true will try and get the base pool's virtual price from the metapool cache.
     * false will get the base pool's virtual price directly from the base pool.
     */
    function getBaseVirtualPrice(bool cached) external view returns (uint256 baseVirtualPrice_) {
        baseVirtualPrice_ = Curve3CrvMetapoolCalculatorLibrary.getBaseVirtualPrice(metapool, cached);
    }

    /**
     * @notice Gets the metapool and basepool virtual prices. These prices do not change with the balance of the coins in the pools.
     * This means the virtual prices can not be manipulated with flash loans or sandwich attacks.
     * @param cached true will try and get the base pool's virtual price from the metapool cache.
     * false will get the base pool's virtual price directly from the base pool.
     * @return metaVirtualPrice_ Metapool's liquidity provider token price in USD scaled to `VIRTUAL_PRICE_SCALE`. eg musd3Crv/USD
     * @return baseVirtualPrice_ Basepool's liquidity provider token price in USD scaled to `VIRTUAL_PRICE_SCALE`. eg 3Crv/USD
     */
    function getVirtualPrices(bool cached)
        public
        view
        returns (uint256 metaVirtualPrice_, uint256 baseVirtualPrice_)
    {
        (metaVirtualPrice_, baseVirtualPrice_) = Curve3CrvMetapoolCalculatorLibrary.getVirtualPrices(metapool, metapoolToken, cached);
    }

    /**
     * @notice Values metapool liquidity provider (LP) tokens as base pool LP tokens.
     * Base pool LP = metapool LP tokens * metapool USD value * base pool virtual price scale /
     * (total metapool LP supply * base pool virutal price)
     * @param metaLp Amount of metapool liquidity provider tokens to value.
     * @param cached true will try and get the base pool's virtual price from the metapool cache.
     * false will get the base pool's virtual price directly from the base pool.
     * @return baseLp_ Value in base pool liquidity provider tokens.
     */
    function convertToBaseLp(uint256 metaLp, bool cached) public view returns (uint256 baseLp_) {
        baseLp_ = Curve3CrvMetapoolCalculatorLibrary.convertToBaseLp(metapool, metapoolToken, metaLp, cached);
    }

    /**
     * @notice Values base pool liquidity provider (LP) tokens as metapool LP tokens.
     * Metapool LP = base pool LP tokens * base pool virutal price * total metapool LP supply /
     * (metapool USD value * base pool virtual price scale)
     * @param baseLp Amount of base pool liquidity provider tokens to value.
     * @param cached true will try and get the base pool's virtual price from the metapool cache.
     * false will get the base pool's virtual price directly from the base pool.
     * @return metaLp_ Value in metapool liquidity provider tokens.
     */
    function convertToMetaLp(uint256 baseLp, bool cached) public view returns (uint256 metaLp_) {
        metaLp_ = Curve3CrvMetapoolCalculatorLibrary.convertToMetaLp(metapool, metapoolToken, baseLp, cached);
    }
}
