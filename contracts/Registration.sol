// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IRewards} from "./interfaces/IRewards.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";
import {ILiquidityManager} from "./interfaces/ILiquidityManager.sol";
import {IGlobalPool} from "./interfaces/IGlobalPool.sol";
import {INFTAIXToken} from "./interfaces/INFTAIXToken.sol";

/**
 * @title Registration
 * @notice Users, packages, activation income + daily trading compliance tracking.
 */
contract Registration is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_LEVELS = 20;
    uint256 public constant NETWORK_PER_LEVEL_BPS = 200;

    IERC20 public immutable usdt;

    address public creatorWallet;
    address public burnWallet;
    address public liquidityWallet;
    address public globalPoolWallet;

    IRewards public rewards;
    ITreasury public treasury;
    ILiquidityManager public liquidityManager;
    IGlobalPool public globalPool;
    INFTAIXToken public platformToken;

    uint16 public directBps = 2000;
    uint16 public networkBps = 4000;
    uint16 public creatorBps = 1000;
    uint16 public burnBps = 2000;
    uint16 public liquidityBps = 500;
    uint16 public globalBps = 500;

    uint16 public requiredVolumeBps = 5000;
    uint256 public inactiveDays = 10;

    struct Package {
        uint256 price;
        uint256 tradingLimit;
        bool exists;
    }

    struct User {
        bool registered;
        bool activated;
        bool permanentlyInactive;
        address sponsor;
        uint8 packageId;
        uint256 tradingLimit;
        uint256 activatedAt;
        uint256 lastUpgradeAt;
        uint256 directCount;
    }

    mapping(uint8 => Package) public packages;
    mapping(address => User) public users;
    mapping(address => address[]) private _directReferrals;
    mapping(uint256 => uint256) public levelUnlock;
    mapping(uint256 => uint256) public nftLevelUnlock;
    mapping(address => bool) public isAuthorizer;
    mapping(address => bool) public isVolumeRecorder;
    mapping(address => mapping(uint256 => uint256)) public dailyVolume;
    mapping(address => uint256) public lastTradeDay;

    address public rootSponsor;

    event Registered(address indexed user, address indexed sponsor);
    event Activated(address indexed user, uint8 indexed packageId, uint256 price, uint256 tradingLimit);
    event Upgraded(
        address indexed user,
        uint8 indexed oldPackageId,
        uint8 indexed newPackageId,
        uint256 price,
        uint256 tradingLimit
    );
    event DirectIncomePaid(address indexed fromUser, address indexed sponsor, uint256 amount);
    event NetworkIncomePaid(address indexed fromUser, address indexed upline, uint256 level, uint256 amount);
    event NetworkLeftoverBurned(address indexed fromUser, uint256 amount);
    event CreatorPaid(address indexed fromUser, uint256 amount);
    event BurnPaid(address indexed fromUser, uint256 amount);
    event LiquidityPaid(address indexed fromUser, uint256 amount);
    event GlobalPoolCredited(address indexed fromUser, uint256 amount);
    event PermanentlyDeactivated(address indexed user);
    event VolumeRecorded(address indexed user, uint256 indexed day, uint256 amount, uint256 dayTotal);
    event ModulesUpdated(address rewards, address treasury, address liquidityManager, address globalPool);
    event PlatformTokenUpdated(address indexed token);

    error InvalidAddress();
    error AlreadyRegistered();
    error NotRegistered();
    error AlreadyActivated();
    error NotActivated();
    error PermanentlyInactive();
    error InvalidSponsor();
    error InvalidPackage();
    error InvalidUpgrade();
    error InvalidSplit();
    error NotAuthorizer();
    error NotRecorder();

    modifier onlyAuthorizer() {
        if (!isAuthorizer[msg.sender] && msg.sender != owner()) revert NotAuthorizer();
        _;
    }

    modifier onlyRecorder() {
        if (!isVolumeRecorder[msg.sender] && msg.sender != owner()) revert NotRecorder();
        _;
    }

    constructor(
        address usdt_,
        address creatorWallet_,
        address burnWallet_,
        address liquidityWallet_,
        address globalPoolWallet_,
        address rootSponsor_
    ) Ownable(msg.sender) {
        if (
            usdt_ == address(0) ||
            creatorWallet_ == address(0) ||
            burnWallet_ == address(0) ||
            liquidityWallet_ == address(0) ||
            globalPoolWallet_ == address(0) ||
            rootSponsor_ == address(0)
        ) revert InvalidAddress();

        usdt = IERC20(usdt_);
        creatorWallet = creatorWallet_;
        burnWallet = burnWallet_;
        liquidityWallet = liquidityWallet_;
        globalPoolWallet = globalPoolWallet_;
        rootSponsor = rootSponsor_;

        _initDefaultPackages();
        _initDefaultLevelUnlocks();
        _initDefaultNftLevelUnlocks();

        users[rootSponsor_].registered = true;
    }

    // ---------------- User ----------------

    function register(address sponsor) external whenNotPaused {
        _register(msg.sender, sponsor);
    }

    /// @notice One-step signup: register + USDT subscription activate.
    function registerAndActivate(address sponsor, uint8 packageId) external nonReentrant whenNotPaused {
        if (!users[msg.sender].registered) {
            _register(msg.sender, sponsor);
        }
        _activate(msg.sender, packageId, true);
    }

    function activate(uint8 packageId) external nonReentrant whenNotPaused {
        _activate(msg.sender, packageId, true);
    }

    function upgrade(uint8 newPackageId) external nonReentrant whenNotPaused {
        _upgrade(msg.sender, newPackageId, true);
    }

    /// @notice Authorizer/admin: register + activate without USDT (free).
    function adminRegisterAndActivate(
        address user,
        address sponsor,
        uint8 packageId
    ) external onlyAuthorizer nonReentrant whenNotPaused {
        if (user == address(0)) revert InvalidAddress();
        if (!users[user].registered) {
            _register(user, sponsor);
        }
        _activate(user, packageId, false);
    }

    /// @notice Authorizer/admin: upgrade package without USDT (free).
    function adminUpgrade(address user, uint8 newPackageId) external onlyAuthorizer nonReentrant whenNotPaused {
        if (user == address(0)) revert InvalidAddress();
        _upgrade(user, newPackageId, false);
    }

    function _register(address user, address sponsor) internal {
        if (users[user].registered) revert AlreadyRegistered();
        if (sponsor == address(0) || sponsor == user) revert InvalidSponsor();
        if (!users[sponsor].registered) revert InvalidSponsor();
        if (users[sponsor].permanentlyInactive) revert PermanentlyInactive();

        users[user] = User({
            registered: true,
            activated: false,
            permanentlyInactive: false,
            sponsor: sponsor,
            packageId: 0,
            tradingLimit: 0,
            activatedAt: 0,
            lastUpgradeAt: 0,
            directCount: 0
        });

        users[sponsor].directCount += 1;
        _directReferrals[sponsor].push(user);
        emit Registered(user, sponsor);
    }

    function _activate(address userAddr, uint8 packageId, bool pullUsdt) internal {
        User storage user = users[userAddr];
        if (!user.registered) revert NotRegistered();
        if (user.activated) revert AlreadyActivated();
        if (user.permanentlyInactive) revert PermanentlyInactive();

        Package memory pkg = packages[packageId];
        if (!pkg.exists) revert InvalidPackage();

        if (pullUsdt) {
            usdt.safeTransferFrom(userAddr, address(this), pkg.price);
        }

        user.activated = true;
        user.packageId = packageId;
        user.tradingLimit = pkg.tradingLimit;
        user.activatedAt = block.timestamp;
        user.lastUpgradeAt = block.timestamp;

        if (pullUsdt) {
            _distributeActivation(userAddr, user.sponsor, pkg.price);
        }
        _distributePlatformTokens(userAddr, pkg.price);
        emit Activated(userAddr, packageId, pkg.price, pkg.tradingLimit);
    }

    function _upgrade(address userAddr, uint8 newPackageId, bool pullUsdt) internal {
        User storage user = users[userAddr];
        if (!user.registered) revert NotRegistered();
        if (!user.activated) revert NotActivated();
        if (user.permanentlyInactive) revert PermanentlyInactive();

        Package memory newPkg = packages[newPackageId];
        if (!newPkg.exists) revert InvalidPackage();
        if (newPkg.price <= packages[user.packageId].price) revert InvalidUpgrade();

        if (pullUsdt) {
            usdt.safeTransferFrom(userAddr, address(this), newPkg.price);
        }

        uint8 oldPackageId = user.packageId;
        user.packageId = newPackageId;
        user.tradingLimit = newPkg.tradingLimit;
        user.lastUpgradeAt = block.timestamp;

        if (pullUsdt) {
            _distributeActivation(userAddr, user.sponsor, newPkg.price);
        }
        _distributePlatformTokens(userAddr, newPkg.price);
        emit Upgraded(userAddr, oldPackageId, newPackageId, newPkg.price, newPkg.tradingLimit);
    }

    function setPlatformToken(address token) external onlyOwner {
        platformToken = INFTAIXToken(token);
        emit PlatformTokenUpdated(token);
    }

    function _distributePlatformTokens(address to, uint256 usdtPrice) internal {
        if (address(platformToken) == address(0) || usdtPrice == 0) return;
        platformToken.distributeForPackage(to, usdtPrice);
    }

    // ---------------- Compliance ----------------

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function requiredDailyVolume(address user) public view returns (uint256) {
        return (users[user].tradingLimit * requiredVolumeBps) / BPS_DENOMINATOR;
    }

    function isCompliant(address user, uint256 day) public view returns (bool) {
        uint256 required = requiredDailyVolume(user);
        if (required == 0) return false;
        return dailyVolume[user][day] >= required;
    }

    function recordVolume(address user, uint256 amount) external onlyRecorder {
        uint256 day = currentDay();
        dailyVolume[user][day] += amount;
        lastTradeDay[user] = day;
        emit VolumeRecorded(user, day, amount, dailyVolume[user][day]);
    }

    function daysSinceLastTrade(address user) public view returns (uint256) {
        uint256 last = lastTradeDay[user];
        uint256 today = currentDay();
        if (last == 0) {
            uint256 activatedAt = users[user].activatedAt;
            if (activatedAt == 0) return 0;
            uint256 activatedDay = activatedAt / 1 days;
            return today > activatedDay ? today - activatedDay : 0;
        }
        return today > last ? today - last : 0;
    }

    function shouldDeactivate(address user) public view returns (bool) {
        User memory u = users[user];
        if (!u.registered || !u.activated || u.permanentlyInactive) return false;
        return daysSinceLastTrade(user) >= inactiveDays;
    }

    // ---------------- Views ----------------

    function getDirectReferrals(address user) external view returns (address[] memory) {
        return _directReferrals[user];
    }

    function levelsForDirects(uint256 directs) public view returns (uint256) {
        if (directs == 0) return 0;
        if (directs >= 10) return levelUnlock[10];
        uint256 levels = levelUnlock[directs];
        if (levels != 0) return levels;
        if (directs >= 6 && directs <= 9) return directs * 2;
        return 0;
    }

    function nftLevelsForDirects(uint256 directs) public view returns (uint256) {
        if (directs == 0) return 0;
        if (directs >= 10) return nftLevelUnlock[10];
        uint256 levels = nftLevelUnlock[directs];
        if (levels != 0) return levels;
        if (directs >= 6 && directs <= 9) return directs * 2;
        return 0;
    }

    function teamSize(address user) external view returns (uint256) {
        return _countTeam(user);
    }

    // ---------------- Admin ----------------

    function setModules(
        address rewards_,
        address treasury_,
        address liquidityManager_,
        address globalPool_
    ) external onlyOwner {
        rewards = IRewards(rewards_);
        treasury = ITreasury(treasury_);
        liquidityManager = ILiquidityManager(liquidityManager_);
        globalPool = IGlobalPool(globalPool_);
        emit ModulesUpdated(rewards_, treasury_, liquidityManager_, globalPool_);
    }

    function setAuthorizer(address account, bool allowed) external onlyOwner {
        isAuthorizer[account] = allowed;
    }

    function setVolumeRecorder(address account, bool allowed) external onlyOwner {
        isVolumeRecorder[account] = allowed;
    }

    function setComplianceConfig(uint16 requiredVolumeBps_, uint256 inactiveDays_) external onlyOwner {
        requiredVolumeBps = requiredVolumeBps_;
        inactiveDays = inactiveDays_;
    }

    function setWallets(
        address creatorWallet_,
        address burnWallet_,
        address liquidityWallet_,
        address globalPoolWallet_
    ) external onlyOwner {
        if (
            creatorWallet_ == address(0) ||
            burnWallet_ == address(0) ||
            liquidityWallet_ == address(0) ||
            globalPoolWallet_ == address(0)
        ) revert InvalidAddress();
        creatorWallet = creatorWallet_;
        burnWallet = burnWallet_;
        liquidityWallet = liquidityWallet_;
        globalPoolWallet = globalPoolWallet_;
    }

    function setSplit(
        uint16 directBps_,
        uint16 networkBps_,
        uint16 creatorBps_,
        uint16 burnBps_,
        uint16 liquidityBps_,
        uint16 globalBps_
    ) external onlyOwner {
        if (
            uint256(directBps_) + networkBps_ + creatorBps_ + burnBps_ + liquidityBps_ + globalBps_ !=
            BPS_DENOMINATOR
        ) revert InvalidSplit();
        directBps = directBps_;
        networkBps = networkBps_;
        creatorBps = creatorBps_;
        burnBps = burnBps_;
        liquidityBps = liquidityBps_;
        globalBps = globalBps_;
    }

    function setPackage(uint8 packageId, uint256 price, uint256 tradingLimit) external onlyOwner {
        if (price == 0) revert InvalidPackage();
        packages[packageId] = Package({price: price, tradingLimit: tradingLimit, exists: true});
    }

    function setLevelUnlock(uint256 directs, uint256 levels) external onlyOwner {
        levelUnlock[directs] = levels;
    }

    function setNftLevelUnlock(uint256 directs, uint256 levels) external onlyOwner {
        nftLevelUnlock[directs] = levels;
    }

    function setPermanentlyInactive(address user, bool value) external onlyAuthorizer {
        if (!users[user].registered) revert NotRegistered();
        users[user].permanentlyInactive = value;
        if (value) emit PermanentlyDeactivated(user);
    }

    function deactivateIfInactive(address user) external {
        if (shouldDeactivate(user)) {
            users[user].permanentlyInactive = true;
            emit PermanentlyDeactivated(user);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------- Internal ----------------

    function _distributeActivation(address fromUser, address sponsor, uint256 amount) internal {
        uint256 directAmt = (amount * directBps) / BPS_DENOMINATOR;
        uint256 networkAmt = (amount * networkBps) / BPS_DENOMINATOR;
        uint256 creatorAmt = (amount * creatorBps) / BPS_DENOMINATOR;
        uint256 burnAmt = (amount * burnBps) / BPS_DENOMINATOR;
        uint256 liquidityAmt = (amount * liquidityBps) / BPS_DENOMINATOR;
        uint256 globalAmt = amount - directAmt - networkAmt - creatorAmt - burnAmt - liquidityAmt;

        if (directAmt > 0) {
            address payee = _eligiblePayee(sponsor);
            if (payee != address(0)) {
                _payUser(payee, directAmt);
                emit DirectIncomePaid(fromUser, payee, directAmt);
            } else {
                burnAmt += directAmt;
            }
        }

        uint256 paidNetwork = _distributeNetwork(fromUser, sponsor, amount, networkAmt);
        if (networkAmt > paidNetwork) {
            burnAmt += networkAmt - paidNetwork;
            emit NetworkLeftoverBurned(fromUser, networkAmt - paidNetwork);
        }

        if (creatorAmt > 0) {
            usdt.safeTransfer(creatorWallet, creatorAmt);
            emit CreatorPaid(fromUser, creatorAmt);
        }
        if (liquidityAmt > 0) {
            _payLiquidity(liquidityAmt);
            emit LiquidityPaid(fromUser, liquidityAmt);
        }
        if (globalAmt > 0) {
            _payGlobal(globalAmt);
            emit GlobalPoolCredited(fromUser, globalAmt);
        }
        if (burnAmt > 0) {
            _payBurn(burnAmt);
            emit BurnPaid(fromUser, burnAmt);
        }
    }

    function _distributeNetwork(
        address fromUser,
        address sponsor,
        uint256 activationAmount,
        uint256 networkBudget
    ) internal returns (uint256 paid) {
        address current = sponsor;
        uint256 perLevel = (activationAmount * NETWORK_PER_LEVEL_BPS) / BPS_DENOMINATOR;

        for (uint256 level = 1; level <= MAX_LEVELS; level++) {
            if (current == address(0) || paid + perLevel > networkBudget) break;
            User storage upline = users[current];
            if (upline.registered && !upline.permanentlyInactive && levelsForDirects(upline.directCount) >= level) {
                _payUser(current, perLevel);
                paid += perLevel;
                emit NetworkIncomePaid(fromUser, current, level, perLevel);
            }
            current = upline.sponsor;
        }
    }

    function _payUser(address to, uint256 amount) internal {
        usdt.safeTransfer(to, amount);
    }

    function _payBurn(uint256 amount) internal {
        if (address(treasury) != address(0)) {
            usdt.forceApprove(address(treasury), amount);
            treasury.receiveBurn(amount);
        } else {
            usdt.safeTransfer(burnWallet, amount);
        }
    }

    function _payLiquidity(uint256 amount) internal {
        if (address(liquidityManager) != address(0)) {
            usdt.forceApprove(address(liquidityManager), amount);
            liquidityManager.receiveLiquidity(amount);
        } else {
            usdt.safeTransfer(liquidityWallet, amount);
        }
    }

    function _payGlobal(uint256 amount) internal {
        if (address(globalPool) != address(0)) {
            usdt.forceApprove(address(globalPool), amount);
            globalPool.credit(amount);
        } else {
            usdt.safeTransfer(globalPoolWallet, amount);
        }
    }

    function _eligiblePayee(address account) internal view returns (address) {
        if (account == address(0)) return address(0);
        User storage u = users[account];
        if (!u.registered || u.permanentlyInactive) return address(0);
        return account;
    }

    function _countTeam(address user) internal view returns (uint256 count) {
        address[] storage directs = _directReferrals[user];
        count = directs.length;
        for (uint256 i = 0; i < directs.length; i++) {
            count += _countTeam(directs[i]);
        }
    }

    function _initDefaultPackages() internal {
        packages[1] = Package(5 ether, 50 ether, true);
        packages[2] = Package(10 ether, 100 ether, true);
        packages[3] = Package(25 ether, 250 ether, true);
        packages[4] = Package(50 ether, 500 ether, true);
        packages[5] = Package(100 ether, 1000 ether, true);
        packages[6] = Package(250 ether, 2500 ether, true);
        packages[7] = Package(500 ether, 5000 ether, true);
        packages[8] = Package(1000 ether, 10_000 ether, true);
        packages[9] = Package(2500 ether, 25_000 ether, true);
        packages[10] = Package(5000 ether, 50_000 ether, true);
        packages[11] = Package(10_000 ether, 100_000 ether, true);
    }

    function _initDefaultLevelUnlocks() internal {
        levelUnlock[1] = 1;
        levelUnlock[2] = 2;
        levelUnlock[3] = 6;
        levelUnlock[4] = 8;
        levelUnlock[5] = 10;
        levelUnlock[6] = 12;
        levelUnlock[7] = 14;
        levelUnlock[8] = 16;
        levelUnlock[9] = 18;
        levelUnlock[10] = 20;
    }

    function _initDefaultNftLevelUnlocks() internal {
        nftLevelUnlock[1] = 2;
        nftLevelUnlock[2] = 4;
        nftLevelUnlock[3] = 6;
        nftLevelUnlock[4] = 8;
        nftLevelUnlock[5] = 10;
        nftLevelUnlock[6] = 12;
        nftLevelUnlock[7] = 14;
        nftLevelUnlock[8] = 16;
        nftLevelUnlock[9] = 18;
        nftLevelUnlock[10] = 20;
    }
}
