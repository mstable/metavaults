module.exports = {
    skipFiles: [
        "integrations",
        "peripheral",
        "upgradability",
        "Convex3CrvBasicVault.sol",
        "SafeCastExtended.sol",
        "z_mocks",
    ],
    mocha: {
        grep: "@skip-on-coverage", // Find everything with this tag
        invert: true, // Run the grep's inverse set.
    },
}
