module.exports = {
    skipFiles: [
        "integrations",
        "oracles",
        "peripheral",
        "shared",
        "upgradability",
        "z_mocks",
    ],
    mocha: {
        grep: "@skip-on-coverage", // Find everything with this tag
        invert: true, // Run the grep's inverse set.
    },
}
