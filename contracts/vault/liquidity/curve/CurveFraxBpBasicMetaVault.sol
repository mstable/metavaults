// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { AbstractSlippage } from "../AbstractSlippage.sol";
import { LightAbstractVault } from "../../LightAbstractVault.sol";
import { CurveFraxBpAbstractMetaVault } from "./CurveFraxBpAbstractMetaVault.sol";
import { VaultManagerRole } from "../../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../../tokens/InitializableToken.sol";

/**
 * @title   Basic FraxBp ERC-4626 vault that takes in one underlying asset to deposit in FraxBp and put the crvFrax in underlying metaVault.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-05-11
 */
contract CurveFraxBpBasicMetaVault is CurveFraxBpAbstractMetaVault, Initializable {
    /// @param _nexus         Address of the Nexus contract that resolves protocol modules and roles..
    /// @param _asset         Address of the vault's asset which is one of the FraxBp tokens FRAX or USDC.
    /// @param _metaVault     Address of the vault's underlying meta vault that implements ERC-4626.
    constructor(
        address _nexus,
        address _asset,
        address _metaVault
    )
        LightAbstractVault(_asset)
        CurveFraxBpAbstractMetaVault(_asset, _metaVault)
        VaultManagerRole(_nexus)
    {}

    /// @param _name          Name of vault.
    /// @param _symbol        Symbol of vault.
    /// @param _vaultManager  Trusted account that can perform vault operations. eg rebalance.
    /// @param _slippageData  Initial slippage limits.
    /// @param _assetToBurn   Amount of assets that will be deposited and corresponding shares locked permanently
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _vaultManager,
        SlippageData memory _slippageData,
        uint256 _assetToBurn
    ) external initializer {
        // Set the vault's decimals to the same as the Metapool LP token (crvFrax).
        InitializableToken._initialize(_name, _symbol, 18);

        VaultManagerRole._initialize(_vaultManager);
        AbstractSlippage._initialize(_slippageData);
        CurveFraxBpAbstractMetaVault._initialize();
        _initialize(_assetToBurn);
    }

    /**
     * @param _assetToBurn amount of assets that will be deposited and corresponding shares locked permanently
     * @dev This is to prevent against loss of precision and frontrunning the user deposits by sandwitch attack. Should be a non-trivial amount.
     */
    function _initialize(uint256 _assetToBurn) internal virtual override {
        if (_assetToBurn > 0) {
            // deposit the assets and transfer shares to the vault to lock permanently
            _depositInternal(_assetToBurn, address(this), depositSlippage);
        }
    }
}
