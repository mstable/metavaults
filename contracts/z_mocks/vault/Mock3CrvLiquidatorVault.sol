// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Libs
import { ILiquidatorVault } from "../../interfaces/ILiquidatorVault.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

/**
 * @title   Mock 3Crv vault for testing the Liquidator.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-10-17
 */
contract Mock3CrvLiquidatorVault is ILiquidatorVault, ImmutableModule {
    using SafeERC20 for IERC20;

    // Reward tokens
    address public CRV = 0xD533a949740bb3306d119CC777fa900bA034cd52;
    address public CVX = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;

    // Cruve 3Pool tokens
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    /// @notice Token that the liquidator sells CRV and CVX rewards for. This must be a Curve 3Pool asset (DAI, USDC or USDT).
    address internal immutable donateToken_;

    /**
     * @param _nexus        Address of the Nexus contract that resolves protocol modules and roles.
     * @param _donateToken  Address of the token the rewards will be swapped for. This must be a Curve 3Pool asset (DAI, USDC or USDT).
     */
    constructor(address _nexus, address _donateToken) ImmutableModule(_nexus) {
        require(
            _donateToken == DAI || _donateToken == USDC || _donateToken == USDT,
            "donate token not in 3Pool"
        );
        donateToken_ = _donateToken;

        _resetAllowances();
    }

    /**
     * Collects reward tokens from underlying platforms or vaults to this vault and
     * reports to the caller the amount of tokens now held by the vault.
     * This can be called by anyone but it used by the Liquidator to transfer the
     * rewards tokens from this vault to the liquidator.
     *
     * @param rewardTokens_ Array of reward tokens that were collected.
     * @param rewards The amount of reward tokens that were collected.
     * @param donateTokens The token the Liquidator swaps the reward tokens to.
     */
    function collectRewards()
        external
        virtual
        override
        returns (
            address[] memory rewardTokens_,
            uint256[] memory rewards,
            address[] memory donateTokens
        )
    {
        rewardTokens_ = new address[](2);
        rewards = new uint256[](2);
        donateTokens = new address[](2);

        rewardTokens_[0] = CRV;
        rewards[0] = IERC20(CRV).balanceOf(address(this));
        donateTokens[0] = donateToken_;

        rewardTokens_[1] = CVX;
        rewards[1] = IERC20(CVX).balanceOf(address(this));
        donateTokens[1] = donateToken_;
    }

    /**
     * @notice Returns all reward tokens address added to the vault.
     */
    function rewardTokens() external view override returns (address[] memory rewardTokens_) {
        rewardTokens_[0] = CRV;
        rewardTokens_[1] = CVX;
    }

    /**
     * @notice Returns the token that rewards must be swapped to before donating back to the vault.
     * @return token The address of the token that reward tokens are swapped for.
     */
    function donateToken(address) external view override returns (address token) {
        token = donateToken_;
    }

    /**
     * @notice Adds tokens to the vault.
     * @param __donateToken  The address of the 3Pool token being donated (DAI, USDC or USDT).
     * @param amount         The amount of tokens being donated.
     */
    function donate(address __donateToken, uint256 amount) external override {
        require(
            __donateToken == DAI || __donateToken == USDC || __donateToken == USDT,
            "donate token not in 3Pool"
        );

        IERC20(__donateToken).safeTransfer(msg.sender, amount);
    }

    /// @notice Reset allowances in the case the keeper is changed in the Nexus.
    function resetAllowances() external onlyKeeperOrGovernor() {
        _resetAllowances();
    }

    function _resetAllowances() internal {
        address keeper = _keeper();

        IERC20(CRV).safeApprove(keeper, type(uint256).max);
        IERC20(CVX).safeApprove(keeper, type(uint256).max);
        IERC20(donateToken_).safeApprove(keeper, type(uint256).max);
    }
}
