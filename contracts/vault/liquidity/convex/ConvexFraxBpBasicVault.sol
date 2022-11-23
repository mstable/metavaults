// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

// External
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

// libs
import { AbstractSlippage } from "../AbstractSlippage.sol";
import { AbstractVault } from "../../AbstractVault.sol";
import { ConvexFraxBpAbstractVault } from "./ConvexFraxBpAbstractVault.sol";
import { VaultManagerRole } from "../../../shared/VaultManagerRole.sol";
import { InitializableToken } from "../../../tokens/InitializableToken.sol";

/**
 * @title   ERC-4626 vault that deposits crvFRAX into a Curve Metapool, eg BUSD+FRAX, deposits the Metapool LP token in Convex
 * and stakes the Convex LP token.
 *
 * WARNING this vault can not be used with the GUSD+FRAX metapool as GUSD only has 2 decimal places.
 *
 * @notice  This is a basic implementation of `ConvexFraxBpAbstractVault` used for testing purposes. It does not include
 * and Liquidator logic like `ConvexFraxBpALiquidatorVault`.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-08-19
 */
contract ConvexFraxBpBasicVault is ConvexFraxBpAbstractVault, Initializable {
    /**
     * @param _nexus         Address of the Nexus contract that resolves protocol modules and roles.
     * @param _asset         Address of the vault's asset which is Curve's FRAX/USDC LP token (crvFRAX).
     * @param _data          InitialData for ConvexFraxBpAbstractVault constructor
     */
    constructor(
        address _nexus,
        address _asset,
        ConstructorData memory _data
    ) VaultManagerRole(_nexus) AbstractVault(_asset) ConvexFraxBpAbstractVault(_data) {}

    /**
     *
     * @param _name            Name of vault.
     * @param _symbol          Symbol of vault.
     * @param _vaultManager    Trusted account that can perform vault operations. eg rebalance.
     * @param _slippageData  Initial slippage limits.
     */
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _vaultManager,
        SlippageData memory _slippageData
    ) external initializer {
        // Vault initialization
        VaultManagerRole._initialize(_vaultManager);
        AbstractSlippage._initialize(_slippageData);
        ConvexFraxBpAbstractVault._initialize();

        // Set the vault's decimals to the same as the metapool's LP token, eg BUSDFRAXBP3CRV-f
        uint8 decimals_ = InitializableToken(address(metapoolToken)).decimals();
        InitializableToken._initialize(_name, _symbol, decimals_);
    }

    function _afterSharesMintedHook(uint256, uint256) internal virtual override {
        // do nothing
    }
}
