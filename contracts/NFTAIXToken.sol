// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NFTAIXToken
 * @notice Fixed 1,000,000 supply held by this contract. Distributors send
 *         2 tokens per $1 package price on register / upgrade.
 */
contract NFTAIXToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 ether;
    /// @notice Tokens per 1 USDT of package price (2e18 wei token per 1e18 USDT).
    uint256 public constant TOKENS_PER_USDT = 2;

    mapping(address => bool) public isDistributor;

    error InvalidAddress();
    error NotDistributor();
    error InsufficientTreasury();

    event DistributorUpdated(address indexed account, bool allowed);
    event PackageTokensDistributed(address indexed to, uint256 usdtAmount, uint256 tokenAmount);

    constructor() ERC20("NFTAIX", "NFTAIX") Ownable(msg.sender) {
        _mint(address(this), MAX_SUPPLY);
        isDistributor[msg.sender] = true;
    }

    function setDistributor(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        isDistributor[account] = allowed;
        emit DistributorUpdated(account, allowed);
    }

    function distributeForPackage(address to, uint256 usdtAmount) external {
        if (!isDistributor[msg.sender] && msg.sender != owner()) revert NotDistributor();
        if (to == address(0)) revert InvalidAddress();
        uint256 tokenAmount = usdtAmount * TOKENS_PER_USDT;
        if (balanceOf(address(this)) < tokenAmount) revert InsufficientTreasury();
        _transfer(address(this), to, tokenAmount);
        emit PackageTokensDistributed(to, usdtAmount, tokenAmount);
    }
}
