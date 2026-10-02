import re

with open("proxy_engine/src/lib.rs", "r") as f:
    content = f.read()

# Replace ProxySession with SessionContext in imports and usages
content = content.replace("use crate::session::SessionContext;", "")
content = content.replace("pub mod transport;", "pub mod transport;\npub mod session;\nuse crate::session::{derive_session_context, SessionContext};\nuse crate::transport::AeadTransport;")

# Rewrite transcript_hash
transcript_old = r'''fn transcript_hash\(hello_a: &\[u8\], hello_b: &\[u8\]\) -> \[u8; 32\] \{
    let mut hasher = blake3::Hasher::new\(\);
    hasher.update\(hello_a\);
    hasher.update\(hello_b\);
    \*hasher.finalize\(\).as_bytes\(\)
\}'''

transcript_new = r'''fn transcript_hash(hello_a: &[u8], hello_b: &[u8], kem_a: &[u8], kem_b: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"V1.0");
    hasher.update(hello_a);
    hasher.update(hello_b);
    hasher.update(kem_b);
    hasher.update(kem_a);
    *hasher.finalize().as_bytes()
}'''

content = re.sub(transcript_old, transcript_new, content)

# Replace ProxySession definition
proxy_session_old = r'''#\[derive\(Clone\)\]
pub struct ProxySession \{
    pub peer_addr: SocketAddr,
    pub shared_secret: Vec<u8>,
    pub session_key: Zeroizing<\[u8; 32\]>,
\}'''

content = re.sub(proxy_session_old, "", content)
content = content.replace("-> Result<ProxySession, ProxyError>", "-> Result<SessionContext, ProxyError>")

# Update run_responder
run_resp_old = r'''    // 6\. Combine secrets \+ derive session key
    let raw_secret = xor_secrets\(&ss_b, &ss_a\);
    let salt = transcript_hash\(&f1, &our_hello\);
    let session_key = derive_session_keys\(&raw_secret, &salt\)\?;

    info!\("Responder: handshake complete — session key derived"\);
    Ok\(ProxySession \{
        peer_addr,
        shared_secret: raw_secret,
        session_key,
    \}\)
\}'''

run_resp_new = r'''    // 6. Combine secrets + derive session key
    let raw_secret = xor_secrets(&ss_b, &ss_a);
    let salt = transcript_hash(&f1, &our_hello, &f4, &f3);
    let session_ctx = derive_session_context(&raw_secret, &salt)?;

    info!("Responder: handshake complete — session context derived");
    Ok(session_ctx)
}'''

content = re.sub(r"write_frame\(stream, &build_kem_ct\(identity, &ct_b\)\?\)\.await\?;", "let f3 = build_kem_ct(identity, &ct_b)?;\n    write_frame(stream, &f3).await?;", content)
content = re.sub(run_resp_old, run_resp_new, content)

# Update run_initiator
run_init_old = r'''    // 6\. Combine secrets \+ derive session key
    let raw_secret = xor_secrets\(&ss_b, &ss_a\);
    let salt = transcript_hash\(&our_hello, &f2\);
    let session_key = derive_session_keys\(&raw_secret, &salt\)\?;

    info!\("Initiator: handshake complete — session key derived"\);
    Ok\(ProxySession \{
        peer_addr,
        shared_secret: raw_secret,
        session_key,
    \}\)
\}'''

run_init_new = r'''    // 6. Combine secrets + derive session key
    let raw_secret = xor_secrets(&ss_b, &ss_a);
    let salt = transcript_hash(&our_hello, &f2, &f3, &f4);
    let session_ctx = derive_session_context(&raw_secret, &salt)?;

    info!("Initiator: handshake complete — session context derived");
    Ok(session_ctx)
}'''

content = re.sub(r"write_frame\(stream, &build_kem_ct\(identity, &ct_a\)\?\)\.await\?;", "let f3 = build_kem_ct(identity, &ct_a)?;\n    write_frame(stream, &f3).await?;", content)
content = re.sub(run_init_old, run_init_new, content)

# Fix ProxySession references
content = content.replace("Result<(ProxySession, TcpStream), ProxyError>", "Result<(SessionContext, TcpStream), ProxyError>")
content = content.replace("Result<ProxySession, ProxyError>", "Result<SessionContext, ProxyError>")

with open("proxy_engine/src/lib.rs", "w") as f:
    f.write(content)
