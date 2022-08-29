// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;

import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/**
 * @notice AssetProxy delegates calls to a Masset implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. AssetProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract AssetProxy is TransparentUpgradeableProxy {
    constructor(
        address _logic,
        address admin_,
        bytes memory _data
    ) payable TransparentUpgradeableProxy(_logic, admin_, _data) {}
}

/**
 * @notice VaultProxy delegates calls to a Vault implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. VaultProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract VaultProxy is TransparentUpgradeableProxy {
    constructor(
        address _logic,
        address admin_,
        bytes memory _data
    ) payable TransparentUpgradeableProxy(_logic, admin_, _data) {}
}

/**
 * @notice LiquidatorProxy delegates calls to a Liquidator implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. LiquidatorProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract LiquidatorProxy is TransparentUpgradeableProxy {
    constructor(
        address _logic,
        address admin_,
        bytes memory _data
    ) payable TransparentUpgradeableProxy(_logic, admin_, _data) {}
}
