pragma circom 2.1.9;

// merkle-inclusion@1 — prove membership of a private `leaf` in a binary Merkle
// tree of fixed height 4 whose public root is `root` (ADR-0008: Poseidon
// in-circuit hashing).
//
// Node hash: Poseidon(2)([left, right]).
// Path convention (must match the engine's MerklePath encoding):
//   level i counts from the leaf upward;
//   siblings[i] is the sibling at level i;
//   pathBits[i] is the i-th bit of the leaf index (LSB-first), where
//   0 = the current node is the LEFT child, 1 = the RIGHT child.
//
// Publicity semantics of the pinned circom binary (v2.1.9, .tools/):
//   signal input  -> private witness (not in publicSignals)
//   signal output -> public witness
// The official `private` keyword and `main {public [...]}` list are NOT
// parseable by this binary. `root` is therefore bound publicly through the
// `rootPub` output (rootPub <== root), so a proof asserts membership in a
// tree with a SPECIFIC public root. Public signals: [rootPub, isZero].
//
// Note: the pinned binary requires literal array sizes — the tree height (4)
// is fixed, matching the certified manifest arity.
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/comparators.circom";

template MerkleInclusion() {
    signal input root;
    signal input leaf;
    signal input siblings[4];
    signal input pathBits[4];
    signal output rootPub;
    signal output isZero;

    rootPub <== root;

    component leftSel[4];
    component rightSel[4];
    component hashes[4];

    for (var i = 0; i < 4; i++) {
        // pathBits must be binary (0 = left child, 1 = right child).
        pathBits[i] * (1 - pathBits[i]) === 0;

        leftSel[i] = Mux1();
        leftSel[i].s <== pathBits[i];
        rightSel[i] = Mux1();
        rightSel[i].s <== pathBits[i];

        if (i == 0) {
            leftSel[i].c[0] <== leaf;
            leftSel[i].c[1] <== siblings[i];
            rightSel[i].c[0] <== siblings[i];
            rightSel[i].c[1] <== leaf;
        } else {
            leftSel[i].c[0] <== hashes[i-1].out;
            leftSel[i].c[1] <== siblings[i];
            rightSel[i].c[0] <== siblings[i];
            rightSel[i].c[1] <== hashes[i-1].out;
        }

        hashes[i] = Poseidon(2);
        hashes[i].inputs[0] <== leftSel[i].out;
        hashes[i].inputs[1] <== rightSel[i].out;
    }

    component check = IsZero();
    check.in <== root - hashes[3].out;
    isZero <== check.out;
}

component main = MerkleInclusion();
