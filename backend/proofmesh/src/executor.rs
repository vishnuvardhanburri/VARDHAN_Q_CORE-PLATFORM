use crate::execution_plan::{ExecutionStep, ExecutionTarget};
use std::collections::HashSet;
use std::io::Write;
use std::time::Duration;
use tempfile::NamedTempFile;
use tokio::process::Command;
use tokio::time::timeout;

pub struct IsolatedExecutor {
    allowed_executables: HashSet<String>,
}

impl IsolatedExecutor {
    pub fn new() -> Self {
        let mut allowed = HashSet::new();
        allowed.insert("cargo".to_string());
        allowed.insert("nextest".to_string());
        allowed.insert("vardhan-replay".to_string());
        allowed.insert("vardhan-fault".to_string());

        Self {
            allowed_executables: allowed,
        }
    }

    pub async fn execute_step(
        &self,
        step: &ExecutionStep,
        timeout_ms: u64,
        max_memory_bytes: u64,
    ) -> Result<Vec<u8>, String> {
        let (cmd_name, mut cmd_args) = match &step.target {
            ExecutionTarget::RustTest {
                test_module,
                target_crate,
            } => (
                "cargo".to_string(),
                vec![
                    "test".to_string(),
                    "-p".to_string(),
                    target_crate.clone(),
                    test_module.clone(),
                ],
            ),
            ExecutionTarget::CargoNextest {
                profile,
                filter_expr,
            } => (
                "cargo".to_string(),
                vec![
                    "nextest".to_string(),
                    "run".to_string(),
                    "--profile".to_string(),
                    profile.clone(),
                    "-E".to_string(),
                    filter_expr.clone(),
                ],
            ),
            ExecutionTarget::Replay { capsule_ref } => (
                "vardhan-replay".to_string(),
                vec!["--capsule".to_string(), capsule_ref.0.to_string()],
            ),
            ExecutionTarget::FaultHarness { scenario_ref } => (
                "vardhan-fault".to_string(),
                vec!["--scenario".to_string(), scenario_ref.0.to_string()],
            ),
            ExecutionTarget::InternalVerification { routine_name } => {
                return Err(format!(
                    "Internal routines must be executed natively, not spawned: {}",
                    routine_name
                ));
            }
        };

        cmd_args.extend(step.arguments.clone());
        for arg in &cmd_args {
            if arg.contains(";") || arg.contains("&") || arg.contains("|") || arg.contains("$") {
                return Err("Shell injection vectors detected in arguments".to_string());
            }
        }

        if !self.allowed_executables.contains(&cmd_name) {
            return Err(format!(
                "Executable {} is not allowlisted for ProofMesh execution",
                cmd_name
            ));
        }

        // Shell-Free Execution: Construct native Command with argv passing
        let mut command = if !step.allowed_network_access {
            if cfg!(target_os = "linux") {
                let mut c = tokio::process::Command::new("unshare");
                c.arg("-n").arg("--").arg(&cmd_name);
                c
            } else if cfg!(target_os = "macos") {
                let mut c = tokio::process::Command::new("sandbox-exec");
                c.arg("-p")
                    .arg("(version 1) (allow default) (deny network*)")
                    .arg(&cmd_name);
                c
            } else {
                tokio::process::Command::new(&cmd_name)
            }
        } else {
            tokio::process::Command::new(&cmd_name)
        };

        for arg in &cmd_args {
            command.arg(arg);
        }

        command.env_clear();

        command.env("VARDHAN_ENV", "verification_sandbox");
        command.env("RUST_BACKTRACE", "1");

        let work_dir = tempfile::tempdir().map_err(|_| "Failed to create per-run directory")?;
        command.current_dir(work_dir.path());

        command.kill_on_drop(true);

        let timeout_duration = Duration::from_millis(timeout_ms);
        let execute_future = command.output();

        let result = match timeout(timeout_duration, execute_future).await {
            Ok(output_res) => output_res.map_err(|e| format!("Failed to spawn process: {}", e)),
            Err(_) => {
                return Err(format!(
                    "Execution timeout reached ({} ms). Process killed.",
                    timeout_ms
                ));
            }
        };

        let output = result?;
        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
}
