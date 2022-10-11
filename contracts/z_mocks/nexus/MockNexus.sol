// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { ModuleKeys } from "../../shared/ModuleKeys.sol";

contract MockNexus is ModuleKeys {
    address public governor;
    bool private _initialized;

    mapping(bytes32 => address) public modules;

    constructor(address _governorAddr) {
        governor = _governorAddr;
        _initialized = true;
    }

    function initialized() external view returns (bool) {
        return _initialized;
    }

    function getModule(bytes32 _key) external view returns (address) {
        return modules[_key];
    }

    function setLiquidator(address _liquidator) external {
        modules[KEY_LIQUIDATOR] = _liquidator;
    }

    function setLiquidatorV2(address _liquidator) external {
        modules[KEY_LIQUIDATOR_V2] = _liquidator;
    }

    function setKeeper(address _keeper) external {
        modules[KEY_KEEPER] = _keeper;
    }
}
