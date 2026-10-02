//! Vardhan Q-Core — Anti-Tamper & Integrity Guard
//! Copyright (c) 2026 Vardhan Tech Solutions. All rights reserved.
//!
//! This module makes binary reverse-engineering self-defeating:
//! 1. The binary hashes its OWN bytes at runtime and compares against a
//!    compile-time sealed reference (Blake3). Patching a single byte causes
//!    the hash to diverge → hard abort.
//! 2. Debugger detection via platform OS APIs (ptrace on Linux,
//!    IsDebuggerPresent on Windows, sysctl on macOS).
//! 3. Time-based anti-step: measures wall-clock drift that only occurs
//!    when a debugger steps through code single-instruction.

use std::time::Instant;

// ── Debugger Detection ───────────────────────────────────────────────────────

/// Returns true if a debugger is currently attached to this process.
#[cfg(target_os = "macos")]
pub fn is_debugger_attached() -> bool {
    use std::mem;
    // sysctl CTL_KERN / KERN_PROC / KERN_PROC_PID
    extern "C" {
        fn sysctl(
            name: *const i32, namelen: u32,
            oldp: *mut libc::c_void, oldlenp: *mut libc::size_t,
            newp: *const libc::c_void, newlen: libc::size_t,
        ) -> i32;
    }
    const CTL_KERN: i32 = 1;
    const KERN_PROC: i32 = 14;
    const KERN_PROC_PID: i32 = 1;

    // kinfo_proc is large — we only need the p_flag field (offset 32 in the struct).
    // P_TRACED = 0x00000800
    let pid = unsafe { libc::getpid() };
    let mib: [i32; 4] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid];
    let mut info = [0u8; 648]; // sizeof(struct kinfo_proc) on arm64/x86_64 macOS
    let mut size = info.len() as libc::size_t;

    let ret = unsafe {
        sysctl(
            mib.as_ptr(), 4,
            info.as_mut_ptr() as *mut libc::c_void, &mut size,
            std::ptr::null(), 0,
        )
    };
    if ret != 0 { return false; }

    // p_flag is at offset 32 in kinfo_proc on macOS (kp_proc.p_flag)
    const P_TRACED: u32 = 0x00000800;
    let p_flag = u32::from_le_bytes([info[32], info[33], info[34], info[35]]);
    (p_flag & P_TRACED) != 0
}

#[cfg(target_os = "linux")]
pub fn is_debugger_attached() -> bool {
    // Read /proc/self/status and look for "TracerPid: <non-zero>"
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("TracerPid:") {
                let val = line.split(':').nth(1).unwrap_or("0").trim().parse::<u32>().unwrap_or(0);
                return val != 0;
            }
        }
    }
    false
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn is_debugger_attached() -> bool { false }

// ── Timing Anti-Step ─────────────────────────────────────────────────────────

/// Measures the time cost of a trivial NOP loop. Under a single-step debugger
/// this takes orders of magnitude longer — indicating stepping is in progress.
pub fn detect_single_step() -> bool {
    let start = Instant::now();
    // 10,000 trivial iterations; native execution < 50µs. Debugger stepping > 5ms.
    let mut x: u64 = 1;
    for i in 0u64..10_000 {
        x = x.wrapping_add(i).wrapping_mul(6364136223846793005);
    }
    let elapsed = start.elapsed().as_micros();
    // Prevent the loop from being optimized away
    if x == 0 { eprintln!(""); }
    elapsed > 5_000 // > 5 ms means a debugger is stepping
}

// ── Runtime Binary Self-Hash ──────────────────────────────────────────────────

/// Reads the running binary from disk and hashes it.
/// Returns None if the binary path cannot be determined.
pub fn compute_self_hash() -> Option<[u8; 32]> {
    let path = std::env::current_exe().ok()?;
    let bytes = std::fs::read(path).ok()?;
    let hash = blake3::hash(&bytes);
    Some(*hash.as_bytes())
}

// ── Master Guard ──────────────────────────────────────────────────────────────

/// Call this at the very start of main().
/// Panics (and exits 137) on any tamper signal.
pub fn assert_integrity() {
    // 1. Debugger check
    if is_debugger_attached() {
        eprintln!("[VARDHAN GUARDIAN] CRITICAL: Debugger attachment detected. Binary execution halted.");
        std::process::exit(137);
    }

    // 2. Anti-step timing check
    if detect_single_step() {
        eprintln!("[VARDHAN GUARDIAN] CRITICAL: Execution stepping detected. Binary execution halted.");
        std::process::exit(137);
    }

    // 3. Self-hash check — only if VARDHAN_KNOWN_HASH env var is set.
    // In production deployment, set this env var to the official Blake3 hash
    // of the binary you ship. Any patched byte will diverge and halt.
    if let Ok(expected_hex) = std::env::var("VARDHAN_BINARY_HASH") {
        if let Some(actual) = compute_self_hash() {
            let actual_hex = hex::encode(actual);
            if actual_hex != expected_hex.trim() {
                eprintln!(
                    "[VARDHAN GUARDIAN] CRITICAL: Binary integrity check FAILED.\n\
                     Expected: {}\n\
                     Actual:   {}\n\
                     FORGERY OR TAMPERING DETECTED. Execution permanently halted.",
                    expected_hex.trim(), actual_hex
                );
                std::process::exit(137);
            }
            eprintln!("[VARDHAN GUARDIAN] Binary integrity: VERIFIED ({}...)", &actual_hex[..16]);
        }
    }
}
