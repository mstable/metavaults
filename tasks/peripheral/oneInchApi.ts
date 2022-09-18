import { logger } from "@tasks/utils/logger"
import { BN } from "@utils/math"
import axios from "axios"

const log = logger("one-inch")

const ONE_INCH_END_POINT = "https://api.1inch.io/v4.0/"
const ONE_INCH_GATEWAY = "https://tx-gateway.1inch.io/v1.1/"

type QuoteParams = {
    fromTokenAddress: string
    toTokenAddress: string
    amount: string | number // including decimals
}
type AllowanceParams = {
    tokenAddress: string
    walletAddress: string
}
class SwapParams {
    fromTokenAddress: string

    toTokenAddress: string

    amount: string // including decimals

    fromAddress: string

    slippage: number // for example 1 means 1% of slippage.

    disableEstimate?: boolean = false

    allowPartialFill?: boolean = false
}

class OneInchRouter {
    chainId: number

    endPoint: string

    constructor(chainId: number, url: string = ONE_INCH_END_POINT) {
        if (!chainId) throw new Error("chainId is required")
        this.chainId = chainId
        // ie. 'https://api.1inch.exchange/v4.0'
        this.endPoint = `${url}${chainId}`
    }

    async getRouterRequest(resource: string, params: any): Promise<any> {
        const response = await axios.get<any>(`${this.endPoint}/${resource}`, {
            params,
            timeout: 5000,
        })
        log("getRouterRequest", response)
        return response
    }

    async getSwapTransaction(params: SwapParams): Promise<any> {
        return this.getRouterRequest("swap", params)
    }

    async getQuote(params: QuoteParams): Promise<BN> {
        const response = (await this.getRouterRequest("quote", params)) as unknown as { data: { toTokenAmount: string } }
        return BN.from(response.data.toTokenAmount)
    }

    async getHealthStatus(): Promise<boolean> {
        const response = await this.getRouterRequest("healthcheck", {})
        return response !== undefined
    }

    /**
     *
     * @return {*}  {Promise<string>} Address of the 1inch router that must be trusted to spend funds for the exchange
     * @memberof Router
     */
    async getSpenderAddress(): Promise<string> {
        const response = (await this.getRouterRequest("approve/spender`", {})) as unknown as { data: { address: string } }
        return response.data.address as string
    }

    async getAllowance(params: AllowanceParams): Promise<BN> {
        const response = (await this.getRouterRequest("approve/allowance`", params)) as unknown as { data: { allowance: number | string } }
        return BN.from(response.data.allowance)
    }

    async getApproveTransaction(tokenAddress: string, amount: string | undefined): Promise<{ data: string; to: string; value: string }> {
        const response = await this.getRouterRequest("approve/transaction`", {
            tokenAddress,
            amount,
        })
        const { data, to, value } = response
        return { data, to, value }
    }

    async broadCastRawTransaction(rawTransaction: any): Promise<string> {
        const response = (await axios.post<string>(
            `${ONE_INCH_GATEWAY}${this.chainId}/broadcast`,
            { rawTransaction },
            { timeout: 5000 },
        )) as unknown as { data: { transactionHash: string } }
        return response.data.transactionHash || ""
    }
}

export { OneInchRouter, SwapParams }
