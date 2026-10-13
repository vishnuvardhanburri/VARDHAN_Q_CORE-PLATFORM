pragma circom 2.1.9;

// poseidon-preimage@1 — prove knowledge of a private 2-field preimage whose
// Poseidon(2) digest equals the public output (ADR-0008: Poseidon in-circuit
// for v1 circuits). `digest` is the only public signal; the preimage stays
// hidden, so a proof attests "I know x with H(x) = digest" without revealing x.
//
// Publicity semantics of the pinned circom binary (v2.1.9, .tools/):
//   signal input  -> private witness (not in publicSignals)
//   signal output -> public witness
// The official `private` keyword and `main {public [...]}` list are NOT
// parseable by this binary, so publicity is expressed this way; the manifest
// (`poseidon-preimage@1`) records the effective interface.
//
// Input convention (must match the engine's PoseidonHashProvider):
//   preimage[0..1] are BN254 scalar field elements, canonical order.
//   digest = Poseidon(2)(preimage) — the standard circomlib Poseidon
//   permutation with nRoundsF=8, nRoundsP=57 (t = 3).
include "circomlib/circuits/poseidon.circom";

template PoseidonPreimage() {
    signal input preimage[2];
    signal output digest;

    component h = Poseidon(2);
    h.inputs[0] <== preimage[0];
    h.inputs[1] <== preimage[1];
    digest <== h.out;
}

component main = PoseidonPreimage();
