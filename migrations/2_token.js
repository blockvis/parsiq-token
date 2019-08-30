const ParsiqToken = artifacts.require("ParsiqToken");
const Burner = artifacts.require("Burner");

module.exports = function (deployer, network, accounts) {
    deployer.deploy(Burner)
    .then(() => {
        return deployer.deploy(ParsiqToken, Burner.address);
    })
    .then(() => Burner.at(Burner.address))
    .then(burner => burner.initialize(ParsiqToken.address));
};
