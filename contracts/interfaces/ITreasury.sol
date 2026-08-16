// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITreasury {
    function receiveBurn(uint256 amount) external;
    function recordNftBurn(address nft, uint256 tokenId) external;
}
