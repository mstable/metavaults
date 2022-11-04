
# contracts/peripheral/Curve
sol2uml ../contracts -hi -b Curve3PoolCalculatorLibrary -i abis,artifacts,types,_flat,build
sol2uml ../contracts -hi -b Curve3CrvMetapoolCalculatorLibrary -i abis,artifacts,types,_flat,build

sol2uml ../contracts -hi -b CurveFraxBpCalculatorLibrary -i abis,artifacts,types,_flat,build
sol2uml ../contracts -hi -b CurveFraxBpMetapoolCalculatorLibrary -i abis,artifacts,types,_flat,build

# contracts/governance
sol2uml ../contracts -b DelayedClaimableGovernor

# contracts/nexus
sol2uml ../contracts -hv -hf -he -hs -hl -hi -b Nexus -o NexusHierarchy.svg
sol2uml ../contracts -d 1 -b Nexus
sol2uml storage ../contracts -c Nexus -o NexusStorage.svg

# contracts/shared
sol2uml .. -b VaultManagerRole -i abis,artifacts,types,_flat,build
sol2uml .. -b TokenHolder -i abis,artifacts,types,_flat,build

# contracts/tokens
sol2uml .. -b InitializableToken -i artifacts,types,_flat,build
sol2uml .. -b TimeWeightedRewardsAbstractToken -i artifacts,types,_flat,build

# contracts/upgradability
sol2uml .. -hv -hf -he -hs -b DelayedProxyAdmin -i abis,artifacts,types,_flat,build -o DelayedProxyAdminHierarchy.svg
sol2uml .. -d 2 -b DelayedProxyAdmin -i artifacts,types,_flat,build
sol2uml storage .. -c DelayedProxyAdmin -i artifacts,types,_flat,build -o DelayedProxyAdminStorage.svg

sol2uml .. -hv -hf -he -hs -b InstantProxyAdmin  -i artifacts,types,_flat,build -o InstantProxyAdminHierarchy.svg

sol2uml .. -hv -hf -he -hs -b VaultProxy  -i artifacts,types,_flat,build -o VaultProxyHierarchy.svg
sol2uml .. -hl -hi -hs -hp -b VaultProxy -i artifacts,types,_flat,build

# contracts/vault
sol2uml ../contracts -b IERC4626Vault
sol2uml ../contracts -b IMultiAssetVault

sol2uml ../ -hv -hf -he -hs -b AbstractVault  -i abis,artifacts,types,_flat,build -o AbstractVaultHierarchy.svg
sol2uml ../contracts -d 0 -b AbstractVault

sol2uml ../contracts -d 0 -b AbstractMultiAssetVault
sol2uml .. -hv -hf -he -hs -hi -hl -b MultiAssetVault -i artifacts,types,_flat,build -o MultiAssetVaultHierarchyHierarchy.svg

sol2uml ../ -hv -hf -he -hs -b LightAbstractVault  -i abis,artifacts,types,_flat,build -o LightAbstractVaultHierarchy.svg
sol2uml ../contracts -d 0 -b LightAbstractVault

# contracts/vault/allocate
sol2uml ../ -hv -hf -he -hs -b PeriodicAllocationAbstractVault  -i abis,artifacts,types,_flat,build -o PeriodicAllocationAbstractVaultHierarchy.svg
sol2uml .. -hl -hi -d 1 -b PeriodicAllocationAbstractVault -i abis,artifacts,types,_flat,build
sol2uml storage .. -c PeriodicAllocationAbstractVault -i abis,artifacts,types,_flat,build -o PeriodicAllocationAbstractVaultStorage.svg

sol2uml ../ -hv -hf -he -hs -hl -b WeightedAbstractVault  -i abis,artifacts,types,_flat,build -o WeightedAbstractVaultHierarchy.svg
sol2uml .. -hl -hi -d 1 -b WeightedAbstractVault -i abis,artifacts,types,_flat,build
sol2uml storage .. -c WeightedAbstractVault -i abis,artifacts,types,_flat,build -o WeightedAbstractVaultStorage.svg

# contracts/vault/fee
sol2uml ../ -hv -hf -he -hs -hi -hl -b PerfFeeAbstractVault  -i abis,artifacts,types,_flat,build -o PerfFeeAbstractVaultHierarchy.svg
sol2uml .. -hl -hi -d 1 -b PerfFeeAbstractVault -i abis,artifacts,types,_flat,build
sol2uml storage .. -c PerfFeeAbstractVault -i abis,artifacts,types,_flat,build -o PerfFeeAbstractVaultStorage.svg

# contracts/vault/liquidator
sol2uml ../ -hv -hf -he -hs -hl -hi -b Liquidator  -i artifacts,types,_flat,build -o LiquidatorHierarchy.svg
sol2uml ../contracts -hl -hi -d 1 -b Liquidator -i artifacts,types,_flat,build
sol2uml storage .. -c Liquidator -i artifacts,types,_flat,build -o LiquidatorStorage.svg

sol2uml ../ -hv -hf -he -hs -hl -hi -b LiquidatorStreamFeeBasicVault  -i artifacts,types,_flat,build -o LiquidatorStreamFeeBasicVaultHierarchy.svg
sol2uml ../contracts -d 1 -b LiquidatorStreamFeeAbstractVault -i artifacts,types,_flat,build
sol2uml storage .. -c LiquidatorStreamFeeAbstractVault -i artifacts,types,_flat,build -o LiquidatorStreamFeeAbstractVaultStorage.svg

sol2uml ../contracts -d 1 -b LiquidatorAbstractVault -i artifacts,types,_flat,build

# contracts/vault/liquidity
sol2uml ../contracts -d 1 -b AbstractSlippage

# contracts/vault/liquidity/convex
## 3Pool
sol2uml .. -hv -hf -he -hs -b Convex3CrvLiquidatorVault -o Convex3CrvLiquidatorVaultHierarchy.svg -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle
sol2uml ../contracts -d 1 -hi -ha -hs -b Convex3CrvLiquidatorVault
sol2uml storage .. -c Convex3CrvLiquidatorVault -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle -o Convex3CrvLiquidatorVaultStorage.svg
sol2uml ../contracts -d 1 -hi -hs -b Convex3CrvAbstractVault

## FRAX
sol2uml .. -hv -hf -he -hs -hi -b ConvexFraxBpLiquidatorVault -o ConvexFraxBpLiquidatorVaultHierarchy.svg -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle
sol2uml ../contracts -d 1 -hi -ha -hs -b ConvexFraxBpLiquidatorVault
sol2uml storage .. -c ConvexFraxBpLiquidatorVault -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle -o ConvexFraxBpLiquidatorVaultStorage.svg
sol2uml ../contracts -d 1 -hi -hs -b ConvexFraxBpAbstractVault

# contracts/vault/liquidity/curve
sol2uml .. -hv -hf -he -hs -b Curve3CrvBasicMetaVault -o Curve3CrvBasicMetaVaultHierarchy.svg -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle
sol2uml ../contracts -d 1 -hi -hs -b Curve3CrvAbstractMetaVault
sol2uml storage .. -c Curve3CrvBasicMetaVault -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle -o Curve3CrvBasicMetaVaultStorage.svg

# contracts/vault/meta
sol2uml .. -hv -hf -he -hs -hl -b PeriodicAllocationPerfFeeMetaVault -o PeriodicAllocationPerfFeeMetaVaultHierarchy.svg -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle
sol2uml ../contracts -d 1 -hi -hs -b PeriodicAllocationPerfFeeMetaVault 
sol2uml storage .. -c PeriodicAllocationPerfFeeMetaVault -o PeriodicAllocationPerfFeeMetaVaultStorage.svg -i abis,artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle

# contracts/vault/swap
sol2uml .. -hv -hf -he -hs -hi -hl -b CowSwapDex -o CowSwapDexHierarchy.svg -i artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle
sol2uml ../contracts -hs -d 1 -b CowSwapDex
sol2uml storage .. -c CowSwapDex -i artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle -o CowSwapDexStorage.svg

sol2uml ../contracts -b OneInchDexSwap
sol2uml storage .. -c OneInchDexSwap -i artifacts,types,_flat,solparse,@solidity-parser,ethlint,build,truffle -o OneInchDexSwapStorage.svg

sol2uml ../contracts -b BasicDexSwap
