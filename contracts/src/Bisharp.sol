// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Single-chain Sepolia prototype. No bridge, router, admin or real stablecoins.
/// Solvers deliver the fixed test output directly and earn the escrowed input.
contract Bisharp is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Unknown, Open, Filled, Cancelled }
    struct Order {
        address owner;
        address recipient;
        uint256 principal;
        uint256 minOutput;
        uint256 maxPrice;
        uint64 deadline;
        Status status;
        address solver;
    }

    IERC20 public immutable inputToken;
    IERC20 public immutable outputToken;
    IPriceFeed public immutable priceFeed;
    uint256 public immutable maxPriceAge;
    uint8 public immutable feedDecimals;
    uint256 public orderCount;
    uint256 public totalLiability;
    mapping(uint256 => Order) private orders;
    mapping(address => uint256) public credits;

    event OrderCreated(uint256 indexed id, address indexed owner, address indexed recipient, uint256 principal, uint256 minOutput, uint256 maxPrice, uint64 deadline);
    event OrderFilled(uint256 indexed id, address indexed solver, uint256 delivered);
    event OrderCancelled(uint256 indexed id);
    event Claimed(address indexed beneficiary, uint256 amount);

    error InvalidTerms();
    error InvalidState();
    error Unauthorized();
    error IneligiblePrice();
    error InvalidPrice();
    error UnsupportedToken();

    constructor(address input_, address output_, address feed_, uint256 age_) {
        if (input_ == output_ || input_.code.length == 0 || output_.code.length == 0 || feed_.code.length == 0 || age_ == 0 || age_ > 1 days) revert InvalidTerms();
        inputToken = IERC20(input_);
        outputToken = IERC20(output_);
        priceFeed = IPriceFeed(feed_);
        uint8 d = IPriceFeed(feed_).decimals();
        if (d > 18) revert InvalidTerms();
        feedDecimals = d;
        maxPriceAge = age_;
    }

    /// @return price ETH/USD normalized exactly to 18 decimals.
    function currentPrice() public view returns (uint256 price) {
        (uint80 round, int256 answer,, uint256 updated, uint80 answered) = priceFeed.latestRoundData();
        if (answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > maxPriceAge || answered < round) revert InvalidPrice();
        price = uint256(answer) * (10 ** (18 - feedDecimals));
    }

    function getOrder(uint256 id) external view returns (Order memory) { return orders[id]; }

    function createOrder(uint256 principal, uint256 minOutput, uint256 maxPrice, uint64 deadline, address recipient) external nonReentrant returns (uint256 id) {
        if (principal == 0 || minOutput == 0 || maxPrice == 0 || recipient == address(0) || recipient == address(this) || deadline < block.timestamp + 5 minutes || deadline > block.timestamp + 30 days) revert InvalidTerms();
        uint256 beforeBalance = inputToken.balanceOf(address(this));
        inputToken.safeTransferFrom(msg.sender, address(this), principal);
        if (inputToken.balanceOf(address(this)) - beforeBalance != principal) revert UnsupportedToken();
        id = ++orderCount;
        orders[id] = Order(msg.sender, recipient, principal, minOutput, maxPrice, deadline, Status.Open, address(0));
        totalLiability += principal;
        emit OrderCreated(id, msg.sender, recipient, principal, minOutput, maxPrice, deadline);
    }

    function fillOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.status != Status.Open || block.timestamp >= o.deadline) revert InvalidState();
        if (currentPrice() > o.maxPrice) revert IneligiblePrice();
        // State, delivery and credit allocation all revert together on failure.
        o.status = Status.Filled;
        o.solver = msg.sender;
        uint256 beforeBalance = outputToken.balanceOf(o.recipient);
        outputToken.safeTransferFrom(msg.sender, o.recipient, o.minOutput);
        if (outputToken.balanceOf(o.recipient) - beforeBalance < o.minOutput) revert UnsupportedToken();
        credits[msg.sender] += o.principal;
        emit OrderFilled(id, msg.sender, o.minOutput);
    }

    /// @dev Owner can cancel before expiry; anyone can close an expired order.
    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.status != Status.Open) revert InvalidState();
        if (msg.sender != o.owner && block.timestamp < o.deadline) revert Unauthorized();
        o.status = Status.Cancelled;
        credits[o.owner] += o.principal;
        emit OrderCancelled(id);
    }

    /// @notice Anyone may trigger a payment, always to its fixed beneficiary.
    function claim(address beneficiary) external nonReentrant {
        uint256 amount = credits[beneficiary];
        if (amount == 0) revert InvalidState();
        credits[beneficiary] = 0;
        totalLiability -= amount;
        inputToken.safeTransfer(beneficiary, amount);
        emit Claimed(beneficiary, amount);
    }
}
