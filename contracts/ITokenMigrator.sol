pragma solidity 0.5.11;


interface ITokenMigrator {
    function migrate(address from, address to, uint256 amount) external returns (bool);
}