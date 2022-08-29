module.exports = {
    extends: [
        "airbnb-typescript",
        "plugin:@typescript-eslint/recommended",
        "prettier",
        "plugin:react/recommended",
        "plugin:import/recommended",
    ],
    env: {
        node: true,
        browser: true,
        jest: true,
    },
    parserOptions: {
        project: "./tsconfig.json",
    },
    settings: {
        "import/resolver": {
            alias: {
                map: [
                    ["@utils", "./test-utils"],
                    ["@test", "./test"],
                    ["@tasks", "./tasks"],
                    ["types/generated", "./types/generated/index", "types/contracts"],
                    ["types", "./types/index"],
                ],
                extensions: [".ts", ".d.ts", ".js", ".jsx", ".json"],
            },
        },
    },
    plugins: ["unused-imports", "simple-import-sort"],
    rules: {
        "import/no-extraneous-dependencies": "off",
        "no-console": "off",
        "import/prefer-default-export": "off",
        "no-nested-ternary": 1,
        "no-await-in-loop": 0,
        "no-restricted-syntax": 1,
        "@typescript-eslint/dot-notation": 1,
        "@typescript-eslint/no-use-before-define": 1,
        "@typescript-eslint/no-loop-func": 1,
        "@typescript-eslint/no-unused-expressions": 1,
        "lines-between-class-members": 0,
        "prefer-destructuring": [
            1,
            {
                array: false,
                object: false,
            },
            {
                enforceForRenamedProperties: false,
            },
        ],
        "@typescript-eslint/consistent-type-imports": "error",
        "unused-imports/no-unused-imports": "error",
        "simple-import-sort/imports": [
            "warn",
            {
                groups: [
                    // Side effect imports
                    ["^\\u0000"],
                    // React Package(s) comes first as seperate group
                    ["^react(-dom(/client)?)?$"],
                    // All other imports
                    ["^@?\\w"],
                    ["^((?!\\u0000$)|/.*|$)"],
                    ["^\\."],
                    // Type imports: keep these last!
                    ["^@?\\w.*\\u0000$"],
                    ["^.*\\u0000$"],
                    ["^\\..*\\u0000$"],
                ],
            },
        ],
    },
    overrides: [
        {
            files: [
                "./types/contracts.ts",
                "./types/interfaces.d.ts",
                "./types/**/*.ts",
                "./scripts/**/*.ts",
                "./test/**/*.ts",
                "./test-utils/**/*.ts",
            ],
        },
    ],
}
