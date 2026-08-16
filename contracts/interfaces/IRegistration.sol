// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRegistration {
    function users(address account) external view returns (
        bool registered,
        bool activated,
        bool permanentlyInactive,
        address sponsor,
        uint8 packageId,
        uint256 tradingLimit,
        uint256 activatedAt,
        uint256 lastUpgradeAt,
        uint256 directCount
    );

    function packages(uint8 packageId) external view returns (
        uint256 price,
        uint256 tradingLimit,
        bool exists
    );

    function getDirectReferrals(address user) external view returns (address[] memory);
    function levelsForDirects(uint256 directs) external view returns (uint256);
    function nftLevelsForDirects(uint256 directs) external view returns (uint256);
    function teamSize(address user) external view returns (uint256);

    function recordVolume(address user, uint256 amount) external;
    function dailyVolume(address user, uint256 day) external view returns (uint256);
    function currentDay() external view returns (uint256);
    function isCompliant(address user, uint256 day) external view returns (bool);
    function requiredDailyVolume(address user) external view returns (uint256);

    function setPermanentlyInactive(address user, bool value) external;
}
