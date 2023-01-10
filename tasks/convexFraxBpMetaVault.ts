import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, IERC20__factory, IERC4626Vault__factory, PeriodicAllocationPerfFeeMetaVault__factory } from "types/generated"

import { config } from "./deployment/convexFraxBpVaults-config"
import { usdFormatter } from "./utils"
import { getBlock } from "./utils/blocks"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { BN } from "@utils/math"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, PeriodicAllocationPerfFeeMetaVault } from "types/generated"

import type { ConvexFraxBpVaultsDeployed } from "./deployment/convexFraxBpVaults"

// deployPeriodicAllocationPerfFeeMetaVault
interface AssetSourcingParams {
    singleVaultSharesThreshold: number
    singleSourceVaultIndex: number
}

interface PeriodicAllocationPerfFeeMetaVaultParams {
    nexus: string
    asset: string
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
    performanceFee: number
    feeReceiver: string
    underlyingVaults: Array<string>
    sourceParams: AssetSourcingParams
    assetPerShareUpdateThreshold: BN
}

export async function deployPeriodicAllocationPerfFeeMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    convexFraxBpVaults: ConvexFraxBpVaultsDeployed,
) {
    const { periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVaultConf } = config
    const underlyingVaults = [convexFraxBpVaults.busd.proxy.address, convexFraxBpVaults.susd.proxy.address, convexFraxBpVaults.alusd.proxy.address]
    const periodicAllocationPerfFeeMetaVault = await deployPeriodicAllocationPerfFeeMetaVault(hre, signer, {
        nexus,
        asset: PeriodicAllocationPerfFeeMetaVaultConf.asset,
        name: PeriodicAllocationPerfFeeMetaVaultConf.name,
        symbol: PeriodicAllocationPerfFeeMetaVaultConf.symbol,
        vaultManager,
        proxyAdmin,
        performanceFee: PeriodicAllocationPerfFeeMetaVaultConf.performanceFee,
        feeReceiver: PeriodicAllocationPerfFeeMetaVaultConf.feeReceiver,
        sourceParams: PeriodicAllocationPerfFeeMetaVaultConf.sourceParams,
        assetPerShareUpdateThreshold: PeriodicAllocationPerfFeeMetaVaultConf.assetPerShareUpdateThreshold,
        underlyingVaults,
    })
    return periodicAllocationPerfFeeMetaVault
}

export const deployPeriodicAllocationPerfFeeMetaVault = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    params: PeriodicAllocationPerfFeeMetaVaultParams,
) => {
    const {
        nexus,
        asset,
        name,
        symbol,
        vaultManager,
        proxyAdmin,
        performanceFee,
        feeReceiver,
        underlyingVaults,
        sourceParams,
        assetPerShareUpdateThreshold,
    } = params
    const constructorArguments = [nexus, asset]
    const vaultImpl = await deployContract<PeriodicAllocationPerfFeeMetaVault>(
        new PeriodicAllocationPerfFeeMetaVault__factory(signer),
        "PeriodicAllocationPerfFeeMetaVault",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/meta/PeriodicAllocationPerfFeeMetaVault.sol:PeriodicAllocationPerfFeeMetaVault",
        constructorArguments: constructorArguments,
    })

    // Proxy
    const data = vaultImpl.interface.encodeFunctionData("initialize", [
        name,
        symbol,
        vaultManager,
        performanceFee,
        feeReceiver,
        underlyingVaults,
        sourceParams,
        assetPerShareUpdateThreshold,
    ])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    return { proxy, impl: vaultImpl }
}

subtask("convex-FraxBp-mv-deploy", "Deploys Convex FraxBp Meta Vault")
    .addParam("vaults", "Comma separated symbols or addresses of the underlying convex vaults", undefined, types.string)
    .addParam(
        "singleSource",
        "Token symbol or address of the vault that smaller withdraws should be sourced from.",
        undefined,
        types.string,
    )
    .addOptionalParam("name", "Vault name", "FraxBp Convex Meta Vault", types.string)
    .addOptionalParam("symbol", "Vault symbol", "mvFraxBp-CVX", types.string)
    .addOptionalParam("asset", "Token address or symbol of the vault's asset", "crvFrax", types.string)
    .addOptionalParam("admin", "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam("feeReceiver", "Address or name of account that will receive vault fees.", "mStableDAO", types.string)
    .addOptionalParam("fee", "Performance fee scaled to 6 decimal places. default 4% = 40000", 40000, types.int)
    .addOptionalParam(
        "singleThreshold",
        "Max percentage of assets withdraws will source from a single vault in basis points. default 10%",
        1000,
        types.int,
    )
    .addOptionalParam("updateThreshold", "Asset per share update threshold. default 100k", 100000, types.int)
    .addOptionalParam("vaultManager", "Name or address to override the Vault Manager", "VaultManager", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const {
            name,
            symbol,
            asset,
            vaults,
            admin,
            feeReceiver,
            fee,
            singleSource,
            singleThreshold,
            updateThreshold,
            vaultManager,
            speed,
        } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetToken = await resolveAssetToken(signer, chain, asset)
        const proxyAdminAddress = resolveAddress(admin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)

        const underlyings = vaults.split(",")
        const underlyingAddresses = underlyings.map((underlying) => resolveAddress(underlying, chain))
        const singleSourceAddress = resolveAddress(singleSource, chain)
        const singleSourceVaultIndex = underlyingAddresses.indexOf(singleSourceAddress)

        const feeReceiverAddress = resolveAddress(feeReceiver, chain)

        const { proxy, impl } = await deployPeriodicAllocationPerfFeeMetaVault(hre, signer, {
            nexus: nexusAddress,
            asset: assetToken.address,
            name,
            symbol,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            feeReceiver: feeReceiverAddress,
            performanceFee: fee,
            underlyingVaults: underlyingAddresses,
            sourceParams: {
                singleVaultSharesThreshold: singleThreshold,
                singleSourceVaultIndex,
            },
            assetPerShareUpdateThreshold: simpleToExactAmount(updateThreshold, assetToken.decimals),
        })

        return { proxy, impl }
    })
task("convex-FraxBp-mv-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("convex-FraxBp-mv-snap", "Logs Convex FraxBp Meta Vault details")
    .addParam("vault", "Vault symbol or address", undefined, types.string)
    .addOptionalParam("owner", "Address, contract name or token symbol to get balances for. Defaults to signer", undefined, types.string)
    .addOptionalParam("block", "Block number. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { vault, owner, block, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const blk = await getBlock(hre.ethers, block)

        const vaultToken = await resolveAssetToken(signer, chain, vault)
        // TODO - Create Vault address
        const vaultContract = PeriodicAllocationPerfFeeMetaVault__factory.connect(vaultToken.address, signer)
        const alusdVaultContract = IERC4626Vault__factory.connect(resolveAddress("TODO after deploy"), signer)
        const susdVaultContract = IERC4626Vault__factory.connect(resolveAddress("TODO after deploy"), signer)
        const busdVaultContract = IERC4626Vault__factory.connect(resolveAddress("TODO after deploy"), signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol)
        const assetContract = IERC20__factory.connect(assetToken.address, signer)

        await hre.run("vault-snap", {
            vault,
            owner,
        })

        console.log(`\nPeriodicAllocationPerfFeeMetaVault`)
        const assetsInVault = await assetContract.balanceOf(vaultToken.address, {
            blockTag: blk.blockNumber,
        })
        const totalAssets = await vaultContract.totalAssets({
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in vault         : ${usdFormatter(assetsInVault, assetToken.decimals)} ${formatUnits(
                assetsInVault.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const assetsInUnderlyings = totalAssets.sub(assetsInVault)
        console.log(
            `Assets in underlyings   : ${usdFormatter(assetsInUnderlyings, assetToken.decimals)} ${formatUnits(
                assetsInUnderlyings.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const alusdAssets = await alusdVaultContract.maxWithdraw(vaultContract.address, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in alUSD vault    : ${usdFormatter(alusdAssets, assetToken.decimals)} ${formatUnits(
                alusdAssets.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const busdAssets = await busdVaultContract.maxWithdraw(vaultContract.address, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in BUSD vault    : ${usdFormatter(busdAssets, assetToken.decimals)} ${formatUnits(
                busdAssets.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const susdAssets = await susdVaultContract.maxWithdraw(vaultContract.address, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in sUSD vault    : ${usdFormatter(susdAssets, assetToken.decimals)} ${formatUnits(
                susdAssets.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        console.log(
            `stored assets/share     : ${formatUnits(
                await vaultContract.assetsPerShare({
                    blockTag: blk.blockNumber,
                }),
                26,
            )}`,
        )
        const current = await vaultContract.calculateAssetPerShare({
            blockTag: blk.blockNumber,
        })
        console.log(`current assets/share    : ${formatUnits(current.assetsPerShare_, 26)}`)
        const fee = await vaultContract.performanceFee({
            blockTag: blk.blockNumber,
        })
        console.log(
            `Active underlying vaults: ${await vaultContract.activeUnderlyingVaults({
                blockTag: blk.blockNumber,
            })}`,
        )
        console.log(
            `Total underlying vaults : ${await vaultContract.totalUnderlyingVaults({
                blockTag: blk.blockNumber,
            })}`,
        )
        const sourceParams = await vaultContract.sourceParams()
        console.log(`Single vault threshold  : ${sourceParams.singleVaultSharesThreshold / 100}%`)
        console.log(
            `Vault Manager           : ${await vaultContract.vaultManager({
                blockTag: blk.blockNumber,
            })}`,
        )
        console.log(
            `Paused                  : ${await vaultContract.paused({
                blockTag: blk.blockNumber,
            })}`,
        )

        console.log(`\nPerformance fee         : ${fee / 10000}%`)
        const feeReceiver = await vaultContract.feeReceiver({
            blockTag: blk.blockNumber,
        })
        console.log(`Fee receiver            : ${feeReceiver}`)
        const feeShares = await vaultContract.balanceOf(feeReceiver, {
            blockTag: blk.blockNumber,
        })
        const feeAssets = await vaultContract.maxWithdraw(feeReceiver, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Collected fees          : ${formatUnits(feeShares)} shares, ${formatUnits(feeAssets, assetToken.decimals)} ${
                assetToken.symbol
            }`,
        )
    })
task("convex-FraxBp-mv-snap").setAction(async (_, __, runSuper) => {
    return runSuper()
})
