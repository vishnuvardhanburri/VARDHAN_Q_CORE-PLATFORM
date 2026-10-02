import express from 'express';
import cors from 'cors';
import { ExecutiveUltimatumGenerator } from './ExecutiveUltimatumGenerator.ts';

const app = express();
app.use(cors());
app.use(express.json());

// Basic in-memory tracking
const activeReceipts: any[] = [];
const generator = new ExecutiveUltimatumGenerator();

app.post('/api/strike', async (req, res) => {
    const { targetDomain } = req.body;
    
    if (!targetDomain) {
        return res.status(400).json({ error: 'targetDomain is required' });
    }

    try {
        console.log(`[API] Received Strike Request for ${targetDomain}`);
        const result = await generator.generateUltimatum({
            companyName: targetDomain.split('.')[0].toUpperCase(),
            domain: targetDomain
        });
        
        // We will mock the cryptographic strings for the UI response to look cool
        const receipt = {
            id: result.receiptId,
            hash: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
            pq: "ML-DSA-87 [NIST PQC]",
            ed: "Ed25519 [CLASSICAL]",
            email: result.emailBody
        };
        
        activeReceipts.push(receipt);
        res.json({ success: true, receipt });
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(50051, () => {
    console.log('[SYS] Vardhan Intelligence Live API Server listening on port 50051');
});
