pragma circom 2.0.0;
include "/Users/vishnuvardhanburri/vardhan-q-core/zk_engine/node_modules/circomlib/circuits/poseidon.circom";

template ComplianceShield() {
    signal input secretData;
    signal input policyHash;
    signal output decisionHash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== secretData;
    hasher.inputs[1] <== policyHash;

    decisionHash <== hasher.out;
}

component main {public [policyHash]} = ComplianceShield();
