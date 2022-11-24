import { contractNames, getChainAddress } from "@tasks/utils"
import { Chain, tokens } from "@tasks/utils/tokens"
import { copySync, outputFileSync, outputJsonSync, readdirSync, readJsonSync, removeSync } from "fs-extra"
import { join, resolve } from "path"
import sh from "shelljs"

import type { Token } from "@tasks/utils/tokens"

const names = {
    main: "index.js",
    types: "index.d.ts",
}

const paths = {
    package: resolve("package.json"),
    tmp: resolve("tmp"),
    abis: resolve("abis"),
    out: resolve("dist-web"),
    license: resolve("LICENSE"),
    readme: resolve("README.md"),
    tsconfig: resolve("tsconfig.json"),
}

const tsconfig = {
    compilerOptions: {
        target: "ES2020",
        lib: ["dom", "ES2022"],
        module: "CommonJS",
        declaration: true,
        esModuleInterop: true,
        moduleResolution: "Node",
        sourceMap: false,
        allowJs: false,
        resolveJsonModule: true,
        skipLibCheck: true,
        outDir: paths.out,
    },
}

const chainMapping: Record<Chain, number> = {
    [Chain.mainnet]: 1,
    [Chain.polygon]: 137,
    [Chain.mumbai]: 80001,
    [Chain.goerli]: 5,
    [Chain.sepolia]: 11155111,
}

const clean = () => {
    removeSync(paths.tmp)
    removeSync(paths.out)
}

const compile = () => {
    // tokens.ts
    try {
        const toks: Record<number, Record<string, Token>> = tokens.reduce(
            (acc, curr) => ({
                ...acc,
                [chainMapping[curr.chain]]: {
                    ...acc[chainMapping[curr.chain]],
                    [curr.symbol.toLowerCase()]: {
                        address: curr.address.toLowerCase(),
                        name: curr.symbol,
                        decimals: curr.decimals,
                    },
                },
            }),
            {},
        )
        const types = tokens.reduce((acc, curr) => acc.add(curr.symbol.toLocaleLowerCase()), new Set())
        outputFileSync(
            join(paths.tmp, "tokens.ts"),
            `export type SupportedToken = '${Array.from(types).join("'|'")}';
export const tokens = ${JSON.stringify(toks, null, 2)}
        `,
        )
    } catch (e) {
        console.error("Error writing token.ts ", e)
    }

    // contracts.ts
    try {
        const contracts = Object.entries(chainMapping).reduce(
            (acc, [chain, id]) => ({
                ...acc,
                [id]: contractNames.reduce((a, name) => ({ ...a, [name]: getChainAddress(name, Number(chain))?.toLowerCase() }), {}),
            }),
            {},
        )
        const types = contractNames.reduce((acc, curr) => acc.add(curr), new Set())
        outputFileSync(
            join(paths.tmp, "contracts.ts"),
            `export type SupportedContract = '${Array.from(types).join("'|'")}';
export const contracts = ${JSON.stringify(contracts, null, 2)}`,
        )
    } catch (e) {
        console.error("Error writing contracts.ts ", e)
    }

    // abis
    let abis: string[]
    try {
        sh.exec("yarn compile")
        sh.exec("yarn compile-abis")
        copySync(paths.abis, join(paths.tmp, "abis"))
        abis = readdirSync(join(paths.tmp, "abis"))
    } catch (e) {
        console.error("Error extracting abis ", e)
    }

    // index.ts
    try {
        outputFileSync(
            join(paths.tmp, "index.ts"),
            `export * from "./contracts"\nexport * from "./tokens"\n${abis
                .map((abi) => `export { default as ${abi.replace(".json", "")}ABI } from "./abis/${abi}"`)
                .join(`\n`)}`,
        )
    } catch (e) {
        console.error("Error writing index.ts ", e)
    }
}

const bundle = () => {
    // package.json
    try {
        const { name, version, description, author, license, repository, bugs, homepage, keywords } = readJsonSync(paths.package)
        outputJsonSync(join(paths.tmp, "package.json"), {
            name: `${name}-web`,
            version,
            description,
            author,
            license,
            repository: { ...repository, url: "https://github.com/mstable/metavaults" },
            bugs,
            homepage,
            keywords,
            main: names.main,
            types: names.types,
            // Enable if it is desired to publish to git hub packages
            publishConfig: {
                registry: "https://registry.npmjs.org",
                email: "info@mstable.com",
                scope: "@mstable",
            },
        })
    } catch (e) {
        console.error("Error writing package.json ", e)
    }

    // typescript
    try {
        outputJsonSync(join(paths.tmp, "tsconfig.json"), tsconfig)
        sh.exec(`npx tsc --project ${join(paths.tmp, "tsconfig.json")}`)
    } catch (e) {
        console.error("Error compiling typescript ", e)
    }

    // misc files
    try {
        copySync(join(paths.tmp, "package.json"), join(paths.out, "package.json"))
        copySync(paths.license, join(paths.out, "LICENSE"))
        copySync(paths.readme, join(paths.out, "README.md"))
    } catch (e) {
        console.error("Error copying legal ", e)
    }
}

const publish = () => {
    // publish
    try {
        sh.exec(`npm publish  --access public`, { cwd: paths.out })
    } catch (e) {
        console.error("Error publishing npm package ", e)
    }
}

    ; (async () => {
        clean()
        compile()
        bundle()
        publish()
        clean()
    })()
