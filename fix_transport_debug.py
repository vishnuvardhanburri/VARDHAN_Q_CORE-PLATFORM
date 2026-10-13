import sys

with open('backend/control_plane_api/src/receipt_transport.rs', 'r') as f:
    content = f.read()

# Add a print statement before record_transaction and record_receipt
content = content.replace(
    'if let Err(error) = store.record_transaction(&transaction).and_then(|_| store.record_receipt(&telemetry)) {',
    'println!("DEBUG: Recording transaction {} and receipt {}", transaction.transaction_id, receipt.receipt_id);\n    if let Err(error) = store.record_transaction(&transaction).and_then(|_| store.record_receipt(&telemetry)) {'
)

with open('backend/control_plane_api/src/receipt_transport.rs', 'w') as f:
    f.write(content)
