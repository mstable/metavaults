import "@nomiclabs/hardhat-ethers"
import "@nomicfoundation/hardhat-chai-matchers"
import "@tenderly/hardhat-tenderly"
import "@typechain/hardhat"
import "hardhat-gas-reporter"
import "solidity-coverage"
import "hardhat-abi-exporter"
import "@nomiclabs/hardhat-etherscan"
import "ts-node/register"
import "tsconfig-paths/register"
import "solidity-docgen"

import { config as dotenvConfig } from "dotenv"
import { resolve } from "path"

dotenvConfig({ path: resolve(__dirname, "./.env") })

export const hardhatConfig = {
    networks: {
        hardhat: {
            allowUnlimitedContractSize: false,
            initialBaseFeePerGas: 0,
        },
        local: { url: "http://localhost:8545" },
        // export the NODE_URL environment variable to use remote nodes like Alchemy or Infura. ge
        // export NODE_URL=https://eth-mainnet.alchemyapi.io/v2/yourApiKey
        anvil: { url: "http://localhost:8545" },
        ropsten: {
            url: process.env.NODE_URL || "",
        },
        goerli: {
            url: process.env.NODE_URL || "",
        },
        polygon_testnet: {
            url: process.env.NODE_URL || "https://rpc-mumbai.maticvigil.com",
        },
        polygon_mainnet: {
            url: process.env.NODE_URL || "https://rpc-mainnet.matic.quiknode.pro",
        },
        mainnet: {
            url: process.env.NODE_URL || "https://main-light.eth.linkpool.io",
        },
        rinkeby: {
            url: process.env.NODE_URL || `https://eth-rinkeby.alchemyapi.io/v2/alchemyApiKey`,
        },
    },
    solidity: {
        version: "0.8.17",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            outputSelection: {
                "*": {
                    Nexus: ["storageLayout"],
                },
            },
        },
    },
    paths: { artifacts: "./artifacts" },
    abiExporter: {
        path: "./abis",
        clear: true,
        flat: true,
    },
    gasReporter: {
        currency: "USD",
        gasPrice: 30,
    },
    mocha: {
        timeout: 240000, // 4 min timeout
    },
    typechain: {
        outDir: "types/generated",
        target: "ethers-v5",
    },
    tenderly: {
        username: "alsco77",
        project: "mStable",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_KEY,
    },
    docgen: {
        outputDir: "./docs/natspec",
        templates: "./docs/templates",
    },
}

export default hardhatConfig
