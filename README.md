<br/>
<img src="https://mstable.org/assets/img/email/mstable_logo_horizontal_black.png" width="420" >

![CI](https://github.com/mstable/metavaults/workflows/Test-Vaults/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/mstable/metavaults/badge.svg?branch=main&t=51eu5t)](https://coveralls.io/github/mstable/metavaults?branch=main)
[![Discord](https://img.shields.io/discord/525087739801239552?color=7289DA&label=discord%20)](https://discordapp.com/channels/525087739801239552/)
[![slither](https://github.com/mstable/metavaults/actions/workflows/slither.yaml/badge.svg)](https://github.com/mstable/metavaults/actions/workflows/slither.yaml)

<br />

# Meta Vaults

This repo contains mStable's **Meta Vaults** contracts that are based on [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626) vaults.

Meta Vaults combine, compose, and optimise multiple yield sources into standardised vaults and higher-order products while remaining open and interoperable.

There are 3 different types of Vault implementations:

-   **Basic Vault:** This is the simplest building block for composable
    yielding Vaults. It follows the ERC-4626 standard. It can be used to either create a yield strategy or wrap an existing contract to allow for ERC-4626 compatability
-   **Multi Asset Vault:** This is a layer that can aggregate multiple
    yield sources into one. It can use any ERC-4626 compliant contracts, even if they are not using the same asset. This Vault is similar to the ERC-4626 standard but has slight modifications to handle multiple assets.
-   **Meta Vault:** This is the top layer that and is composed of either Basic Vaults, Multi Asset Vaults, other ERC-4626 compliant contracts, or any
    combination of them. This the Meta Vault is ERC-4626 compliant and therefore
    offers the users the easiest path to allocate their assets or for protocols to integrate.

The Contracts follow a modular pattern. The Vaults can be enriched with additional functionality:

-   **Allocation Vaults:** Vaults that can manage a multiple underlying Vaults via setting weights or batching.
-   **Cached Vaults:** Adds the capability to caches some of the underlying assets in the vault. Saves gas on small deposits/withdrawals to/from an underlying platform or vault.
-   **Fee Vaults:** Adds the capability to charge a fee, ether performance or transactional.
-   **Rewards:** Handling rewards donated to the Vault.

Separate Modules:

-   **Liquidator:** Can be used by a Vault to liquidate assets and swap into the underlying in order to increase share value of itself. Useful for farmining strategies.
-   **Swap:** Contracts to swap one asset for another. Used by the liquidator.
-   **Managers:** Contracts that add function to manage a vault - Batching transaction and is easier/cheaper to manage vault positions.

Find the [official Announcement here](https://medium.com/mstable/erc-4626-meta-vaults-are-coming-to-mstable-9e7c5e182b04).

# 3Crv Convex Vaults

The first set of mStable meta vaults are for staking 3Pool-based (3Crv) Curve Metapool liquidity provider (LP) tokens in Convex. See [3Crv Convex Vaults](./3CrvConvexVaults.md) for more details.

# FRAX-based Convex Vaults

The second set of mStable meta vaults are for staking FRAX based [Curve](https://curve.fi/) Metapool liquidity provider (LP) tokens in [Convex](https://www.convexfinance.com/). That is, Metapools that include the FRAX+USDC (crvFRAX) LP token which is also referred to as the Frax base pool (FraxBP). See [FRAX-based Convex Vaults](./FraxBPConvexVaults.md) for more details.

# Developer Notes

## Prerequisites

-   [Node.js](https://nodejs.org/en/) v16.16.0 (you may wish to use [nvm][1])
-   [yarn](https://yarnpkg.com/)

## Installing dependencies

```
$ yarn
```

### Suite

Key folders:

-   `/contracts/z_mocks`: All mocks used throughout the test suite
-   `/security`: Scripts used to run static analysis tools like Slither and Securify
-   `/build`: Is generate from the build process `yarn compile`.
-   `/dist`: Typescript generated JavaScript and definition files.
-   `/docs`: Images used in READMEs. The contract diagrams are generated by [sol2uml](https://github.com/naddison36/sol2uml). The process diagrams are done in [PlantUML](https://plantuml.com/) with source in the [mStable-process-docs](https://github.com/mstable/mStable-process-docs) repo.
-   `/tasks`: [Hardhat](https://hardhat.org/) tasks that run operational reports and transactions.
-   `/test`: Unit tests in folders corresponding to contracts/xx. All third party protocols are mocked.
-   `/test-fork`: Hardhat fork tests used to test against other protocols.
-   `/test-utils`: Core util files used throughout the test framework
-   `/types`: TS Types used throughout the suite
    -   `/generated`: Generated output from [Typechain](https://github.com/dethcrypto/TypeChain); strongly-typed, Ethers-flavoured contract interfaces

## Testing

Tests are written with [Hardhat](https://hardhat.org/), [Ethers.js](https://docs.ethers.io), [Mocha](https://mochajs.org/) & [Typescript](https://www.typescriptlang.org/), using [Typechain](https://github.com/dethcrypto/TypeChain) to generate typings for all contracts. Tests are executed using `hardhat` in hardhats evm.

```
$ yarn test
```

### Coverage

[Solidity-coverage](https://github.com/sc-forks/solidity-coverage) is used to run coverage analysis on test suite.

This produces reports that are visible in the `/coverage` folder, and navigatable/uploadable. Ultimately they are used as a reference that there is some sort of adequate cover, although they will not be a source of truth for a robust test framework. Reports are publicly available on [coveralls](https://coveralls.io/github/mstable/metavaults).

_NB: solidity-coverage runs with solc `optimizer=false` (see [discussion](https://github.com/sc-forks/solidity-coverage/issues/417))_

## CI

Codebase rules are enforced through a passing [GitHub Actions](https://github.com/features/actions) (workflow configs are in `.github/workflows`). These rules are:

-   Linting of both the contracts (through Solium) and TS files (ESLint)
-   Passing unit test suite
-   Maintaining high unit testing coverage

## Code formatting

-   Solidity imports deconstructed as `import { xxx } from "../xxx.sol"`
-   Solidity commented as per [NatSpec format](https://solidity.readthedocs.io/en/v0.5.0/layout-of-source-files.html#comments)
-   Internal function ordering from high > low order

<br />

[1]: https://github.com/nvm-sh/nvm
[2]: https://github.com/trufflesuite/ganache-cli

## Logger

The logger can be found in [logger.ts](./tasks/utils/logger.ts) and uses the [debug](https://www.npmjs.com/package/debug) package. Set the `DEBUG` environment variable to enable the log messages.

```bash
# See all mStable logs
export DEBUG=mstable*

# Just see the tx logs
export DEBUG=mstable:tx

# To see the address resolving logs
export DEBUG=mstable:addresses
```

## Command Line Interface

[Hardhat Tasks](https://hardhat.org/guides/create-task.html) are used for command line interactions with the mStable contracts. The tasks can be found in the [tasks](./tasks) folder.

### Provider

To access public blockchains the `NODE_URL` environment variable needs to be exported with the provider url. For example

```bash
# Alchemy mainnet
export NODE_URL=https://eth-mainnet.alchemyapi.io/v2/yourApiKey
# Infura mainnet
NODE_URL=https://mainnet.infura.io/v3/yourApiKey
```

The Hardhat `--network` option must be used to specify which chain to use. These networks are configured in [hardhat.config.ts](./hardhat.config.ts). For example `mainnet`, `polygon_mainnet`, `ropsten`, `goerli`, `polygon_testnet` or `local`.

### Signers

If you are just using readonly tasks like `token-balance` you don't need to have a signer with Ether in it so the default Hardhat test account is ok to use. For example

```
yarn task token-balance --network mainnet --token MTA --owner mStableDAO
```

If you want to use [Defender Relay](https://docs.openzeppelin.com/defender/relay) you need to export the API key and secret in environment variable `DEFENDER_API_KEY` and `DEFENDER_API_SECRET`. For example

```
export DEFENDER_API_KEY=<your key>
export DEFENDER_API_SECRET=<your secret>
```

You can also a local private key with.

```
export PRIVATE_KEY=<your private key>
```

A separate Hardhat config file [tasks.config.ts](./tasks.config.ts) is used for task config. This inherits from the main Hardhat config file [hardhat.config.ts](./hardhat.config.ts). This avoids circular dependencies when the repository needs to be compiled before the Typechain artifacts have been generated. This means the `--config tasks.config.ts` Hardhat option needs to be used to run the mStable tasks.

**Never commit mainnet private keys, mnemonics or provider URLs to the repository.**

Examples of using the Hardhat tasks

```zsh
# List all Hardhat tasks
yarn task

# Set the provider url
export NODE_URL=https://mainnet.infura.io/v3/yourApiKey

# To transfer 1000 MTA tokens from the signer account being used to the mStable DAO
yarn task token-transfer --network mainnet --asset MTA --recipient mStableDAO -- amount 1000
```

## Document generation from Natspec

The contract Natspec can be generated into a markdown file in the `docs/natspec` folder using the following command.

```
yarn docgen
```

The markdown for the relevant contracts can then be copied into GitBook.

Unfortunately the generated markdown will not include inherited classes. These need to be manually include for now. 

## Other mStable Meta Vault repositories

-   https://github.com/mstable/mStable-defender
-   https://github.com/mstable/metavault-subgraph
-   https://github.com/mstable/frontend
-   https://github.com/mstable/mStable-data
-   https://github.com/mstable/mStable-process-docs/tree/main/vaults

## Meta Vaults links

-   https://yield.mstable.org Meta Vault user Interface
-   https://docs.mstable.org User documentation
-   https://developers.mstable.org Developer documentation
-   https://immunefi.com/bounty/mstable/ Bug bounty

## mStable version 1 app and documentation.

-   https://mstable.org
-   https://app.mstable.org
-   https://staking.mstable.app
-   https://github.com/mstable/mStable-contracts
