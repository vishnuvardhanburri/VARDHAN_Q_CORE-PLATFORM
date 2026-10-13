use core_crypto::QuantumNodeIdentity;
use poc_auditor::CisoPdfGenerator;
use saas_metering::UsageMeter;

fn main() {
    println!("==================================================================");
    println!(" VARDHAN TECHNOLOGIES :: DORA / NIS2 CISO AUDIT REPORT GENERATOR");
    println!("==================================================================");

    let font_path = "poc_auditor/fonts/Roboto-Regular.ttf";
    let generator = match CisoPdfGenerator::new(font_path) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("Error initializing PDF generator: {}", e);
            return;
        }
    };

    println!("[*] Initializing Metering Sandbox...");
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let meter = UsageMeter::new("TENANT_LLOYDS_BANK_01".to_string());

    // Simulate some traffic processing
    for _ in 0..154320 {
        meter.record_transaction(150); // 150 bytes per payload
    }

    let receipt = meter.generate_signed_receipt(&identity);
    let output_file = "CISO_Audit_Report.pdf";

    println!("[*] Generating Cryptographic Audit Receipt...");
    println!("[*] Tenant: {}", receipt.tenant_id);
    println!(
        "[*] BLAKE3 Merkle Hash: {}",
        hex::encode(&receipt.blake3_audit_hash)
    );

    match generator.generate_dora_report(&receipt, output_file) {
        Ok(report) => {
            println!("------------------------------------------------------------------");
            println!(" SUCCESS: DORA / NIS2 Audit Report Generated!");
            println!(" File: {}", output_file);
            println!(" Shielded Requests: {}", report.total_requests_shielded);
            println!(" Total Encrypted: {} bytes", report.total_bytes_encrypted);
            println!("==================================================================");
        }
        Err(e) => eprintln!("Failed to generate report: {}", e),
    }
}
