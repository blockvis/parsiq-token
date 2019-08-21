pragma solidity 0.5.11;

import "./ITokenReceiver.sol";
import "./ParsiqToken.sol";
/**
    This contract is only an example of automatic burner contract which can perform actions before burning tokens 
 */
contract CanonicalBurner is ITokenReceiver {

    address payable public token;

    constructor(address payable _token) public {
        token = _token;
        ParsiqToken(token).register();
    }

    function tokensReceived(address, address, uint256 amount) external {
        require(msg.sender == token, "Only Parsiq Token can notify");
        ParsiqToken(token).burn(amount);
    }
}