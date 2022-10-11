// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/**
 * @notice Used instead of `DelayedProxyAdmin` when 1 week delays to proxy upgrades is too long.
 * For example, when a new contract is first deployed and any bugs need to be quickly fixed.
 */
contract InstantProxyAdmin is ProxyAdmin {}
