import { setStorageAt } from "@nomicfoundation/hardhat-network-helpers"
import { hexlify, hexZeroPad, keccak256 } from "ethers/lib/utils"

import type { BigNumberish } from "ethers"
import type { BytesLike } from "ethers/lib/utils"

/**
 * @description Sets the value of a mapping storage variable in a contract for local Hardhat tests.
 * @param contract Address of the contract with the storage. This may be a proxy address.
 * @param key mapping key. number, address or hashed string like `keccak256(toUtf8Bytes("Liquidator"))`
 * @param storageSlot Slot number of the mapping storage variable.
 * Add `storageLayout` to the Hardhat Solidity config to get slot numbers of a contract. eg for the Nexus contract
    solidity: {
        version: "0.8.15",
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
 * Then search for `storageLayout": {` in the build files to see the list of storage slots.
 * @param value number or bytes
 */
export const setMappedValue = async (
    contract: string,
    key: BytesLike,
    storageSlot: number,
    value: BigNumberish | BytesLike,
): Promise<void> => {
    const keyHex = hexZeroPad(hexlify(key), 32)
    const valueHex = hexZeroPad(hexlify(value), 32)

    if (!Number.isInteger(storageSlot) || storageSlot < 0) {
        throw Error(`storageSlot ${storageSlot} must be an integer`)
    }
    const paddedStorageSlot = storageSlot.toString().padStart(64, "0")

    const hashedStorageSlot = keccak256(keyHex.concat(paddedStorageSlot))

    await setStorageAt(contract, hashedStorageSlot, valueHex)
}
