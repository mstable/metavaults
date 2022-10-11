// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

interface ICurveAddressProvider {
    function get_registry() external view returns (address);

    function max_id() external view returns (uint256);

    function get_address(uint256 _id) external view returns (address);

    function add_new_id(address _address, string memory _description) external returns (uint256);

    function set_address(uint256 _id, address _address) external returns (bool);

    function unset_address(uint256 _id) external returns (bool);

    function commit_transfer_ownership(address _new_admin) external returns (bool);

    function apply_transfer_ownership() external returns (bool);

    function revert_transfer_ownership() external returns (bool);

    function admin() external view returns (address);

    function transfer_ownership_deadline() external view returns (uint256);

    function future_admin() external view returns (address);

    function get_id_info(uint256 arg0)
        external
        view
        returns (
            address addr,
            bool is_active,
            uint256 version,
            uint256 last_modified,
            string memory description
        );
}
