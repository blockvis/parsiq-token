const ParsiqToken = artifacts.require("ParsiqToken");

module.exports = function (deployer, network, accounts) {
    deployer.deploy(ParsiqToken);
};
