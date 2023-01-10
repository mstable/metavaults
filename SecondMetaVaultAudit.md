# Second Meta Vaults Security Audit

Scope of the second security audit of [mStable](https://mstable.org/)'s vaults will be focused on the Meta Vault. This is an [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626) vault that periodically invests deposited assets into the underlying EIP-4626 vaults and charges a performance fee.

# Logic

See [3Crv Convex Vaults](./3CrvConvexVaults.md) and [FraxBP Convex Vaults](./FraxBPConvexVaults.md) for explanations of what the different vaults do and how value flows between them.
The [PeriodicAllocationPerfFeeMetaVault](./contracts/vault/meta/PeriodicAllocationPerfFeeMetaVault.sol) contract is the same for both the 3CRv and FraxBP Meta Vaults. It can also be used to integrate to other underlying vaults that are compliant with the [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626) vault standard.

More detailed documentation of the Meta Vault can be found in the [README](./contracts/vault/meta/README.md) including:
-   [Capabilities](./contracts/vault/meta/README.md#periodicallocationperffeemetavault)
-   [Contract Diagrams](./contracts/vault/meta/README.md#diagrams)
-   [Processes](./contracts/vault/meta/README.md#periodicallocationperffeemetavault-processes)

# Code

All code is in the [metavaults](https://github.com/mstable/metavaults) repository with tag [0.0.7-dev](https://github.com/mstable/metavaults/releases/tag/v0.0.7-dev) and commit hash [1657b7ed2f8b964783487a0d68f973c70036bdfb](https://github.com/mstable/metavaults/commit/1657b7ed2f8b964783487a0d68f973c70036bdfb) on the [develop](https://github.com/mstable/metavaults/tree/develop) branch.

# Contract scope

All contract are under the [contracts](./contracts/) folder.

## In scope

Base contract
-  [PeriodicAllocationPerfFeeMetaVault](./contracts/vault/meta/PeriodicAllocationPerfFeeMetaVault.sol)

Inherited contracts
-  [PeriodicAllocationAbstractVault](./contracts/vault/allocate/PeriodicAllocationAbstractVault.sol)
-  [PerfFeeAbstractVault](./contracts/vault/fee/PerfFeeAbstractVault.sol)
-  [FeeAdminAbstractVault](./contracts/vault/fee/FeeAdminAbstractVault.sol)
-  [AssetPerShareAbstractVault](./contracts/vault/allocate/AssetPerShareAbstractVault.sol)
-  [SameAssetUnderlyingsAbstractVault](./contracts/vault/allocate/SameAssetUnderlyingsAbstractVault.sol)
-  [AbstractVault](./contracts/vault/AbstractVault.sol)
-  [InitializableToken](./contracts/tokens/InitializableToken.sol)
-  [VaultManagerRole](./contracts/shared/VaultManagerRole.sol)
-  [InitializableTokenDetails](./contracts/tokens/InitializableTokenDetails.sol)
-  [ImmutableModule](./contracts/shared/ImmutableModule.sol)
-  [ModuleKeys](./contracts/shared/ModuleKeys.sol)

## Out of scope

The inherited Open Zeppelin contracts are out of scope
-  @openzeppelin/contracts/token/ERC20/ERC20.sol
-  @openzeppelin/contracts/utils/Context.sol
-  @openzeppelin/contracts/security/Pausable.sol
-  @openzeppelin/contracts/proxy/utils/Initializable.sol

The following related contracts are out of scope
-  [Nexus](./contracts/shared/Nexus.sol) used to manage the `Governor` and `Keeper` roles used by the Meta Vault.
-  [Proxies](./contracts/upgradability/Proxies.sol) proxy contract.
-  [InstantProxyAdmin](./contracts/upgradability/InstantProxyAdmin.sol) proxy admin with no time delay.
-  [DelayedProxyAdmin](./contracts/upgradability/DelayedProxyAdmin.sol) proxy admin with one week time delay.

# Tests

## Unit tests

`yarn test` will run all the units tests but to test that cover the above in scope contracts are

```
yarn test:file ./test/vault/allocate/PeriodicAllocationBasicVault.spec.ts
yarn test:file ./test/vault/allocate/SameAssetUnderlyingsBasicVault.spec.ts
yarn test:file ./test/vault/fees/PerfFeeBasicVault.spec.ts
```

## Fork Tests

Rather than mocking external protocols like Curve and Convex, fork tests are used to test the integration with these protocols. This was we are testing exactly as the protocols work and not our assumptions on how they are implemented. The `PeriodicAllocationPerfFeeMetaVault` contract is tested with the following fork tests.

```
export NODE_URL=<url to mainnet node>
# Convex 3Crv vaults
yarn test:file:fork ./test-fork/vault/savePlus.spec.ts
# Convex FraxBP vaults
yarn test:file:fork ./test-fork/vault/saveFraxPlus.spec.ts
```

## Coverage

Coveralls is used to report on the code coverage of the unit and fork tests.

https://coveralls.io/github/mstable/metavaults

# Third Party Dependencies

## Contract Libraries

-   [OpenZeppelin](https://www.openzeppelin.com/contracts) is used for ERC20 tokens, access control, initialization, reentry protection, proxies, casting and math operations.

## Protocols

-   [Curve Finance](https://curve.fi/) used to generate yield on stablecoin deposits.
-   [Convex Finance](https://www.convexfinance.com/) used to enhance the yield from Curve pools.
-   [Cowswap](https://cowswap.exchange/) used for swapping Convex reward tokens (CRV and CVX) to DAI, USDC or USDT.

## Standards

-   [EIP-20](https://eips.ethereum.org/EIPS/eip-20)
-   [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626)
