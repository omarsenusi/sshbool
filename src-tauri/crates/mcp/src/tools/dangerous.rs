//! Definitions and dispatch handlers for all 10 DANGEROUS tier tools.

use super::ToolDefinition;
use crate::approval::ToolCallContext;
use crate::error::McpError;
use crate::policy::obfuscation::detect_obfuscation;
use crate::policy::risk::classify_command;
use crate::scope::resolve_host_in_scope;
use serde_json::{json, Value};
use sqlx::SqlitePool;

pub fn dangerous_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "exec_command".into(),
            description: "Execute arbitrary shell command on host (DANGEROUS - risk classified)"
                .into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "session_handle": { "type": "string" },
                    "command": { "type": "string" },
                    "cwd": { "type": "string" },
                    "reason": { "type": "string", "description": "Agent justification (required)" },
                    "show_terminal": { "type": "boolean", "default": false },
                    "timeout_seconds": { "type": "integer", "minimum": 1, "maximum": 300, "default": 60 }
                },
                "required": ["command", "reason"]
            }),
        },
        ToolDefinition {
            name: "exec_script".into(),
            description: "Execute multiline shell script file on host".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "script_content": { "type": "string" },
                    "interpreter": { "type": "string", "default": "/bin/bash" },
                    "reason": { "type": "string" }
                },
                "required": ["host_id", "script_content", "reason"]
            }),
        },
        ToolDefinition {
            name: "run_background_task".into(),
            description: "Spawn long-running background command on host".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "command": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["host_id", "command", "reason"]
            }),
        },
        ToolDefinition {
            name: "cancel_task".into(),
            description: "Terminate background task on host".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "task_id": { "type": "string" }
                },
                "required": ["host_id", "task_id"]
            }),
        },
        ToolDefinition {
            name: "read_task_logs".into(),
            description: "Read stdout/stderr log stream of background task".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "task_id": { "type": "string" }
                },
                "required": ["host_id", "task_id"]
            }),
        },
        ToolDefinition {
            name: "install_package".into(),
            description: "Install system package using package manager (apt/dnf/pacman)".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "package_name": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["host_id", "package_name", "reason"]
            }),
        },
        ToolDefinition {
            name: "restart_service".into(),
            description: "Restart or reload systemd service unit".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "unit": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["host_id", "unit", "reason"]
            }),
        },
        ToolDefinition {
            name: "reboot_host".into(),
            description: "Initiate system reboot or shutdown".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["host_id", "reason"]
            }),
        },
        ToolDefinition {
            name: "k8s_apply".into(),
            description: "Apply Kubernetes manifest YAML (secrets prohibited)".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "manifest_yaml": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["host_id", "manifest_yaml", "reason"]
            }),
        },
        ToolDefinition {
            name: "db_execute_mutation".into(),
            description: "Execute SQL DDL or DML mutation query".into(),
            tier: "dangerous".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "connection_id": { "type": "string" },
                    "sql_query": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["connection_id", "sql_query", "reason"]
            }),
        },
    ]
}

fn require_reason(args: &Value) -> Result<(), McpError> {
    let reason = args
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if reason.is_empty() {
        return Err(McpError::InvalidArguments(
            "Missing required reason for dangerous operation".into(),
        ));
    }
    Ok(())
}

/// Pre-approval validation for DANGEROUS tools (hard invariants, obfuscation, scope).
pub async fn validate_dangerous_tool(
    pool: &SqlitePool,
    client_id: &str,
    tool_name: &str,
    args: &Value,
) -> Result<(), McpError> {
    if let Some(host_id) = args.get("host_id").and_then(|v| v.as_str()) {
        resolve_host_in_scope(pool, client_id, host_id).await?;
    }

    match tool_name {
        "exec_command"
        | "exec_script"
        | "run_background_task"
        | "install_package"
        | "restart_service"
        | "reboot_host"
        | "k8s_apply"
        | "db_execute_mutation" => {
            require_reason(args)?;
        }
        _ => {}
    }

    if tool_name == "exec_command" || tool_name == "run_background_task" {
        let cmd = args["command"]
            .as_str()
            .ok_or_else(|| McpError::InvalidArguments("Missing command".into()))?;

        let signals = detect_obfuscation(cmd);
        if !signals.is_empty() {
            let reasons: Vec<String> = signals.iter().map(|s| s.reason.to_string()).collect();
            return Err(McpError::HardDeny(format!(
                "EVASION_DENIED: Command contains obfuscation: {}",
                reasons.join(", ")
            )));
        }

        let risk = classify_command(cmd);
        let lower = cmd.to_lowercase();
        if lower.contains("rm -rf /") || lower.contains("rm -rf /*") || lower.contains("mkfs") {
            return Err(McpError::HardDeny(format!(
                "HARD_DENY: Catastrophic command blocked by policy: {}",
                risk.reasons.join(", ")
            )));
        }
    }

    if tool_name == "exec_script" {
        let script = args["script_content"]
            .as_str()
            .ok_or_else(|| McpError::InvalidArguments("Missing script_content".into()))?;
        let signals = detect_obfuscation(script);
        if !signals.is_empty() {
            return Err(McpError::HardDeny(
                "EVASION_DENIED: Script contains obfuscation".into(),
            ));
        }
    }

    if tool_name == "k8s_apply" {
        let yaml = args["manifest_yaml"].as_str().unwrap_or_default();
        if yaml.to_lowercase().contains("kind: secret") {
            return Err(McpError::Forbidden(
                "Applying Kubernetes Secret manifests is prohibited".into(),
            ));
        }
    }

    Ok(())
}

async fn run_exec(
    exec: &std::sync::Arc<dyn crate::executor::McpToolExecutor>,
    host_id: &str,
    command: &str,
    args: &Value,
) -> Result<Value, McpError> {
    exec.exec_command(
        host_id,
        command,
        super::exec_show_terminal(args),
        super::exec_timeout_ms(args),
    )
    .await
}

/// Executes a DANGEROUS tier tool call after human approval.
pub async fn execute_dangerous_tool(
    ctx: &ToolCallContext,
    tool_name: &str,
    args: &Value,
    host_id: &str,
) -> Result<Value, McpError> {
    let exec = ctx
        .executor()
        .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;

    match tool_name {
        "exec_command" => {
            let command = args["command"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing command".into()))?;
            let cmd = if let Some(cwd) = args.get("cwd").and_then(|v| v.as_str()) {
                format!("cd {cwd} && {command}")
            } else {
                command.to_string()
            };
            run_exec(&exec, host_id, &cmd, args).await
        }
        "exec_script" => {
            let script = args["script_content"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing script_content".into()))?;
            let interpreter = args
                .get("interpreter")
                .and_then(|v| v.as_str())
                .unwrap_or("/bin/bash");
            run_exec(
                &exec,
                host_id,
                &format!("{interpreter} -s <<'SSHBBOOL_EOF'\n{script}\nSSHBBOOL_EOF"),
                args,
            )
            .await
        }
        "run_background_task" => {
            let command = args["command"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing command".into()))?;
            run_exec(
                &exec,
                host_id,
                &format!("nohup {command} > /tmp/sshbool-mcp-task.log 2>&1 & echo $!"),
                args,
            )
            .await
        }
        "cancel_task" => {
            let task_id = args["task_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing task_id".into()))?;
            run_exec(&exec, host_id, &format!("kill {task_id}"), args).await
        }
        "read_task_logs" => {
            run_exec(
                &exec,
                host_id,
                "tail -n 200 /tmp/sshbool-mcp-task.log",
                args,
            )
            .await
        }
        "install_package" => {
            let package = args["package_name"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing package_name".into()))?;
            run_exec(
                &exec,
                host_id,
                &format!(
                    "if command -v apt-get >/dev/null; then sudo apt-get install -y {package}; \
                     elif command -v dnf >/dev/null; then sudo dnf install -y {package}; \
                     elif command -v pacman >/dev/null; then sudo pacman -S --noconfirm {package}; \
                     else echo 'unsupported package manager'; fi"
                ),
                args,
            )
            .await
        }
        "restart_service" => {
            let unit = args["unit"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing unit".into()))?;
            run_exec(
                &exec,
                host_id,
                &format!("sudo systemctl restart {unit}"),
                args,
            )
            .await
        }
        "reboot_host" => run_exec(&exec, host_id, "sudo reboot", args).await,
        "k8s_apply" => {
            let yaml = args["manifest_yaml"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing manifest_yaml".into()))?;
            run_exec(
                &exec,
                host_id,
                &format!("kubectl apply -f - <<'SSHBBOOL_EOF'\n{yaml}\nSSHBBOOL_EOF"),
                args,
            )
            .await
        }
        "db_execute_mutation" => Err(McpError::ToolNotAvailable(
            "db_execute_mutation requires database connection wiring".into(),
        )),
        _ => Err(McpError::ToolNotAvailable(format!(
            "Unknown dangerous tool: {tool_name}"
        ))),
    }
}
