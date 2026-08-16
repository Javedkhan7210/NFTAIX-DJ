// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INFTAIXToken {
    function distributeForPackage(address to, uint256 usdtAmount) external;
}
