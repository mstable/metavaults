// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.16;
import { ICowSettlement } from "../../peripheral/Cowswap/ICowSettlement.sol";

contract MockGPv2Settlement is ICowSettlement {
    /// @dev The EIP-712 domain type hash used for computing the domain
    /// separator.
    bytes32 private constant DOMAIN_TYPE_HASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    /// @dev The EIP-712 domain name used for computing the domain separator.
    bytes32 private constant DOMAIN_NAME = keccak256("Gnosis Protocol");

    /// @dev The EIP-712 domain version used for computing the domain separator.
    bytes32 private constant DOMAIN_VERSION = keccak256("v2");

    /// @dev Marker value indicating an order is pre-signed.
    uint256 private constant PRE_SIGNED = uint256(keccak256("GPv2Signing.Scheme.PreSign"));

    /// @dev The domain separator used for signing orders that gets mixed in
    /// making signatures for different domains incompatible. This domain
    /// separator is computed following the EIP-712 standard and has replay
    /// protection mixed in so that signed orders are only valid for specific
    /// GPv2 contracts.
    bytes32 public immutable domainSeparator;

    /// @dev Storage indicating whether or not an order has been signed by a
    /// particular address.
    mapping(bytes => uint256) public preSignature;

    /// @dev Event that is emitted when an account either pre-signs an order or
    /// revokes an existing pre-signature.
    event PreSignature(address indexed owner, bytes orderUid, bool signed);

    constructor() {
        // NOTE: Currently, the only way to get the chain ID in solidity is
        // using assembly.
        uint256 chainId;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }

        domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPE_HASH, DOMAIN_NAME, DOMAIN_VERSION, chainId, address(this))
        );
    }

    /// @dev Sets a presignature for the specified order UID.
    ///
    /// @param orderUid The unique identifier of the order to pre-sign.
    function setPreSignature(bytes calldata orderUid, bool signed) external override {
        // (, address owner, ) = orderUid.extractOrderUidParams();
        address owner = msg.sender;
        // require(owner == msg.sender, "GPv2: cannot presign order");
        if (signed) {
            preSignature[orderUid] = PRE_SIGNED;
        } else {
            preSignature[orderUid] = 0;
        }
        emit PreSignature(owner, orderUid, signed);
    }
}
