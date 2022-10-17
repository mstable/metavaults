export interface BlockInfo {
    blockNumber: number
    blockTime: Date
}

export interface BlockRange {
    fromBlock: BlockInfo
    toBlock: BlockInfo
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const getBlock = async (ethers, _blockNumber?: number | string): Promise<BlockInfo> => {
    const blockNumber = _blockNumber || (await ethers.provider.getBlockNumber())
    const toBlock = await ethers.provider.getBlock(blockNumber)
    const blockTime = new Date(toBlock.timestamp * 1000)

    return {
        blockNumber,
        blockTime,
    }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const getBlockRange = async (ethers, fromBlockNumber: number, _toBlockNumber?: number): Promise<BlockRange> => {
    const toBlockNumber = _toBlockNumber || (await ethers.provider.getBlockNumber())
    // const toBlock = await ethers.provider.getBlock(toBlockNumber)
    // const endTime = new Date(toBlock.timestamp * 1000)
    const toBlock = await getBlock(ethers, _toBlockNumber)
    const fromBlock = await getBlock(ethers, fromBlockNumber)
    console.log(`Between blocks ${fromBlock.blockNumber} and ${toBlockNumber}. ${fromBlock.blockTime} and ${toBlock.blockTime}`)

    return {
        fromBlock,
        toBlock,
    }
}
