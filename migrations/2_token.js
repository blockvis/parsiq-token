const ParsiqToken = artifacts.require("ParsiqToken");
const Burner = artifacts.require("Burner");

module.exports = function (deployer, network, accounts) {
    deployer.deploy(ParsiqToken);
};
