// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { CurveFraxBpMetapoolCalculatorLibrary } from "./CurveFraxBpMetapoolCalculatorLibrary.sol";

/**
 * @title   CurveFraxBpMetapoolCalculatorLibrary wrapper for testing.
 * @notice  This has been configured to work for metapools with only two coins, 18 decimal places and 3Pool (3Crv) as the base pool.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-07-20
 */
contract CurveFraxBpMetapoolCalculator {
    /// @notice Curve's FraxBP based metapool. eg the BUSD+FRAX pool
    address public immutable metapool;
    /// @notice Curve's Liquidity Provider (LP) token for the metapool. eg BUSDFRAXBP3CRV-f.
    address public immutable metapoolToken;

    /**
     * @param _metapool Curve metapool. eg the musd3Crv pool. This is different to the metapool LP token.
     * @param _metapoolToken Curve liquidity provider token for the metapool. eg musd3Crv
     */
    constructor(address _metapool, address _metapoolToken) {
        metapool = _metapool;
        metapoolToken = _metapoolToken;
    }

    /**
     * @notice Calculates the amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f,
     * to mint for depositing a fixed amount of tokens, eg BUSD or crvFRAX, to the metapool.
     * @param _tokenAmount The amount of coins, eg BUSD or crvFRAX, to deposit to the metapool.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return mintAmount_ The amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, to mint.
     * @return invariant_ The metapool invariant before the deposit. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the deposit.
     * @return baseVirtualPrice_ Virtual price of the base pool in USD and `VIRTUAL_PRICE_SCALE` decimals.
     */
    function calcDeposit(uint256 _tokenAmount, uint256 _coinIndex)
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
            CurveFraxBpMetapoolCalculatorLibrary.calcDeposit(
                metapool,
                metapoolToken,
                _tokenAmount,
                _coinIndex
            );
    }

    /**
     * @notice Calculates the amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f,
     * to burn for withdrawing a fixed amount of tokens, eg BUSD or crvFRAX, from the metapool.
     * @param _tokenAmount The amount of coins, eg BUSD or crvFRAX, to withdraw from the metapool.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return burnAmount_ The amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, to burn.
     * @return invariant_ The metapool invariant before the withdraw. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the withdraw.
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
            CurveFraxBpMetapoolCalculatorLibrary.calcWithdraw(
                metapool,
                metapoolToken,
                _tokenAmount,
                _coinIndex
            );
    }

    /**
     * @notice Calculates the amount of metapool coins, eg BUSD or crvFRAX, to deposit into the metapool
     * to mint a fixed amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f.
     * @param _mintAmount The amount of metapool liquidity provider token, eg BUSDFRAXBP3CRV-f, to mint.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return tokenAmount_ The amount of coins, eg BUSD or crvFRAX, to deposit.
     * @return invariant_ The invariant before the mint. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the mint.
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
            CurveFraxBpMetapoolCalculatorLibrary.calcMint(
                metapool,
                metapoolToken,
                _mintAmount,
                _coinIndex
            );
    }

    /**
     * @notice Calculates the amount of metapool coins, eg BUSD or crvFRAX, that will be received from the metapool
     * from burning a fixed amount of metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f.
     * @param _burnAmount The amount of metapool liquidity provider token, eg BUSDFRAXBP3CRV-f, to burn.
     * @param _coinIndex The index of the coin in the metapool. 0 = eg BUSD, 1 = crvFRAX.
     * @return tokenAmount_ The amount of coins, eg BUSD or crvFRAX, to deposit.
     * @return invariant_ The invariant before the redeem. This is the USD value of the metapool.
     * @return totalSupply_ Total metapool liquidity provider tokens, eg BUSDFRAXBP3CRV-f, before the redeem.
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
            CurveFraxBpMetapoolCalculatorLibrary.calcRedeem(
                metapool,
                metapoolToken,
                _burnAmount,
                _coinIndex
            );
    }

    /**
     * @notice Values metapool liquidity provider (LP) tokens as base pool LP tokens.
     * Base pool LP = metapool LP tokens * metapool USD value * base pool virtual price scale /
     * (total metapool LP supply * base pool virutal price)
     * @param metaLp Amount of metapool liquidity provider tokens to value.
     * @return baseLp_ Value in base pool liquidity provider tokens.
     */
    function convertToBaseLp(uint256 metaLp) public view returns (uint256 baseLp_) {
        baseLp_ = CurveFraxBpMetapoolCalculatorLibrary.convertToBaseLp(
            metapool,
            metapoolToken,
            metaLp
        );
    }

    /**
     * @notice Values base pool liquidity provider (LP) tokens as metapool LP tokens.
     * Metapool LP = base pool LP tokens * base pool virutal price * total metapool LP supply /
     * (metapool USD value * base pool virtual price scale)
     * @param baseLp Amount of base pool liquidity provider tokens to value.
     * @return metaLp_ Value in metapool liquidity provider tokens.
     */
    function convertToMetaLp(uint256 baseLp) public view returns (uint256 metaLp_) {
        metaLp_ = CurveFraxBpMetapoolCalculatorLibrary.convertToMetaLp(
            metapool,
            metapoolToken,
            baseLp
        );
    }
}
