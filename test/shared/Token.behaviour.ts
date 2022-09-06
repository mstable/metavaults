import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"

import type { BigNumberish } from "ethers"
import type { Account } from "types"
import type { IERC20, InitializableTokenDetails } from "types/generated"

export type TokenERC20 = IERC20 & InitializableTokenDetails

export interface TokenContext {
    decimals: number
    token: TokenERC20
    sender: Account
    spender: Account
    recipient: Account
    maxAmount: BigNumberish
}

const testTransfer = async (ctx: TokenContext, amount: BigNumberish) => {
    const { token, sender, spender, recipient } = ctx

    const senderBalBefore = await token.balanceOf(sender.address)
    const spenderBalBefore = await token.balanceOf(spender.address)
    const recipientBalBefore = await token.balanceOf(recipient.address)

    const senderToRecipientAllowanceBefore = await token.allowance(sender.address, recipient.address)
    const senderToSpenderAllowanceBefore = await token.allowance(sender.address, spender.address)

    const tx = token.connect(sender.signer).transfer(recipient.address, amount)

    await expect(tx).to.emit(token, "Transfer").withArgs(sender.address, recipient.address, amount)

    expect(await token.balanceOf(spender.address), "spender bal").to.eq(spenderBalBefore)
    expect(await token.balanceOf(sender.address), "sender bal").to.eq(senderBalBefore.sub(amount))
    expect(await token.balanceOf(recipient.address), "recipient bal").to.eq(recipientBalBefore.add(amount))

    expect(await token.allowance(sender.address, recipient.address), "sender to recipient allowance").to.eq(
        senderToRecipientAllowanceBefore,
    )
    expect(await token.allowance(sender.address, spender.address), "sender to spender allowance").to.eq(senderToSpenderAllowanceBefore)
}

const testTransferFrom = async (ctx: TokenContext, amount: BigNumberish) => {
    const { token, sender, recipient, spender } = ctx

    const spenderBalBefore = await token.balanceOf(spender.address)
    const senderBalBefore = await token.balanceOf(sender.address)
    const recipientBalBefore = await token.balanceOf(recipient.address)

    // sender's allowance for the spender to transfer
    const senderToSpenderAllowanceBefore = await token.allowance(sender.address, spender.address)
    // sender's allowance for the recipient to transfer
    const senderToRecipientAllowanceBefore = await token.allowance(sender.address, recipient.address)

    const tx = token.connect(spender.signer).transferFrom(sender.address, recipient.address, amount)

    await expect(tx).to.emit(token, "Transfer").withArgs(sender.address, recipient.address, amount)

    expect(await token.balanceOf(spender.address), "spender bal").to.eq(spenderBalBefore)
    expect(await token.balanceOf(sender.address), "sender bal").to.eq(senderBalBefore.sub(amount))
    expect(await token.balanceOf(recipient.address), "recipient bal").to.eq(recipientBalBefore.add(amount))

    expect(await token.allowance(sender.address, spender.address), "sender allowance to spender ").to.eq(
        senderToSpenderAllowanceBefore.sub(amount),
    )
    expect(await token.allowance(sender.address, recipient.address), "sender allowance to recipient").to.eq(
        senderToRecipientAllowanceBefore,
    )
}

export function shouldBehaveLikeToken(ctx: () => TokenContext): void {
    it("token details", async () => {
        const { token } = ctx()
        expect(await token.name(), "name").to.not.eq(undefined)
        expect(await token.symbol(), "symbol").to.not.eq(undefined)
        expect(await token.decimals(), "decimals >= 0").to.gte(0)
        expect(await token.decimals(), "decimals <= 30").to.lt(30)
    })
    describe("sender should transfer to recipient", () => {
        describe("without allowance", () => {
            beforeEach(async () => {
                const { recipient, sender, token } = ctx()
                await token.connect(sender.signer).approve(recipient.address, 0)
            })
            it("zero amount", async () => {
                await testTransfer(ctx(), 0)
            })
            it("smallest unit", async () => {
                await testTransfer(ctx(), 1)
            })
            it("one whole unit", async () => {
                const { decimals } = ctx()
                const amount = decimals > 0 ? simpleToExactAmount(1, decimals) : 1
                await testTransfer(ctx(), amount)
            })
            it("all sender's tokens", async () => {
                const { sender, token } = ctx()
                await testTransfer(ctx(), await token.balanceOf(sender.address))
            })
        })
        describe("with allowance", () => {
            beforeEach(async () => {
                const { recipient, sender, token } = ctx()
                const allowanceAmount = await token.balanceOf(sender.address)
                await token.connect(sender.signer).approve(recipient.address, allowanceAmount)
            })
            it("zero", async () => {
                await testTransfer(ctx(), 0)
            })
            it("smallest unit", async () => {
                await testTransfer(ctx(), 1)
            })
            it("one whole unit", async () => {
                const { decimals } = ctx()
                const amount = decimals > 0 ? simpleToExactAmount(1, decimals) : 1
                await testTransfer(ctx(), amount)
            })
            it("all sender's tokens", async () => {
                const { sender, token } = ctx()
                await testTransfer(ctx(), await token.balanceOf(sender.address))
            })
        })
    })
    describe("sender should fail to transfer with insufficient balance", async () => {
        it("just over balance", async () => {
            const { recipient, sender, token } = ctx()
            const senderBalBefore = await token.balanceOf(sender.address)

            const tx = token.connect(sender.signer).transfer(recipient.address, senderBalBefore.add(1))

            await expect(tx).to.revertedWith("ERC20: transfer amount exceeds balance")
            expect(await token.balanceOf(sender.address), "sender bal").to.eq(senderBalBefore)
        })
        it("max amount", async () => {
            const { maxAmount, recipient, sender, token } = ctx()
            const senderBalBefore = await token.balanceOf(sender.address)

            const tx = token.connect(sender.signer).transfer(recipient.address, maxAmount)

            await expect(tx).to.revertedWith("ERC20: transfer amount exceeds balance")
            expect(await token.balanceOf(sender.address), "sender bal").to.eq(senderBalBefore)
        })
    })
    describe("spender should transfer from sender to recipient", () => {
        describe("with allowance same as sender balance", () => {
            beforeEach(async () => {
                const { sender, spender, token } = ctx()
                const allowanceAmount = await token.balanceOf(sender.address)
                await token.connect(sender.signer).approve(spender.address, allowanceAmount)
            })
            it("zero amount", async () => {
                await testTransferFrom(ctx(), 0)
            })
            it("smallest unit", async () => {
                await testTransferFrom(ctx(), 1)
            })
            it("one whole unit", async () => {
                const { decimals } = ctx()
                const amount = decimals > 0 ? simpleToExactAmount(1, decimals) : 1
                await testTransferFrom(ctx(), amount)
            })
            it("all sender's tokens", async () => {
                const { sender, token } = ctx()
                await testTransferFrom(ctx(), await token.balanceOf(sender.address))
            })
        })
        describe("with allowance 1/3 of sender balance", () => {
            let allowanceAmount: BigNumberish
            beforeEach(async () => {
                const { sender, spender, token } = ctx()
                allowanceAmount = (await token.balanceOf(sender.address)).div(3)
                await token.connect(sender.signer).approve(spender.address, allowanceAmount)
            })
            it("zero amount", async () => {
                await testTransferFrom(ctx(), 0)
            })
            it("smallest unit", async () => {
                await testTransferFrom(ctx(), 1)
            })
            it("one whole unit", async () => {
                const { decimals } = ctx()
                const amount = decimals > 0 ? simpleToExactAmount(1, decimals) : 1
                await testTransferFrom(ctx(), amount)
            })
            it("all allowance tokens", async () => {
                await testTransferFrom(ctx(), allowanceAmount)
            })
        })
    })
    describe("spender should fail to transfer from sender", async () => {
        it("just over sender balance", async () => {
            const { recipient, sender, spender, token } = ctx()
            const senderBalBefore = await token.balanceOf(sender.address)
            const allowanceAmount = senderBalBefore.add(1)
            await token.connect(sender.signer).approve(spender.address, allowanceAmount)

            const tx = token.connect(spender.signer).transferFrom(sender.address, recipient.address, allowanceAmount)

            await expect(tx).to.revertedWith("ERC20: transfer amount exceeds balance")

            expect(await token.balanceOf(sender.address), "sender bal").to.eq(senderBalBefore)
            expect(await token.allowance(sender.address, spender.address), "sender allows spender").to.eq(allowanceAmount)
        })
        it("just over allowance balance", async () => {
            const { recipient, sender, spender, token } = ctx()
            const senderBalBefore = await token.balanceOf(sender.address)
            // allowance amount is 1/3 of the sender's balance
            const allowanceAmount = senderBalBefore.div(3)
            await token.connect(sender.signer).approve(spender.address, allowanceAmount)

            const tx = token.connect(spender.signer).transferFrom(sender.address, recipient.address, allowanceAmount.add(1))

            await expect(tx).to.revertedWith("ERC20: insufficient allowance")

            expect(await token.balanceOf(sender.address), "sender bal").to.eq(senderBalBefore)
            expect(await token.allowance(sender.address, spender.address), "sender allows spender").to.eq(allowanceAmount)
        })
    })
}
export default shouldBehaveLikeToken
