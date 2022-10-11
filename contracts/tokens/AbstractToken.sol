// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  Abstracts an ERC-20 token so different implementations can be used by implementing contracts.
 * @author mStable
 * @notice For exmaple, ERC-4626 vaults can abstract the ERC-20 token implementations.
 * @dev     VERSION: 1.0
 *          DATE:    2022-04-07
 */
abstract contract AbstractToken is IERC20 {
    function totalSupply() public view virtual override returns (uint256);

    function balanceOf(address account) public view virtual override returns (uint256);

    function allowance(address owner, address spender)
        public
        view
        virtual
        override
        returns (uint256);

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual;

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual;

    function _mint(address recipient, uint256 amount) internal virtual;

    function _burn(address recipient, uint256 amount) internal virtual;
}
