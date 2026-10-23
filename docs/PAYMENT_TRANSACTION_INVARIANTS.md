# Payment transaction invariant matrix

Separate from the finding gate. **No complete payment authorization/settlement claim.**
All rows are mandatory production requirements; absent evidence blocks release.

| ID | Acceptance condition | Existing enforcement / tests | Remaining limitation |
|---|---|---|---|
| PAY-01 | authenticated tenant/caller/institution/application/role | institutional registry key comparison | tenant/application/role binding absent in ISO model |
| PAY-02 | exact approved schema/version/profile | payment_xml root+namespace checks; XML regression tests | official XSD and market profile absent |
| PAY-03 | one unambiguous business message and transaction | direct-child paths, NbOfTxs=1 | official mandatory-field semantics incomplete |
| PAY-04 | exact amount/currency and authorised limit | unsigned-decimal syntax, finite positive amount/limit; payment gate tests | f64 precision and currency decimal scales unresolved |
| PAY-05 | valid beneficiary/account relationships | required account paths; missing-account regression | account checksums/existence and ownership unresolved |
| PAY-06 | trusted current signing keys and algorithms | active/expiry/registry checks; substitution/revocation tests | not-before, key-ID registry, rotation history incomplete |
| PAY-07 | signatures bind exact content and context | V2 tuple + parsed document digest; metadata/whitespace tests | independent representation/protocol review pending |
| PAY-08 | originator/destination institution authorised | BIC relationship and blocklist checks | static blocklist is not sanctions; routing identity incomplete |
| PAY-09 | valid ID and trusted freshness | UETR/EndToEndId checks, RFC3339 conversion; date tests | freshness clock source and full UUID/BIC semantics need review |
| PAY-10 | durable uniqueness across concurrency/failure | PaymentIdempotencyStore interface | bundled in-memory store is not durable/cross-node |
| PAY-11 | permitted state transition before dispatch | transaction model exists separately | integrated payment durable state machine absent |
| PAY-12 | authorised downstream destination/adapter | FrameIngressHandler interface | no approved bank adapter or counterparty acceptance |
| PAY-13 | explicit unknown outcome and reconciliation | receipt CLI OUTCOME_UNKNOWN repair | downstream outbox/inbox and recovery absent |
| PAY-14 | independently verifiable minimal receipt/audit | finding receipt/audit tools exist separately | payment receipt schema and external anchoring incomplete |

Financial gate acceptance is only a local validation/reservation decision. It is never
confirmation, settlement, a fraud decision or permission to bypass bank controls.
