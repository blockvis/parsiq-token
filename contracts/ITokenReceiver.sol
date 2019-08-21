pragma solidity 0.5.11;


interface ITokenReceiver {
    function tokensReceived(
        address from,
        address to,
        uint256 amount
    ) external;
}