// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IRegistration} from "./interfaces/IRegistration.sol";
import {IRewards} from "./interfaces/IRewards.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";
import {ILiquidityManager} from "./interfaces/ILiquidityManager.sol";
import {IGlobalPool} from "./interfaces/IGlobalPool.sol";

/**
 * @title NFTMarketplace
 * @notice FIFO NFT market + bot buy via USDT allowance (no deposit vault).
 */
contract NFTMarketplace is ERC721, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_LEVELS = 20;
    uint256 public mintPrice = 10 ether;
    uint256 public burnThreshold = 75 ether;
    uint16 public appreciationBps = 1000;

    uint16 public sellerBps = 3000;
    uint16 public teamBps = 2000;
    uint16 public creatorBps = 500;
    uint16 public burnBps = 2500;
    uint16 public liquidityBps = 1000;
    uint16 public globalBps = 1000;

    IERC20 public immutable usdt;
    IRegistration public registration;
    IRewards public rewards;
    ITreasury public treasury;
    ILiquidityManager public liquidityManager;
    IGlobalPool public globalPool;
    address public creatorWallet;

    uint256 private _nextTokenId = 1;
    uint256 public nextListPrice;

    uint256[] private _queue;
    uint256 private _queueHead;

    mapping(uint256 => uint256) public listPrice;
    mapping(uint256 => bool) public listed;
    mapping(uint256 => address) private _sellerOf;
    mapping(address => uint256) public heldTokenId;
    /// @dev USDT paid when token entered personal hold (for +10% list on displace).
    mapping(uint256 => uint256) public holdPaidPrice;
    mapping(address => bool) public isBot;
    mapping(address => bool) public botEnabled; // user opt-in for bot
    /// @dev Packages with price <= this never hold; buy auto-lists at +10%.
    uint256 public constant NO_HOLD_PACKAGE_MAX = 10 ether;

    event ModulesUpdated();
    event Purchased(address indexed buyer, uint256 indexed tokenId, uint256 price);
    event Listed(uint256 indexed tokenId, uint256 price);
    event Unlisted(uint256 indexed tokenId);
    event Held(address indexed user, uint256 indexed tokenId);
    event Unheld(address indexed user, uint256 indexed tokenId);
    event NftBurned(uint256 indexed tokenId, uint256 price);
    event SplitSpawned(address indexed buyer, uint256 indexed burnedId, uint256[3] newIds, uint256 unitPrice);
    event UserBotUpdated(address indexed user, bool enabled);

    error InvalidAddress();
    error NotActivated();
    error PermanentlyInactive();
    error DailyLimitExceeded();
    error NotBot();
    error BotDisabled();
    error InvalidSplit();

    constructor(
        address usdt_,
        address registration_,
        address creatorWallet_
    ) ERC721("NFTAIX", "NFTX") Ownable(msg.sender) {
        if (usdt_ == address(0) || registration_ == address(0) || creatorWallet_ == address(0)) {
            revert InvalidAddress();
        }
        usdt = IERC20(usdt_);
        registration = IRegistration(registration_);
        creatorWallet = creatorWallet_;
        nextListPrice = (mintPrice * (BPS + appreciationBps)) / BPS;
    }

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
        emit ModulesUpdated();
    }

    function setBot(address bot, bool allowed) external onlyOwner {
        isBot[bot] = allowed;
    }

    function setUserBot(address user, bool enabled) external {
        if (msg.sender != user && msg.sender != owner()) revert BotDisabled();
        botEnabled[user] = enabled;
        emit UserBotUpdated(user, enabled);
    }

    function setCreatorWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert InvalidAddress();
        creatorWallet = wallet;
    }

    function setPricing(uint256 mintPrice_, uint256 burnThreshold_, uint16 appreciationBps_) external onlyOwner {
        mintPrice = mintPrice_;
        burnThreshold = burnThreshold_;
        appreciationBps = appreciationBps_;
    }

    function setSaleSplit(
        uint16 seller,
        uint16 team,
        uint16 creator,
        uint16 burn,
        uint16 liquidity,
        uint16 global_
    ) external onlyOwner {
        if (uint256(seller) + team + creator + burn + liquidity + global_ != BPS) revert InvalidSplit();
        sellerBps = seller;
        teamBps = team;
        creatorBps = creator;
        burnBps = burn;
        liquidityBps = liquidity;
        globalBps = global_;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function queueLength() public view returns (uint256) {
        if (_queueHead >= _queue.length) return 0;
        return _queue.length - _queueHead;
    }

    function peekNext() external view returns (uint256 tokenId, uint256 price) {
        if (queueLength() == 0) return (0, nextListPrice);
        tokenId = _queue[_queueHead];
        price = listPrice[tokenId];
    }

    /// @notice Seller credited on the next `buy()` of this listed token (address(0) = primary mint path).
    function sellerOf(uint256 tokenId) external view returns (address) {
        return _sellerOf[tokenId];
    }

    /// @notice FIFO entry at `index` (0 = next buy). Reverts if out of range.
    function queueAt(uint256 index) external view returns (uint256 tokenId, uint256 price, address seller) {
        require(index < queueLength(), "oob");
        tokenId = _queue[_queueHead + index];
        price = listPrice[tokenId];
        seller = _sellerOf[tokenId];
    }

    /// @notice Manual buy. User must `USDT.approve(marketplace, amount)` first.
    function buy() external nonReentrant whenNotPaused {
        _buy(msg.sender);
    }

    /// @notice Bot/keeper buy using user's USDT allowance on this contract.
    function botBuy(address user) external nonReentrant whenNotPaused {
        if (!isBot[msg.sender] && msg.sender != owner()) revert NotBot();
        if (!botEnabled[user]) revert BotDisabled();
        _buy(user);
    }

    /// @notice Owner/keeper: multiple buys while allowance + balance + daily limit allow.
    function runBot(address user, uint256 maxTrades) external onlyOwner {
        if (!botEnabled[user]) revert BotDisabled();
        for (uint256 i = 0; i < maxTrades; i++) {
            (, uint256 price) = this.peekNext();
            (, , , , , uint256 tradingLimit, , , ) = registration.users(user);
            uint256 day = registration.currentDay();
            uint256 used = registration.dailyVolume(user, day);
            if (used + price > tradingLimit) break;
            if (usdt.balanceOf(user) < price) break;
            if (usdt.allowance(user, address(this)) < price) break;
            _buy(user);
        }
    }

    /**
     * @notice Owner seeds the FIFO sell queue (no USDT). Each NFT listed at mintPrice +10% (e.g. $10 → $11).
     * @dev Does not ladder `nextListPrice` — organic buy()/auto-list still appreciates. Seller address(0) = primary.
     */
    function adminMintToQueue(uint256 quantity) external onlyOwner nonReentrant whenNotPaused {
        require(quantity > 0 && quantity <= 50, "qty");
        uint256 ask = (mintPrice * (BPS + appreciationBps)) / BPS;
        require(ask > 0 && ask < burnThreshold, "threshold");
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _nextTokenId++;
            _mint(address(this), tokenId);
            _enqueue(tokenId, ask, address(0));
        }
        // Keep primary empty-queue ask aligned to base mint +10%
        if (nextListPrice < ask) nextListPrice = ask;
    }

    /**
     * @notice Owner burns a token. If it is the FIFO head, dequeue first; mid-queue listed tokens revert.
     */
    function adminBurnToken(uint256 tokenId) external onlyOwner nonReentrant {
        require(_exists(tokenId), "gone");
        if (listed[tokenId]) {
            require(queueLength() > 0 && _queue[_queueHead] == tokenId, "not head");
            _queueHead += 1;
            _clearListingMeta(tokenId);
        } else {
            address o = ownerOf(tokenId);
            if (heldTokenId[o] == tokenId) {
                heldTokenId[o] = 0;
                emit Unheld(o, tokenId);
            }
            if (o != address(this)) {
                _transfer(o, address(this), tokenId);
            }
        }
        _burn(tokenId);
        emit NftBurned(tokenId, 0);
    }

    /// @notice Manual list for rare holds (e.g. ask would hit burn threshold).
    /// @dev Normal buys already auto-enqueue via `_autoListAfterBuy`.
    function listHeld() external nonReentrant whenNotPaused {
        uint256 tokenId = heldTokenId[msg.sender];
        require(tokenId != 0 && ownerOf(tokenId) == msg.sender, "no hold");
        uint256 price = nextListPrice;
        require(price < burnThreshold, "threshold");

        heldTokenId[msg.sender] = 0;
        emit Unheld(msg.sender, tokenId);
        _transfer(msg.sender, address(this), tokenId);
        _enqueue(tokenId, price, msg.sender);
        nextListPrice = (price * (BPS + appreciationBps)) / BPS;
    }

    function _buy(address buyer) internal {
        _requireActive(buyer);

        uint256 tokenId;
        uint256 price;
        bool mintedFresh;

        if (queueLength() == 0) {
            price = nextListPrice;
            tokenId = _mintListed(price);
            mintedFresh = true;
        } else {
            tokenId = _queue[_queueHead];
            price = listPrice[tokenId];
            _queueHead += 1;
            listed[tokenId] = false;
        }

        _enforceDailyLimit(buyer, price);
        usdt.safeTransferFrom(buyer, address(this), price);

        address seller = mintedFresh ? address(0) : _sellerOf[tokenId];
        _distributeSale(buyer, seller, price);

        if (!mintedFresh) _clearListingMeta(tokenId);

        if (price >= burnThreshold) {
            if (_exists(tokenId)) _burn(tokenId);
            emit NftBurned(tokenId, price);
            if (address(treasury) != address(0)) {
                treasury.recordNftBurn(address(this), tokenId);
            }
            _spawnSplit(buyer, tokenId, price);
        } else {
            _placeAfterPurchase(buyer, tokenId, price);
        }

        registration.recordVolume(buyer, price);
        emit Purchased(buyer, tokenId, price);
    }

    /// @dev $5/$10 packages: always auto-list +10%. Higher packages: 1-hold; 2nd buy lists previous at +10%.
    function _placeAfterPurchase(address buyer, uint256 tokenId, uint256 paidPrice) internal {
        uint256 ask = (paidPrice * (BPS + appreciationBps)) / BPS;
        if (ask >= burnThreshold) {
            _assignHold(buyer, tokenId);
            holdPaidPrice[tokenId] = paidPrice;
            nextListPrice = ask;
            return;
        }

        (, , , , uint8 packageId, , , , ) = registration.users(buyer);
        (uint256 pkgPrice, , bool pkgExists) = registration.packages(packageId);
        bool holdEligible = pkgExists && pkgPrice > NO_HOLD_PACKAGE_MAX;

        if (!holdEligible) {
            _enqueue(tokenId, ask, buyer);
            nextListPrice = (ask * (BPS + appreciationBps)) / BPS;
            return;
        }

        uint256 prev = heldTokenId[buyer];
        if (prev != 0) {
            uint256 prevPaid = holdPaidPrice[prev];
            if (prevPaid == 0) prevPaid = paidPrice;
            uint256 prevAsk = (prevPaid * (BPS + appreciationBps)) / BPS;
            if (prevAsk >= burnThreshold) prevAsk = prevPaid;
            heldTokenId[buyer] = 0;
            delete holdPaidPrice[prev];
            emit Unheld(buyer, prev);
            if (ownerOf(prev) != address(this)) {
                _transfer(buyer, address(this), prev);
            }
            _enqueue(prev, prevAsk, buyer);
            nextListPrice = (prevAsk * (BPS + appreciationBps)) / BPS;
        } else {
            nextListPrice = ask;
        }

        if (ownerOf(tokenId) == address(this)) {
            _transfer(address(this), buyer, tokenId);
        }
        heldTokenId[buyer] = tokenId;
        holdPaidPrice[tokenId] = paidPrice;
        emit Held(buyer, tokenId);
    }

    /// @dev Legacy name kept for tests / rare burn-threshold path.
    function _autoListAfterBuy(address buyer, uint256 tokenId, uint256 paidPrice) internal {
        _placeAfterPurchase(buyer, tokenId, paidPrice);
    }

    function _spawnSplit(address buyer, uint256 burnedId, uint256 price) internal {
        uint256 unit = price / 3;
        uint256[3] memory ids;

        for (uint256 i = 0; i < 3; i++) {
            uint256 id = _nextTokenId++;
            ids[i] = id;
            _mint(address(this), id);
            uint256 ask = (unit * (BPS + appreciationBps)) / BPS;
            _enqueue(id, ask >= burnThreshold ? unit : ask, buyer);
        }
        nextListPrice = (unit * (BPS + appreciationBps)) / BPS;
        emit SplitSpawned(buyer, burnedId, ids, unit);
    }

    function _assignHold(address user, uint256 tokenId) internal {
        uint256 prev = heldTokenId[user];
        if (prev != 0) emit Unheld(user, prev);
        if (ownerOf(tokenId) == address(this)) {
            _transfer(address(this), user, tokenId);
        }
        heldTokenId[user] = tokenId;
        emit Held(user, tokenId);
    }

    function _mintListed(uint256 price) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _mint(address(this), tokenId);
        _sellerOf[tokenId] = address(0);
        listPrice[tokenId] = price;
        listed[tokenId] = true;
    }

    function _enqueue(uint256 tokenId, uint256 price, address seller) internal {
        listPrice[tokenId] = price;
        listed[tokenId] = true;
        _sellerOf[tokenId] = seller;
        _queue.push(tokenId);
        emit Listed(tokenId, price);
    }

    function _clearListingMeta(uint256 tokenId) internal {
        delete listPrice[tokenId];
        delete listed[tokenId];
        delete _sellerOf[tokenId];
        emit Unlisted(tokenId);
    }

    function _distributeSale(address buyer, address seller, uint256 price) internal {
        // Resale economics: reverse +10% list → prior cost, split only the appreciation/profit slice.
        // Example: buyer pays $12.10 → cost $11.00 back to seller + $1.10 profit split 30/20/5/25/10/10%.
        uint256 costBasis = (price * BPS) / (BPS + appreciationBps);
        uint256 profit = price - costBasis;

        uint256 sellerProfit = (profit * sellerBps) / BPS;
        uint256 teamAmt = (profit * teamBps) / BPS;
        uint256 creatorAmt = (profit * creatorBps) / BPS;
        uint256 burnAmt = (profit * burnBps) / BPS;
        uint256 liqAmt = (profit * liquidityBps) / BPS;
        uint256 globalAmt = profit - sellerProfit - teamAmt - creatorAmt - burnAmt - liqAmt;

        if (seller != address(0)) {
            _payUser(seller, costBasis + sellerProfit);
        } else {
            burnAmt += costBasis + sellerProfit;
        }

        uint256 paidTeam = _distributeTeam(buyer, teamAmt);
        if (teamAmt > paidTeam) burnAmt += teamAmt - paidTeam;

        if (creatorAmt > 0) usdt.safeTransfer(creatorWallet, creatorAmt);

        if (liqAmt > 0) {
            if (address(liquidityManager) != address(0)) {
                usdt.forceApprove(address(liquidityManager), liqAmt);
                liquidityManager.receiveLiquidity(liqAmt);
            } else {
                usdt.safeTransfer(creatorWallet, liqAmt);
            }
        }
        if (globalAmt > 0) {
            if (address(globalPool) != address(0)) {
                usdt.forceApprove(address(globalPool), globalAmt);
                globalPool.credit(globalAmt);
            } else {
                usdt.safeTransfer(creatorWallet, globalAmt);
            }
        }
        if (burnAmt > 0) {
            if (address(treasury) != address(0)) {
                usdt.forceApprove(address(treasury), burnAmt);
                treasury.receiveBurn(burnAmt);
            } else {
                usdt.safeTransfer(creatorWallet, burnAmt);
            }
        }
    }

    function _distributeTeam(address buyer, uint256 teamBudget) internal returns (uint256 paid) {
        uint256 perLevel = teamBudget / MAX_LEVELS;
        (, , , address sponsor, , , , , ) = registration.users(buyer);
        address current = sponsor;

        for (uint256 level = 1; level <= MAX_LEVELS; level++) {
            if (current == address(0) || paid + perLevel > teamBudget) break;
            (
                bool registered,
                ,
                bool permanentlyInactive,
                address nextSponsor,
                ,
                ,
                ,
                ,
                uint256 directCount
            ) = registration.users(current);

            if (registered && !permanentlyInactive && registration.nftLevelsForDirects(directCount) >= level) {
                _payUser(current, perLevel);
                paid += perLevel;
            }
            current = nextSponsor;
        }
    }

    /// @dev Seller + team/upline income — immediate USDT to wallet (same as Registration). Global pool stays periodic via `globalPool.credit`.
    function _payUser(address to, uint256 amount) internal {
        usdt.safeTransfer(to, amount);
    }

    function _enforceDailyLimit(address buyer, uint256 price) internal view {
        (, , , , , uint256 tradingLimit, , , ) = registration.users(buyer);
        if (tradingLimit == 0) revert NotActivated();
        uint256 day = registration.currentDay();
        uint256 used = registration.dailyVolume(buyer, day);
        if (used + price > tradingLimit) revert DailyLimitExceeded();
    }

    function _requireActive(address user) internal view {
        (bool registered, bool activated, bool permanentlyInactive, , , , , , ) = registration.users(user);
        if (!registered || !activated) revert NotActivated();
        if (permanentlyInactive) revert PermanentlyInactive();
    }

    function _exists(uint256 tokenId) internal view returns (bool) {
        try this.ownerOf(tokenId) returns (address) {
            return true;
        } catch {
            return false;
        }
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && heldTokenId[from] == tokenId && to != from) {
            heldTokenId[from] = 0;
            emit Unheld(from, tokenId);
        }
        return super._update(to, tokenId, auth);
    }
}
