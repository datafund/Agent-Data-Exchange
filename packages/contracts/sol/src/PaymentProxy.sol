// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PaymentProxy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public platform;
    uint16 public feeBps;

    mapping(address => bool) public relayers;

    event PaymentForwarded(
        address indexed seller,
        address indexed token,
        uint256 amount,
        uint256 fee,
        bytes32 skillId
    );
    event RelayerUpdated(address indexed relayer, bool allowed);

    error OnlyRelayer();
    error FeeTooHigh();
    error InsufficientBalance();
    error ZeroAmount();

    modifier onlyRelayer() {
        if (!relayers[msg.sender] && msg.sender != owner()) revert OnlyRelayer();
        _;
    }

    constructor(address _platform, uint16 _feeBps) Ownable(msg.sender) {
        if (_feeBps > 2000) revert FeeTooHigh();
        platform = _platform;
        feeBps = _feeBps;
    }

    function forward(
        address seller,
        address token,
        uint256 amount,
        bytes32 skillId
    ) external onlyRelayer nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance();

        uint256 fee = (amount * feeBps) / 10000;
        uint256 sellerAmount = amount - fee;

        if (fee > 0) {
            IERC20(token).safeTransfer(platform, fee);
        }
        IERC20(token).safeTransfer(seller, sellerAmount);

        emit PaymentForwarded(seller, token, amount, fee, skillId);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > 2000) revert FeeTooHigh();
        feeBps = _feeBps;
    }

    function setPlatform(address _platform) external onlyOwner {
        platform = _platform;
    }

    /// @notice Recover stuck tokens. Restricted to owner.
    function recover(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
