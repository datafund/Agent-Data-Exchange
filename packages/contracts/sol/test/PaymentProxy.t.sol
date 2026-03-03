// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PaymentProxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USDC", "USDC") {
        _mint(msg.sender, 1_000_000e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract PaymentProxyTest is Test {
    PaymentProxy proxy;
    MockUSDC usdc;
    address owner = address(this);
    address platform;
    address relayer;
    address seller;
    address attacker;

    event PaymentForwarded(
        address indexed seller,
        address indexed token,
        uint256 amount,
        uint256 fee,
        bytes32 skillId
    );

    function setUp() public {
        platform = makeAddr("platform");
        relayer = makeAddr("relayer");
        seller = makeAddr("seller");
        attacker = makeAddr("attacker");

        usdc = new MockUSDC();
        proxy = new PaymentProxy(platform, 0);
        proxy.setRelayer(relayer, true);
    }

    function testForwardZeroFee() public {
        usdc.transfer(address(proxy), 500_000);
        vm.prank(relayer);
        proxy.forward(seller, address(usdc), 500_000, bytes32(uint256(1)));
        assertEq(usdc.balanceOf(seller), 500_000);
        assertEq(usdc.balanceOf(platform), 0);
    }

    function testForwardWithFee() public {
        proxy.setFeeBps(500);
        usdc.transfer(address(proxy), 1_000_000);
        vm.prank(relayer);
        proxy.forward(seller, address(usdc), 1_000_000, bytes32(uint256(2)));
        assertEq(usdc.balanceOf(seller), 950_000);
        assertEq(usdc.balanceOf(platform), 50_000);
    }

    function testOnlyRelayerCanForward() public {
        usdc.transfer(address(proxy), 100_000);
        vm.prank(attacker);
        vm.expectRevert(PaymentProxy.OnlyRelayer.selector);
        proxy.forward(seller, address(usdc), 100_000, bytes32(0));
    }

    function testOwnerCanForward() public {
        usdc.transfer(address(proxy), 100_000);
        proxy.forward(seller, address(usdc), 100_000, bytes32(0));
        assertEq(usdc.balanceOf(seller), 100_000);
    }

    function testFeeCannotExceed20Percent() public {
        vm.expectRevert(PaymentProxy.FeeTooHigh.selector);
        proxy.setFeeBps(2001);
    }

    function testFeeBoundary2000() public {
        proxy.setFeeBps(2000);
        assertEq(proxy.feeBps(), 2000);
    }

    function testRecoverRequiresOwner() public {
        usdc.transfer(address(proxy), 100_000);
        vm.prank(attacker);
        vm.expectRevert();
        proxy.recover(address(usdc), attacker, 100_000);
    }

    function testSetPlatformRequiresOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        proxy.setPlatform(attacker);
    }

    function testForwardInsufficientBalance() public {
        vm.prank(relayer);
        vm.expectRevert(PaymentProxy.InsufficientBalance.selector);
        proxy.forward(seller, address(usdc), 100_000, bytes32(0));
    }

    function testForwardEmitsEvent() public {
        usdc.transfer(address(proxy), 500_000);
        vm.prank(relayer);
        vm.expectEmit(true, true, false, true);
        emit PaymentForwarded(seller, address(usdc), 500_000, 0, bytes32(uint256(1)));
        proxy.forward(seller, address(usdc), 500_000, bytes32(uint256(1)));
    }

    function testForwardZeroAmountReverts() public {
        vm.prank(relayer);
        vm.expectRevert(PaymentProxy.ZeroAmount.selector);
        proxy.forward(seller, address(usdc), 0, bytes32(0));
    }
}
