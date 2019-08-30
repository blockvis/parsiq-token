const BN = web3.utils.BN;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

const OneToken = new BN(web3.utils.toWei('1', 'ether'));

const { increaseTime, nextBlock, getTime, signRelease } = require('./utils.js');

const ParsiqToken = artifacts.require("ParsiqToken");
const Burner = artifacts.require("Burner");

contract('Parsiq Timelock', async accounts => {
  const admin = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const duration = 60; // seconds
  let token;
  let burner;

  describe('Whitelist', () => {
    beforeEach(async () => {
      burner = await Burner.new();
      token = await ParsiqToken.new(burner.address);
      await burner.initialize(token.address);
    });
    it('owner can add to whitelist', async () => {
      await token.addWhitelisted(user1);

      (await token.whitelisted(user1)).should.be.true;
    });

    it('stranger cannot add to whitelist', async () => {
      await token.addWhitelisted(user1, { from: user1 }).should.be.rejected;
    });

    it('owner can remove from whitelist', async () => {
      await token.addWhitelisted(user1);

      await token.removeWhitelisted(user1);

      (await token.whitelisted(user1)).should.be.false; 
    });

    it('stranger cannot remove from whitelist', async () => {
      await token.addWhitelisted(user1);

      await token.removeWhitelisted(user1, { from: user1 }).should.be.rejected;
    });

    it('can renounce whitelisted', async () => {
      await token.addWhitelisted(user1);

      await token.renounceWhitelisted({ from: user1 });

      (await token.whitelisted(user1)).should.be.false;          
    });

    it('owner should be whitelisted', async () => {
      (await token.whitelisted(admin)).should.be.true;
    });

    it('previous owner should be removed from whitelisted', async () => {
      await token.transferOwnership(user1);
      
      (await token.whitelisted(admin)).should.be.false;
    });

    it('new owner should be added to whitelisted', async () => {
      await token.transferOwnership(user1);
      
      (await token.whitelisted(user1)).should.be.true;
    });

    it('previous owner should not be whitelisted after renonce ownership', async () => {
      await token.renounceOwnership();
      
      (await token.whitelisted(admin)).should.be.false;
    });

    it('only whitelisted can lock tokens', async () => {
      await token.addWhitelisted(user1);
      await token.transfer(user1, OneToken);
      const now = await getTime();
      await token.transferLocked(user2, OneToken, now + 5, { from: user1 });

      (await token.lockedBalanceOf(user2)).should.bignumber.equal(OneToken);
    });

    it('whitelisted can transfer tokens before token unlock', async () => {
      await token.transfer(user1, OneToken);
      await token.addWhitelisted(user1);

      await token.transfer(user2, OneToken, { from: user1 });

      (await token.balanceOf(user2)).should.bignumber.equal(OneToken);
    });

    it('can transfer tokens to whitelisted before token unlock', async () => {
      await token.transfer(user2, OneToken);
      await token.addWhitelisted(user1);

      await token.transfer(user1, OneToken, { from: user2 });

      (await token.balanceOf(user1)).should.bignumber.equal(OneToken);
    });
  });

  describe('Single slot', () => {
    let now;

    describe('Absolute timelock', () => {
      before(async () => {
        now = await getTime();
        burner = await Burner.new();
        token = await ParsiqToken.new(burner.address);
        await burner.initialize(token.address);
      });
      it('sucessfully adds slot', async () => {
        const lockedTill = new BN(now + duration);
        await token.transferLocked(user1, OneToken, lockedTill);
        const { time, amount } = await token.timelocks(user1, 0);
        time.should.be.bignumber.equal(lockedTill);
        amount.should.be.bignumber.equal(OneToken);
      });
  
      it('user1 should not have tokens', async () => {
        (await token.balanceOf(user1)).should.be.bignumber.equal('0');
      });
  
      it('should not release until date', async () => {
        await token.release({ from: user1 });
  
        (await token.balanceOf(user1)).should.be.bignumber.equal('0');
      });
  
      it('should release when date passes', async () => {
        await increaseTime(duration + 1);
  
        await token.release({ from: user1 });
  
        (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
      });
    });

    describe('Relative timelock', () => {
      before(async () => {
        burner = await Burner.new();
        token = await ParsiqToken.new(burner.address);
        await burner.initialize(token.address);
      });

      it('sucessfully adds slot', async () => {
        await token.transferLockedRelative(user1, OneToken, duration);
        const { time, amount } = await token.relativeTimelocks(user1, 0);
        time.should.be.bignumber.equal(new BN(duration));
        amount.should.be.bignumber.equal(OneToken);
      });
  
      it('user1 should not have tokens', async () => {
        (await token.balanceOf(user1)).should.be.bignumber.equal('0');
      });
  
      it('should not release until date', async () => {
        await token.release({ from: user1 });
  
        (await token.balanceOf(user1)).should.be.bignumber.equal('0');
      });
  
      it('should release when date passes', async () => {
        const now = await getTime();
        const unlockTime = now + 5;
        await token.unlockTransfers(unlockTime);
        await increaseTime(unlockTime - now + duration + 1);
  
        await token.release({ from: user1 });
  
        (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
      });
    });
  });

  describe('Multiple slots', () => {
    let now;

    describe('Absolute timelock', () => {
      before(async () => {
        now = await getTime();
        burner = await Burner.new();
        token = await ParsiqToken.new(burner.address);
        await burner.initialize(token.address);
      });

      it('sucessfully adds multiple slots', async () => {
        for (let i = 0; i < 5; i++) {
          await token.transferLocked(user2, OneToken, now + (i + 1) * 5);
        }
        for (let i = 0; i < 5; i++) {
          const  { time, amount } = await token.timelocks(user2, i);
          time.should.be.bignumber.equal(new BN(now + (i + 1) * 5));
          amount.should.be.bignumber.equal(OneToken);
        }
      });

      it('user2 should not have tokens', async () => {
        (await token.balanceOf(user2)).should.be.bignumber.equal('0');
      });

      it('should not release until date', async () => {
        await token.release({ from: user2 });
        (await token.balanceOf(user2)).should.be.bignumber.equal('0');
      });

      it('should partially release tokens', async () => {
        await increaseTime(10);
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('2')));
      });

      it('should release all left tokens when date passes', async () => {
        await increaseTime(30);
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('5')));
      });

      it('should allow lock again', async () => {
        for (let i = 0; i < 4; i++) {
          await token.transferLocked(user2, OneToken, now + 50 + (i + 1) * 10);
        }
      });

      it('should release all locked tokens', async () => {
        await increaseTime(100);
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('9')));
        (await token.balanceOf(token.address)).should.be.bignumber.equal('0');
      });

      it('should not do anything on empty schedule', async () => {
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('9')));
      });
    });

    describe('Relative timelock', () => {
      before(async () => {
        burner = await Burner.new();
        token = await ParsiqToken.new(burner.address);
        await burner.initialize(token.address);
      });

      it('sucessfully adds multiple slots', async () => {
        for (let i = 0; i < 5; i++) {
          await token.transferLockedRelative(user2, OneToken, (i + 1) * 5);
        }
        for (let i = 0; i < 5; i++) {
          const  { time, amount } = await token.relativeTimelocks(user2, i);
          time.should.be.bignumber.equal(new BN((i + 1) * 5));
          amount.should.be.bignumber.equal(OneToken);
        }
      });

      it('user2 should not have tokens', async () => {
        (await token.balanceOf(user2)).should.be.bignumber.equal('0');
      });

      it('should not release until date', async () => {
        await token.release({ from: user2 });
        (await token.balanceOf(user2)).should.be.bignumber.equal('0');
      });

      it('should partially release tokens', async () => {
        await nextBlock();
        await token.unlockTransfers(await getTime());
        await increaseTime(10);
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('2')));
      });

      it('should release all left tokens when date passes', async () => {
        await increaseTime(30);
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('5')));
      });

      it('should not allow relative lock again', async () => {
        await token.transferLockedRelative(user2, OneToken, 60).should.be.rejected;
      });

      it('should not do anything on empty schedule', async () => {
        await token.release({ from: user2 });

        (await token.balanceOf(user2)).should.be.bignumber.equal(OneToken.mul(new BN('5')));
      });
    });

  });

  describe('Absolute and relative timelocks', () => {
    let now;
    beforeEach(async () => {
      now = await getTime();
      burner = await Burner.new();
      token = await ParsiqToken.new(burner.address);
      await burner.initialize(token.address);
    });

    it('should allow locks', async () => {
      const lockedTill = new BN(now + duration);
      
      await token.transferLocked(user1, OneToken, lockedTill);
      await token.transferLockedRelative(user1, OneToken, duration);

      (await token.lockedBalanceOf(user1)).should.bignumber.equal(OneToken.add(OneToken));
      (await token.totalBalanceOf(user1)).should.bignumber.equal(OneToken.add(OneToken));
    });

    it('should show unlockable balance when transfers are not unlocked', async () => {
      const lockedTill = new BN(now + duration);
      await token.transferLocked(user1, OneToken, lockedTill);
      await token.transferLockedRelative(user1, OneToken, duration);
      await increaseTime(duration + 1);
      await nextBlock();

      (await token.unlockableBalanceOf(user1)).should.bignumber.equal(OneToken);
    });

    it('should show unlockable balance when transfers are unlocked', async () => {
      const now = await getTime();
      const lockedTill = new BN(now + duration);
      await token.transferLocked(user1, OneToken, lockedTill);
      await token.transferLockedRelative(user1, OneToken, duration);
      const unlockTime = now + 1;
      await token.unlockTransfers(unlockTime);
      await increaseTime(unlockTime - now + duration + 1);
      await nextBlock();

      (await token.unlockableBalanceOf(user1)).should.bignumber.equal(OneToken.add(OneToken));
    });

    it('should unlock all', async () => {
      const now = await getTime();
      const lockedTill = new BN(now + duration);
      await token.transferLocked(user1, OneToken, lockedTill);
      await token.transferLockedRelative(user1, OneToken, duration);
      const unlockTime = now + 5;
      await token.unlockTransfers(unlockTime);
      await increaseTime(unlockTime - now + duration + 1);

      await token.release({ from: user1 });

      (await token.balanceOf(user1)).should.bignumber.equal(OneToken.add(OneToken));
    });
  });

  describe('Etherless release', () => {
    let now;
    before(async () => {
      now = await getTime();
      burner = await Burner.new();
      token = await ParsiqToken.new(burner.address);
      await burner.initialize(token.address);
    });

    it('sucessfully adds slot', async () => {
      const lockedTill = new BN(now + duration);

      await token.transferLocked(user1, OneToken, lockedTill);
      
      const { time, amount } = await token.timelocks(user1, 0);
      time.should.be.bignumber.equal(lockedTill);
      amount.should.be.bignumber.equal(OneToken);
    });

    it('user1 should not have tokens', async () => {
      (await token.balanceOf(user1)).should.be.bignumber.equal('0');
    });

    it('should not release until date', async () => {
      const signature = await signRelease(user1, 1, 0, token.address);

      await token.releasePreSigned(signature, 1, 0, { from: user2 }).should.be.rejected;
    });

    it('should release when date passes', async () => {
      await increaseTime(duration + 1);
      const signature = await signRelease(user1, 1, 0, token.address);

      await token.releasePreSigned(signature, 1, 0, { from: user2 });

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken.sub(new BN('1')));
      (await token.balanceOf(user2)).should.be.bignumber.equal('1');
    });
  });

  describe('Release with Ether transfer', () => {
    let now;
    before(async () => {
      burner = await Burner.new();
      token = await ParsiqToken.new(burner.address);
      await burner.initialize(token.address);
      now = await getTime();
      await token.unlockTransfers(now + 1);
    });

    it('sucessfully adds slot', async () => {
      const lockedTill = new BN(now + duration);
      await token.transferLocked(user1, OneToken, lockedTill);

      const { time, amount } = await token.timelocks(user1, 0);
      
      time.should.be.bignumber.equal(lockedTill);
      amount.should.be.bignumber.equal(OneToken);
    });

    it('user1 should not have tokens', async () => {
      (await token.balanceOf(user1)).should.be.bignumber.equal('0');
    });

    it('should not release until date', async () => {
      await web3.eth.sendTransaction({
        from: user1,
        to: token.address,
        value: '1'
      });

      (await token.balanceOf(user1)).should.be.bignumber.equal('0');
    });

    it('should release when date passes', async () => {
      await increaseTime(duration + 1);

      await web3.eth.sendTransaction({
        from: user1,
        to: token.address,
        value: '1'
      });

      (await token.balanceOf(user1)).should.be.bignumber.equal(OneToken);
    });
  });
});