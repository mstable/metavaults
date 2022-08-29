// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

// Libs
import { FeeAdminAbstractVault } from "./FeeAdminAbstractVault.sol";

/**
 * @title   Abstract ERC-4626 vault that charges transactopm fees to a fee recipient.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-04-07
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
 * - TxFeeAbstractVaults._initialize(_feeData)
 */
abstract contract TxFeeAbstractVault is FeeAdminAbstractVault {
    struct FeeData {
        uint16 depositFee;
        uint16 mintFee;
        uint16 withdrawFee;
        uint16 redeemFee;
        // Fees decided
        uint16 swapFee;
    }

    uint16 public constant FEE_SCALE = 10000;
    uint16 public constant MAX_FEE = FEE_SCALE / 5; // 20%

    /**
     * @notice fees in basis points. eg
     * 100% = 10,000
     * 10% = 1,000
     * 1% = 100.
     * 0.1% or 10 bps = 10.
     * 0.02% or 2 bps = 2.
     */
    FeeData public feeData;

    event FeeDataUpdated(
        address indexed caller,
        uint16 depositFee,
        uint16 mintFee,
        uint16 withdrawFee,
        uint16 redeemFee,
        uint16 swapFee
    );

    function _initialize(FeeData memory _feeData) internal virtual {
        feeData = _feeData;
    }

    /***************************************
                    Vault Admin
    ****************************************/

    function setFeeData(FeeData memory _feeData) external onlyGovernor {
        require(_feeData.depositFee <= MAX_FEE, "Invalid deposit fee");
        require(_feeData.mintFee <= MAX_FEE, "Invalid mint fee");
        require(_feeData.withdrawFee <= MAX_FEE, "Invalid withdraw fee");
        require(_feeData.redeemFee <= MAX_FEE, "Invalid redeem fee");
        require(_feeData.swapFee <= MAX_FEE, "Invalid swap fee");

        feeData = _feeData;

        emit FeeDataUpdated(
            msg.sender,
            _feeData.depositFee,
            _feeData.mintFee,
            _feeData.withdrawFee,
            _feeData.redeemFee,
            _feeData.swapFee
        );
    }

    /***************************************
                    Overrides
    ****************************************/

    function _previewDeposit(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        (shares, ) = _calculateFeeDown(_convertToShares(assets), feeData.depositFee);
    }

    function _previewMint(uint256 shares) internal view virtual override returns (uint256 assets) {
        uint256 fee = feeData.mintFee;
        if (fee > 0) {
            //  nett shares = gross shares / (1 - fee)
            shares = (shares * FEE_SCALE) / (FEE_SCALE - fee);
        }
        assets = _convertToAssets(shares);
    }

    function _previewWithdraw(uint256 assets)
        internal
        view
        virtual
        override
        returns (uint256 shares)
    {
        uint256 fee = feeData.redeemFee;
        shares = _convertToShares(assets);
        if (fee > 0) {
            //  nett shares = gross shares / (1 - fee)
            shares = (shares * FEE_SCALE) / (FEE_SCALE - fee);
        }
    }

    function _previewRedeem(uint256 shares)
        internal
        view
        virtual
        override
        returns (uint256 assets)
    {
        (assets, ) = _calculateFeeDown(_convertToAssets(shares), feeData.redeemFee);
    }

    /*///////////////////////////////////////////////////////////////
                        DEPOSIT/WITHDRAWAL LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Transferring exact amount of underlying asset tokens from the caller, mints shares to the caller minus a deposit fee `feeData.depositFee`
     * @param assets The amount of underlying assets to be transferred to the vault.
     * @param receiver The account that the vault shares will be minted to.
     * @return shares The amount of vault shares that were minted for the receiver.
     */
    function _deposit(uint256 assets, address receiver)
        internal
        virtual
        override
        returns (uint256 shares)
    {
        require((shares = _previewDeposit(assets)) != 0, "Shares are zero");
        _applyFeeAndMint(_convertToShares(assets), feeReceiver, feeData.depositFee);
        _transferAndMint(assets, shares, receiver, true);
    }

    /**
     * @notice Mint exact amount of vault shares to the receiver by transferring enough underlying asset tokens from the caller taking into account minting fee `feeData.mintFee`.
     * @param shares The amount of vault shares to be minted to.
     * @param receiver The account the vault shares will be minted to.
     * @return assets The amount of underlying assets that were transferred from the caller.
     */
    function _mint(uint256 shares, address receiver)
        internal
        virtual
        override
        returns (uint256 assets)
    {
        require((assets = _previewMint(shares)) != 0, "Assets are zero");
        _applyFeeAndMint(_convertToShares(assets), feeReceiver, feeData.mintFee);
        _transferAndMint(assets, shares, receiver, false);
    }

    function _withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) internal virtual override returns (uint256 shares) {
        shares = _previewWithdraw(assets);
        _applyFeeAndMint(shares, feeReceiver, feeData.withdrawFee);
        _burnTransfer(assets, shares, receiver, owner, false);
    }

    function _redeem(
        uint256 shares,
        address receiver,
        address owner
    ) internal virtual override returns (uint256 assets) {
        require((assets = _previewRedeem(shares)) != 0, "Assets are zero");
        _applyFeeAndMint(_convertToShares(assets), feeReceiver, feeData.redeemFee);
        _burnTransfer(assets, shares, receiver, owner, true);
    }

    /***************************************
                    Internal
    ****************************************/

    function _applyFeeAndMint(
        uint256 shares,
        address receiver,
        uint256 fee
    ) internal returns (uint256 sharesFee) {
        (, sharesFee) = _calculateFeeDown(shares, fee);
        if (sharesFee > 0) {
            _mint(receiver, sharesFee);
        }
    }

    function _calculateFeeDown(uint256 shares, uint256 fee)
        internal
        pure
        returns (uint256 sharesAmount, uint256 sharesFee)
    {
        sharesAmount = shares;
        if (fee > 0) {
            sharesFee = (shares * fee) / FEE_SCALE;
            sharesAmount = shares - sharesFee;
        }
    }
}
