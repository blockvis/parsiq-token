pragma solidity 0.5.11;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./TokenRecoverable.sol";
import "./ITokenReceiver.sol";


contract ParsiqToken is TokenRecoverable, ERC20 {
    using SafeMath for uint256;
    using ECDSA for bytes32;
    using Address for address;

    uint256 public constant MAX_UINT256 = ~uint256(0);
    uint256 public constant TOTAL_TOKENS = 1000000e18; // 1 000 000 tokens
    string public constant name = "Parsiq Token";
    string public constant symbol = "PRQ";
    uint8 public constant decimals = uint8(18);

    mapping(address => bool) public notify;
    mapping(address => Timelock[]) public timelocks;
    mapping(address => Timelock[]) public relativeTimelocks;
    mapping(bytes32 => bool) public hashedTxs;
    mapping(address => bool) public whitelisted;
    uint256 public transfersUnlockTime = MAX_UINT256; // MAX_UINT256 - transfers locked
    address public burnAddress;
    bool public etherlessTransferEnabled = true;

    struct Timelock {
        uint256 time;
        uint256 amount;
    }

    event TransferPreSigned(
        address indexed from,
        address indexed to,
        address indexed delegate,
        uint256 amount,
        uint256 fee);
    event TransferLocked(address indexed from, address indexed to, uint256 amount, uint256 until);
    event TransferLockedRelative(address indexed from, address indexed to, uint256 amount, uint256 duration);
    event Released(address indexed to, uint256 amount);
    event WhitelistedAdded(address indexed account);
    event WhitelistedRemoved(address indexed account);

    modifier onlyWhenEtherlessTransferEnabled {
        require(etherlessTransferEnabled == true, "Etherless transfer functionality disabled");
        _;
    }
    
    modifier onlyBurnAddress() {
        require(msg.sender == burnAddress, "Only burnAddress can burn tokens");
        _;
    }

    modifier onlyWhenTransfersUnlocked(address from, address to) {
        require(
            transfersUnlockTime <= now ||
            whitelisted[from] == true ||
            whitelisted[to] == true, "Transfers locked");
        _;
    }

    modifier onlyWhitelisted() {
        require(whitelisted[msg.sender] == true, "Not whitelisted");
        _;
    }

    modifier notTokenAddress(address _address) {
        require(_address != address(this), "Cannot transfer to token contract");
        _;
    }

    constructor() public TokenRecoverable() {
        _mint(msg.sender, TOTAL_TOKENS);
        _addWhitelisted(msg.sender);
    }

    function () external payable {
        _release(msg.sender);
        if (msg.value > 0) {
            msg.sender.transfer(msg.value);
        }
    }

    function register() public {
        notify[msg.sender] = true;
    }

    function unregister() public {
        notify[msg.sender] = false;
    }

    function enableEtherlessTransfer() public onlyOwner {
        etherlessTransferEnabled = true;
    }

    function disableEtherlessTransfer() public onlyOwner {
        etherlessTransferEnabled = false;
    }

    function addWhitelisted(address _address) public onlyOwner {
        _addWhitelisted(_address);
    }

    function removeWhitelisted(address _address) public onlyOwner {
        _removeWhitelisted(_address);
    }

    function renounceWhitelisted() public {
        _removeWhitelisted(msg.sender);
    }

    function transferOwnership(address newOwner) public onlyOwner {
        _removeWhitelisted(owner());
        super.transferOwnership(newOwner);
        _addWhitelisted(newOwner);
    }

    function renounceOwnership() public onlyOwner {
        renounceWhitelisted();
        super.renounceOwnership();
    }

    function unlockTransfers(uint256 when) public onlyOwner {
        require(transfersUnlockTime == MAX_UINT256, "Transfers already unlocked");
        require(when >= now, "Transfer unlock must not be in past");
        transfersUnlockTime = when;
    }

    function transfer(address to, uint256 value) public
        onlyWhenTransfersUnlocked(msg.sender, to)
        notTokenAddress(to)
        returns (bool)
    {
        bool success = super.transfer(to, value);
        if (success) {
            _postTransfer(msg.sender, to, value);
        }
        return success;
    }

    function transferFrom(address from, address to, uint256 value) public
        onlyWhenTransfersUnlocked(from, to)
        notTokenAddress(to)
        returns (bool)
    {
        bool success = super.transferFrom(from, to, value);
        if (success) {
            _postTransfer(from, to, value);
        }
        return success;
    }

    // We do not limit batch size, it's up to caller to determine maximum batch size/gas limit
    function transferBatch(address[] memory to, uint256[] memory value) public returns (bool) {
        require(to.length == value.length, "Array sizes must be equal");
        uint256 n = to.length;
        for (uint256 i = 0; i < n; i++) {
            transfer(to[i], value[i]);
        }
    }

    function transferLocked(address to, uint256 value, uint256 until) public
        onlyWhitelisted returns (bool)
    {
        require(to != address(this), "Cannot lock on contract address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(value > 0, "Value must be positive");
        require(until > now, "Until must be future value");

        _transfer(msg.sender, address(this), value);

        timelocks[to].push(Timelock({ time: until, amount: value }));

        emit TransferLocked(msg.sender, to, value, until);
    }

    /**
    This function is analogue to transferLocked(), but uses relative time locks to synchornize
    with transfer unlocking time
     */
    function transferLockedRelative(address to, uint256 value, uint256 duration) public
        onlyWhitelisted returns (bool)
    {
        require(transfersUnlockTime > now, "Relative locks are disabled. Use transferLocked() instead");
        require(to != address(this), "Cannot lock on contract address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(value > 0, "Value must be positive");

        _transfer(msg.sender, address(this), value);

        relativeTimelocks[to].push(Timelock({ time: duration, amount: value }));

        emit TransferLockedRelative(msg.sender, to, value, duration);
    }

    function release() public {
        _release(msg.sender);
    }

    function lockedBalanceOf(address who) public view returns (uint256) {
        return _lockedBalanceOf(timelocks[who])
            .add(_lockedBalanceOf(relativeTimelocks[who]));
    }
    
    function unlockableBalanceOf(address who) public view returns (uint256) {
        uint256 tokens = _unlockableBalanceOf(timelocks[who], 0);
        if (transfersUnlockTime > now) return tokens;

        return tokens.add(_unlockableBalanceOf(relativeTimelocks[who], transfersUnlockTime));
    }

    function totalBalanceOf(address who) public view returns (uint256) {
        return balanceOf(who).add(lockedBalanceOf(who));
    }

    /**
     * @dev Burns a specific amount of tokens.
     * @param value The amount of token to be burned.
     */
    function burn(uint256 value) public onlyBurnAddress {
        _burn(msg.sender, value);
    }

    function setBurnAddress(address _burnAddress) public onlyOwner {
        require(balanceOf(_burnAddress) == 0, "Burn address must have zero balance!");

        burnAddress = _burnAddress;
    }

    /** Etherless Transfer (ERC865 based) */
    /**
     * @notice Submit a presigned transfer
     * @param _signature bytes The signature, issued by the owner.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _nonce uint256 Presigned transaction number. Should be unique, per user.
     */
    function transferPreSigned(
        bytes memory _signature,
        address _to,
        uint256 _value,
        uint256 _fee,
        uint256 _nonce
    )
        public
        onlyWhenEtherlessTransferEnabled
        notTokenAddress(_to)
        returns (bool)
    {
        require(_to != address(0), "Transfer to the zero address");

        bytes32 hashedParams = hashForSign(msg.sig, address(this), _to, _value, _fee, _nonce);
        address from = hashedParams.toEthSignedMessageHash().recover(_signature);
        require(from != address(0), "Invalid signature");

        require(
            transfersUnlockTime <= now ||
            whitelisted[from] == true ||
            whitelisted[_to] == true, "Transfers are locked");

        bytes32 hashedTx = keccak256(abi.encodePacked(from, hashedParams));
        require(hashedTxs[hashedTx] == false, "Nonce already used");
        hashedTxs[hashedTx] = true;

        if (msg.sender == _to) {
            _transfer(from, _to, _value.add(_fee));
            _postTransfer(from, _to, _value.add(_fee));
        } else {
            _transfer(from, _to, _value);
            _postTransfer(from, _to, _value);
            _transfer(from, msg.sender, _fee);
            _postTransfer(from, msg.sender, _fee);
        }

        emit TransferPreSigned(from, _to, msg.sender, _value, _fee);
        return true;
    }

    /**
     * @notice Hash (keccak256) of the payload used by transferPreSigned
     * @param _token address The address of the token.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _nonce uint256 Presigned transaction number.
     */
    function hashForSign(
        bytes4 _selector,
        address _token,
        address _to,
        uint256 _value,
        uint256 _fee,
        uint256 _nonce
    )
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(_selector, _token, _to, _value, _fee, _nonce));
    }

    function releasePreSigned(bytes memory _signature, uint256 _fee, uint256 _nonce)
        public
        onlyWhenEtherlessTransferEnabled
        returns (bool)
    {
        bytes32 hashedParams = hashForReleaseSign(msg.sig, address(this), _fee, _nonce);
        address from = hashedParams.toEthSignedMessageHash().recover(_signature);
        require(from != address(0), "Invalid signature");

        bytes32 hashedTx = keccak256(abi.encodePacked(from, hashedParams));
        require(hashedTxs[hashedTx] == false, "Nonce already used");
        hashedTxs[hashedTx] = true;

        uint256 released = _release(from);
        require(released > _fee, "Too small release");
        if (from != msg.sender) { // "from" already have all the tokens, no need to charge
            _transfer(from, msg.sender, _fee);
            _postTransfer(from, msg.sender, _fee);
        }
        return true;
    }

    /**
     * @notice Hash (keccak256) of the payload used by transferPreSigned
     * @param _token address The address of the token.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _nonce uint256 Presigned transaction number.
     */
    function hashForReleaseSign(
        bytes4 _selector,
        address _token,
        uint256 _fee,
        uint256 _nonce
    )
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(_selector, _token, _fee, _nonce));
    }

    function recoverTokens(IERC20 token, address to, uint256 amount) public onlyOwner {
        require(address(token) != address(this), "Cannot recover Parsiq tokens");
        super.recoverTokens(token, to,  amount);
    }

    function _release(address beneficiary) internal returns (uint256) {
        uint256 tokens = _releaseLocks(timelocks[beneficiary], 0);
        if (transfersUnlockTime <= now) {
            tokens = tokens.add(_releaseLocks(relativeTimelocks[beneficiary], transfersUnlockTime));
        }

        if (tokens == 0) return 0;

        _transfer(address(this), beneficiary, tokens);
        _postTransfer(address(this), beneficiary, tokens);
        emit Released(beneficiary, tokens);
        return tokens;
    }

    function _releaseLocks(Timelock[] storage locks, uint256 relativeTime) internal returns (uint256) {
        uint256 tokens = 0;
        uint256 lockCount = locks.length;
        uint256 i = lockCount;
        while (i > 0) {
            i--;
            Timelock storage timelock = locks[i];
            if (relativeTime.add(timelock.time) > now) continue;
            
            tokens = tokens.add(timelock.amount);
            lockCount--;
            if (i != lockCount) {
                locks[i] = locks[lockCount];
            }
        }
        locks.length = lockCount;
        return tokens;
    }

    function _lockedBalanceOf(Timelock[] storage locks) internal view returns (uint256) {
        uint256 tokens = 0;
        uint256 n = locks.length;
        for (uint256 i = 0; i < n; i++) {
            tokens = tokens.add(locks[i].amount);
        }
        return tokens;
    }

    function _unlockableBalanceOf(Timelock[] storage locks, uint256 relativeTime) internal view returns (uint256) {
        uint256 tokens = 0;
        uint256 n = locks.length;
        for (uint256 i = 0; i < n; i++) {
            Timelock storage timelock = locks[i];
            if (relativeTime.add(timelock.time) <= now) {
                tokens = tokens.add(timelock.amount);
            }
        }
        return tokens;
    }

    function _postTransfer(address from, address to, uint256 value) internal {
        if (to.isContract()) {
            if (notify[to] == false) return;

            ITokenReceiver(to).tokensReceived(from, to, value);
        } else {
            if (to == burnAddress) {
                _burn(burnAddress, value);
            }
        }
    }

    function _addWhitelisted(address _address) internal {
        whitelisted[_address] = true;
        emit WhitelistedAdded(_address);
    }

    function _removeWhitelisted(address _address) internal {
        whitelisted[_address] = false;
        emit WhitelistedRemoved(_address);
    }
}