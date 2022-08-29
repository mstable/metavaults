// eslint-disable-next-line simple-import-sort/imports
import config from "./hardhat-fork-polygon.config"

import "./tasks/nexus"
import "./tasks/proxyAdmin"
import "./tasks/token"
import "./tasks/vault"
import "./tasks/liquidator"
import "./tasks/dex"

export default config
