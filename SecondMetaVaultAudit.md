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

All code is in the [metavaults](https://github.com/mstable/metavaults) repository with tag ??? and commit hash ??? on the [fraxBP](https://github.com/mstable/metavaults/tree/fraxBP) branch.

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
