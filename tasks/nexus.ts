import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { Nexus__factory } from "types/generated"

import { MTA } from "./utils"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { logger } from "./utils/logger"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { Nexus } from "types/generated"

const log = logger("task:nexus")

export async function deployNexus(hre: HardhatRuntimeEnvironment, signer: Signer, governorAddress: string) {
    const constructorArguments = [governorAddress]
    const nexus = await deployContract<Nexus>(new Nexus__factory(signer), "Nexus", constructorArguments)

    // initialize is only callable by the governor so this only works on testnets where the governor is an eternally owned account
    // Mainnet will need a ProtocolDAO transaction
    const metaTokenKey = keccak256(toUtf8Bytes("MetaToken"))
    const tx = await nexus.connect(signer).initialize([metaTokenKey], [MTA.address], [true], governorAddress)

    await logTxDetails(tx, "Nexus.initialize")

    await verifyEtherscan(hre, {
        address: nexus.address,
        contract: "contracts/nexus/Nexus.sol:Nexus",
        constructorArguments,
    })
    return nexus
}

subtask("nexus-deploy", "Deploys a new Nexus contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .addOptionalParam("governor", "Governor address override", "Governor", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const governorAddress = resolveAddress(taskArgs.governor, chain)
        return deployNexus(hre, signer, governorAddress)
    })
task("nexus-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

task("nexus-module", "Resolve address of a Nexus module")
    .addParam("module", "Name of module. eg LiquidatorV2", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const nexusAddress = resolveAddress("Nexus", chain)

        const nexus = Nexus__factory.connect(nexusAddress, signer)
        const key = keccak256(toUtf8Bytes(taskArgs.module))
        log(`Key for module ${taskArgs.module}: ${key}`)
        const moduleAddress = await nexus.getModule(key)
        log(`Address of module ${taskArgs.module}: ${moduleAddress}`)
    })

subtask("nexus-prop-mod", "Propose a new Nexus module")
    .addParam("module", "Name of module. eg LiquidatorV2", undefined, types.string)
    .addParam("address", "Name or address of the account or account the module should resolve to. eg LiquidatorV2", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed, false)

        const nexusAddress = resolveAddress("Nexus", chain)

        const nexus = Nexus__factory.connect(nexusAddress, signer)
        const key = keccak256(toUtf8Bytes(taskArgs.module))
        log(`Key for module ${taskArgs.module}: ${key}`)
        const moduleAddress = resolveAddress(taskArgs.address, chain)
        const tx = await nexus.proposeModule(key, moduleAddress)
        logTxDetails(tx, `propose module ${taskArgs.module} with address ${moduleAddress}`)
    })
task("nexus-prop-mod").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("nexus-acc-mod", "Accept a new Nexus module after 1 week")
    .addParam("module", "Name of module. eg LiquidatorV2", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed, false)

        const nexusAddress = resolveAddress("Nexus", chain)

        const nexus = Nexus__factory.connect(nexusAddress, signer)
        const key = keccak256(toUtf8Bytes(taskArgs.module))
        log(`Key for module ${taskArgs.module}: ${key}`)
        const tx = await nexus.acceptProposedModule(key)
        logTxDetails(tx, `accept module ${taskArgs.module}`)
    })
task("nexus-acc-mod").setAction(async (_, __, runSuper) => {
    return runSuper()
})
