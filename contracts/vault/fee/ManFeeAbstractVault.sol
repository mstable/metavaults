// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// Libs
import { FeeAdminAbstractVault } from "./FeeAdminAbstractVault.sol";

struct ManagementFeeData {
    uint128 feePerSecond;
    uint32 lastUpdatedTimestamp;
}

/**
 * @notice  Abstract ERC-4626 vault that charges a management fee.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-27
 *
 * The following functions have to be implemented
 * - totalAssets()
 * - the token functions on `AbstractToken`.
 *
 * The following functions have to be called by implementing contract.
 * - constructor
 *   - AbstractVault(_asset)
 *   - VaultManagerRole(_nexus)
 * - VaultManagerRole._initialize(_vaultManager)
 * - FeeAdminAbstractVault._initialize(_feeReceiver)
 * - ManFeeAbstractVault._initialize(_feePerSecond)
 */
abstract contract ManFeeAbstractVault is FeeAdminAbstractVault {
    uint256 public constant FEE_SCALE = 1e18;

    ManagementFeeData internal _manFee;

    event ManagementFee(address feeReceiver, uint256 feeShares);
    event ManagementFeeUpdated(uint256 feePerSecond);

    modifier chargeManFee() {
        _chargeManFee();
        _;
    }

    function _chargeManFee() internal {
        ManagementFeeData memory manFeeMem = _manFee;

        uint256 secondsSinceLastFee = block.timestamp - manFeeMem.lastUpdatedTimestamp;
        // Can be zero if two transactions are in the same block
        if (secondsSinceLastFee > 0) {
            uint256 totalShares = totalSupply();
            uint256 feeShares = (totalShares * secondsSinceLastFee * manFeeMem.feePerSecond) /
                FEE_SCALE;

            // The fee shares may be rounded to zero if the vault decimals less than 9 decimals
            if (feeShares > 0) {
                _mint(feeReceiver, feeShares);
                _manFee.lastUpdatedTimestamp = SafeCast.toUint32(block.timestamp);

                emit ManagementFee(feeReceiver, feeShares);
            } else if (totalShares == 0) {
                // Only start charging a management fee from when there are shares in the vault.
                // Or if all shares were removed, when shares are added back.
                _manFee.lastUpdatedTimestamp = SafeCast.toUint32(block.timestamp);
            }
        }
    }

    /**
     * @param _feePerSecond Management fee per second scaled to `FEE_SCALE`.
     */
    function _initialize(uint256 _feePerSecond) internal virtual {
        _manFee = ManagementFeeData(
            SafeCast.toUint128(_feePerSecond),
            SafeCast.toUint32(block.timestamp)
        );
    }

    /***************************************
            Override Vault Functions
    ****************************************/

    function deposit(uint256 assets, address receiver)
        external
        virtual
        override
        chargeManFee
        returns (uint256 shares)
    {
        shares = _deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        external
        virtual
        override
        chargeManFee
        returns (uint256 assets)
    {
        assets = _mint(shares, receiver);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external virtual override chargeManFee returns (uint256 assets) {
        assets = _redeem(shares, receiver, owner);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external virtual override chargeManFee returns (uint256 shares) {
        shares = _withdraw(assets, receiver, owner);
    }

    /***************************************
            Management Fee Views
    ****************************************/

    /**
     * @return feePerSecond Management fee per second scaled to `FEE_SCALE`.
     */
    function managementFee() external view returns (uint256 feePerSecond) {
        feePerSecond = _manFee.feePerSecond;
    }

    /**
     * @return timestamp UNIX time in seconds of the last management fee update.
     */
    function lastManFeeUpdate() external view returns (uint256 timestamp) {
        timestamp = _manFee.lastUpdatedTimestamp;
    }

    /***************************************
            Management Fee Admin
    ****************************************/

    /**
     * @notice  Sets the management fee per second.
     * For example, a 2% per annum management fee is
     * 0.02 * 1e18 / (60 * 60 * 24 * 365) = 634,195,839 shares per second scaled to `FEE_SCALE`.
     * A 1 basic point fee over a year is 3,170,979 shares per second scaled to `FEE_SCALE`.
     * @param feePerSecond Management fee per second scaled to `FEE_SCALE`.
     */
    function setManagementFee(uint128 feePerSecond) external onlyGovernor {
        require(feePerSecond <= FEE_SCALE / 365 days, "Invalid fee/second");

        _chargeManFee();

        _manFee.feePerSecond = feePerSecond;

        emit ManagementFeeUpdated(feePerSecond);
    }
}
