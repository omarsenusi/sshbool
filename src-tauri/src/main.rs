#![windows_subsystem = "windows"]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Immediately write any deep link argument to handoff file for the primary instance
    if let Some(url) = args.iter().skip(1).find(|a| a.starts_with("sshbool://")) {
        if let Some(mut path) = dirs::home_dir() {
            path.push("sshbool_deep_link_handoff.txt");
            let _ = std::fs::write(path, url);
        }
    }

    sshbool_lib::run();
}
