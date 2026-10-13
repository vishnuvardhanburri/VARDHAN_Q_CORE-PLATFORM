import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VardhanComplianceCircuit {
    public readonly name = "Vardhan ZK-SNARK Compliance Shield";

    private wasmPath: string;
    private zkeyPath: string;
    private vkeyPath: string;

    constructor() {
        // Resolve paths to the generated cryptographic assets
        this.wasmPath = path.resolve(__dirname, '../compliance.wasm');
        this.zkeyPath = path.resolve(__dirname, '../compliance_final.zkey');
        this.vkeyPath = path.resolve(__dirname, '../verification_key.json');
    }

    public async generateConstraints(privateDecisionData: string, expectedPolicyHash: string) {
        console.log(`[CIRCUIT] Initializing REAL SNARK generation for ${this.name}...`);
        
        // Convert strings to BigInts or numbers for the Poseidon Hash (circom expects numeric inputs)
        // For demonstration of the REAL working engine, we map strings to simplified numbers.
        const secretNum = this.stringToCircomField(privateDecisionData);
        const policyNum = this.stringToCircomField(expectedPolicyHash);

        const input = {
            secretData: secretNum,
            policyHash: policyNum
        };

        try {
            console.log(`[CIRCUIT] Executing Wasm Witness Generation & Groth16 Prover...`);
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, this.wasmPath, this.zkeyPath);

            console.log(`[CIRCUIT] ZK-Proof Generated Successfully.`);
            
            // Verify it immediately to ensure it's mathematically sound
            const vKey = JSON.parse(fs.readFileSync(this.vkeyPath, "utf-8"));
            const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);

            if (!isValid) {
                throw new Error("Proof generated but verification failed.");
            }

            console.log(`[CIRCUIT] Mathematics Verified: True`);

            return {
                publicInputs: publicSignals,
                proof: proof,
                isValid: isValid
            };
        } catch (error) {
            console.error("[CIRCUIT] FAILED to generate or verify real ZK-SNARK:", error);
            return {
                publicInputs: [],
                proof: null,
                isValid: false
            };
        }
    }

    private stringToCircomField(str: string): string {
        // A simple hash function to map a string into a BN128 scalar field for Circom
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0; 
        }
        return Math.abs(hash).toString();
    }
}
