import { logger } from "@tasks/utils/logger"
import { expect } from "chai"
import { ethers } from "hardhat"
import { TestSingleSlotMapper__factory } from "types/generated"

import type { BN } from "@utils/math"
import type { TestSingleSlotMapper } from "types/generated"

const log = logger("test:SingleSlotMapper")

describe("SingleSlotMapper", () => {
    let mapper: TestSingleSlotMapper

    before(async () => {
        const accounts = await ethers.getSigners()
        mapper = await new TestSingleSlotMapper__factory(accounts[0]).deploy()
    })
    it("initialize", async () => {
        const mapData = await mapper.init()
        expect(await mapper.indexes(mapData)).to.eq(0)
        expect(await mapper.map(mapData, 0)).to.eq(0xf)
        expect(await mapper.map(mapData, 1)).to.eq(0xf)
        expect(await mapper.map(mapData, 61)).to.eq(0xf)
        await expect(mapper.map(mapData, 62)).to.rejectedWith("Index out of bounds")
    })
    describe("should add first value", async () => {
        let mapData: BN
        let index
        beforeEach(async () => {
            mapData = await mapper.init()
        })
        const testValues = [0, 1, 2, 14, 0xe]
        testValues.forEach((value) => {
            it(`${value}`, async () => {
                ;({ index, mapData_: mapData } = await mapper.addValue(mapData, value))
                expect(index).to.eq(0)
                expect(await mapper.map(mapData, 0)).to.eq(value)
                expect(await mapper.map(mapData, 1)).to.eq(0xf)
                expect(await mapper.map(mapData, 61)).to.eq(0xf)
                expect(await mapper.indexes(mapData)).to.eq(1)
            })
        })
    })
    it("fail to add invalid first value", async () => {
        const mapData = await mapper.init()
        await expect(mapper.addValue(mapData, 0xf)).to.rejectedWith("value out of bounds")
        await expect(mapper.addValue(mapData, 0x10)).to.rejectedWith("value out of bounds")
        await expect(mapper.addValue(mapData, 0xf0)).to.rejectedWith("value out of bounds")
        await expect(mapper.addValue(mapData, 0x100)).to.rejectedWith("value out of bounds")
        await expect(mapper.addValue(mapData, 0xf00)).to.rejectedWith("value out of bounds")
    })
    describe("should add three values", async () => {
        let mapData: BN
        let index
        beforeEach(async () => {
            mapData = await mapper.init()
        })
        const testValues = [
            [0, 0, 0],
            [1, 1, 1],
            [0, 1, 2],
            [14, 13, 12],
            [14, 14, 14],
        ]
        testValues.forEach((values) => {
            it(`${values}`, async () => {
                // Add first value
                ;({ index, mapData_: mapData } = await mapper.addValue(mapData, values[0]))
                expect(index).to.eq(0)
                expect(await mapper.map(mapData, 0)).to.eq(values[0])
                expect(await mapper.map(mapData, 1)).to.eq(0xf)
                expect(await mapper.map(mapData, 2)).to.eq(0xf)
                expect(await mapper.map(mapData, 3)).to.eq(0xf)
                expect(await mapper.map(mapData, 4)).to.eq(0xf)
                expect(await mapper.map(mapData, 61)).to.eq(0xf)
                expect(await mapper.indexes(mapData)).to.eq(1)
                // Add second value
                ;({ index, mapData_: mapData } = await mapper.addValue(mapData, values[1]))
                expect(index).to.eq(1)
                expect(await mapper.map(mapData, 0)).to.eq(values[0])
                expect(await mapper.map(mapData, 1)).to.eq(values[1])
                expect(await mapper.map(mapData, 2)).to.eq(0xf)
                expect(await mapper.map(mapData, 3)).to.eq(0xf)
                expect(await mapper.map(mapData, 4)).to.eq(0xf)
                expect(await mapper.map(mapData, 61)).to.eq(0xf)
                expect(await mapper.indexes(mapData)).to.eq(2)
                // Add third value
                ;({ index, mapData_: mapData } = await mapper.addValue(mapData, values[2]))
                expect(index).to.eq(2)
                expect(await mapper.map(mapData, 0)).to.eq(values[0])
                expect(await mapper.map(mapData, 1)).to.eq(values[1])
                expect(await mapper.map(mapData, 2)).to.eq(values[2])
                expect(await mapper.map(mapData, 3)).to.eq(0xf)
                expect(await mapper.map(mapData, 4)).to.eq(0xf)
                expect(await mapper.map(mapData, 61)).to.eq(0xf)
                expect(await mapper.indexes(mapData)).to.eq(3)
            })
        })
    })
    it("should add 62 values", async () => {
        let mapData = await mapper.init()
        const indexes = [...Array(62).keys()]
        for (const index of indexes) {
            const value = index % 15
            log(`index: ${index}, value: ${value}`)

            const result = await mapper.addValue(mapData, value)

            mapData = result.mapData_
            expect(result.index).to.eq(index)
            expect(await mapper.map(mapData, index)).to.eq(value)
            expect(await mapper.indexes(mapData)).to.eq(index + 1)
        }
    })
    it("fail to add 63 values", async () => {
        let mapData = await mapper.init()
        const indexes = [...Array(62).keys()]
        for (const index of indexes) {
            const value = (index + 1) % 15
            const result = await mapper.addValue(mapData, value)
            mapData = result.mapData_
        }
        await expect(mapper.addValue(mapData, 1)).to.rejectedWith("map full")
    })
    describe("remove vault", () => {
        let mapData: BN
        const indexes = [...Array(15).keys()]
        beforeEach(async () => {
            mapData = await mapper.init()
            for (const index of indexes) {
                const result = await mapper.addValue(mapData, index)
                mapData = result.mapData_
            }
            expect(await mapper.indexes(mapData), "index before").to.eq(15)
        })
        describe("should remove value", () => {
            const testValues = [0, 1, 2, 13, 14]
            testValues.forEach((value) => {
                it(`${value}`, async () => {
                    // Add first value
                    mapData = await mapper.removeValue(mapData, value)
                    expect(await mapper.map(mapData, 15)).to.eq(0xf)
                    expect(await mapper.map(mapData, 16)).to.eq(0xf)
                    expect(await mapper.map(mapData, 61)).to.eq(0xf)
                    expect(await mapper.indexes(mapData), "index after").to.eq(15)

                    for (const index of indexes) {
                        if (index === value) {
                            expect(await mapper.map(mapData, index)).to.eq(0xf)
                        } else {
                            expect(await mapper.map(mapData, index)).to.eq(index > value ? index - 1 : index)
                        }
                    }
                })
            })
        })
        it("fail to remove invalid value", async () => {
            await expect(mapper.removeValue(mapData, 0xf)).to.rejectedWith("value out of bounds")
            await expect(mapper.removeValue(mapData, 0x10)).to.rejectedWith("value out of bounds")
            await expect(mapper.removeValue(mapData, 0xf0)).to.rejectedWith("value out of bounds")
            await expect(mapper.removeValue(mapData, 0x100)).to.rejectedWith("value out of bounds")
            await expect(mapper.removeValue(mapData, 0xf00)).to.rejectedWith("value out of bounds")
        })
        it("fail to find value", async () => {
            mapData = await mapper.removeValue(mapData, 0)
            await expect(mapper.removeValue(mapData, 14)).to.rejectedWith("value not found")
        })
    })
})
