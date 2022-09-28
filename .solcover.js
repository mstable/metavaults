module.exports = {
    skipFiles: [
        "integrations",
        "upgradability",
        "./vault/liquidity/convex/Convex3CrvBasicVault.sol",
        "./shared/SafeCastExtended.sol",
        "z_mocks",
    ],
    mocha: {
        grep: "@skip-on-coverage", // Find everything with this tag
        invert: true, // Run the grep's inverse set.
    },
}
