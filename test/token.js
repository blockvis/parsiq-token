const BN = web3.utils.BN;

const { hashAndSign, getTime, nextBlock, increaseTime } = require('./utils.js');

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

const OneToken = new BN(web3.utils.toWei('1', 'ether'));

const ParsiqToken = artifacts.require('ParsiqToken');
const Burner = artifacts.require('Burner');
const RandomContract = artifacts.require('RandomContract');
const TestERC20Token = artifacts.require('TestERC20Token');

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

  describe('Sending', () => {
    describe('Before transfers enabled', () => {
      it('should allow transfer from owner', async () => {
        await token.transfer(user1, OneToken);

        (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
      });

      it('should allow transfer to owner', async () => {
        await token.transfer(user1, OneToken);
        await token.transfer(admin, OneToken, { from: user1 });
      });

      it('should not allow tranfers between users', async () => {
        await token.transfer(user1, OneToken);
        await token.transfer(user2, OneToken, { from: user1 }).should.be.rejected;
      });

      it('should allow transfer batch from owner', async () => {
        await token.transferBatch([user1], [OneToken]);

        (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
      });

      it('should allow transfer batch to owner', async () => {
        await token.transfer(user1, OneToken);
        await token.transferBatch([admin], [OneToken], { from: user1 });
      });

      it('should not allow batch tranfers between users', async () => {
        await token.transfer(user1, OneToken);
        await token.transferBatch([user2], [OneToken], { from: user1 }).should.be.rejected;
      });
    });

    describe('After transfers enabled', () => {
      let random;
      let now;
      beforeEach(async () => {
        random = await RandomContract.new();
        now = await getTime();        
        await nextBlock();
        await token.unlockTransfers(now + 1);
        await increaseTime(1);
      });

      it('should success ERC20 transfer', async () => {
        await token.transfer(user1, OneToken);

        (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
      });

      it('should successfully transfer into non receiver smart contract', async () => {
        await token.transfer(random.address, OneToken);

        (await token.balanceOf(random.address)).should.be.bignumber.equal(OneToken);
      });

      it('should allow tranfers between users', async () => {
        await token.transfer(user1, OneToken);

        await token.transfer(user2, OneToken, { from: user1 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken);
      });

      it('should allow tranferFrom between users', async () => {
        await token.transfer(user1, OneToken);
        await token.approve(user2, OneToken, { from: user1 });

        await token.transferFrom(user1, user2, OneToken, { from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken);
      });

      it('should fail to transfer to token address', async () => {
        await token.transfer(token.address, OneToken).should.be.rejected;
      });

      it('should fail to transferFrom to token address', async () => {
        await token.approve(user1, OneToken);
        await token.transfer(user1, OneToken);
        await token.transferFrom(user1, token.address, OneToken, { from: user1}).should.be.rejected;
      });

      it('should fail to burn before burning is enabled', async () => {
        await token.transfer(user1, OneToken);

        await token.burn(OneToken.mul(new BN(0.5)), '', {
          from: user1
        }).should.be.rejected;
      });
    });
  });

  describe('Burning', () => {
    it('should not allow burning', async () => {
      await token.burn(OneToken.mul(new BN(0.5)), {
        from: user1
      }).should.be.rejected;
    });

    it('should successfully burn', async () => {
      const totalSupply = await token.totalSupply();
      await token.enableBurning();

      await token.transfer(burner.address, OneToken);

      (await token.balanceOf(burner.address)).should.be.bignumber.equal('0');
      (await token.totalSupply()).should.be.bignumber.equal(totalSupply.sub(OneToken));
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

    it('cannot recover Parsiq tokens', async () => {
      await token.transferLockedRelative(user1, OneToken, 10);

      await token.recoverTokens(token.address, user1, OneToken).should.be.rejected;
    });
  });

  describe('Signature', () => {
    let contract;
    let burner;
    beforeEach(async () => {
      burner = await Burner.new();
      token = await ParsiqToken.new(burner.address);
      await burner.initialize(token.address);
      contract = await RandomContract.new();
    });

    it('transferPreSigned() should transfer tokens to contract', async () => {
      const nonce = 0;
      const signature = await hashAndSign(admin, contract.address, OneToken, OneToken.div(new BN(100)), nonce, token.address);

      await token.transferPreSigned(signature, contract.address, OneToken, OneToken.div(new BN(100)), nonce, {
        from: user2
      });

      (await token.balanceOf(contract.address)).should.be.bignumber.equal(OneToken);
      (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.div(new BN(100)));
    });

    it('transferPreSigned() should not allow transfer tokens between users', async () => {
      await token.transfer(user1, OneToken.mul(new BN(2)));

      const nonce = 0;
      const signature = await hashAndSign(user1, user2, OneToken, OneToken.div(new BN(100)), nonce, token.address);

      await token.transferPreSigned(signature, user2, OneToken, OneToken.div(new BN(100)), nonce, {
        from: user2
      }).should.be.rejected;
    });

    it('transferPreSigned() should allow transfer tokens between users', async () => {
      const now = await getTime();
      await token.unlockTransfers(now + 1);
      const total = OneToken.add(OneToken.div(new BN(100)));
      await token.transfer(user1, total);
      await increaseTime(10);
      const nonce = 0;
      const signature = await hashAndSign(user1, user2, OneToken, OneToken.div(new BN(100)), nonce, token.address);

      await token.transferPreSigned(signature, user2, OneToken, OneToken.div(new BN(100)), nonce, {
        from: user2
      });

      (await token.balanceOf(user1)).should.be.bignumber.equal('0');
      (await token.balanceOf(user2)).should.be.bignumber.equal(total);
    });
  });
});
