// eslint-disable-next-line simple-import-sort/imports
import config from "./hardhat-fork.config"

import "./tasks/convex3CrvVault"
import "./tasks/dex"
import "./tasks/liquidator"
import "./tasks/nexus"
import "./tasks/proxyAdmin"
import "./tasks/vault"
import "./tasks/token"
import "./tasks/deployment/mainnet"

export default config
