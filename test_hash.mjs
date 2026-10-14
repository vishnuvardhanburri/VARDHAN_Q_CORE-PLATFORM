import { blake3 } from '@noble/hashes/blake3'; console.log(blake3(Buffer.from('test')).toString('hex'));
