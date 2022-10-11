// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Curve3PoolCalculatorLibrary } from "./Curve3PoolCalculatorLibrary.sol";
import { ICurve3Pool } from "./ICurve3Pool.sol";

/**
 * @title   Calculates Curve token amounts including fees for the Curve.fi 3Pool.
 * @notice  This has been configured to work for Curve 3Pool which contains DAI, USDC and USDT.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-07-12
 * @dev     See Atul Agarwal's post "Understanding the Curve AMM, Part -1: StableSwap Invariant"
 *          for an explaination of the maths behind StableSwap. This includes an explation of the
 *          variables S, D, Ann used in _getD
 *          https://atulagarwal.dev/posts/curveamm/stableswap/
 */
contract Curve3PoolCalculator {
    /**
     * @notice Calculates the amount of liquidity provider tokens (3Crv) to mint for depositing a fixed amount of pool tokens.
     * @param _tokenAmount The amount of coins, eg DAI, USDC or USDT, to deposit.
     * @param _coinIndex The index of the coin in the pool to withdraw. 0 = DAI, 1 = USDC, 2 = USDT.
     * @return mintAmount_ The amount of liquidity provider tokens (3Crv) to mint.
     * @return invariant_ The invariant before the deposit. This is the USD value of the pool.
     * @return totalSupply_ Total liquidity provider tokens (3Crv) before the deposit.
     */
    function calcDeposit(uint256 _tokenAmount, uint256 _coinIndex)
        public
        view
        returns (
            uint256 mintAmount_,
            uint256 invariant_,
            uint256 totalSupply_
        )
    {
        return Curve3PoolCalculatorLibrary.calcDeposit(_tokenAmount, _coinIndex);
    }

    /**
     * @notice Calculates the amount of liquidity provider tokens (3Crv) to burn for receiving a fixed amount of pool tokens.
     * @param _tokenAmount The amount of coins, eg DAI, USDC or USDT, required to receive.
     * @param _coinIndex The index of the coin in the pool to withdraw. 0 = DAI, 1 = USDC, 2 = USDT.
     * @return burnAmount_ The amount of liquidity provider tokens (3Crv) to burn.
     * @return invariant_ The invariant before the withdraw. This is the USD value of the pool.
     * @return totalSupply_ Total liquidity provider tokens (3Crv) before the withdraw.
     */
    function calcWithdraw(uint256 _tokenAmount, uint256 _coinIndex)
        public
        view
        returns (
            uint256 burnAmount_,
            uint256 invariant_,
            uint256 totalSupply_
        )
    {
        return Curve3PoolCalculatorLibrary.calcWithdraw(_tokenAmount, _coinIndex);
    }

    /**
     * @notice Calculates the amount of pool coins to deposit for minting a fixed amount of liquidity provider tokens (3Crv).
     * @param _mintAmount The amount of liquidity provider tokens (3Crv) to mint.
     * @param _coinIndex The index of the coin in the pool to withdraw. 0 = DAI, 1 = USDC, 2 = USDT.
     * @return tokenAmount_ The amount of coins, eg DAI, USDC or USDT, to deposit.
     * @return invariant_ The invariant before the mint. This is the USD value of the pool.
     * @return totalSupply_ Total liquidity provider tokens (3Crv) before the mint.
     */
    function calcMint(uint256 _mintAmount, uint256 _coinIndex)
        public
        view
        returns (
            uint256 tokenAmount_,
            uint256 invariant_,
            uint256 totalSupply_
        )
    {
        return Curve3PoolCalculatorLibrary.calcMint(_mintAmount, _coinIndex);
    }

    /**
     * @notice Calculates the amount of pool coins to receive for redeeming a fixed amount of liquidity provider tokens (3Crv).
     * @param _burnAmount The amount of liquidity provider tokens (3Crv) to burn.
     * @param _coinIndex The index of the coin in the pool to withdraw. 0 = DAI, 1 = USDC, 2 = USDT.
     * @return tokenAmount_ The amount of coins, eg DAI, USDC or USDT, to receive from the redeem.
     * @return invariant_ The invariant before the redeem. This is the USD value of the pool.
     * @return totalSupply_ Total liquidity provider tokens (3Crv) before the redeem.
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
        return Curve3PoolCalculatorLibrary.calcRedeem(_burnAmount, _coinIndex);
    }

    /**
     * Get 3Pool's virtual price which is in USD. This is the pool's invariant
     * divided by the number of LP tokens scaled to `VIRTUAL_PRICE_SCALE` which is 1e18.
     * @return virtualPrice_ 3Pool's virtual price in USD scaled to 18 decimal places.
     */
    function getVirtualPrice() public view returns (uint256 virtualPrice_) {
        return Curve3PoolCalculatorLibrary.getVirtualPrice();
    }
}
