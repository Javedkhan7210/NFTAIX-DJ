// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LiquidityManager
 * @notice Holds LP allocation USDT; admin forwards to Pancake/LP wallet.
 */
contract LiquidityManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    address public liquidityWallet;

    mapping(address => bool) public isOperator;
    uint256 public totalReceived;
    uint256 public totalForwarded;

    event OperatorUpdated(address indexed operator, bool allowed);
    event LiquidityWalletUpdated(address indexed wallet);
    event LiquidityReceived(address indexed from, uint256 amount);
    event LiquidityForwarded(address indexed to, uint256 amount);

    error InvalidAddress();
    error NotOperator();

    modifier onlyOperator() {
        if (!isOperator[msg.sender] && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(address usdt_, address liquidityWallet_) Ownable(msg.sender) {
        if (usdt_ == address(0) || liquidityWallet_ == address(0)) revert InvalidAddress();
        usdt = IERC20(usdt_);
        liquidityWallet = liquidityWallet_;
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        isOperator[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setLiquidityWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert InvalidAddress();
        liquidityWallet = wallet;
        emit LiquidityWalletUpdated(wallet);
    }

    function receiveLiquidity(uint256 amount) external nonReentrant onlyOperator {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalReceived += amount;
        emit LiquidityReceived(msg.sender, amount);
    }

    function forwardLiquidity(uint256 amount) external onlyOwner nonReentrant {
        usdt.safeTransfer(liquidityWallet, amount);
        totalForwarded += amount;
        emit LiquidityForwarded(liquidityWallet, amount);
    }

    function forwardAll() external onlyOwner nonReentrant {
        uint256 bal = usdt.balanceOf(address(this));
        if (bal == 0) return;
        usdt.safeTransfer(liquidityWallet, bal);
        totalForwarded += bal;
        emit LiquidityForwarded(liquidityWallet, bal);
    }
}
