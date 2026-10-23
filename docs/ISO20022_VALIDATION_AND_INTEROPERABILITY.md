# ISO 20022 validation and interoperability

**Experimental internal profile; NOT approved for SWIFT, CHAPS, FedNow or a bank.**
No official XSD, network usage-guide or independent counterparty test was performed.

## Implemented parser policy

`core_crypto/src/payment_xml.rs` uses roxmltree 0.21.1 for structural interpretation
and quick-xml 0.41.0 for escaped output. Inputs are UTF-8 Rust strings, limited to
1 MiB, 20,000 parser nodes and 64 ancestor levels. DTDs/external entities, comments,
processing instructions, duplicate/nested roots, mixed payment namespaces and
ambiguous security fields fail closed. No external resource retrieval is performed.
The work is bounded by input/node/depth limits; there is no independent wall-clock
parser deadline. Production ingress still needs concurrency, rate and request timeouts.

Supported namespace/root pairs are only:

- `urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08` / `FIToFICstmrCdtTrf`.
- `urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08` / `FICdtTrf`.

One Document, one message root, one GrpHdr and one CdtTrfTxInf are required. Payment
field extraction checks NbOfTxs=1 and exact direct-child paths. Other message versions,
batches and extensions are rejected. This deliberately removes former guessed support
for pacs.002 and pain.001; those require distinct schemas and business semantics.
Structural parsing is not XSD validation. Synthetic fixtures are not official bank fixtures.

## V2 signing representation and compatibility

The parsed root is recursively encoded as JSON arrays:
`["element", namespace-or-empty, local-name, sorted-expanded-attributes, children]`;
text nodes are `["text", exact-decoded-character-data]`. Child order and text whitespace
are retained. The sole validated Vardhan supplementary envelope is excluded. Namespace
prefix spelling is resolved to expanded names. This is an application representation,
**not W3C C14N or XMLDSig**. Changing meaningful text whitespace invalidates signatures.

BLAKE3 commits to those UTF-8 JSON bytes. Both Ed25519 strict verification and ML-DSA-87
(with empty ML-DSA context) sign the same serialized tuple:
`["VARDHAN-ISO20022-SEAL-V2", classical_algorithm, pq_algorithm, signer_bic, key_id,
message_type, payload_digest, ed_public_key_hex, ml_public_key_hex, epoch_timestamp]`.
The envelope uses namespace `urn:vardhan:qcore:pqc:2` and placement marker
`VARDHAN-QCORE-PQC-SEAL-V2`. XML output is escaped through the writer and reparsed;
the business representation must remain identical before and after transformation.
The old V1 digest-only signature format is rejected. Migrate by re-authorising and
re-signing synthetic/staged messages; never reinterpret archived V1 seals as V2.

## Institutional authentication

Authenticated verification compares both keys to the configured registry, rejects
unknown, inactive and expired signers, checks permitted message type and institution
identity, and verifies the exact document/version and signed metadata. The standalone
`verify_iso20022_pqc_seal` API checks consistency only and is unsuitable as identity
authority. BIC registry entries currently lack tenant/application/role, not-before,
versioned key IDs and rotation history. Deployment must supply these missing controls;
embedding a key or key ID does not establish ownership.

## Release blockers and required interoperability evidence

Obtain official schemas and applicable market profile from an authorised source; pin
checksums/licenses, validate both input and transformed output against them, check
supplementary extension permission and schema ordering, and exchange adversarial fixtures
with the intended counterparty. Implement exact currency-specific decimal arithmetic,
account semantics, route authorization, transaction status and durable reconciliation.
The local BIC/currency checks and static blocked-BIC list do not implement sanctions,
fraud, settlement or regulatory controls. No production adapter is certified here.

## Error compatibility

`PaymentGateError::InvalidField` distinguishes malformed RFC3339 values, unsupported
subseconds/pre-epoch dates, transaction counts and oversized message IDs from internal
policy/clock faults. This adds a public enum variant: downstream exhaustive Rust
matches must handle it. No repository consumers outside the defining module were
found. Rejection remains mandatory; this changes classification, not acceptance.
