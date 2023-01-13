// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

// libs
import { AbstractSlippage } from "../AbstractSlippage.sol";
import { AbstractVault } from "../../AbstractVault.sol";
import { Convex3CrvAbstractVault } from "./Convex3CrvAbstractVault.sol";
import { VaultManagerRole } from "../../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../../tokens/InitializableToken.sol";

/**
 * @title   ERC-4626 vault that deposits 3Crv in a Curve Metapool, eg musd3Crv, deposits the Metapool lp token in Convex
 * and stakes the Convex lp token, eg cvxmusd3Crv.
 * @notice  This is a basic implementation of `Convex3CrvAbstractVault` used for testing purposes. It does not include
 * and Liquidator logic like `Convex3CrvLiquidatorVault`.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-06-10
 */
contract Convex3CrvBasicVault is Convex3CrvAbstractVault, Initializable {
    /**
     * @param _nexus         Address of the Nexus contract that resolves protocol modules and roles.
     * @param _asset         Address of the vault's underlying asset which is a Curve LP token. eg musd3CRV
     * @param _data          InitialData for Convex3CrvAbstractVault constructor
     */
    constructor(
        address _nexus,
        address _asset,
        ConstructorData memory _data
    ) VaultManagerRole(_nexus) AbstractVault(_asset) Convex3CrvAbstractVault(_data) {}

    /**
     *
     * @param _name           Name of vault.
     * @param _symbol         Symbol of vault.
     * @param _vaultManager   Trusted account that can perform vault operations. eg rebalance.
     * @param _slippageData   Initial slippage limits.
     * @param _assetToBurn    Amount of assets that will be deposited and corresponding shares locked permanently
     */
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _vaultManager,
        SlippageData memory _slippageData,
        uint256 _assetToBurn
    ) external initializer {
        // Vault initialization
        VaultManagerRole._initialize(_vaultManager);
        Convex3CrvAbstractVault._initialize();
        AbstractSlippage._initialize(_slippageData);
        
        // Set the vault's decimals to the same as the metapool's LP token, eg musd3CRV
        uint8 decimals_ = InitializableToken(address(metapoolToken)).decimals();
        InitializableToken._initialize(_name, _symbol, decimals_);
        AbstractVault._initialize(_assetToBurn);
    }

    function _afterSharesMintedHook(uint256, uint256) internal virtual override {
        // do nothing
    }
}
