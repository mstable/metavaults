// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

// Libs
import { SingleSlotMapper } from "../../shared/SingleSlotMapper.sol";

contract TestSingleSlotMapper {
    using SingleSlotMapper for uint256;

    function init() external pure returns (uint256 mapData_) {
        mapData_ = SingleSlotMapper.initialize();
    }

    function map(uint256 mapData, uint256 index) external pure returns (uint256 value) {
        value = mapData.map(index);
    }

    function indexes(uint256 mapData) external pure returns (uint256 index_) {
        index_ = mapData.indexes();
    }

    function addValue(uint256 _mapData, uint256 value)
        external
        pure
        returns (uint256 mapData_, uint256 index)
    {
        return SingleSlotMapper.addValue(_mapData, value);
    }

    function removeValue(uint256 _mapData, uint256 index) external pure returns (uint256 mapData_) {
        mapData_ = SingleSlotMapper.removeValue(_mapData, index);
    }
}
