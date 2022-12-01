// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   Convex Mint Calculator
 * @notice  Calculates the number of CVX to be minted given an amount of CRV Tokens.
 * It performs the same calculations as CVX.mint() function.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-12-01
 * @dev     Calculations based on the CVX token and deployed version configuration.
 *          https://github.com/convex-eth/platform/blob/main/contracts/contracts/Cvx.sol
 */
library ConvexMintCalculatorLibrary {
    /// @notice CVX Address.
    address public constant cvx = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    /// @notice CVX maxSupply.
    uint256 public constant maxSupply = 100 * 1000000 * 1e18; //100mil
    /// @notice CVX minter total cliffs.    
    uint256 public constant totalCliffs = 1000;
    /// @notice CVX minter reduction per cliff.        
    uint256 public constant reductionPerCliff = 100000000000000000000000;


    /**
     * @notice Calculates the amount of CVX to be minted given the current total supply 
     * and configuration of the CVX Token
     * @param _amount The amount of CRV tokens minted.
     * @return amount_ The amount of CVX to mint given the current total supply and CRV tokens.
     */    
    function calcMint(uint256 _amount) external view returns (uint256 amount_) {

        uint256 supply = IERC20(cvx).totalSupply();
        
        //use current supply to gauge cliff
        //this will cause a bit of overflow into the next cliff range
        //but should be within reasonable levels.
        //requires a max supply check though
        uint256 cliff = supply / reductionPerCliff;
        //mint if below total cliffs
        if(cliff < totalCliffs){
            //for reduction% take inverse of current cliff
            uint256 reduction = totalCliffs - cliff;
            //reduce
            amount_ = _amount * reduction / totalCliffs;

            //supply cap check
            uint256 amtTillMax = maxSupply - supply;
            if(amount_ > amtTillMax){
                amount_ = amtTillMax;
            }
        }
    }

}