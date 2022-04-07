// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

abstract contract ERC20Mock is ERC20 {
    constructor() ERC20("", "") {
        _mint(msg.sender, 1e20);
    }

    function owner() virtual external view returns (address);
    function burn(uint256 amount, bytes32 to) virtual external;
    function mint(address account, uint256 amount) virtual external;
}
