// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockERC20ForceBurnable is ERC20Burnable {
    uint8 dec;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) ERC20(_name, _symbol) {
        dec = _decimals;
        _mint(_initialRecipient, _initialMint * (10**uint256(_decimals)));
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }

    /**
     * @dev FORCE Destroys `amount` tokens from `account`without allowance protection
     * to be used for testing purposes
     */
    function burnForce(address account, uint256 amount) public virtual {
        _burn(account, amount);
    }
}
