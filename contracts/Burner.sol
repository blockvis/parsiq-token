pragma solidity 0.5.11;

import "./TokenRecoverable.sol";
import "./ITokenReceiver.sol";
import "./ITokenMigrator.sol";
import "./ParsiqToken.sol";

contract Burner is TokenRecoverable, ITokenReceiver {
    address payable public token;

    address public migrator;

    function initialize(address payable _token) public onlyOwner {
        require(token == address(0), "Already initialized");
        ParsiqToken(_token).register();
        token = _token;
    }

    function setMigrator(address _migrator) public onlyOwner {
        migrator = _migrator;
    }

    function tokensReceived(address from, address to, uint256 amount) external {
        require(token != address(0), "Burner is not initialized");
        require(msg.sender == token, "Only Parsiq Token can notify");
        require(ParsiqToken(token).burningEnabled(), "Burning is disabled");
        if (migrator != address(0)) {
            ITokenMigrator(migrator).migrate(from, to, amount);
        }
        ParsiqToken(token).burn(amount);
    }
}