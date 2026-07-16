#![allow(dead_code)]

//! Event topic helpers.

pub const APP_LOCK: &str = "app://lock";

pub fn terminal_data(pane_id: &str) -> String {
    format!("terminal://data/{pane_id}")
}

pub fn terminal_exit(pane_id: &str) -> String {
    format!("terminal://exit/{pane_id}")
}

pub fn transfer_progress(job_id: &str) -> String {
    format!("transfer://progress/{job_id}")
}

pub fn connection_state(host_id: &str) -> String {
    format!("connection://state/{host_id}")
}

pub fn metrics_snapshot(host_id: &str) -> String {
    format!("metrics://snapshot/{host_id}")
}
