const BN = web3.utils.BN;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

const { sign, getTime, increaseTime } = require('./utils.js');

const OneToken = new BN(web3.utils.toWei('1', 'ether'));

const ParsiqToken = artifacts.require('ParsiqToken');
const Burner = artifacts.require('Burner');
const RandomContract = artifacts.require('RandomContract');
const TestTokenReceiver = artifacts.require("TestTokenReceiver");
const CanonicalBurner = artifacts.require("CanonicalBurner");
const TestERC20Token = artifacts.require("TestERC20Token");

contract('Parsiq Token', async accounts => {
  const admin = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  let token;
  let burner;

  beforeEach(async () => {
    burner = await Burner.new();
    token = await ParsiqToken.new(burner.address);
    await burner.initialize(token.address);
  });

  describe('Default', () => {
    it('receives token name', async () => {
      (await token.name()).should.equal('Parsiq Token');
    });
    it('receives token symbol', async () => {
      (await token.symbol()).should.equal('PRQ');
    });
    it('receives decimals', async () => {
      (await token.decimals()).should.bignumber.equal('18');
    });
    it('should successfully set burn address', async () => {
      (await token.burnerAddress()).should.equal(burner.address);
    });
  });

  describe('Transfer', () => {
    it('allows owner to transfer tokens', async () => {
      await token.transfer(user2, OneToken);

      (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken);
    });

    it('should transfer when transfers are enabled', async () => {
      const unlockTime = (await getTime()) + 5;
      await token.unlockTransfers(unlockTime);
      await increaseTime(10);
      await token.transfer(user1, OneToken);

      await token.transfer(user2, OneToken, {
        from: user1
      });

      (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken);
    });

    it('stranger cannot transfer tokens', async () => {
      await token.transfer(user2, OneToken, {
        from: user2
      }).should.be.rejected;
    });

    it('cannot transfer to address(0)', async () => {
      await token.transfer('0x0', OneToken).should.be.rejected;
    });

    it('transfers and notifies smart contract', async () => {
      const receiver = await TestTokenReceiver.new(token.address);

      await token.transfer(receiver.address, OneToken);

      (await token.balanceOf(receiver.address)).should.bignumber.equal(OneToken);
      (await receiver.from()).should.equal(admin);
      (await receiver.to()).should.equal(receiver.address);
      (await receiver.amount()).should.bignumber.equal(OneToken);
    });

    it('transfers and burns when transfering to burner contract', async () => {
      await token.enableBurning();

      await token.transfer(burner.address, OneToken);

      (await token.balanceOf(burner.address)).should.bignumber.equal('0');
    });
  });

  describe('Sending', () => {
    let random;
    let receiver;
    beforeEach(async () => {
      await token.transfer(admin, OneToken.mul(new BN(10)));
      random = await RandomContract.new();
      receiver = await TestTokenReceiver.new(token.address);
    });

    it('should success ERC20 transfer', async () => {
      await token.transfer(user1, OneToken);

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
    });

    it('should successfully transfer and notify token receiver smart contract', async () => {
      await token.transfer(receiver.address, OneToken);

      (await token.balanceOf(receiver.address)).should.be.bignumber.equal(OneToken);
      (await receiver.from()).should.equal(admin);
      (await receiver.to()).should.equal(receiver.address);
      (await receiver.amount()).should.bignumber.equal(OneToken);
    });

    it('should successfully transfer into unregistered smart contract ', async () => {
      await receiver.unregister();

      await token.transfer(receiver.address, OneToken);

      (await token.balanceOf(receiver.address)).should.be.bignumber.equal(OneToken);
      (await receiver.from()).should.equal('0x0000000000000000000000000000000000000000');
      (await receiver.to()).should.equal('0x0000000000000000000000000000000000000000');
      (await receiver.amount()).should.bignumber.equal(new BN('0'));
    });
  });

  describe('Etherless Transfer', () => {
    let receiver;
    let methodSignature;
    beforeEach(async () => {
      random = await RandomContract.new();
      receiver = await TestTokenReceiver.new(token.address);
      methodSignature = web3.eth.abi.encodeFunctionSignature("transferPreSigned(bytes,address,uint256,uint256,uint256)");
    });

    it('should success ERC20 transfer', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, user1, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);

      await token.transferPreSigned(signature, user1, OneToken, OneToken, 1);

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
    });
   
    it('should fail to ERC20 transfer when etherless transfers disabled', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, user1, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);
      await token.disableEtherlessTransfer();

      await token.transferPreSigned(signature, user1, OneToken, OneToken, 1).should.be.rejected;
    });

    it('should success ERC20 transfer when etherless transfers enabled', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, user1, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);
      await token.disableEtherlessTransfer();
      await token.transferPreSigned(signature, user1, OneToken, OneToken, 1).should.be.rejected;
      await token.enableEtherlessTransfer();

      await token.transferPreSigned(signature, user1, OneToken, OneToken, 1);

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
    });

    it('should success ERC20 transfer from receiver', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, user1, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);

      await token.transferPreSigned(signature, user1, OneToken, OneToken, 1, { from: user1 });

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken.mul(new BN('2')));
    });

    it('should successfully transfer and notify token receiver smart contract', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, receiver.address, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);

      await token.transferPreSigned(signature, receiver.address, OneToken, OneToken, 1);

      (await token.balanceOf(receiver.address)).should.be.bignumber.equal(OneToken);
      (await receiver.from()).should.equal(admin);
      (await receiver.to()).should.equal(receiver.address);
      (await receiver.amount()).should.bignumber.equal(OneToken);
    });

    it('should successfully forward transfer and notify token receiver smart contract', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, user1, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);

      await receiver.forwardTransferPreSigned(signature, user1, OneToken, OneToken, 1);

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
      (await token.balanceOf(receiver.address)).should.be.bignumber.equal(OneToken);
      (await receiver.from()).should.equal(admin);
      (await receiver.to()).should.equal(receiver.address);
      (await receiver.amount()).should.bignumber.equal(OneToken);
    });

    it('should successfully forward transfer and notify token receiver smart contract', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, receiver.address, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);

      await receiver.forwardTransferPreSigned(signature, receiver.address, OneToken, OneToken, 1);

      (await token.balanceOf(receiver.address)).should.be.bignumber.equal(OneToken.mul(new BN('2')));
      (await receiver.from()).should.equal(admin);
      (await receiver.to()).should.equal(receiver.address);
      (await receiver.amount()).should.bignumber.equal(OneToken.mul(new BN('2')));
    });

    it('should successfully transfer into unregistered smart contract ', async () => {
      const msg = await token.hashForSign(methodSignature, token.address, receiver.address, OneToken, OneToken, 1);
      const signature = await sign(msg, admin);
      await receiver.unregister();

      await token.transferPreSigned(signature, receiver.address, OneToken, OneToken, 1);

      (await token.balanceOf(receiver.address)).should.be.bignumber.equal(OneToken);
      (await receiver.from()).should.equal('0x0000000000000000000000000000000000000000');
      (await receiver.to()).should.equal('0x0000000000000000000000000000000000000000');
      (await receiver.amount()).should.bignumber.equal(new BN('0'));
    });
  });

  describe('Burning', () => {
    let canonicalBurner;
    let receiver;
    beforeEach(async () => {
      canonicalBurner = await CanonicalBurner.new(token.address);
      receiver = await TestTokenReceiver.new(token.address);
    });

    it('should allow burning before all tokens are minted', async () => {
      const totalSupply = await token.totalSupply();
      await token.enableBurning();

      await token.transfer(burner.address, OneToken);

      (await token.balanceOf(burner.address)).should.bignumber.equal(new BN(0));
      (await token.totalSupply()).should.bignumber.equal(totalSupply.sub(OneToken));
    });

    it('should burn tokens when transfering to burnAddress', async () => {
      await token.transfer(admin, OneToken);
      const balance = await token.balanceOf(admin);
      await token.enableBurning();

      await token.transfer(burner.address, OneToken);

      (await token.balanceOf(burner.address)).should.bignumber.equal(new BN(0));
      (await token.balanceOf(admin)).should.bignumber.equal(new BN(balance).sub(OneToken));
    });

    it('should burn tokens using burning contract', async () => {
      const balance = await token.balanceOf(admin);
      await token.enableBurning();

      await token.transfer(burner.address, OneToken);

      (await token.balanceOf(burner.address)).should.bignumber.equal(new BN(0));
      (await token.balanceOf(admin)).should.bignumber.equal(new BN(balance).sub(OneToken));
    });

    it('unregistered burner should have balance', async () => {
      await receiver.unregister();
      await token.enableBurning();

      await token.transfer(receiver.address, OneToken);

      (await token.balanceOf(receiver.address)).should.bignumber.equal(OneToken);
    });

    it('stranger cannot burn tokens', async () => {
      await token.transfer(user2, OneToken);
      await token.enableBurning();

      await token.burn(OneToken, { from: user2 }).should.be.rejected;
    });
  });

  describe('Token Recovery', () => {
    let erc20Token;

    beforeEach(async () => {
      erc20Token = await TestERC20Token.new();

      await erc20Token.mint(user1, OneToken);
      await erc20Token.transfer(token.address, OneToken, {
        from: user1
      });
    });

    it('owner can recover other tokens', async () => {
      await token.recoverTokens(erc20Token.address, user1, OneToken);

      (await erc20Token.balanceOf(token.address)).should.be.bignumber.equal('0');
      (await erc20Token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
    });

    it('stranger cannot recover other tokens', async () => {
      await token.recoverTokens(erc20Token.address, user1, OneToken, {
        from: user1
      }).should.be.rejected;
    });
  });
});
