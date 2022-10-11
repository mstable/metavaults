// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.17;

interface ICurveRegistryContract {
    function find_pool_for_coins(address _from, address _to) external view returns (address);

    function find_pool_for_coins(
        address _from,
        address _to,
        uint256 i
    ) external view returns (address);

    function get_n_coins(address _pool) external view returns (uint256[2] memory);

    function get_coins(address _pool) external view returns (address[8] memory);

    function get_underlying_coins(address _pool) external view returns (address[8] memory);

    function get_decimals(address _pool) external view returns (uint256[8] memory);

    function get_underlying_decimals(address _pool) external view returns (uint256[8] memory);

    function get_rates(address _pool) external view returns (uint256[8] memory);

    function get_gauges(address _pool)
        external
        view
        returns (address[10] memory, int128[10] memory);

    function get_balances(address _pool) external view returns (uint256[8] memory);

    function get_underlying_balances(address _pool) external view returns (uint256[8] memory);

    function get_virtual_price_from_lp_token(address _token) external view returns (uint256);

    function get_A(address _pool) external view returns (uint256);

    function get_parameters(address _pool)
        external
        view
        returns (
            uint256 A,
            uint256 future_A,
            uint256 fee,
            uint256 admin_fee,
            uint256 future_fee,
            uint256 future_admin_fee,
            address future_owner,
            uint256 initial_A,
            uint256 initial_A_time,
            uint256 future_A_time
        );

    function get_fees(address _pool) external view returns (uint256[2] memory);

    function get_admin_balances(address _pool) external view returns (uint256[8] memory);

    function get_coin_indices(
        address _pool,
        address _from,
        address _to
    )
        external
        view
        returns (
            int128,
            int128,
            bool
        );

    function estimate_gas_used(
        address _pool,
        address _from,
        address _to
    ) external view returns (uint256);

    function is_meta(address _pool) external view returns (bool);

    function get_pool_name(address _pool) external view returns (string memory);

    function get_coin_swap_count(address _coin) external view returns (uint256);

    function get_coin_swap_complement(address _coin, uint256 _index)
        external
        view
        returns (address);

    function get_pool_asset_type(address _pool) external view returns (uint256);

    function add_pool(
        address _pool,
        uint256 _n_coins,
        address _lp_token,
        bytes32 _rate_info,
        uint256 _decimals,
        uint256 _underlying_decimals,
        bool _has_initial_A,
        bool _is_v1,
        string memory _name
    ) external;

    function add_pool_without_underlying(
        address _pool,
        uint256 _n_coins,
        address _lp_token,
        bytes32 _rate_info,
        uint256 _decimals,
        uint256 _use_rates,
        bool _has_initial_A,
        bool _is_v1,
        string memory _name
    ) external;

    function add_metapool(
        address _pool,
        uint256 _n_coins,
        address _lp_token,
        uint256 _decimals,
        string memory _name
    ) external;

    function add_metapool(
        address _pool,
        uint256 _n_coins,
        address _lp_token,
        uint256 _decimals,
        string memory _name,
        address _base_pool
    ) external;

    function remove_pool(address _pool) external;

    function set_pool_gas_estimates(address[5] memory _addr, uint256[2][5] memory _amount) external;

    function set_coin_gas_estimates(address[10] memory _addr, uint256[10] memory _amount) external;

    function set_gas_estimate_contract(address _pool, address _estimator) external;

    function set_liquidity_gauges(address _pool, address[10] memory _liquidity_gauges) external;

    function set_pool_asset_type(address _pool, uint256 _asset_type) external;

    function batch_set_pool_asset_type(address[32] memory _pools, uint256[32] memory _asset_types)
        external;

    function address_provider() external view returns (address);

    function gauge_controller() external view returns (address);

    function pool_list(uint256 arg0) external view returns (address);

    function pool_count() external view returns (uint256);

    function coin_count() external view returns (uint256);

    function get_coin(uint256 arg0) external view returns (address);

    function get_pool_from_lp_token(address arg0) external view returns (address);

    function get_lp_token(address arg0) external view returns (address);

    function last_updated() external view returns (uint256);
}
