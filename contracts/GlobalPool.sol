// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRegistration} from "./interfaces/IRegistration.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/**
 * @title GlobalPool
 * @notice Collects global %; next-day equal distribute by rank. Empty/unqualified → burn.
 */
contract GlobalPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    IRegistration public registration;
    ITreasury public treasury;

    mapping(address => bool) public isCreditor;
    mapping(uint256 => uint256) public dayPool;
    mapping(uint256 => bool) public dayDistributed;

    uint16 public primeBps = 2000;
    uint16 public eliteBps = 2500;
    uint16 public royalBps = 2500;
    uint16 public directorBps = 2000;
    uint16 public crownBps = 1000;

    event CreditorUpdated(address indexed creditor, bool allowed);
    event ModulesUpdated(address registration, address treasury);
    event Credited(uint256 indexed day, uint256 amount);
    event Distributed(uint256 indexed day, uint256 total);
    event RankPaid(uint256 indexed day, uint8 rank, uint256 slice, uint256 perUser, uint256 winners);
    event RankBurned(uint256 indexed day, uint8 rank, uint256 amount);

    error InvalidAddress();
    error NotCreditor();
    error AlreadyDistributed();
    error NothingToDistribute();
    error InvalidSplit();

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

    function setRankBps(uint16 prime, uint16 elite, uint16 royal, uint16 director, uint16 crown)
        external
        onlyOwner
    {
        if (uint256(prime) + elite + royal + director + crown != 10_000) revert InvalidSplit();
        primeBps = prime;
        eliteBps = elite;
        royalBps = royal;
        directorBps = director;
        crownBps = crown;
    }

    function currentDay() public view returns (uint256) {
        if (address(registration) != address(0)) return registration.currentDay();
        return block.timestamp / 1 days;
    }

    function credit(uint256 amount) external nonReentrant onlyCreditor {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        uint256 day = currentDay();
        dayPool[day] += amount;
        emit Credited(day, amount);
    }

    function distributeDay(
        uint256 day,
        address[] calldata prime,
        address[] calldata elite,
        address[] calldata royal,
        address[] calldata director,
        address[] calldata crown
    ) external onlyOwner nonReentrant {
        if (dayDistributed[day]) revert AlreadyDistributed();
        uint256 total = dayPool[day];
        if (total == 0 || day >= currentDay()) revert NothingToDistribute();

        dayDistributed[day] = true;
        dayPool[day] = 0;

        _payRank(day, 1, primeBps, total, prime);
        _payRank(day, 2, eliteBps, total, elite);
        _payRank(day, 3, royalBps, total, royal);
        _payRank(day, 4, directorBps, total, director);
        _payRank(day, 5, crownBps, total, crown);

        emit Distributed(day, total);
    }

    function _payRank(
        uint256 day,
        uint8 rank,
        uint16 bps,
        uint256 total,
        address[] calldata candidates
    ) internal {
        uint256 slice = (total * bps) / 10_000;
        if (slice == 0) return;

        address[] memory winners = new address[](candidates.length);
        uint256 w;
        for (uint256 i = 0; i < candidates.length; i++) {
            address u = candidates[i];
            if (_qualifies(u, rank) && registration.dailyVolume(u, day) > 0) {
                winners[w++] = u;
            }
        }

        if (w == 0) {
            _burn(slice);
            emit RankBurned(day, rank, slice);
            return;
        }

        uint256 perUser = slice / w;
        uint256 paid = perUser * w;
        for (uint256 i = 0; i < w; i++) {
            usdt.safeTransfer(winners[i], perUser);
        }
        if (slice > paid) _burn(slice - paid);
        emit RankPaid(day, rank, slice, perUser, w);
    }

    function _qualifies(address user, uint8 rank) internal view returns (bool) {
        (
            bool registered,
            ,
            bool permanentlyInactive,
            ,
            ,
            ,
            ,
            ,
            uint256 directCount
        ) = registration.users(user);
        if (!registered || permanentlyInactive) return false;

        uint256 team = registration.teamSize(user);
        if (rank == 1) return directCount >= 10;
        if (rank == 2) return directCount >= 15 && team >= 100;
        if (rank == 3) return directCount >= 25 && team >= 250;
        if (rank == 4) return directCount >= 75 && team >= 1000;
        if (rank == 5) return directCount >= 150 && team >= 5000;
        return false;
    }

    function _burn(uint256 amount) internal {
        if (amount == 0) return;
        if (address(treasury) != address(0)) {
            usdt.forceApprove(address(treasury), amount);
            treasury.receiveBurn(amount);
        } else {
            usdt.safeTransfer(owner(), amount);
        }
    }
}
