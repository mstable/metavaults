// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

struct LockedBalance {
    uint112 amount;
    uint112 boosted;
    uint32 unlockTime;
}

interface ICvxLocker {
    function rewardPerToken(address _rewardsToken) external view returns (uint256);

    function getRewardForDuration(address _rewardsToken) external view returns (uint256);

    // Address and claimable amount of all reward tokens for the given account
    function claimableRewards(address _account) external view;

    // Total BOOSTED balance of an account, including unlocked but not withdrawn tokens
    function rewardWeightOf(address _user) external view returns (uint256 amount);

    // total token balance of an account, including unlocked but not withdrawn tokens
    function lockedBalanceOf(address _user) external view returns (uint256 amount);

    //BOOSTED balance of an account which only includes properly locked tokens as of the most recent eligible epoch
    function balanceOf(address _user) external view returns (uint256 amount);

    //BOOSTED balance of an account which only includes properly locked tokens at the given epoch
    function balanceAtEpochOf(uint256 _epoch, address _user) external view returns (uint256 amount);

    //return currently locked but not active balance
    function pendingLockOf(address _user) external view returns (uint256 amount);

    function pendingLockAtEpochOf(uint256 _epoch, address _user)
        external
        view
        returns (uint256 amount);

    //supply of all properly locked BOOSTED balances at most recent eligible epoch
    function totalSupply() external view returns (uint256 supply);

    //supply of all properly locked BOOSTED balances at the given epoch
    function totalSupplyAtEpoch(uint256 _epoch) external view returns (uint256 supply);

    //find an epoch index based on timestamp
    function findEpochId(uint256 _time) external view returns (uint256 epoch);

    // Information on a user's locked balances
    function lockedBalances(address _user)
        external
        view
        returns (
            uint256 total,
            uint256 unlockable,
            uint256 locked,
            LockedBalance[] memory lockData
        );

    //number of epochs
    function epochCount() external view returns (uint256);

    /* ========== MUTATIVE FUNCTIONS ========== */

    //insert a new epoch if needed. fill in any gaps
    function checkpointEpoch() external;

    // Locked tokens cannot be withdrawn for lockDuration and are eligible to receive stakingReward rewards
    function lock(
        address _account,
        uint256 _amount,
        uint256 _spendRatio
    ) external;

    // withdraw expired locks to a different address
    function withdrawExpiredLocksTo(address _withdrawTo) external;

    // Withdraw/relock all currently locked tokens where the unlock time has passed
    function processExpiredLocks(bool _relock) external;

    function kickExpiredLocks(address _account) external;

    // claim all pending rewards
    function getReward(address _account) external;
}
