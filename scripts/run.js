const Ganache = require("ganache-core");
const server = Ganache.server({
    mnemonic: 'swarm because dignity grid decide rigid once size leisure unhappy powder hazard minimum push river',
    // gasLimit: 0x7A1200
});
server.listen(8545, function (err, blockchain) {
    if (err) {
        console.error(err);
        return;
    }
});