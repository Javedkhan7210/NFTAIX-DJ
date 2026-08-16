// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRegistration} from "./interfaces/IRegistration.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/**
 * @title Rewards
 * @notice Daily MLM income escrow. Claim if compliant; else burn.
 */
contract Rewards is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    IRegistration public registration;
    ITreasury public treasury;

    mapping(address => bool) public isCreditor;
    mapping(address => mapping(uint256 => uint256)) public pending;
    mapping(address => mapping(uint256 => bool)) public settled;

    event CreditorUpdated(address indexed creditor, bool allowed);
    event ModulesUpdated(address registration, address treasury);
    event IncomeCredited(address indexed user, uint256 indexed day, uint256 amount);
    event IncomeClaimed(address indexed user, uint256 indexed day, uint256 amount);
    event IncomeBurned(address indexed user, uint256 indexed day, uint256 amount);

    error InvalidAddress();
    error NotCreditor();
    error AlreadySettled();
    error NothingPending();
    error DayNotEnded();

    modifier onlyCreditor() {
        if (!isCreditor[msg.sender] && msg.sender != owner()) revert NotCreditor();
        _;
    }

    constructor(address usdt_) Ownable(msg.sender) {
        if (usdt_ == address(0)) revert InvalidAddress();
        usdt = IERC20(usdt_);
    }

    function setModules(address registration_, address treasury_) external onlyOwner {
        registration = IRegistration(registration_);
        treasury = ITreasury(treasury_);
        emit ModulesUpdated(registration_, treasury_);
    }

    function setCreditor(address creditor, bool allowed) external onlyOwner {
        isCreditor[creditor] = allowed;
        emit CreditorUpdated(creditor, allowed);
    }

    function currentDay() public view returns (uint256) {
        if (address(registration) != address(0)) return registration.currentDay();
        return block.timestamp / 1 days;
    }

    function creditIncome(address user, uint256 amount) external nonReentrant onlyCreditor {
        if (user == address(0) || amount == 0) return;
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        uint256 day = currentDay();
        pending[user][day] += amount;
        emit IncomeCredited(user, day, amount);
    }

    function claim(uint256 day) external nonReentrant {
        _settle(msg.sender, day, true);
    }

    function settle(address user, uint256 day) external nonReentrant {
        _settle(user, day, false);
    }

    function _settle(address user, uint256 day, bool isClaim) internal {
        if (settled[user][day]) revert AlreadySettled();
        uint256 amount = pending[user][day];
        if (amount == 0) revert NothingPending();

        uint256 today = currentDay();
        bool compliant =
            address(registration) == address(0) ? true : registration.isCompliant(user, day);

        if (compliant) {
            if (!isClaim && msg.sender != user && msg.sender != owner()) revert DayNotEnded();
            settled[user][day] = true;
            pending[user][day] = 0;
            usdt.safeTransfer(user, amount);
            emit IncomeClaimed(user, day, amount);
            return;
        }

        if (day >= today && msg.sender != owner()) revert DayNotEnded();

        settled[user][day] = true;
        pending[user][day] = 0;

        if (address(treasury) != address(0)) {
            usdt.forceApprove(address(treasury), amount);
            treasury.receiveBurn(amount);
        } else {
            usdt.safeTransfer(owner(), amount);
        }
        emit IncomeBurned(user, day, amount);
    }
}
