# Fee Vaults

Fee vaults collect various fees for multiple parties. For example, transaction, performance and management fees.

# Contracts

-   [PerfFeeAbstractVault](./PerfFeeAbstractVault.sol) Abstract ERC-4626 vault that calculates a performance fee between investment of deposited assets into underlying platforms/vaults.
-   [PerfFeeBasicVault](./PerfFeeBasicVault.sol) A simple implementation of the abstract performance fee vault for testing purposes.
-   [ManFeeAbstractVault](./ManFeeAbstractVault.sol) Abstract ERC-4626 vault that calculates a management fee when vault operations are performed.
-   [ManFeeBasicVault](./ManFeeBasicVault.sol) A simple implementation of the abstract management fee vault for testing purposes.
-   [TxFeeAbstractVault](./TxFeeAbstractVault.sol) Abstract ERC-4626 vault that charges transaction fees to a single recipient.
-   [TxFeeBasicVault](./TxFeeAbstractVault.sol) Basic implementation `TxFeeAbstractVault` for testing purposes.

# Diagrams

## Performance Fee

`PerfFeeBasicVault` hierarchy

![Performance Fee Basic Vault Hierarchy](../../../docs/PerfFeeAbstractVaultHierarchy.svg)

`PerfFeeAbstractVault` contract

![Performance Fee Abstract Vault](../../../docs/PerfFeeAbstractVault.svg)

`PerfFeeAbstractVault` storage

![Performance Fee Abstract Vault Storage](../../../docs/PerfFeeAbstractVaultStorage.svg)

## Management Fee

`ManFeeAbstractVault` hierarchy

![Management Fee Basic Vault Hierarchy](../../../docs/ManFeeAbstractVaultHierarchy.svg)

`ManFeeAbstractVault` contract

![Management Fee Abstract Vault](../../../docs/ManFeeAbstractVault.svg)

`ManFeeAbstractVault` storage

![Management Fee Abstract Vault Storage](../../../docs/ManFeeAbstractVaultStorage.svg)

## Transaction Fee

`TxFeeAbstractVault` hierarchy

![Transaction Fee Abstract Vault Hierarchy](../../../docs/TxFeeAbstractVaultHierarchy.svg)

`TxFeeAbstractVault` contract

![Transaction Fee Abstract Vault](../../../docs/TxFeeAbstractVault.svg)

`TxFeeAbstractVault` storage

![Transaction Fee Abstract Vault Storage](../../../docs/TxFeeAbstractVaultStorage.svg)

# Tests

Unit tests

`yarn test ./test/vault/fees/*.spec.ts`
