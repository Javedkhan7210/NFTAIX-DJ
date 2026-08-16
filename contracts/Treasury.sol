// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Treasury
 * @notice Burn wallet + NFT burn accounting only.
 */
contract Treasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    address public burnWallet;

    mapping(address => bool) public isOperator;
    uint256 public totalBurned;
    uint256 public totalNftsBurned;

    event OperatorUpdated(address indexed operator, bool allowed);
    event BurnWalletUpdated(address indexed wallet);
    event Burned(address indexed from, uint256 amount);
    event NftBurnRecorded(address indexed nft, uint256 indexed tokenId);

    error InvalidAddress();
    error NotOperator();

    modifier onlyOperator() {
        if (!isOperator[msg.sender] && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(address usdt_, address burnWallet_) Ownable(msg.sender) {
        if (usdt_ == address(0) || burnWallet_ == address(0)) revert InvalidAddress();
        usdt = IERC20(usdt_);
        burnWallet = burnWallet_;
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        isOperator[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setBurnWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert InvalidAddress();
        burnWallet = wallet;
        emit BurnWalletUpdated(wallet);
    }

    function receiveBurn(uint256 amount) external nonReentrant onlyOperator {
        usdt.safeTransferFrom(msg.sender, burnWallet, amount);
        totalBurned += amount;
        emit Burned(msg.sender, amount);
    }

    function recordNftBurn(address nft, uint256 tokenId) external onlyOperator {
        totalNftsBurned += 1;
        emit NftBurnRecorded(nft, tokenId);
    }
}
