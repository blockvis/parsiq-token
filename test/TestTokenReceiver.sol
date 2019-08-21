pragma solidity 0.5.11;

import "../contracts/ITokenReceiver.sol";
import "../contracts/ParsiqToken.sol";

contract TestTokenReceiver is ITokenReceiver {
    address public from;
    address public to;
    uint256 public amount;
    address payable public token;

    constructor(address payable _token) public {
        token = _token;
        ParsiqToken(_token).register();
    }

    function unregister() public {
        ParsiqToken(token).unregister();
    }

    function tokensReceived(
        address _from,
        address _to,
        uint256 _amount
    ) external {
        from = _from;
        to = _to;
        amount = _amount;
    }

    function forwardTransferPreSigned(bytes memory _signature,
        address _to,
        uint256 _value,
        uint256 _fee,
        uint256 _nonce) public returns (bool)
    {
        ParsiqToken(token).transferPreSigned(_signature, _to, _value, _fee, _nonce);
    }
}