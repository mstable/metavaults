// eslint-disable-next-line simple-import-sort/imports
import config from "./hardhat.config"

import "./tasks/dex"
import "./tasks/liquidator"
import "./tasks/liquidatorVault"
import "./tasks/nexus"
import "./tasks/proxyAdmin"
import "./tasks/vault"
import "./tasks/time"
import "./tasks/token"
import "./tasks/deployment/localhost"
import "./tasks/convex3CrvVault"
import "./tasks/convex3CrvFork"
import "./tasks/convex3CrvMetaVault"
import "./tasks/curve3CrvVault"
import "./tasks/metaVaultManage"

export default config
